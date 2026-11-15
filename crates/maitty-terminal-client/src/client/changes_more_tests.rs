//! Changes for a pane on another machine (its daemon reads and commits), ticked commits, and
//! comments on diff lines. `MAITTY_SHOW=1 cargo test changes_more -- --nocapture` prints the frames.

use super::*;
use crate::client::ids::{MachineId, Remote};
use crate::client::reference_fixture::{Layout, Stage, raw_text, world};
use crate::conversation::{ConversationDiff, ConversationDiffFile};
use crate::protocol::{GitRequest, Reply};
use maitty_shared::repo::{RepoReply, RepoRequest};
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

const THERE: MachineId = MachineId(1);

/// Two machines, "build" holding a copy of this one's sessions, with one of build's in front.
fn on_build() -> (App, mpsc::UnboundedReceiver<Outgoing>, mpsc::UnboundedReceiver<Bg>) {
    let mut app = world(Stage::None);
    let (tx, rx) = mpsc::unbounded_channel();
    app.out = tx;
    let (bg_tx, bg_rx) = mpsc::unbounded_channel();
    app.bg = bg_tx;
    let there = app.snap.clone();
    app.remotes.insert(
        THERE,
        Remote {
            name: "build".into(),
            snap: there,
            ..Remote::default()
        },
    );
    app.screen_fresh();
    let tab = app.snap_of(THERE).unwrap().active().unwrap().tab().unwrap();
    app.cmd_on(THERE, Command::FocusPane { term: tab.focus });
    app.screen_focus(ClientTerm::on(THERE, tab.focus));
    (app, rx, bg_rx)
}

fn sent(rx: &mut mpsc::UnboundedReceiver<Outgoing>) -> Vec<Outgoing> {
    std::iter::from_fn(|| rx.try_recv().ok()).collect()
}

/// The diff questions sent, by machine and tag.
fn diff_asks(out: &[Outgoing]) -> Vec<(MachineId, u64)> {
    out.iter()
        .filter_map(|o| match &o.msg {
            ClientMsg::Query(Query::Repo { tag, request: RepoRequest::Diff { path: None }, .. }) => {
                Some((o.machine, *tag))
            }
            _ => None,
        })
        .collect()
}

/// The git steps sent, by machine, request and tag.
fn git_asks(out: &[Outgoing]) -> Vec<(MachineId, GitRequest, u64)> {
    out.iter()
        .filter_map(|o| match &o.msg {
            ClientMsg::Query(Query::Git { request, tag, .. }) => Some((o.machine, request.clone(), *tag)),
            _ => None,
        })
        .collect()
}

fn press(app: &mut App, code: KeyCode) {
    app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
}

fn type_text(app: &mut App, text: &str) {
    for c in text.chars() {
        press(app, KeyCode::Char(c));
    }
}

fn frame(app: &mut App, title: &str) -> String {
    let text = raw_text(app, Layout::Floating, 140, 34, "unicode");
    if std::env::var(concat!(env!("APP_ENV"), "_SHOW")).is_ok() {
        println!("---- {title}\n{text}");
    }
    text
}

fn file(path: &str, patch: &str) -> ConversationDiffFile {
    let additions = patch.lines().filter(|l| l.starts_with('+') && !l.starts_with("+++")).count();
    let deletions = patch.lines().filter(|l| l.starts_with('-') && !l.starts_with("---")).count();
    ConversationDiffFile { path: path.into(), additions, deletions, patch: patch.into(), binary: false }
}

fn two_files() -> RepoReply {
    let files = vec![
        file(
            "src/a.rs",
            "diff --git a/src/a.rs b/src/a.rs\n--- a/src/a.rs\n+++ b/src/a.rs\n@@ -1,2 +1,2 @@\n fn a() {\n-    old();\n+    new();\n",
        ),
        file(
            "docs/b.md",
            "diff --git a/docs/b.md b/docs/b.md\nnew file mode 100644\n--- /dev/null\n+++ b/docs/b.md\n@@ -0,0 +1 @@\n+# Notes\n",
        ),
    ];
    RepoReply::Diff(ConversationDiff { additions: 2, deletions: 1, total_files: 2, truncated: false, files })
}

