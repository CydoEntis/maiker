//! The chat menu of a sidebar row, and renaming a row in place. Docs: UI.md, "Chat menu".

use super::*;
use crate::client::menu::Act;
use crate::client::reference_fixture::{Stage, world};
use crate::protocol::{ClientMsg, Command};
use ratatui::{Terminal, backend::TestBackend};

fn frame(app: &mut App) -> String {
    let mut term = Terminal::new(TestBackend::new(120, 34)).expect("a test terminal");
    term.draw(|f| crate::client::render::draw(app, f)).expect("a frame");
    let buf = term.backend().buffer().clone();
    (0..34).map(|y| (0..120).map(|x| buf[(x, y)].symbol()).collect::<String>()).collect::<Vec<_>>().join("\n")
}

fn labels(app: &App, term: ClientTerm) -> Vec<String> {
    app.session_items(term).expect("a menu").1.into_iter().map(|(l, _)| l).collect()
}

/// The agent pane that is not the open one, with `status` and `context` set.
fn chat(status: Status, context: Option<f32>) -> (App, ClientTerm) {
    let mut app = world(Stage::None);
    let id = *app.snap.terms.iter().find(|(_, t)| t.agent.is_some()).map(|(id, _)| id).expect("an agent");
    let info = app.snap.terms.get_mut(&id).expect("its info");
    info.status = status;
    info.usage.context = context;
    (app, ClientTerm::local(id))
}

fn sent(rx: &mut tokio::sync::mpsc::UnboundedReceiver<crate::client::Outgoing>) -> Vec<ClientMsg> {
    std::iter::from_fn(|| rx.try_recv().ok()).map(|o| o.msg).collect()
}

#[test]
fn compact_is_offered_from_eighty_percent_of_the_context() {
    let (app, term) = chat(Status::Idle, Some(79.0));
    assert!(!labels(&app, term).contains(&"Compact the context".to_string()));
    let (app, term) = chat(Status::Idle, Some(80.0));
    assert!(labels(&app, term).contains(&"Compact the context".to_string()));
}

#[test]
fn compact_types_the_agents_own_command() {
    let (mut app, term) = chat(Status::Idle, Some(90.0));
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    app.out = tx;
    app.menu_do(Act::Compact(term));
    assert!(sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Input { data, .. } if data == b"/compact\r")));
}

#[test]
fn stop_the_agent_is_offered_only_while_it_works_or_needs_you_and_sits_above_close_chat() {
    let (app, term) = chat(Status::Idle, None);
    assert!(!labels(&app, term).contains(&"Stop the agent".to_string()));
    for status in [Status::Working, Status::Blocked] {
        let (app, term) = chat(status, None);
        let items = labels(&app, term);
        let n = items.len();
        assert_eq!(&items[n - 2..], ["Stop the agent", "Close chat"], "{items:?}");
    }
}

#[test]
fn stop_the_agent_interrupts_it_with_ctrl_c() {
    let (mut app, term) = chat(Status::Working, None);
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    app.out = tx;
    app.menu_do(Act::StopAgent(term));
    assert!(sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Input { data, .. } if data == &[3u8])));
}

#[test]
fn the_menu_names_its_items_as_the_design_does_with_the_keys_that_work_in_the_sidebar() {
    let (app, term) = chat(Status::Working, Some(85.0));
    let items = labels(&app, term);
    for want in ["Open", "Rename…", "Copy folder path", "Compact the context", "Stop the agent", "Close chat"] {
        assert!(items.contains(&want.to_string()), "{want} in {items:?}");
    }
}

#[test]
fn closing_a_chat_says_its_branch_and_history_are_kept() {
    let (mut app, term) = chat(Status::Idle, None);
    app.menu_do(Act::End(vec![term]));
    let (said, ..) = app.notice.clone().expect("a notice");
    assert_eq!(said, "Closed the chat. Its branch and history are kept.");
}

#[test]
fn a_rename_is_typed_on_the_row_with_a_cursor_and_enter_saves_it() {
    let (mut app, term) = chat(Status::Idle, None);
    let _ = frame(&mut app);
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    app.out = tx;
    app.menu_do(Act::RenamePane(term));
    for c in "zz".chars() {
        app.on_key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE));
    }
    let all = frame(&mut app);
    assert!(all.contains("zz▏"), "the typed name and a cursor are on the row\n{all}");
    assert!(!all.contains("Rename pane"), "no box of its own\n{all}");
    app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    assert!(
        sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Command(Command::RenamePane { name, .. }) if name.ends_with("zz"))),
        "saved"
    );
}

#[test]
fn escape_cancels_a_rename_and_keeps_the_name() {
    let (mut app, term) = chat(Status::Idle, None);
    let _ = frame(&mut app);
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    app.out = tx;
    app.menu_do(Act::RenamePane(term));
    app.on_key(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::NONE));
    app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
    assert!(!sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Command(Command::RenamePane { .. }))));
    assert!(!frame(&mut app).contains('▏'));
}
