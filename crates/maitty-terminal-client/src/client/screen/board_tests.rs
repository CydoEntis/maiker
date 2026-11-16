//! The Work board, a run's steps opened from it, the status log, broadcasting, even pane widths and
//! Recent sessions, drawn and driven as a person would. `MAITTY_SHOW=1 cargo test board_tests --
//! --nocapture` prints the frames.
use super::*;
use crate::client::reference_fixture::{self, Stage};
use crate::layout::{Dir, Node};
use crate::protocol::{ClientMsg, ClosedSession, PROTOCOL_VERSION, Reply, ServerMsg, TurnEvent, TurnKind};
use crate::workflow::{StepState::{self, *}, WorkflowRun, WorkflowStep, WorkflowTicket};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
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
    if std::env::var(concat!(env!("APP_ENV"), "_SHOW")).is_ok() {
        println!("---- {title}");
        for row in rows {
            println!("{row}");
        }
    }
}

fn key(app: &mut App, code: KeyCode) {
    app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
}

fn click(app: &mut App, x: u16, y: u16) {
    for kind in [MouseEventKind::Down(MouseButton::Left), MouseEventKind::Up(MouseButton::Left)] {
        app.on_mouse(MouseEvent { kind, column: x, row: y, modifiers: KeyModifiers::NONE });
    }
}

fn run(id: &str, key: &str, title: &str, steps: &[(&str, StepState)]) -> WorkflowRun {
    WorkflowRun {
        workflow: "factory".into(),
        run: id.into(),
        ticket: Some(WorkflowTicket { key: key.into(), title: Some(title.into()), link: None }),
        steps: steps
            .iter()
            .map(|(name, state)| WorkflowStep {
                name: (*name).into(),
                state: *state,
                note: (*state == SentBack).then(|| "2 tests failed".into()),
                helper: (*name == "build").then(|| format!("{key} builder")),
                choices: Vec::new(),
            })
            .collect(),
        reported_at: 1,
    }
}

/// The world with session 2 running four workflow runs, focused.
fn with_runs() -> App {
    let mut app = reference_fixture::world(Stage::None);
    app.snap.terms.get_mut(&2).unwrap().workflows = vec![
        run("001", "MAITTY-42", "Add export", &[("intake", Passed), ("build", SentBack), ("review code", Waiting)]),
        run("002", "MAITTY-43", "Fix footer", &[("intake", NeedsYou), ("build", Waiting), ("review code", Waiting)]),
        run("003", "MAITTY-40", "Dark mode", &[("intake", Passed), ("build", Passed), ("review code", Passed)]),
        run("004", "MAITTY-41", "Search", &[("intake", Passed), ("build", Working), ("review code", Waiting)]),
    ];
    app.screen_fresh();
    reference_fixture::focus(&mut app, 2);
    app
}

#[test]
fn the_work_board_puts_each_run_in_its_step_then_needs_human_and_done() {
    let mut app = with_runs();
    app.act(Action::WorkBoard);
    let rows = text(&mut app, 140, 36);
    show(&rows, "the Work board, 140x36");
    let all = rows.join("\n");
    assert!(all.contains("work · "), "titled by the session");
    assert!(all.contains("1 needs you · 2 working · 1 done"), "the summary on the border");
    let heads = rows.iter().find(|r| r.contains("Intake")).expect("a row of column heads");
    for name in ["Intake  0", "Build  2", "Review code  0", "Needs human  1", "Done  1"] {
        assert!(heads.contains(name), "{name} in {heads}");
    }
    assert!(all.contains("MAITTY-43") && all.contains("Fix footer"));
    assert!(all.contains("2 tests failed"), "a card shows its step's note");
    assert!(all.contains("Nothing here"), "an empty column says so");
    assert!(matches!(app.mode, Mode::Work { sel: 2, .. }), "it opens on the card that needs you: {:?}", app.mode);
}

#[test]
fn enter_opens_a_cards_run_and_esc_goes_back_to_the_board_then_closes() {
    let mut app = with_runs();
    app.act(Action::WorkBoard);
    text(&mut app, 140, 36);
    key(&mut app, KeyCode::Up);
    key(&mut app, KeyCode::Up);
    key(&mut app, KeyCode::Enter);
    assert!(matches!(&app.mode, Mode::Run { board: Some(0), .. }), "{:?}", app.mode);
    let rows = text(&mut app, 140, 36);
    show(&rows, "a run opened from the board");
    let all = rows.join("\n");
    assert!(all.contains("MAITTY-42  working"), "the run's key and word");
    assert!(all.contains("updated ") && all.contains("this computer"), "the meta line");
    assert!(all.contains("✓ intake ━━ ↺ build ── · review code"), "the step strip");
    assert!(all.contains("sent back"), "each step's word");
    key(&mut app, KeyCode::Esc);
    assert!(matches!(app.mode, Mode::Work { sel: 0, .. }), "{:?}", app.mode);
    key(&mut app, KeyCode::Esc);
    assert!(matches!(app.mode, Mode::Normal));
}

#[test]
fn a_click_on_a_card_opens_it_and_arrows_step_between_columns() {
    let mut app = with_runs();
    app.act(Action::WorkBoard);
    key(&mut app, KeyCode::Right);
    assert!(matches!(app.mode, Mode::Work { sel: 3, .. }), "→ goes to Done's first card: {:?}", app.mode);
    key(&mut app, KeyCode::Left);
    assert!(matches!(app.mode, Mode::Work { sel: 2, .. }), "{:?}", app.mode);
    key(&mut app, KeyCode::Left);
    assert!(matches!(app.mode, Mode::Work { sel: 0, .. }), "{:?}", app.mode);
    let rows = text(&mut app, 140, 36);
    let y = rows.iter().position(|r| r.contains("MAITTY-43  ") || r.ends_with("MAITTY-43")).unwrap();
    let at = rows[y].find("MAITTY-43").unwrap();
    let x = rows[y][..at].chars().count() as u16;
    click(&mut app, x, y as u16);
    assert!(matches!(&app.mode, Mode::Run { board: Some(2), .. }), "{:?}", app.mode);
}

#[test]
fn a_narrow_board_stacks_its_columns_and_an_empty_one_says_how_runs_arrive() {
    let mut app = with_runs();
    app.act(Action::WorkBoard);
    let rows = text(&mut app, 80, 24);
    show(&rows, "the Work board at 80x24");
    let all = rows.join("\n");
    assert!(all.contains("NEEDS HUMAN  1"), "stacked headings");
    assert!(rows.iter().any(|r| r.contains("MAITTY-43  Fix footer")), "a card a line");
    let mut app = reference_fixture::world(Stage::None);
    reference_fixture::focus(&mut app, 2);
    app.act(Action::WorkBoard);
    let rows = text(&mut app, 80, 24);
    show(&rows, "no runs");
    assert!(rows.join("\n").contains("No runs reported in this session."));
}

#[test]
fn the_runs_done_line_and_the_row_menu_open_the_board() {
    let mut app = with_runs();
    let rows = text(&mut app, 140, 36);
    let y = rows.iter().position(|r| r.contains("1 run done")).expect("the folded line");
    let x = rows[y].chars().position(|c| c == '1').unwrap() as u16;
    click(&mut app, x, y as u16);
    assert!(matches!(app.mode, Mode::Work { .. }), "{:?}", app.mode);
    let items = app.session_items(ClientTerm::local(2)).unwrap().1;
    assert!(items.iter().any(|(l, a)| l == "Work board" && *a == crate::client::menu::Act::Board(ClientTerm::local(2))));
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
