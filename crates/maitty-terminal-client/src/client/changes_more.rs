//! Changes beyond the local review: picking the files a commit takes and writing its message,
//! comments on lines of the diff for the agent, fetch, pull and push, and the same view for a
//! pane on another machine, whose checkout that machine's daemon reads (`Query::Repo`) and
//! changes (`Query::Git`). Every git step runs off the UI thread: here in `spawn_bg`, there on
//! the daemon, the answer coming back as a message.

use super::*;
use crate::protocol::GitRequest;
use maitty_shared::repo::{RepoReply, RepoRequest};
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU64, Ordering};

/// The longest commit message or comment typed here.
const TEXT_MAX: usize = 500;
/// A commit subject suggested from the session is cut to this.
const SUBJECT_MAX: usize = 72;
/// File names a suggested message lists before it counts them instead.
const NAMED_FILES: usize = 3;
/// Rows a page key moves the diff's cursor.
const PAGE: usize = 15;
/// Rows of the diff the cursor is kept within when it moves down (the view's usual height).
const FOLLOW_ROWS: usize = 20;
/// How long another machine is given to answer before its daemon is taken to be too old to.
const DIFF_WAIT: Duration = Duration::from_secs(30);
/// A fetch, pull or push may take the daemon's whole limit, and a pull request a push and `gh`.
const GIT_WAIT: Duration = Duration::from_secs(crate::protocol::GIT_SYNC_LIMIT_SECS * 2 + 30);

/// Tags of this view's questions, apart from any other feature's.
static NEXT_TAG: AtomicU64 = AtomicU64::new(0x4348_0000_0000);

