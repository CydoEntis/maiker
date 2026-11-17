//! The status log, broadcasting, even pane widths and
//! Recent sessions, drawn and driven as a person would. `AGENT_SHOW=1 cargo test board_tests --
//! --nocapture` prints the frames.
use super::*;
use crate::client::reference_fixture::{self, Stage};
use crate::layout::{Dir, Node};
use crate::protocol::{ClientMsg, ClosedSession, PROTOCOL_VERSION, Reply, ServerMsg, TurnEvent, TurnKind};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::Terminal;
use ratatui::backend::TestBackend;
use tokio::sync::mpsc;

fn text(app: &mut App, w: u16, h: u16) -> Vec<String> {
    app.screen_fresh();
    let mut term = Terminal::new(TestBackend::new(w, h)).expect("a test terminal");
    term.draw(|f| crate::client::render::draw(app, f)).expect("a frame");
    let buf = term.backend().buffer().clone();
    (0..h)
        .map(|y| (0..w).map(|x| buf[(x, y)].symbol()).collect::<String>().trim_end().to_string())
        .collect()
}

fn show(rows: &[String], title: &str) {
    if maitty_shared::brand::env_var("SHOW").is_ok() {
        println!("---- {title}");
        for row in rows {
            println!("{row}");
        }
    }
}

fn key(app: &mut App, code: KeyCode) {
    app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
}

#[test]
fn the_status_log_says_why_newest_first_with_how_long_each_turn_ran() {
    let mut app = reference_fixture::world(Stage::None);
    reference_fixture::focus(&mut app, 2);
    let info = app.snap.terms.get_mut(&2).unwrap();
    info.status_why = "hook: Stop".into();
    info.timeline = vec![
        TurnEvent { at: 1_000, kind: TurnKind::Working, detail: "hook: UserPromptSubmit".into() },
        TurnEvent { at: 1_192, kind: TurnKind::Done, detail: "hook: Stop".into() },
        TurnEvent { at: 1_200, kind: TurnKind::CommandFinished, detail: "1".into() },
    ];
    app.act(Action::StatusLog);
    let rows = text(&mut app, 100, 30);
    show(&rows, "the status log");
    let at = |s: &str| rows.iter().position(|r| r.contains(s)).unwrap_or_else(|| panic!("{s}"));
    assert!(rows[at("Now")].contains("hook: Stop"), "the reason for the status now");
    assert!(at("Command finished (exit 1)") < at("Finished the turn"), "newest first");
    assert!(rows[at("Started working")].contains("ran 3m 12s") && rows[at("Started working")].contains("hook: UserPromptSubmit"));
    key(&mut app, KeyCode::Esc);
    assert!(matches!(app.mode, Mode::Normal));
    let items = app.session_items(ClientTerm::local(2)).unwrap().1;
    assert!(items.iter().any(|(l, _)| l == "Status log"));
}

#[test]
fn broadcast_types_into_every_pane_of_the_tab_and_the_bar_says_so() {
    let mut app = reference_fixture::world(Stage::None);
    let focus = app.focused().expect("a focused pane");
    let tab = app.screen.tab;
    app.screen.tabs[tab].layout.split(focus.term, Dir::Right, 2);
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    app.act(Action::Broadcast);
    let rows = text(&mut app, 140, 36);
    show(&rows, "broadcasting");
    assert!(rows.last().unwrap().contains("BROADCAST · 2 PANES"), "{}", rows.last().unwrap());
    let _ = std::iter::from_fn(|| rx.try_recv().ok()).count();
    key(&mut app, KeyCode::Char('l'));
    let typed: Vec<u32> = std::iter::from_fn(|| rx.try_recv().ok())
        .filter_map(|o| match o.msg {
            ClientMsg::Input { term, data } if data == b"l" => Some(term),
            _ => None,
        })
        .collect();
    assert_eq!(typed.len(), 2, "{typed:?}");
    assert!(typed.contains(&focus.term) && typed.contains(&2));
    app.act(Action::Broadcast);
    assert!(app.broadcasting().is_none());
    let rows = text(&mut app, 140, 36);
    assert!(!rows.last().unwrap().contains("BROADCAST"));
}

#[test]
fn broadcast_wants_two_panes() {
    let mut app = reference_fixture::world(Stage::None);
    app.act(Action::Broadcast);
    assert!(app.broadcasting().is_none(), "one pane: nothing to broadcast to");
}

#[test]
fn reset_widths_shares_the_room_out() {
    let mut app = reference_fixture::world(Stage::None);
    let focus = app.focused().expect("a focused pane");
    let tab = app.screen.tab;
    let layout = &mut app.screen.tabs[tab].layout;
    layout.split(focus.term, Dir::Right, 2);
    layout.resize(focus.term, Dir::Right, 0.3);
    app.act(Action::ResetWidths);
    let Node::Split { ratio, .. } = &app.screen.tabs[tab].layout else { panic!("a split") };
    assert!((ratio - 0.5).abs() < 1e-6, "{ratio}");
}

#[test]
fn recent_sessions_lists_what_the_daemon_kept_and_reopens_the_pick() {
    let mut app = reference_fixture::world(Stage::None);
    app.local_protocol = PROTOCOL_VERSION;
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    text(&mut app, 140, 36);
    app.act(Action::RecentSessions);
    let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
    assert!(sent.iter().any(|o| matches!(o.msg, ClientMsg::Query(crate::protocol::Query::ClosedSessions))));
    let closed = |agent: &str, session: &str, at: u64, title: &str| ClosedSession {
        agent: agent.into(),
        session: session.into(),
        cwd: "/code/dsa-tool".into(),
        branch: Some("feat/export".into()),
        title: Some(title.into()),
        at,
        worktree: None,
        repo: None,
    };
    let now = super::now_secs();
    app.on_server(ServerMsg::Reply(Reply::ClosedSessions(vec![
        closed("claude", "abc-1", now - 7200, "add export"),
        closed("gemini", "g-2", now - 60, "old idea"),
    ])));
    let rows = text(&mut app, 140, 36);
    show(&rows, "recent sessions");
    let Mode::ScreenMenu(m) = &app.mode else { panic!("{:?}", app.mode) };
    assert_eq!(m.items.len(), 2);
    assert!(m.items[0].0.starts_with("gemini · 1m ago · can't be reopened"), "newest first: {}", m.items[0].0);
    assert!(m.items[1].0.starts_with("Claude · 2h ago · add export · dsa-tool"), "{}", m.items[1].0);
    app.menu_do(m.items[1].1.clone());
    let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
    assert!(sent.iter().any(|o| matches!(&o.msg, ClientMsg::Command(Command::ReopenClosedSession { agent, session }) if agent == "claude" && session == "abc-1")));
}

#[test]
fn a_reply_after_the_list_closed_opens_nothing() {
    let mut app = reference_fixture::world(Stage::None);
    app.local_protocol = PROTOCOL_VERSION;
    app.act(Action::RecentSessions);
    key(&mut app, KeyCode::Esc);
    app.on_server(ServerMsg::Reply(Reply::ClosedSessions(Vec::new())));
    assert!(matches!(app.mode, Mode::Normal), "{:?}", app.mode);
}
