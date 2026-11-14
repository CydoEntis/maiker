//! Answers beside a Claude conversation (`Query::SideAnswer`): Claude Code's `/btw`, and the commands
//! that only report (`/context`, `/usage`…), which its terminal draws and the chat never sees. The
//! daemon starts a copy of the agent's own session (`--resume <id> --fork-session`) that is never
//! saved (`--no-session-persistence`), sends the ask on its standard input and keeps what it prints.
//! The conversation itself is not touched: nothing is typed into its pane or added to its file.
//!
//! Every input comes from the daemon's own records, not the client: the session id the hook or the
//! structured binding gave, the pane's folder, the model the transcript named. The client names
//! only the conversation, and either a question or one command from a fixed list (`SideCommand`).

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::protocol::{SIDE_ANSWER_MAX_BYTES, SIDE_QUESTION_MAX_CHARS, SideAnswer, SideAsk};

/// How long Claude Code has to answer: a question waits on the model, a command on start-up alone.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(90);

/// The most side answers running at once on this daemon; past it one is refused, not queued.
const MAX_AT_ONCE: usize = 3;

/// The longest model name passed on; a longer one is left out and Claude Code picks its own.
const MODEL_NAME_MAX: usize = 64;

static RUNNING: AtomicUsize = AtomicUsize::new(0);

/// Where and as what a side answer runs, all of it from the daemon's records of the conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::daemon) struct Target {
    pub executable: PathBuf,
    pub cwd: PathBuf,
    pub session: String,
    pub model: Option<String>,
    /// The Claude Code folder the session lives under, when it is not the default one.
    pub config_root: Option<PathBuf>,
}

/// Whether `id` is a session id as Claude Code writes them: a UUID, 8-4-4-4-12 hex digits. It is
/// passed as an argument, so nothing else is.
pub(in crate::daemon) fn is_claude_session(id: &str) -> bool {
    const GROUPS: [usize; 5] = [8, 4, 4, 4, 12];
    let parts: Vec<&str> = id.split('-').collect();
    parts.len() == GROUPS.len()
        && parts
            .iter()
            .zip(GROUPS)
            .all(|(part, len)| part.len() == len && part.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// A model name the transcript gave, kept only when it looks like one (`claude-opus-5-5`, `opus[1m]`).
pub(in crate::daemon) fn model_argument(model: Option<&str>) -> Option<String> {
    let model = model?.trim();
    let fits = !model.is_empty()
        && model.len() <= MODEL_NAME_MAX
        && !model.starts_with('-')
        && model
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'[' | b']'));
    fits.then(|| model.to_owned())
}

/// Why `ask` is refused before anything starts, or None when it may go.
pub(in crate::daemon) fn refusal(ask: &SideAsk) -> Option<String> {
    let SideAsk::Question(question) = ask else {
        return None;
    };
    if question.trim().is_empty() {
        return Some("A side question is empty".into());
    }
    if question.chars().count() > SIDE_QUESTION_MAX_CHARS {
        return Some(format!("A side question is at most {SIDE_QUESTION_MAX_CHARS} characters"));
    }
    if question.contains('\0') {
        return Some("A side question holds a character it cannot".into());
    }
    None
}

/// The Claude Code folder a followed session's transcript lives under: the file is
/// `<root>/projects/<folder>/<session>.jsonl`. None for any other shape, which leaves Claude Code
/// on its default folder.
pub(in crate::daemon) fn config_root_of(transcript: &Path) -> Option<PathBuf> {
    let projects = transcript.parent()?.parent()?;
    if projects.file_name()? != "projects" {
        return None;
    }
    projects.parent().map(Path::to_path_buf)
}

/// The `claude` this daemon would start, from the login PATH: the program a terminal pane runs.
pub(in crate::daemon) fn claude_on_path() -> Option<PathBuf> {
    let search = crate::login_path::effective_path().or_else(|| std::env::var_os("PATH"))?;
    // The Windows installer puts claude.exe on PATH; a script wrapper is not started.
    let name = if cfg!(windows) { "claude.exe" } else { "claude" };
    crate::shim::find_on_path(name, &search, Path::new(""), &[])
}

