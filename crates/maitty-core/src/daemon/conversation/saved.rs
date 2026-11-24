//! The conversations Claude and Codex saved for a folder (`Query::SavedConversations`), or in any
//! folder (`Query::ImportableChats`): the id, the first thing the person typed, and when the file was
//! last written. Read only from each agent's own store; a folder just picks which of its files count.
//! Runs on a blocking thread.

use super::follow_transcript::{ClaudeLine, claude_line, codex_text, is_codex_context, without_paste_tags};
use super::tool_input::clean_text;
use crate::config::same_path;
use crate::protocol::{
    IMPORTABLE_CHATS_MAX, IMPORTABLE_CHATS_PER_FOLDER, ImportableChat, SAVED_CONVERSATIONS_MAX,
    SAVED_FIRST_MESSAGE_MAX_CHARS, SavedConversation, SavedConversations,
};
use std::collections::{HashMap, HashSet};
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Most files looked at for one answer, newest first.
const FILES_MAX: usize = 500;
/// How much of a file's start is read for its first message: Codex writes about 150 KiB of its own
/// instructions before the person's first words.
const HEAD_MAX_BYTES: u64 = 1024 * 1024;
/// How much of a Codex file's first line is read for its folder and id.
const CODEX_META_MAX_BYTES: u64 = 64 * 1024;
/// How much of the end of a long Claude file is read for the name it was given: Claude appends
/// its generated title again as the chat goes on, and `/rename` appends the person's.
const TAIL_MAX_BYTES: u64 = 256 * 1024;
/// How much of the end of Codex's `session_index.jsonl` (a thread's id and name, one line each
/// time it is named) is read for names.
const CODEX_INDEX_MAX_BYTES: u64 = 1024 * 1024;
/// The longest id passed on: it is what a later resume is given.
const ID_MAX_CHARS: usize = 128;

/// Where each agent keeps its saved conversations.
pub(in crate::daemon) struct Stores {
    /// Claude's `projects` folder: one folder per working folder, one `<session>.jsonl` each.
    pub claude: Option<PathBuf>,
    /// Codex's `sessions` folder: `YYYY/MM/DD/rollout-….jsonl`.
    pub codex: Option<PathBuf>,
}

impl Stores {
    pub fn of_this_user(home: Option<&Path>) -> Stores {
        let claude_root = std::env::var_os("CLAUDE_CONFIG_DIR")
            .map(PathBuf::from)
            .or_else(|| home.map(|home| home.join(".claude")));
        Stores {
            claude: claude_root.map(|root| root.join("projects")),
            codex: crate::daemon::usage::codex_sessions(),
        }
    }
}

/// The conversations `agent` saved for `folder`, newest first. A folder with none, or a store that
/// is not there, is an empty list; an agent whose conversations are not read is `NotSupported`.
pub(in crate::daemon) fn list(agent: &str, folder: &Path, stores: &Stores) -> SavedConversations {
    let found = match agent.trim().to_ascii_lowercase().as_str() {
        "claude" => stores.claude.as_deref().map(|root| claude(root, folder)),
        "codex" => stores.codex.as_deref().map(|root| codex(root, folder)),
        _ => return SavedConversations::NotSupported,
    };
    SavedConversations::Listed(found.unwrap_or_default())
}

fn claude(root: &Path, folder: &Path) -> Vec<SavedConversation> {
    let folder = &real_folder(folder);
    let files = newest_first(jsonl_files(&root.join(claude_folder_name(folder))));
    files
        .into_iter()
        .filter_map(|(file, modified)| {
            let id = file.file_stem()?.to_str()?.to_owned();
            let head = read_or_log(&file, HEAD_MAX_BYTES)?;
            let first_message = claude_first_message(&head, folder)?;
            saved(id, first_message, claude_title(&file, &head), modified)
        })
        .take(SAVED_CONVERSATIONS_MAX)
        .collect()
}