/// Changes open on build's pane, its diff answered.
fn open_with_diff() -> (App, mpsc::UnboundedReceiver<Outgoing>, mpsc::UnboundedReceiver<Bg>) {
    let (mut app, mut rx, bg) = on_build();
    sent(&mut rx);
    app.act(Action::Changes);
    let asks = diff_asks(&sent(&mut rx));
    assert_eq!(asks.len(), 1, "one diff question");
    assert_eq!(asks[0].0, THERE, "asked of the pane's machine");
    app.on_machine_server(THERE, ServerMsg::Reply(Reply::Repo { tag: asks[0].1, reply: two_files() }));
    (app, rx, bg)
}

fn view(app: &App) -> &views::ChangesView {
    match &app.view {
        Some(View::Changes(v)) => v,
        _ => panic!("Changes is not open"),
    }
}

#[test]
fn changes_on_another_machine_are_asked_of_it_and_never_read_here() {
    let (mut app, mut rx, mut bg) = on_build();
    sent(&mut rx);
    app.act(Action::Changes);
    assert!(app.notice.is_none(), "no local-only refusal: {:?}", app.notice);
    let asks = diff_asks(&sent(&mut rx));
    assert_eq!(asks.iter().map(|(m, _)| *m).collect::<Vec<_>>(), [THERE]);
    let waiting = frame(&mut app, "changes on build, waiting");
    assert!(waiting.contains("reading the changes on build…"), "{waiting}");
    // An answer to another tag, or from another machine, is not this view's.
    app.on_machine_server(MachineId::LOCAL, ServerMsg::Reply(Reply::Repo { tag: asks[0].1, reply: two_files() }));
    assert!(view(&app).review.is_none());
    app.on_machine_server(THERE, ServerMsg::Reply(Reply::Repo { tag: asks[0].1, reply: two_files() }));
    let shown = frame(&mut app, "changes on build");
    assert!(shown.contains("a.rs") && shown.contains("b.md") && shown.contains("on build"), "{shown}");
    assert!(shown.contains("# Notes"), "the first file in the list, its diff: {shown}");
    press(&mut app, KeyCode::Down);
    app.request_diff();
    let r = view(&app).review.as_ref().unwrap();
    assert!(r.diff.iter().any(|l| l.contains("new();")), "the other file's diff: {:?}", r.diff);
    frame(&mut app, "changes on build, the second file");
    assert!(bg.try_recv().is_err(), "nothing was read with git here");
}

#[test]
fn a_ticked_commit_goes_to_that_machine_with_the_message_written() {
    let (mut app, mut rx, _bg) = open_with_diff();
    press(&mut app, KeyCode::Down);
    press(&mut app, KeyCode::Char('t'));
    press(&mut app, KeyCode::Char('c'));
    assert_eq!(view(&app).extra.message.as_deref(), Some("Update a.rs"));
    let shown = frame(&mut app, "commit message for one ticked file");
    assert!(shown.contains("Commit 1 ticked file on") && shown.contains("Update a.rs"), "{shown}");
    for _ in 0.."Update a.rs".len() {
        press(&mut app, KeyCode::Backspace);
    }
    press(&mut app, KeyCode::Enter);
    assert!(git_asks(&sent(&mut rx)).is_empty(), "an empty message commits nothing");
    type_text(&mut app, "Use new()");
    press(&mut app, KeyCode::Enter);
    let asks = git_asks(&sent(&mut rx));
    assert_eq!(asks.len(), 1);
    assert_eq!(asks[0].0, THERE);
    assert_eq!(
        asks[0].1,
        GitRequest::Commit { message: "Use new()".into(), paths: Some(vec!["src/a.rs".into()]) }
    );
    assert!(view(&app).extra.ticked.is_empty() && view(&app).extra.busy.is_some());
    app.on_machine_server(THERE, ServerMsg::Reply(Reply::GitDone { tag: asks[0].2, outcome: Ok("1a2b3c Use new()".into()) }));
    assert!(view(&app).extra.busy.is_none());
    assert_eq!(app.notice.as_ref().map(|(m, _, e)| (m.as_str(), *e)), Some(("1a2b3c Use new()", false)));
    assert_eq!(diff_asks(&sent(&mut rx)).len(), 1, "read again after the commit");
}

