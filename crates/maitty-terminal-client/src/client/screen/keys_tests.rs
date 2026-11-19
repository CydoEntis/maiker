//! The keys of the v26 handoff end to end: the prefix and what is taken inside a pane, Search
//! commands (Ctrl+K) with its sessions, the Menu, and the Updates box.

use super::*;
use crate::client::reference_fixture::{Stage, world};
use crate::client::{Outgoing, render};
use crate::protocol::{ClientMsg, Command};
use ratatui::Terminal;
use ratatui::backend::TestBackend;
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use tokio::sync::mpsc;

fn app_with_channel() -> (App, mpsc::UnboundedReceiver<Outgoing>) {
    let mut app = world(Stage::None);
    let (tx, rx) = mpsc::unbounded_channel();
    app.out = tx;
    app.screen_fresh();
    (app, rx)
}

fn press(app: &mut App, code: KeyCode, mods: KeyModifiers) {
    app.on_key(KeyEvent::new(code, mods));
}

/// Search is on the leader now: ctrl+space, then k.
fn open_search(app: &mut App) {
    press(app, KeyCode::Char(' '), KeyModifiers::CONTROL);
    press(app, KeyCode::Char('k'), KeyModifiers::NONE);
}

fn type_text(app: &mut App, text: &str) {
    for c in text.chars() {
        press(app, KeyCode::Char(c), KeyModifiers::NONE);
    }
}

fn frame(app: &mut App, w: u16, h: u16) -> String {
    app.screen_fresh();
    let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
    term.draw(|f| render::draw(app, f)).unwrap();
    let buf = term.backend().buffer().clone();
    (0..h)
        .map(|y| (0..w).map(|x| buf[(x, y)].symbol().to_string()).collect::<String>().trim_end().to_string() + "\n")
        .collect()
}

#[test]
fn the_prefix_is_ctrl_space_and_ctrl_a_still_works_for_one_release() {
    let (app, _rx) = app_with_channel();
    let key = |s: &str| s.parse::<crate::keys::KeySpec>().unwrap();
    assert_eq!(app.keymap.prefix, key("ctrl+space"));
    assert!(app.keymap.is_prefix(&key("ctrl+a")), "the old prefix still opens key mode");
    assert!(!app.keymap.is_prefix(&key("ctrl+b")));
    let cfg = crate::config::Config { prefix: "ctrl+b".into(), ..Default::default() };
    let km = cfg.keymap();
    assert!(km.is_prefix(&key("ctrl+b")) && !km.is_prefix(&key("ctrl+a")), "a prefix set on purpose is the only one");
}

#[test]
fn inside_a_pane_only_the_listed_keys_are_taken() {
    let (app, _rx) = app_with_channel();
    let key = |s: &str| s.parse::<crate::keys::KeySpec>().unwrap();
    let taken: Vec<_> = app.keymap.global.keys().copied().collect();
    for passes in ["ctrl+c", "ctrl+d", "ctrl+z", "ctrl+l", "ctrl+r", "up", "down", "left", "right", "tab", "esc", "enter"] {
        assert!(!taken.contains(&key(passes)), "{passes} goes to the program");
    }
    for takes in ["alt+up", "alt+down", "alt+j"] {
        assert!(taken.contains(&key(takes)), "{takes} is taken");
    }
}

#[test]
fn leader_k_opens_search_commands_and_it_lists_commands_then_sessions() {
    let (mut app, _rx) = app_with_channel();
    open_search(&mut app);
    assert!(matches!(&app.mode, Mode::KeyMap(km) if km.view == KeyView::Search));
    let shown = frame(&mut app, 140, 40);
    println!("{shown}");
    assert!(shown.contains("Search") && shown.contains("Search chats and commands"));
    let chats = shown.find("Chats").expect("Chats");
    let commands = chats + shown[chats..].find("Commands").expect("Commands");
    assert!(chats < commands, "chats first");
    for command in ["New chat", "Show changes", "Settings", "Collapse sidebar", "Group by machine", "Light theme", "Keys"] {
        assert!(shown.contains(command), "{command}: {shown}");
    }
    assert!(!shown.contains("Compact this chat") && !shown.contains("Install update"), "only when they apply");
    assert!(shown.contains("↑ ↓") && shown.contains("Enter") && shown.contains("Esc"));
}

#[test]
fn typing_is_a_fuzzy_in_order_subsequence_and_the_group_reads_results() {
    let (mut app, _rx) = app_with_channel();
    open_search(&mut app);
    type_text(&mut app, "spld");
    let shown = frame(&mut app, 140, 40);
    println!("{shown}");
    assert!(shown.contains("Commands"), "{shown}");
    assert!(shown.contains("Split down"), "s-p-l-d are in order in it: {shown}");
    assert!(!shown.contains("Settings"), "and not in Settings, which has no p: {shown}");
}

#[test]
fn a_session_row_shows_its_name_and_project_and_enter_goes_to_it() {
    let (mut app, mut rx) = app_with_channel();
    open_search(&mut app);
    type_text(&mut app, "fixfoot");
    let shown = frame(&mut app, 140, 40);
    println!("{shown}");
    assert!(shown.contains("fix-footer") && shown.contains("affiliate-site") && shown.contains("local"), "{shown}");
    while rx.try_recv().is_ok() {}
    // The command rows come first; the session is the last row.
    for _ in 0..40 {
        press(&mut app, KeyCode::Down, KeyModifiers::NONE);
    }
    press(&mut app, KeyCode::Enter, KeyModifiers::NONE);
    // Opened from the leader, search hands the keys back to the leader when it closes.
    assert!(matches!(app.mode, Mode::Prefix { .. }), "{:?}", app.mode);
    let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
    assert!(
        sent.iter().any(|o| matches!(o.msg, ClientMsg::Command(Command::FocusPane { .. }))),
        "the session takes the focus: {sent:?}"
    );
}