/// The real path of `folder`, which Claude runs in (`transport` resolves it) and so names its
/// transcripts' folder from and writes as their `cwd`. `folder` can be another name for it: a link,
/// or a Windows short name (`RUNNER~1`). One that cannot be resolved is kept as given.
pub(super) fn real_folder(folder: &Path) -> PathBuf {
    std::fs::canonicalize(folder).map_or_else(|_| folder.to_path_buf(), crate::daemon::clean_path)
}

/// The folder Claude keeps a working folder's transcripts in: every character but an ASCII letter or
/// digit becomes `-` (`C:\dev\app` is `C--dev-app`). Two folders can share a name, so each
/// transcript's own `cwd` is checked too.
pub(super) fn claude_folder_name(folder: &Path) -> String {
    let folder = folder.to_string_lossy();
    // Claude names the folder from the plain path it runs in. A canonicalized Windows path starts
    // with `\\?\`, which would name a folder Claude never made.
    let folder = folder.strip_prefix(r"\\?\").unwrap_or(&folder);
    folder
        .trim_end_matches(['/', '\\'])
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// The first thing the person typed in a Claude transcript, when the transcript is `folder`'s.
fn claude_first_message(head: &str, folder: &Path) -> Option<String> {
    claude_said(head, |cwd| same_path(cwd, folder)).map(|(_, said)| said)
}

/// The folder a Claude transcript ran in and the first thing the person typed there, when `wanted`
/// takes the folder of each of the person's lines up to it.
fn claude_said(head: &str, wanted: impl Fn(&Path) -> bool) -> Option<(PathBuf, String)> {
    for line in complete_lines(head).filter_map(|line| serde_json::from_str::<Value>(line).ok()) {
        if line.get("type").and_then(Value::as_str) != Some("user")
            || line.get("isMeta").and_then(Value::as_bool) == Some(true)
            || line.get("isSidechain").and_then(Value::as_bool) == Some(true)
        {
            continue;
        }
        let cwd = Path::new(line.get("cwd").and_then(Value::as_str)?);
        if !wanted(cwd) {
            return None;
        }
        let text = match line.pointer("/message/content") {
            Some(Value::String(text)) => text.clone(),
            Some(Value::Array(blocks)) => blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect(),
            _ => continue,
        };
        if let ClaudeLine::Said = claude_line(&text)
            && let Some(said) = one_line(&without_paste_tags(&text))
        {
            return Some((cwd.to_path_buf(), said));
        }
    }
    None
}

fn codex(root: &Path, folder: &Path) -> Vec<SavedConversation> {
    let names = codex_names(root);
    newest_first(codex_files(root))
        .into_iter()
        .filter_map(|(file, modified)| {
            let meta = read_or_log(&file, CODEX_META_MAX_BYTES)?;
            let id = codex_id_for(complete_lines(&meta).next()?, folder)?;
            let head = read_or_log(&file, HEAD_MAX_BYTES)?;
            let title = names.get(&id).cloned();
            saved(id, codex_first_message(&head)?, title, modified)
        })
        .take(SAVED_CONVERSATIONS_MAX)
        .collect()
}

/// The session's id, when its first line says it ran in `folder` and a person started it (a
/// subagent's session is its parent's business).
fn codex_id_for(first_line: &str, folder: &Path) -> Option<String> {
    codex_meta(first_line)
        .filter(|(_, cwd)| same_path(cwd, folder))
        .map(|(id, _)| id)
}

/// The session's id and the folder it ran in, from its first line, when a person started it.
fn codex_meta(first_line: &str) -> Option<(String, PathBuf)> {
    let line: Value = serde_json::from_str(first_line).ok()?;
    if line.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }
    let payload = line.get("payload")?;
    if payload.get("thread_source").and_then(Value::as_str) == Some("subagent") {
        return None;
    }
    let cwd = PathBuf::from(payload.get("cwd").and_then(Value::as_str)?);
    let id = payload.get("id").and_then(Value::as_str)?.to_owned();
    Some((id, cwd))
}

impl crate::daemon::Daemon {
    /// The agents' own ids of every conversation the daemon already runs: its chats, the chats it is
    /// starting on a saved session, and the terminal agents whose session it knows. None of them is
    /// offered for import.
    pub(in crate::daemon) fn held_agent_sessions(&self) -> HashSet<String> {
        self.conversations
            .iter()
            .map(|conversation| conversation.binding.session_id.clone())
            .chain(self.pending_starts.iter().filter_map(|pending| pending.thread_id.clone()))
            .chain(self.terms.values().filter_map(|term| term.session.clone()))
            .collect()
    }
}

/// The conversations Claude and Codex saved in any folder, newest first, leaving out those whose id
/// is in `held` (the daemon already runs them) and those whose folder is gone, since a chat cannot
/// start there. At most `IMPORTABLE_CHATS_MAX`, and `IMPORTABLE_CHATS_PER_FOLDER` of one folder.
pub(in crate::daemon) fn importable(stores: &Stores, held: &HashSet<String>) -> Vec<ImportableChat> {
    let claude = stores.claude.as_deref().map(|root| claude_everywhere(root, held)).unwrap_or_default();
    let codex = stores.codex.as_deref().map(|root| codex_everywhere(root, held)).unwrap_or_default();
    let mut chats: Vec<ImportableChat> = claude.into_iter().chain(codex).collect();
    chats.sort_by_key(|chat| std::cmp::Reverse(chat.saved.last_active));
    chats.truncate(IMPORTABLE_CHATS_MAX);
    chats
}

fn claude_everywhere(root: &Path, held: &HashSet<String>) -> Vec<ImportableChat> {
    let files = newest_first(subfolders(root).iter().flat_map(|folder| jsonl_files(folder)).collect());
    let mut taken = Taken::default();
    files
        .into_iter()
        .filter_map(|(file, modified)| {
            let id = file.file_stem()?.to_str()?.to_owned();
            // Counted by Claude's own folder before anything is read, so a busy one is not read through.
            if held.contains(&id) || !taken.has_room(file.parent()?) {
                return None;
            }
            let head = read_or_log(&file, HEAD_MAX_BYTES)?;
            let (folder, first_message) = claude_said(&head, |_| true)?;
            let title = claude_title(&file, &head);
            let chat = importable_chat("claude", folder, saved(id, first_message, title, modified)?)?;
            taken.take(file.parent()?);
            Some(chat)
        })
        .take(IMPORTABLE_CHATS_MAX)
        .collect()
}

fn codex_everywhere(root: &Path, held: &HashSet<String>) -> Vec<ImportableChat> {
    let names = codex_names(root);
    let mut taken = Taken::default();
    newest_first(codex_files(root))
        .into_iter()
        .filter_map(|(file, modified)| {
            let meta = read_or_log(&file, CODEX_META_MAX_BYTES)?;
            let (id, folder) = codex_meta(complete_lines(&meta).next()?)?;
            if held.contains(&id) || !taken.has_room(&folder) {
                return None;
            }
            let head = read_or_log(&file, HEAD_MAX_BYTES)?;
            let title = names.get(&id).cloned();
            let chat = importable_chat("codex", folder, saved(id, codex_first_message(&head)?, title, modified)?)?;
            taken.take(&chat.folder);
            Some(chat)
        })
        .take(IMPORTABLE_CHATS_MAX)
        .collect()
}

/// A chat to offer, when its folder is still there to start it in.
fn importable_chat(agent: &str, folder: PathBuf, saved: SavedConversation) -> Option<ImportableChat> {
    folder.is_dir().then(|| ImportableChat { agent: agent.to_owned(), folder, saved })
}

/// How many chats each folder has given.
#[derive(Default)]
struct Taken(HashMap<PathBuf, usize>);

impl Taken {
    fn has_room(&self, folder: &Path) -> bool {
        self.0.get(folder).is_none_or(|count| *count < IMPORTABLE_CHATS_PER_FOLDER)
    }

    fn take(&mut self, folder: &Path) {
        *self.0.entry(folder.to_path_buf()).or_default() += 1;
    }
}

/// The name Claude gave a transcript: the person's own (`/rename`), else the title Claude made, the
/// latest of each. Read from `head` and, when the file is longer than that, from its end.
fn claude_title(file: &Path, head: &str) -> Option<String> {
    let mut found = ClaudeTitles::default();
    head.lines().for_each(|line| found.note(line));
    let long = std::fs::metadata(file).is_ok_and(|meta| meta.len() > HEAD_MAX_BYTES);
    if long && let Some(tail) = read_tail_or_log(file, TAIL_MAX_BYTES) {
        // The first line of a tail starts anywhere, and the last may be unfinished.
        complete_lines(&tail).skip(1).for_each(|line| found.note(line));
    }
    found.best()
}

#[derive(Default)]
struct ClaudeTitles {
    custom: Option<String>,
    generated: Option<String>,
}

impl ClaudeTitles {
    fn note(&mut self, line: &str) {
        let (kind, key, slot) = if line.contains(r#""custom-title""#) {
            ("custom-title", "customTitle", &mut self.custom)
        } else if line.contains(r#""ai-title""#) {
            ("ai-title", "aiTitle", &mut self.generated)
        } else {
            return;
        };
        let Ok(line) = serde_json::from_str::<Value>(line) else { return };
        if line.get("type").and_then(Value::as_str) != Some(kind) {
            return;
        }
        if let Some(title) = line.get(key).and_then(Value::as_str).and_then(one_line) {
            *slot = Some(title);
        }
    }

    fn best(self) -> Option<String> {
        self.custom.or(self.generated)
    }
}

/// Codex's thread names by session id, from the end of its index: a thread named again later in the
/// file takes the later name. Empty when the index is not there.
fn codex_names(sessions: &Path) -> HashMap<String, String> {
    let Some(index) = sessions.parent().map(|home| home.join("session_index.jsonl")) else {
        return HashMap::new();
    };
    let Some(tail) = read_tail_or_log(&index, CODEX_INDEX_MAX_BYTES) else {
        return HashMap::new();
    };
    // Only a read that began inside the file can start in the middle of a line.
    let skip = usize::from(std::fs::metadata(&index).is_ok_and(|meta| meta.len() > CODEX_INDEX_MAX_BYTES));
    complete_lines(&tail)
        .skip(skip)
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|line| {
            let id = line.get("id")?.as_str()?.to_owned();
            Some((id, one_line(line.get("thread_name")?.as_str()?)?))
        })
        .collect()
}