#[test]
fn fetch_pull_push_and_a_pull_request_go_to_that_machine() {
    let (mut app, mut rx, _bg) = open_with_diff();
    sent(&mut rx);
    press(&mut app, KeyCode::Char('f'));
    let fetch = git_asks(&sent(&mut rx));
    assert_eq!(fetch.iter().map(|a| a.1.clone()).collect::<Vec<_>>(), [GitRequest::Fetch]);
    press(&mut app, KeyCode::Char('u'));
    assert!(git_asks(&sent(&mut rx)).is_empty(), "one step at a time");
    app.on_machine_server(THERE, ServerMsg::Reply(Reply::GitDone { tag: fetch[0].2, outcome: Err("no remote".into()) }));
    assert_eq!(app.notice.as_ref().map(|(m, _, e)| (m.as_str(), *e)), Some(("no remote", true)));
    for (key, want) in [('u', GitRequest::Pull), ('P', GitRequest::Push)] {
        press(&mut app, KeyCode::Char(key));
        let asks = git_asks(&sent(&mut rx));
        assert_eq!(asks.iter().map(|a| a.1.clone()).collect::<Vec<_>>(), [want]);
        app.on_machine_server(THERE, ServerMsg::Reply(Reply::GitDone { tag: asks[0].2, outcome: Ok("done".into()) }));
    }
    sent(&mut rx);
    press(&mut app, KeyCode::Char('p'));
    let asked = frame(&mut app, "pull request question");
    assert!(asked.contains("Push and open a pull"), "{asked}");
    assert!(git_asks(&sent(&mut rx)).is_empty(), "asked first");
    press(&mut app, KeyCode::Char('y'));
    assert_eq!(git_asks(&sent(&mut rx)).iter().map(|a| a.1.clone()).collect::<Vec<_>>(), [GitRequest::PullRequest]);
    // Merging, discarding and the editor stay with this computer's checkouts.
    press(&mut app, KeyCode::Char('d'));
    assert!(app.notice.as_ref().is_some_and(|(m, _, _)| m.contains("local-only")));
    assert!(app.view.is_some(), "nothing was thrown away");
}

#[test]
fn a_comment_on_a_diff_line_goes_to_the_agents_message_box() {
    let (mut app, _rx, _bg) = open_with_diff();
    press(&mut app, KeyCode::Down);
    app.request_diff();
    press(&mut app, KeyCode::Char('l'));
    let first = view(&app).extra.line.expect("the diff has the keys");
    assert_eq!(view(&app).review.as_ref().unwrap().diff[first], " fn a() {");
    press(&mut app, KeyCode::Down);
    press(&mut app, KeyCode::Down);
    press(&mut app, KeyCode::Enter);
    type_text(&mut app, "why new?");
    let writing = frame(&mut app, "writing a comment");
    assert!(writing.contains("on src/a.rs, line 2") && writing.contains("why new?"), "{writing}");
    press(&mut app, KeyCode::Enter);
    let shown = frame(&mut app, "a comment under its line");
    assert!(shown.contains("✎ why new?") && shown.contains("· ✎ 1"), "{shown}");
    press(&mut app, KeyCode::Char('s'));
    match &app.mode {
        Mode::Compose(c) => assert_eq!(c.text, "About src/a.rs, line 2:\n>     new();\n\nwhy new?"),
        other => panic!("no message box: {other:?} {:?}", app.notice),
    }
    assert!(view(&app).extra.comments.is_empty(), "handed to the message box");
}

#[test]
fn a_refusal_or_no_answer_from_that_machine_says_so() {
    let (mut app, mut rx, _bg) = on_build();
    sent(&mut rx);
    app.act(Action::Changes);
    sent(&mut rx);
    app.on_machine_server(THERE, ServerMsg::Error("not a git repository".into()));
    assert!(view(&app).error.as_deref().is_some_and(|e| e.contains("not a git repository")));
    app.view = None;
    app.act(Action::Changes);
    if let Some(View::Changes(v)) = &mut app.view
        && let Some(remote) = v.extra.remote.as_mut()
        && let Some((_, at)) = &mut remote.asked
    {
        *at = Instant::now() - Duration::from_secs(31);
    }
    app.changes_tick();
    let why = view(&app).error.clone().unwrap_or_default();
    assert!(why.contains("build did not answer"), "{why}");
}