#[test]
fn the_menu_has_the_v26_sections_and_skips_their_headers() {
    let rows = action_items();
    let labels: Vec<&str> = rows.iter().map(|(l, _)| *l).collect();
    assert_eq!(
        labels,
        [
            "Shell here", "Pane beside this", "Clone a repository…", "Files", "Changes", "Branches", "History",
            "References", "Inbox", "Search commands", "All keys", "Collapse sidebar", "Settings",
        ]
    );
    let (mut app, _rx) = app_with_channel();
    press(&mut app, KeyCode::Char('a'), KeyModifiers::CONTROL);
    press(&mut app, KeyCode::Char('.'), KeyModifiers::NONE);
    assert!(matches!(app.mode, Mode::Actions { sel: 0 }));
    let shown = frame(&mut app, 140, 40);
    for header in ["NEW", "TOOLS", "FIND", "SIDEBAR"] {
        assert!(shown.contains(header), "{header}: {shown}");
    }
    press(&mut app, KeyCode::Down, KeyModifiers::NONE);
    assert!(matches!(app.mode, Mode::Actions { sel: 1 }), "arrows move over rows, not headers");
}

#[test]
fn the_updates_box_follows_the_install_and_offers_its_keys() {
    let (mut app, _rx) = app_with_channel();
    app.update_available = Some("9.9.9".into());
    app.update_notes = vec!["Flat sessions".into()];
    // The release chip's menu (Release notes) and search commands open it; it has no key.
    app.act(crate::keys::Action::Updates);
    assert_eq!(app.mode, Mode::Updates);
    let shown = frame(&mut app, 140, 40);
    println!("{shown}");
    assert!(shown.contains("9.9.9") && shown.contains("Flat sessions"), "{shown}");
    assert!(shown.contains("Download") && shown.contains("Skip") && shown.contains("Later"), "{shown}");
    press(&mut app, KeyCode::Char('s'), KeyModifiers::NONE);
    assert_eq!(app.mode, Mode::Normal, "skip closes it");
    assert_eq!(app.update_phase(), super::updates::Phase::UpToDate, "and this version is skipped for the run");
    app.update_failed = Some("offline".into());
    assert!(matches!(app.update_phase(), super::updates::Phase::Failed { .. }));
}

#[test]
fn a_chat_row_names_its_project_branch_machine_and_age() {
    let (mut app, _rx) = app_with_channel();
    open_search(&mut app);
    let shown = frame(&mut app, 140, 40);
    assert!(shown.contains("affiliate-site / fix-footer · local"), "{shown}");
    assert!(shown.contains("2m"), "its age: {shown}");
}

#[test]
fn compact_and_install_update_are_listed_only_when_they_apply() {
    let (mut app, _rx) = app_with_channel();
    open_search(&mut app);
    let shown = frame(&mut app, 140, 40);
    assert!(!shown.contains("Compact this chat") && !shown.contains("Install update"), "{shown}");
    let term = app.selected_term().expect("a chat in front");
    let info = app.snap.terms.get_mut(&term.term).expect("its info");
    info.agent = Some("claude".into());
    info.usage.context = Some(80.0);
    app.update_available = Some("9.9.9".into());
    let shown = frame(&mut app, 140, 40);
    assert!(shown.contains("Compact this chat") && shown.contains("Install update"), "{shown}");
    info_context(&mut app, 79.0);
    assert!(!frame(&mut app, 140, 40).contains("Compact this chat"), "under 80% it is not offered");
}

fn info_context(app: &mut App, used: f32) {
    let term = app.selected_term().expect("a chat in front");
    app.snap.terms.get_mut(&term.term).expect("its info").usage.context = Some(used);
}

#[test]
fn group_by_names_what_it_will_do_and_enter_does_it() {
    let (mut app, _rx) = app_with_channel();
    assert!(!app.screen.saved.group_machine);
    open_search(&mut app);
    type_text(&mut app, "group");
    let shown = frame(&mut app, 140, 40);
    assert!(shown.contains("Group by machine") && !shown.contains("Group by status"), "{shown}");
    press(&mut app, KeyCode::Enter, KeyModifiers::NONE);
    assert!(app.screen.saved.group_machine, "grouped by machine now");
    app.mode = Mode::Normal;
    open_search(&mut app);
    type_text(&mut app, "group");
    assert!(frame(&mut app, 140, 40).contains("Group by status"), "the other way is offered next");
}

#[test]
fn a_search_that_finds_nothing_says_so() {
    let (mut app, _rx) = app_with_channel();
    open_search(&mut app);
    type_text(&mut app, "zzqx");
    let shown = frame(&mut app, 140, 40);
    assert!(shown.contains("Nothing matches."), "{shown}");
    assert!(!shown.contains("Chats") && !shown.contains("Commands"), "{shown}");
}

#[test]
fn a_command_row_runs_on_enter_and_a_chat_row_goes_to_its_chat() {
    let (mut app, mut rx) = app_with_channel();
    open_search(&mut app);
    type_text(&mut app, "keys");
    press(&mut app, KeyCode::Enter, KeyModifiers::NONE);
    assert!(matches!(&app.mode, Mode::KeyMap(km) if km.view == KeyView::All), "Keys opens the keys help: {:?}", app.mode);
    app.mode = Mode::Normal;
    open_search(&mut app);
    type_text(&mut app, "quick-fox");
    while rx.try_recv().is_ok() {}
    press(&mut app, KeyCode::Enter, KeyModifiers::NONE);
    let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
    assert!(sent.iter().any(|o| matches!(o.msg, ClientMsg::Command(Command::FocusPane { .. }))), "{sent:?}");
}