fn codex_first_message(head: &str) -> Option<String> {
    complete_lines(head)
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find_map(|line| {
            let payload = line.get("payload")?;
            let said = match (
                line.get("type").and_then(Value::as_str),
                payload.get("type").and_then(Value::as_str),
            ) {
                (Some("event_msg"), Some("user_message")) => payload.get("message")?.as_str()?.to_owned(),
                (Some("response_item"), Some("message"))
                    if payload.get("role").and_then(Value::as_str) == Some("user") && !is_codex_context(payload) =>
                {
                    codex_text(payload)
                }
                _ => return None,
            };
            one_line(&said)
        })
}

/// Codex's session files, newest day first, at most `FILES_MAX`. Only real folders and files are
/// followed, so a link inside the store cannot lead out of it.
fn codex_files(root: &Path) -> Vec<(PathBuf, SystemTime)> {
    let mut files = Vec::new();
    for year in subfolders(root) {
        for month in subfolders(&year) {
            for day in subfolders(&month) {
                files.extend(jsonl_files(&day));
                if files.len() >= FILES_MAX {
                    return files;
                }
            }
        }
    }
    files
}

/// The folders directly inside `folder`, last name first (Codex names them by date).
fn subfolders(folder: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = entries(folder)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect();
    found.sort_unstable_by(|a, b| b.cmp(a));
    found
}