fn next_tag() -> u64 {
    NEXT_TAG.fetch_add(1, Ordering::Relaxed)
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ChangesExtra {
    /// Files left out of the next commit. Every changed file is in it until it is unpicked, so a
    /// file the agent changes next is in without a key.
    pub unticked: BTreeSet<String>,
    /// The commit message being edited (`m`, or a click on it), until Esc stops editing.
    pub message: Option<String>,
    /// The message as edited, kept after editing stops; None: the one made from the changes.
    pub draft: Option<String>,
    /// The diff's cursor (an index into the review's diff lines) while the diff has the keys.
    pub line: Option<usize>,
    /// A comment being written on the cursor's line.
    pub commenting: Option<String>,
    /// Comments written and not sent to the agent yet, in the order written.
    pub comments: Vec<LineComment>,
    /// A git step under way, in words ("committing…"), until it ends.
    pub busy: Option<String>,
    /// Some for a pane on another machine.
    pub remote: Option<RemoteChanges>,
}

/// A comment on one line of a file's diff.
#[derive(Debug, Clone, PartialEq)]
pub struct LineComment {
    pub path: String,
    /// The line's index in the file's diff lines.
    pub index: usize,
    /// The line's number in the file (the old file's for a removed line).
    pub at: Option<u32>,
    pub removed: bool,
    /// The diff line, without its `+`, `-` or space.
    pub text: String,
    pub comment: String,
}

/// A pane on another machine: its changes as its daemon read them.
#[derive(Debug, Clone, PartialEq)]
pub struct RemoteChanges {
    pub term: ClientTerm,
    pub machine: String,
    pub task: tasks::TaskRow,
    /// The diff asked for and not answered yet.
    pub asked: Option<(u64, Instant)>,
    /// The git step sent and not answered yet.
    pub git: Option<(u64, Instant)>,
    /// Each file's diff lines, in the review's file order.
    pub patches: Vec<Vec<String>>,
}

/// Diff lines a comment can be about: an added, removed or unchanged line, not a hunk header.
pub fn commentable(line: &str) -> bool {
    matches!(line.chars().next(), Some('+' | '-' | ' '))
}

/// Where each diff line is in its file: (number, removed). Hunk headers set where they start.
pub fn line_numbers(diff: &[String]) -> Vec<Option<(u32, bool)>> {
    let (mut old, mut new) = (0u32, 0u32);
    diff.iter()
        .map(|l| {
            if let Some(rest) = l.strip_prefix("@@") {
                let num = |sign: char| {
                    rest.split_whitespace()
                        .find_map(|w| w.strip_prefix(sign))
                        .and_then(|w| w.split(',').next()?.parse::<u32>().ok())
                        .unwrap_or(1)
                };
                old = num('-');
                new = num('+');
                None
            } else if l.starts_with('-') {
                old += 1;
                Some((old - 1, true))
            } else if l.starts_with('+') {
                new += 1;
                Some((new - 1, false))
            } else if l.starts_with(' ') {
                old += 1;
                new += 1;
                Some((new - 1, false))
            } else {
                None
            }
        })
        .collect()
}

/// What goes to the agent: each comment under the line it is about, quoted.
pub fn comments_message(comments: &[LineComment]) -> String {
    comments
        .iter()
        .map(|c| {
            let where_ = match c.at {
                Some(n) if c.removed => format!("{}, line {n} (removed)", c.path),
                Some(n) => format!("{}, line {n}", c.path),
                None => c.path.clone(),
            };
            format!("About {where_}:\n> {}\n\n{}", c.text, c.comment.trim())
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// A first commit message: what the agent last summed up, else what changed.
pub fn suggested_message(summary: &str, paths: &[&str]) -> String {
    let line = summary.lines().next().unwrap_or("").trim();
    if !line.is_empty() {
        return super::render::truncate(line, SUBJECT_MAX);
    }
    let name = |p: &str| p.rsplit('/').next().unwrap_or(p).to_string();
    match paths {
        [] => String::new(),
        few if few.len() <= NAMED_FILES => {
            format!("Update {}", few.iter().map(|p| name(p)).collect::<Vec<_>>().join(", "))
        }
        many => {
            let folders: BTreeSet<&str> =
                many.iter().map(|p| p.rsplit_once('/').map_or("", |(d, _)| d)).collect();
            match folders.iter().next() {
                Some(only) if folders.len() == 1 && !only.is_empty() => {
                    format!("Update {} files in {only}", many.len())
                }
                _ => format!("Update {} files", many.len()),
            }
        }
    }
}

/// Ctrl+Enter, which a terminal that cannot tell it from Enter sends as Ctrl+J.
fn commit_key(k: &KeyEvent) -> bool {
    k.modifiers.contains(KeyModifiers::CONTROL) && matches!(k.code, KeyCode::Enter | KeyCode::Char('j'))
}

impl views::ChangesView {
    /// Whether the next commit takes `path`.
    pub fn is_picked(&self, path: &str) -> bool {
        !self.extra.unticked.contains(path)
    }

    /// The files the next commit takes, in the review's order.
    pub fn picked(&self) -> Vec<String> {
        let Some(r) = &self.review else { return Vec::new() };
        r.files.iter().filter(|f| self.is_picked(&f.path)).map(|f| f.path.clone()).collect()
    }

    fn toggle_picked(&mut self, path: &str) {
        if !self.extra.unticked.remove(path) {
            self.extra.unticked.insert(path.to_string());
        }
    }

    /// The message the next commit carries: the one being edited, else the one written, else
    /// one made from the agent's summary or the picked files.
    pub fn message_text(&self) -> String {
        if let Some(m) = self.extra.message.as_ref().or(self.extra.draft.as_ref()) {
            return m.clone();
        }
        let (Some(r), picked) = (&self.review, self.picked()) else { return String::new() };
        let paths: Vec<&str> = picked.iter().map(String::as_str).collect();
        suggested_message(&r.task.summary, &paths)
    }
}

/// A file's patch as the view shows it: from its first hunk, tabs as spaces.
fn patch_lines(patch: &str, binary: bool) -> Vec<String> {
    if binary {
        return vec!["(binary file: no diff to show)".into()];
    }
    patch
        .lines()
        .skip_while(|l| !l.starts_with("@@"))
        .take(4000)
        .map(|l| l.replace('\t', "    "))
        .collect()
}

impl App {
    /// Changes for a pane on another machine: its daemon reads the checkout.
    pub(super) fn open_remote_changes(&mut self, term: ClientTerm) {
        let Some(info) = self.term_info(term).cloned() else {
            return self.notify("no pane to show the changes of".into(), true);
        };
        let branch = info.branch.clone().unwrap_or_else(|| "this checkout".into());
        let task = tasks::TaskRow {
            ws: 0,
            name: branch.clone(),
            branch,
            base: "HEAD".into(),
            stage: tasks::Stage::Ready,
            summary: info.summary.clone(),
            dirty: 0,
            ahead: 0,
            agent: info.agent.is_some().then_some(term),
            dir: info.cwd.clone(),
            root: info.cwd.clone(),
        };
        let machine = match self.machine_name(term.machine) {
            "" => self.machine.name().to_owned(),
            name => name.to_owned(),
        };
        let v = views::ChangesView {
            extra: ChangesExtra {
                remote: Some(RemoteChanges {
                    term,
                    machine,
                    task,
                    asked: None,
                    git: None,
                    patches: Vec::new(),
                }),
                ..Default::default()
            },
            dir: info.cwd.clone(),
            review: None,
            error: None,
            agent: info.agent.clone().unwrap_or_default(),
            said: info.said.clone(),
            term: Some(term),
            ws: None,
            linked: false,
            confirm: None,
            reviewed: Default::default(),
        };
        self.show_view(View::Changes(Box::new(v)));
        self.ask_remote_diff();
    }

    fn remote_view(&mut self) -> Option<&mut views::ChangesView> {
        match &mut self.view {
            Some(View::Changes(v)) if v.extra.remote.is_some() => Some(v),
            _ => None,
        }
    }

    /// Ask the pane's machine for its uncommitted changes, every file with its diff.
    fn ask_remote_diff(&mut self) {
        let tag = next_tag();
        let Some(v) = self.remote_view() else { return };
        let Some(remote) = v.extra.remote.as_mut() else { return };
        remote.asked = Some((tag, Instant::now()));
        let term = remote.term;
        self.send(
            term.machine,
            ClientMsg::Query(Query::Repo {
                term: term.term,
                tag,
                request: RepoRequest::Diff { path: None },
            }),
        );
    }

    /// Whether `tag` from `machine` answers the open view's diff question.
    pub(super) fn remote_diff_waits(&self, machine: MachineId, tag: u64) -> bool {
        matches!(&self.view, Some(View::Changes(v))
            if v.extra.remote.as_ref().is_some_and(|r| r.term.machine == machine
                && r.asked.is_some_and(|(t, _)| t == tag)))
    }

    /// Whether `tag` from `machine` answers the open view's git step.
    pub(super) fn remote_git_waits(&self, machine: MachineId, tag: u64) -> bool {
        matches!(&self.view, Some(View::Changes(v))
            if v.extra.remote.as_ref().is_some_and(|r| r.term.machine == machine
                && r.git.is_some_and(|(t, _)| t == tag)))
    }

    /// The other machine's diff arrived: it becomes the review.
    pub(super) fn remote_diff_arrived(&mut self, reply: RepoReply) {
        let Some(v) = self.remote_view() else { return };
        let Some(remote) = v.extra.remote.as_mut() else { return };
        remote.asked = None;
        let RepoReply::Diff(diff) = reply else {
            v.error = Some("the other machine answered something else".into());
            return;
        };
        remote.patches = diff.files.iter().map(|f| patch_lines(&f.patch, f.binary)).collect();
        let files: Vec<tasks::Changed> = diff
            .files
            .iter()
            .map(|f| tasks::Changed {
                path: f.path.clone(),
                added: i64::try_from(f.additions).unwrap_or(i64::MAX),
                removed: i64::try_from(f.deletions).unwrap_or(i64::MAX),
                untracked: f.patch.contains("\nnew file mode") || f.patch.starts_with("new file mode"),
                deleted: f.patch.contains("\ndeleted file mode") || f.patch.starts_with("deleted file mode"),
            })
            .collect();
        let keep = v.review.as_ref().map(|r| r.sel);
        let task = remote.task.clone();
        // Ticks and marks of files no longer changed go.
        v.extra.unticked.retain(|p| files.iter().any(|f| f.path == *p));
        v.reviewed.retain(|p| files.iter().any(|f| f.path == *p));
        let n = files.len();
        v.review = Some(tasks::Review {
            task,
            merge_base: "HEAD".into(),
            to_push: None,
            files,
            sel: 0,
            diff: Vec::new(),
            diff_sel: None,
            scroll: 0,
            confirm: None,
        });
        // The file chosen before stays chosen; the first time, the first file in the list.
        let sel = keep
            .map(|s| s.min(n.saturating_sub(1)))
            .or_else(|| v.order().first().copied())
            .unwrap_or(0);
        if let Some(r) = v.review.as_mut() {
            r.sel = sel;
        }
        Self::remote_diff_for_selection(v);
        v.error = None;
        if diff.truncated {
            self.notify(
                format!("only the first {} changed files are shown", diff.files.len()),
                false,
            );
        }
    }

    /// The other machine's diff for the file now chosen, held since the review arrived.
    pub(super) fn remote_diff_for_selection(v: &mut views::ChangesView) -> bool {
        let Some(remote) = &v.extra.remote else {
            return false;
        };
        if let Some(r) = v.review.as_mut()
            && r.diff_sel != Some(r.sel)
        {
            r.diff = remote.patches.get(r.sel).cloned().unwrap_or_default();
            r.diff_sel = Some(r.sel);
        }
        true
    }

    /// The other machine's git step ended: say how, and read its changes again.
    pub(super) fn remote_git_done(&mut self, outcome: Result<String, String>) {
        let Some(v) = self.remote_view() else { return };
        v.extra.busy = None;
        if let Some(remote) = v.extra.remote.as_mut() {
            remote.git = None;
        }
        match outcome {
            Ok(line) => self.notify(crate::hidden::sanitize(&line, false), false),
            Err(why) => self.notify(crate::hidden::sanitize(&why, false), true),
        }
        self.ask_remote_diff();
    }

    /// `machine` refused a request: a question the view waits on there is not coming.
    pub(super) fn remote_changes_failed(&mut self, machine: MachineId, why: &str) {
        let Some(v) = self.remote_view() else { return };
        let Some(remote) = v.extra.remote.as_mut() else { return };
        if remote.term.machine != machine || (remote.asked.is_none() && remote.git.is_none()) {
            return;
        }
        let asked = remote.asked.take().is_some();
        remote.git = None;
        v.extra.busy = None;
        if asked && v.review.is_none() {
            v.error = Some(why.to_string());
        }
    }

    /// Called after every event: a question another machine has not answered in time is given
    /// up, since a daemon older than it never answers.
    pub(super) fn changes_tick(&mut self) {
        let Some(v) = self.remote_view() else { return };
        let Some(remote) = v.extra.remote.as_mut() else { return };
        let late = |at: Option<(u64, Instant)>, wait| at.is_some_and(|(_, at)| at.elapsed() >= wait);
        if !late(remote.asked, DIFF_WAIT) && !late(remote.git, GIT_WAIT) {
            return;
        }
        let why = format!(
            "{} did not answer: update maiker there to see and commit its changes from here",
            remote.machine
        );
        remote.asked = None;
        remote.git = None;
        v.extra.busy = None;
        if v.review.is_none() {
            v.error = Some(why.clone());
        }
        self.dirty = true;
        self.notify(why, true);
    }

    /// Run a git step on the view's checkout: here off the UI thread, or by the pane's own
    /// machine. Its review is read again when it ends.
    fn changes_git(&mut self, v: &mut views::ChangesView, request: GitRequest, doing: &str) {
        if let Some(busy) = &v.extra.busy {
            return self.notify(format!("still {busy}"), false);
        }
        if let Some(remote) = v.extra.remote.as_mut() {
            let tag = next_tag();
            remote.git = Some((tag, Instant::now()));
            let term = remote.term;
            v.extra.busy = Some(doing.to_string());
            self.notify(doing.to_string(), false);
            self.send(
                term.machine,
                ClientMsg::Query(Query::Git {
                    term: term.term,
                    request,
                    tag,
                }),
            );
            return;
        }
        let Some(r) = &v.review else { return };
        let task = r.task.clone();
        let dir = task.dir.clone();
        self.notify(doing.to_string(), false);
        match request {
            GitRequest::Commit { message, paths } => self.spawn_bg(move || {
                Bg::Done(tasks::commit_with(&task, paths.as_deref(), &message), true)
            }),
            GitRequest::Fetch => self.spawn_bg(move || Bg::Done(tasks::sync(&dir, tasks::Sync::Fetch), true)),
            GitRequest::Pull => self.spawn_bg(move || Bg::Done(tasks::sync(&dir, tasks::Sync::Pull), true)),
            GitRequest::Push => self.spawn_bg(move || Bg::Done(tasks::sync(&dir, tasks::Sync::Push), true)),
            GitRequest::PullRequest => self.spawn_bg(move || Bg::Done(tasks::pull_request(&task), true)),
        }
    }

    /// Commit the picked files with the message shown; nothing picked, or no message, says so.
    fn commit_picked(&mut self, v: &mut views::ChangesView) {
        let paths = v.picked();
        if paths.is_empty() {
            return self.warn("Pick at least one file to commit".into());
        }
        let message = v.message_text().trim().to_string();
        if message.is_empty() {
            return self.notify("Write a message first".into(), true);
        }
        v.extra.message = None;
        v.extra.draft = None;
        self.changes_git(v, GitRequest::Commit { message, paths: Some(paths) }, "committing…");
    }

    /// The keys this file adds to Changes, ahead of the review's own. None: not one of them.
    pub(super) fn changes_more_key(&mut self, v: &mut views::ChangesView, k: &KeyEvent) -> Option<bool> {
        let ctrl = k.modifiers.contains(KeyModifiers::CONTROL);
        let esc = k.code == KeyCode::Esc || k.code == KeyCode::Char('\x1b');
        // Editing the commit message: Enter is a new line, Ctrl+Enter commits, Esc stops.
        if let Some(message) = &mut v.extra.message {
            match k.code {
                _ if esc => v.extra.draft = v.extra.message.take(),
                _ if commit_key(k) => self.commit_picked(v),
                KeyCode::Enter if message.chars().count() < TEXT_MAX => message.push('\n'),
                KeyCode::Backspace => {
                    message.pop();
                }
                KeyCode::Char('u') if ctrl => message.clear(),
                KeyCode::Char(c) if (!ctrl || crate::client::input::alt_gr(k)) && message.chars().count() < TEXT_MAX => message.push(c),
                _ => {}
            }
            return Some(true);
        }
        // Writing a comment on a line.
        if let Some(text) = &mut v.extra.commenting {
            match k.code {
                _ if esc => v.extra.commenting = None,
                KeyCode::Enter => {
                    let comment = text.trim().to_string();
                    v.extra.commenting = None;
                    if !comment.is_empty() {
                        self.add_line_comment(v, comment);
                    }
                }
                KeyCode::Backspace => {
                    text.pop();
                }
                KeyCode::Char('u') if ctrl => text.clear(),
                KeyCode::Char(c) if (!ctrl || crate::client::input::alt_gr(k)) && text.chars().count() < TEXT_MAX => text.push(c),
                _ => {}
            }
            return Some(true);
        }
        // Another machine's pull request: asked first, then its daemon pushes and opens it.
        if let (Some(_), Some((_, action))) = (&v.extra.remote, &v.confirm) {
            let action = *action;
            v.confirm = None;
            if action == 'p' && matches!(k.code, KeyCode::Enter | KeyCode::Char('y')) {
                self.changes_git(v, GitRequest::PullRequest, "pushing and opening a pull request…");
            }
            return Some(true);
        }
        if v.confirm.is_some() {
            return None;
        }
        // The diff has the keys: a cursor on its lines.
        if let Some(line) = v.extra.line {
            let Some(r) = v.review.as_mut() else {
                v.extra.line = None;
                return Some(true);
            };
            let last = r.diff.len().saturating_sub(1);
            let to = match k.code {
                _ if esc => {
                    v.extra.line = None;
                    return Some(true);
                }
                KeyCode::Left | KeyCode::Char('h') => {
                    v.extra.line = None;
                    return Some(true);
                }
                KeyCode::Down | KeyCode::Char('j') => (line + 1).min(last),
                KeyCode::Up | KeyCode::Char('k') => line.saturating_sub(1),
                KeyCode::PageDown | KeyCode::Char(' ') => (line + PAGE).min(last),
                KeyCode::PageUp => line.saturating_sub(PAGE),
                KeyCode::Enter => {
                    if r.diff.get(line).is_some_and(|l| commentable(l)) && v.term.is_some() {
                        v.extra.commenting = Some(String::new());
                    } else if v.term.is_none() {
                        self.notify("no agent works here to read a comment".into(), true);
                    }
                    return Some(true);
                }
                KeyCode::Char('s') => {
                    self.send_line_comments(v);
                    return Some(true);
                }
                _ => return Some(true),
            };
            v.extra.line = Some(to);
            // Keep the cursor in view: the drawing follows it the rest of the way.
            let scroll = usize::from(r.scroll);
            if to < scroll {
                r.scroll = u16::try_from(to).unwrap_or(u16::MAX);
            } else if to >= scroll + FOLLOW_ROWS {
                r.scroll = u16::try_from(to + 1 - FOLLOW_ROWS).unwrap_or(u16::MAX);
            }
            return Some(true);
        }
        let remote = v.extra.remote.is_some();
        let r = v.review.as_ref()?;
        match k.code {
            KeyCode::Right | KeyCode::Char('l') => {
                if let Some(first) = r.diff.iter().skip(usize::from(r.scroll)).position(|l| commentable(l)) {
                    v.extra.line = Some(usize::from(r.scroll) + first);
                } else if let Some(first) = r.diff.iter().position(|l| commentable(l)) {
                    v.extra.line = Some(first);
                }
            }
            KeyCode::Char(' ' | 't') => {
                if let Some(f) = r.files.get(r.sel) {
                    let path = f.path.clone();
                    v.toggle_picked(&path);
                }
            }
            _ if commit_key(k) => self.commit_picked(v),
            KeyCode::Char('m') => v.extra.message = Some(v.message_text()),
            KeyCode::Char('s') => self.send_line_comments(v),
            KeyCode::Char('f') => self.changes_git(v, GitRequest::Fetch, "fetching…"),
            KeyCode::Char('u') => self.changes_git(v, GitRequest::Pull, "pulling…"),
            KeyCode::Char('P') => self.changes_git(v, GitRequest::Push, "pushing…"),
            KeyCode::Char('p') if remote => {
                v.confirm = Some((
                    "Push and open a pull request?".to_string(),
                    'p',
                ));
            }
            // A mark on another machine's file lasts while the view is open: its file cannot
            // be read here to see whether it changed since.
            KeyCode::Char('x') if remote => {
                if let Some(f) = r.files.get(r.sel) {
                    let path = f.path.clone();
                    if !v.reviewed.remove(&path) {
                        v.reviewed.insert(path);
                    }
                }
            }
            KeyCode::Char('e' | 'B' | 'M' | 'd') if remote => {
                let machine = v.extra.remote.as_ref().map(|r| r.machine.clone()).unwrap_or_default();
                self.notify(
                    format!(
                        "on {machine} Changes commits, opens a pull request, fetches, pulls and pushes; the rest is local-only in v1"
                    ),
                    false,
                );
            }
            _ => return None,
        }
        Some(true)
    }

    fn add_line_comment(&mut self, v: &mut views::ChangesView, comment: String) {
        let (Some(r), Some(index)) = (&v.review, v.extra.line) else {
            return;
        };
        let Some(file) = r.files.get(r.sel) else { return };
        let Some(line) = r.diff.get(index) else { return };
        let at = line_numbers(&r.diff).get(index).copied().flatten();
        v.extra.comments.push(LineComment {
            path: file.path.clone(),
            index,
            at: at.map(|(n, _)| n),
            removed: at.is_some_and(|(_, removed)| removed),
            text: line.get(1..).unwrap_or("").trim_end().to_string(),
            comment,
        });
    }

    /// `s`: the comments go to the agent's message box, where they are read, changed and sent
    /// (or kept as its draft). They leave the diff once handed over.
    fn send_line_comments(&mut self, v: &mut views::ChangesView) {
        if v.extra.comments.is_empty() {
            return self.notify("no comments yet: l goes into the diff, Enter on a line writes one".into(), false);
        }
        let Some(term) = v.term else {
            return self.notify("no agent works here to read the comments".into(), true);
        };
        let message = comments_message(&v.extra.comments);
        self.start_compose(term, false, None);
        if let Mode::Compose(c) = &mut self.mode {
            c.text = if c.text.trim().is_empty() {
                message
            } else {
                format!("{}\n\n{message}", c.text.trim_end())
            };
            v.extra.comments.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(text: &str) -> Vec<String> {
        text.lines().map(str::to_string).collect()
    }

    #[test]
    fn each_line_of_a_diff_knows_where_it_is_in_its_file() {
        let diff = lines("@@ -10,3 +12,4 @@ fn x\n same\n-gone\n+new\n+more\n tail");
        assert_eq!(
            line_numbers(&diff),
            [None, Some((12, false)), Some((11, true)), Some((13, false)), Some((14, false)), Some((15, false))]
        );
        assert!(!commentable(&diff[0]) && commentable(&diff[2]));
    }

    #[test]
    fn the_comments_go_as_one_message_each_under_its_line() {
        let c = |path: &str, at, removed, text: &str, comment: &str| LineComment {
            path: path.into(),
            index: 0,
            at,
            removed,
            text: text.into(),
            comment: comment.into(),
        };
        let message = comments_message(&[
            c("src/a.rs", Some(4), false, "let x = 1;", " Why one? "),
            c("src/b.rs", Some(9), true, "old()", "Keep this"),
        ]);
        assert_eq!(
            message,
            "About src/a.rs, line 4:\n> let x = 1;\n\nWhy one?\n\nAbout src/b.rs, line 9 (removed):\n> old()\n\nKeep this"
        );
    }

    #[test]
    fn a_suggested_message_is_the_summary_else_what_changed() {
        assert_eq!(suggested_message("Fix the footer\nand more", &["a.rs"]), "Fix the footer");
        assert_eq!(suggested_message("", &["src/a.rs", "b.rs"]), "Update a.rs, b.rs");
        assert_eq!(suggested_message("", &["src/a", "src/b", "src/c", "src/d"]), "Update 4 files in src");
        assert_eq!(suggested_message("", &["a", "src/b", "c", "d"]), "Update 4 files");
    }
}