/// The arguments for `ask`: a question gets no tools and no MCP servers, so the copy can only talk;
/// a command keeps the session's own, which it reports on and which no command runs.
pub(in crate::daemon) fn arguments(target: &Target, ask: &SideAsk) -> Vec<OsString> {
    let mut args: Vec<OsString> = ["-p", "--resume"].map(OsString::from).into();
    args.push(OsString::from(&target.session));
    args.extend(["--fork-session", "--no-session-persistence"].map(OsString::from));
    if matches!(ask, SideAsk::Question(_)) {
        args.extend(["--tools", "", "--strict-mcp-config"].map(OsString::from));
    }
    if let Some(model) = &target.model {
        args.push("--model".into());
        args.push(model.into());
    }
    args
}

/// What is written to Claude Code's standard input: the prompt, so a question that starts with a
/// dash is never read as an option.
fn prompt(ask: &SideAsk) -> String {
    match ask {
        SideAsk::Question(question) => question.trim().to_owned(),
        SideAsk::Command(command) => command.typed().to_owned(),
    }
}

/// `printed` as the window shows it: valid text, no control characters but line breaks and tabs,
/// trimmed, and cut at `SIDE_ANSWER_MAX_BYTES` on a character boundary.
pub(in crate::daemon) fn shown(printed: &[u8]) -> String {
    let text: String = String::from_utf8_lossy(printed)
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .collect();
    let text = text.trim();
    let mut end = text.len().min(SIDE_ANSWER_MAX_BYTES);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

/// Holds one of the `MAX_AT_ONCE` places of `count` while an answer runs.
struct Place(&'static AtomicUsize);

impl Place {
    fn take(count: &'static AtomicUsize) -> Option<Self> {
        count
            .try_update(Ordering::AcqRel, Ordering::Acquire, |n| (n < MAX_AT_ONCE).then_some(n + 1))
            .ok()
            .map(|_| Place(count))
    }
}

impl Drop for Place {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

fn failed(reason: &str) -> SideAnswer {
    SideAnswer::Failed { reason: reason.to_owned() }
}

/// Runs `ask` beside `target`'s session and gives back what Claude Code printed. The process is
/// killed when it overruns `ANSWER_TIMEOUT` or this future is dropped.
pub(in crate::daemon) async fn answer(target: Target, ask: SideAsk) -> SideAnswer {
    let Some(_place) = Place::take(&RUNNING) else {
        return failed("Claude Code is already answering other side questions; try again in a moment");
    };
    let mut command = tokio::process::Command::new(&target.executable);
    command
        .args(arguments(&target, &ask))
        .current_dir(&target.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .env_remove("CLAUDECODE");
    // The copy is no pane and no structured chat: its hooks must not report for either.
    for name in crate::ipc::STRUCTURED_ENV
        .iter()
        .chain([concat!(env!("APP_ENV"), "_TERM_ID"), concat!(env!("APP_ENV"), "_PANE_TOKEN")].iter())
    {
        command.env_remove(name);
    }
    if let Some(root) = &target.config_root {
        command.env("CLAUDE_CONFIG_DIR", root);
    }
    crate::proc::quiet(command.as_std_mut());
    let run = async {
        let mut child = command.spawn().map_err(|_| "Could not start Claude Code")?;
        let mut stdin = child.stdin.take().ok_or("Could not start Claude Code")?;
        stdin
            .write_all(prompt(&ask).as_bytes())
            .await
            .map_err(|_| "Claude Code stopped before it read the question")?;
        drop(stdin);
        let stdout = child.stdout.take().ok_or("Could not start Claude Code")?;
        let mut printed = Vec::new();
        stdout
            .take(SIDE_ANSWER_MAX_BYTES as u64 + 1)
            .read_to_end(&mut printed)
            .await
            .map_err(|_| "Could not read Claude Code's answer")?;
        let status = child.wait().await.map_err(|_| "Claude Code stopped unexpectedly")?;
        // Past the cap the rest is dropped unread, so a cut answer's exit status is not waited on as a failure.
        if !status.success() && printed.len() <= SIDE_ANSWER_MAX_BYTES {
            return Err("Claude Code could not answer; the conversation may have moved or closed");
        }
        Ok::<_, &'static str>(shown(&printed))
    };
    match tokio::time::timeout(ANSWER_TIMEOUT, run).await {
        Ok(Ok(text)) if text.is_empty() => failed("Claude Code answered with nothing"),
        Ok(Ok(text)) => SideAnswer::Answered { text },
        Ok(Err(reason)) => failed(reason),
        Err(_) => failed("Claude Code took too long to answer"),
    }
}

impl crate::daemon::Daemon {
    /// What a side answer about conversation `id` runs as, for `client`; the refusal otherwise. A
    /// followed pane is answered only for the app it is shown in, as its history is (ADR 0004).
    pub(in crate::daemon) fn side_target(
        &self,
        client: crate::daemon::ClientId,
        id: crate::conversation::ConversationId,
    ) -> Result<Target, SideAnswer> {
        let no_such = || SideAnswer::Failed { reason: "No such conversation".into() };
        if let Some(follower) = self.followed.iter().find(|f| f.id == id) {
            if !self.shown_to(follower.term, self.surface_of(client)) {
                return Err(no_such());
            }
            if follower.provider != crate::conversation::Provider::Claude {
                return Err(SideAnswer::NotSupported);
            }
            let (session, transcript, model) = follower.side_parts();
            let cwd = self.terms.get(&follower.term).map(|t| t.cwd.clone()).ok_or_else(no_such)?;
            let executable = claude_on_path().ok_or_else(|| failed("Claude Code was not found on PATH"))?;
            return checked(Target {
                executable,
                cwd,
                session: session.to_owned(),
                model: model_argument(model),
                config_root: transcript.and_then(config_root_of),
            });
        }
        let record = self.conversations.iter().find(|c| c.id == id).ok_or_else(no_such)?;
        if record.binding.provider != crate::conversation::Provider::Claude {
            return Err(SideAnswer::NotSupported);
        }
        checked(Target {
            executable: record.binding.executable.clone(),
            cwd: record.binding.cwd.clone(),
            session: record.binding.session_id.clone(),
            model: None,
            config_root: Some(record.binding.config_root.clone()),
        })
    }
}

/// A target whose session id is a Claude one; until the agent names its session there is none.
fn checked(target: Target) -> Result<Target, SideAnswer> {
    if is_claude_session(&target.session) {
        Ok(target)
    } else {
        Err(failed("Claude Code has not named this conversation yet; try again after its first reply"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::SideCommand;

    const SESSION: &str = "0df0e0cb-1a2b-4c3d-8e9f-0123456789ab";

    fn target(model: Option<&str>) -> Target {
        Target {
            executable: PathBuf::from("/usr/bin/claude"),
            cwd: PathBuf::from("/home/me/app"),
            session: SESSION.into(),
            model: model.map(str::to_owned),
            config_root: None,
        }
    }

    fn strings(args: Vec<OsString>) -> Vec<String> {
        args.into_iter().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn only_a_uuid_is_taken_for_a_session() {
        assert!(is_claude_session(SESSION));
        assert!(!is_claude_session("--dangerously-skip-permissions"));
        assert!(!is_claude_session("0df0e0cb-1a2b-4c3d-8e9f-0123456789a"));
        assert!(!is_claude_session("0df0e0cb-1a2b-4c3d-8e9f-0123456789ag"));
        assert!(!is_claude_session(""));
    }

    #[test]
    fn a_model_name_is_passed_on_only_when_it_looks_like_one() {
        assert_eq!(model_argument(Some("claude-opus-5-5")).as_deref(), Some("claude-opus-5-5"));
        assert_eq!(model_argument(Some("opus[1m]")).as_deref(), Some("opus[1m]"));
        assert_eq!(model_argument(Some("--tools")), None);
        assert_eq!(model_argument(Some("opus; rm")), None);
        assert_eq!(model_argument(Some(&"a".repeat(MODEL_NAME_MAX + 1))), None);
        assert_eq!(model_argument(None), None);
    }

    #[test]
    fn a_question_gets_no_tools_and_no_mcp_servers_and_a_command_keeps_the_sessions() {
        let question = strings(arguments(&target(Some("claude-haiku-5-5")), &SideAsk::Question("why?".into())));
        assert_eq!(
            question,
            ["-p", "--resume", SESSION, "--fork-session", "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--model", "claude-haiku-5-5"]
        );
        let command = strings(arguments(&target(None), &SideAsk::Command(SideCommand::Context)));
        assert_eq!(command, ["-p", "--resume", SESSION, "--fork-session", "--no-session-persistence"]);
    }

    #[test]
    fn the_ask_goes_on_standard_input_never_as_an_option() {
        assert_eq!(prompt(&SideAsk::Question("  --help me  ".into())), "--help me");
        assert_eq!(prompt(&SideAsk::Command(SideCommand::Usage)), "/usage");
    }

    #[test]
    fn an_empty_long_or_binary_question_is_refused_before_anything_starts() {
        assert!(refusal(&SideAsk::Question("  ".into())).is_some());
        assert!(refusal(&SideAsk::Question("a".repeat(SIDE_QUESTION_MAX_CHARS + 1))).is_some());
        assert!(refusal(&SideAsk::Question("a\0b".into())).is_some());
        assert!(refusal(&SideAsk::Question("which file?".into())).is_none());
        assert!(refusal(&SideAsk::Command(SideCommand::Mcp)).is_none());
    }

    #[test]
    fn the_config_folder_is_read_off_a_transcript_under_projects_only() {
        assert_eq!(
            config_root_of(Path::new("/home/me/.claude-work/projects/-home-me-app/x.jsonl")),
            Some(PathBuf::from("/home/me/.claude-work"))
        );
        assert_eq!(config_root_of(Path::new("/home/me/elsewhere/-home-me-app/x.jsonl")), None);
        assert_eq!(config_root_of(Path::new("x.jsonl")), None);
    }

    #[test]
    fn what_is_shown_has_no_control_characters_and_is_cut_on_a_character() {
        assert_eq!(shown(b"\x1b[1m## Context\x1b[0m\n| a |\t1 |\n\n"), "[1m## Context[0m\n| a |\t1 |");
        let long = "é".repeat(SIDE_ANSWER_MAX_BYTES);
        let cut = shown(long.as_bytes());
        assert!(cut.len() <= SIDE_ANSWER_MAX_BYTES && cut.chars().all(|c| c == 'é'));
    }

    #[test]
    fn no_more_than_the_cap_run_at_once() {
        static COUNT: AtomicUsize = AtomicUsize::new(0);
        let held: Vec<Place> = std::iter::from_fn(|| Place::take(&COUNT)).take(MAX_AT_ONCE + 1).collect();
        assert_eq!(held.len(), MAX_AT_ONCE);
        assert!(Place::take(&COUNT).is_none());
        drop(held);
        assert!(Place::take(&COUNT).is_some());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_fake_claude_reads_the_ask_on_stdin_and_its_answer_comes_back() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("maitty-side-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("claude");
        std::fs::write(&fake, "#!/bin/sh\nprintf 'args:%s\\n' \"$*\"; printf 'asked:'; cat\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let target = Target { executable: fake.clone(), cwd: dir.clone(), session: SESSION.into(), model: None, config_root: None };

        let answer = super::answer(target.clone(), SideAsk::Command(SideCommand::Goal)).await;
        assert_eq!(
            answer,
            SideAnswer::Answered { text: format!("args:-p --resume {SESSION} --fork-session --no-session-persistence\nasked:/goal") }
        );

        std::fs::write(&fake, "#!/bin/sh\nexit 3\n").unwrap();
        assert!(matches!(super::answer(target, SideAsk::Question("q".into())).await, SideAnswer::Failed { .. }));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