/// The `.jsonl` files directly inside `folder`, with when each was last written.
fn jsonl_files(folder: &Path) -> Vec<(PathBuf, SystemTime)> {
    entries(folder)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|path| {
            let modified = std::fs::metadata(&path).and_then(|meta| meta.modified()).ok()?;
            Some((path, modified))
        })
        .collect()
}

fn entries(folder: &Path) -> impl Iterator<Item = std::fs::DirEntry> {
    std::fs::read_dir(folder).into_iter().flatten().filter_map(Result::ok)
}

fn newest_first(mut files: Vec<(PathBuf, SystemTime)>) -> Vec<(PathBuf, SystemTime)> {
    files.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));
    files.truncate(FILES_MAX);
    files
}

/// Up to `max` bytes from the start of `file`, as text. A file that cannot be read is skipped, and only
/// its path is logged: what it holds is the person's.
fn read_or_log(file: &Path, max: u64) -> Option<String> {
    let read = std::fs::File::open(file).and_then(|opened| {
        let mut bytes = Vec::new();
        opened.take(max).read_to_end(&mut bytes)?;
        Ok(bytes)
    });
    match read {
        Ok(bytes) => Some(String::from_utf8_lossy(&bytes).into_owned()),
        Err(error) => {
            tracing::warn!(file = %file.display(), kind = ?error.kind(), "saved conversations: skipped a file that could not be read");
            None
        }
    }
}

/// Up to `max` bytes from the end of `file`, as text; a file shorter than that is read whole. Skipped
/// like `read_or_log` skips a file, and a missing one quietly.
fn read_tail_or_log(file: &Path, max: u64) -> Option<String> {
    use std::io::{Seek, SeekFrom};
    let read = std::fs::File::open(file).and_then(|mut opened| {
        let len = opened.metadata()?.len();
        opened.seek(SeekFrom::Start(len.saturating_sub(max)))?;
        let mut bytes = Vec::new();
        opened.take(max).read_to_end(&mut bytes)?;
        Ok(bytes)
    });
    match read {
        Ok(bytes) => Some(String::from_utf8_lossy(&bytes).into_owned()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            tracing::warn!(file = %file.display(), kind = ?error.kind(), "saved conversations: skipped a file's end that could not be read");
            None
        }
    }
}

/// The lines of `text` that ended: the last one may have been cut by the read.
fn complete_lines(text: &str) -> impl Iterator<Item = &str> {
    let ended = text.rfind('\n').map_or("", |end| &text[..end]);
    ended.lines().map(|line| line.trim_end_matches('\r')).filter(|line| !line.is_empty())
}

/// `text` as one clean line: no escape sequences or control characters, runs of white space as one
/// space, cut to `SAVED_FIRST_MESSAGE_MAX_CHARS`. None when nothing is left.
fn one_line(text: &str) -> Option<String> {
    let clean = maitty_shared::hidden::sanitize(&clean_text(text), false);
    let joined = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut: String = joined.chars().take(SAVED_FIRST_MESSAGE_MAX_CHARS).collect();
    (!cut.is_empty()).then_some(cut)
}

/// A listed conversation, when its id is one a resume can be given as is. A letter or digit comes
/// first: the id lands on the agent's command line, where a leading `-` would be read as a flag.
fn saved(id: String, first_message: String, title: Option<String>, modified: SystemTime) -> Option<SavedConversation> {
    let plain = id.starts_with(|c: char| c.is_ascii_alphanumeric())
        && id.chars().count() <= ID_MAX_CHARS
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    plain.then(|| SavedConversation {
        id,
        first_message,
        title,
        last_active: modified.duration_since(SystemTime::UNIX_EPOCH).map_or(0, |since| since.as_secs()),
    })
}

#[cfg(test)]
mod tests;
