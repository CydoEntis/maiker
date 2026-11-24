//! The sidebar (each machine with its sessions), the status glyphs, the tab row and the workspace
//! frames, held to the TUI redesign. `AGENT_SHOW=1 cargo test <name> -- --nocapture` prints the frames.
use super::status_mark::State;
use super::*;
use crate::client::reference_fixture::{self, Stage};
use crate::layout::{Dir, Node};
use crate::protocol::ClientMsg;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::Terminal;
use ratatui::backend::TestBackend;
use tokio::sync::mpsc;

fn cells(app: &mut App, w: u16, h: u16) -> Buffer {
    app.cfg.ui.gap = "1".into();
    app.screen_fresh();
    let mut term = Terminal::new(TestBackend::new(w, h)).expect("a test terminal");
    term.draw(|f| crate::client::render::draw(app, f))
        .expect("a frame");
    term.backend().buffer().clone()
}

/// `app` drawn at `w`×`h` as rows of text, trailing spaces trimmed.
fn text(app: &mut App, w: u16, h: u16) -> Vec<String> {
    let buf = cells(app, w, h);
    (0..h)
        .map(|y| {
            (0..w)
                .map(|x| buf[(x, y)].symbol())
                .collect::<String>()
                .trim_end()
                .to_string()
        })
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

/// The sidebar's columns of row `y` of a frame with the full sidebar.
fn side(rows: &[String], y: usize) -> String {
    rows[y].chars().take(34).collect()
}

fn click(app: &mut App, x: u16, y: u16) {
    for kind in [
        MouseEventKind::Down(MouseButton::Left),
        MouseEventKind::Up(MouseButton::Left),
    ] {
        app.on_mouse(MouseEvent {
            kind,
            column: x,
            row: y,
            modifiers: KeyModifiers::NONE,
        });
    }
}

/// The world with its first session split into `n` panes (2 to 4).
fn split_world(n: usize) -> App {
    let mut app = reference_fixture::world(Stage::None);
    let focus = app.focused().expect("a focused pane");
    let tab = app.screen.tab;
    let layout = &mut app.screen.tabs[tab].layout;
    layout.split(focus.term, Dir::Right, 2);
    if n > 2 {
        layout.split(2, Dir::Down, 3);
    }
    if n > 3 {
        layout.split(focus.term, Dir::Down, 4);
    }
    app
}

// ---- the sidebar ---------------------------------------------------------------------------

/// The row a session's first line is drawn on.
fn row_of(app: &App, term: u32) -> usize {
    app.screen.row_y[&ClientTerm::local(term)] as usize
}

fn side_of(row: &str) -> String {
    row.chars().take(34).collect()
}

#[test]
fn a_row_moves_to_the_group_of_its_status() {
    let mut app = reference_fixture::world(Stage::None);
    for (status, heading) in [
        (Status::Working, "Working"),
        (Status::Blocked, "Needs you"),
        (Status::Done, "Done"),
        (Status::Idle, "Idle"),
    ] {
        app.snap.terms.get_mut(&5).unwrap().status = status;
        let rows = text(&mut app, 140, 36);
        let above = (0..row_of(&app, 5))
            .rev()
            .map(|y| side_of(&rows[y]))
            .find(|r| ["Needs you", "Working", "Done", "Idle"].iter().any(|h| r.contains(h)))
            .expect("a heading above the row");
        assert!(above.contains(heading), "{status:?} sits under {heading}: {above}");
    }
}

#[test]
fn the_filter_is_a_modal_that_narrows_the_list_as_you_type_and_esc_clears_it() {
    let mut app = reference_fixture::world(Stage::None);
    app.screen_side_set(SideItem::Sess(app.session_key(ClientTerm::local(1))));
    key(&mut app, KeyCode::Char('/'));
    for c in "pixls".chars() {
        key(&mut app, KeyCode::Char(c));
    }
    let rows = text(&mut app, 140, 36);
    show(&rows, "filtered");
    assert!(rows.iter().any(|r| r.contains("Filter sessions") && r.contains('╭')), "the modal's title");
    assert!(rows.iter().any(|r| r.contains("› pixls")), "what is typed");
    assert!(rows.iter().any(|r| side_of(r).contains("warm-finch")));
    assert!(!rows.iter().any(|r| side_of(r).contains("fix-footer")), "only the match");
    key(&mut app, KeyCode::Esc);
    let rows = text(&mut app, 140, 36);
    assert!(!rows.iter().any(|r| r.contains("Filter sessions")), "the modal is gone");
    assert!(rows.iter().any(|r| side_of(r).contains("fix-footer")));
    // A session's project matches too.
    app.screen.filter = "affiliate".into();
    let rows = text(&mut app, 140, 36);
    assert!(rows.iter().any(|r| side_of(r).contains("add-payments")));
}

#[test]
fn enter_in_the_filter_opens_the_match_and_leaves_the_list_whole() {
    let mut app = reference_fixture::world(Stage::None);
    app.act(Action::FilterSessions);
    for c in "pixls".chars() {
        key(&mut app, KeyCode::Char(c));
    }
    key(&mut app, KeyCode::Enter);
    assert!(app.screen.filter.is_empty() && !app.screen.filtering);
    let rows = text(&mut app, 140, 36);
    assert!(rows.iter().any(|r| side_of(r).contains("fix-footer")), "nothing stays hidden");
}

#[test]
fn add_machine_is_in_the_sidebar_menu() {
    let mut app = reference_fixture::world(Stage::None);
    text(&mut app, 140, 36);
    app.sidebar_menu();
    let Mode::ScreenMenu(m) = &app.mode else { panic!("{:?}", app.mode) };
    let i = m.items.iter().position(|(label, _)| label == "Add machine…").expect("the item");
    app.menu_pick(i);
    assert!(matches!(app.mode, Mode::Machines(_)), "{:?}", app.mode);
    let rows = text(&mut app, 140, 36);
    assert!(!side(&rows, 0).contains("+ machine"), "no chip on the top border");
}

#[test]
fn the_default_width_is_34_and_a_dragged_one_stays_between_24_and_60() {
    let mut app = reference_fixture::world(Stage::None);
    cells(&mut app, 140, 36);
    assert_eq!(app.screen.side_rect.width, 34);
    app.screen.saved.side_w = Some(80);
    cells(&mut app, 140, 36);
    assert_eq!(app.screen.side_rect.width, 60);
    app.screen.saved.side_w = Some(10);
    cells(&mut app, 140, 36);
    assert_eq!(app.screen.side_rect.width, 24);
}

#[test]
fn clicking_a_session_focuses_its_pane_wherever_the_daemon_holds_it() {
    let mut app = reference_fixture::world(Stage::None);
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    cells(&mut app, 140, 36);
    let y = app.screen.row_y[&ClientTerm::local(3)];
    click(&mut app, 8, y);
    let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
    assert!(
        sent.iter()
            .any(|o| matches!(&o.msg, ClientMsg::Command(Command::FocusPane { term: 3 }))),
        "{} messages, none a focus on pane 3",
        sent.len()
    );
}

#[test]
fn prefix_dot_on_a_session_opens_its_row_menu_and_anywhere_else_the_menu() {
    let mut app = reference_fixture::world(Stage::None);
    text(&mut app, 140, 36);
    app.screen_side_set(SideItem::Sess(app.session_key(ClientTerm::local(3))));
    app.act(Action::Menu);
    let Mode::ScreenMenu(menu) = &app.mode else {
        panic!("{:?}", app.mode)
    };
    assert!(menu.title.contains("warm-finch"), "{}", menu.title);
    let mut app = reference_fixture::world(Stage::None);
    text(&mut app, 140, 36);
    app.act(Action::Menu);
    assert!(matches!(app.mode, Mode::Actions { .. }));
}

#[test]
fn the_plus_on_a_machine_heading_starts_a_shell_there_at_once() {
    let mut app = reference_fixture::world(Stage::None);
    app.screen.saved.group_machine = true;
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    let rows = text(&mut app, 140, 36);
    let y = rows.iter().position(|r| side(std::slice::from_ref(r), 0).contains("This computer")).expect("this computer's heading");
    let plus = side(&rows, y).chars().position(|c| c == '+').unwrap() as u16;
    click(&mut app, plus, y as u16);
    let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
    assert!(
        sent.iter()
            .any(|o| matches!(&o.msg, ClientMsg::Command(Command::NewShip { ws: 10, cmd: None, .. }))),
        "{} messages",
        sent.len()
    );
    assert_eq!(app.mode, Mode::Normal, "no name is asked");
}

#[test]
fn a_machine_that_is_offline_gets_a_warning_and_no_shell() {
    let mut app = reference_fixture::world(Stage::None);
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    app.service_lost();
    app.new_ship_on(MachineId::LOCAL);
    assert!(std::iter::from_fn(|| rx.try_recv().ok()).next().is_none());
    assert!(app.notice.as_ref().is_some_and(|(m, _, err)| *err && m.contains("offline")));
}

/// The world with `kingdom` configured, its supervisor saying the app is not there.
fn with_kingdom_needing_the_app() -> (App, MachineId) {
    use crate::client::link::ConnectionState;
    let mut app = reference_fixture::world(Stage::None);
    app.cfg.machines.push(maitty_settings::config::MachineDef {
        name: "kingdom".into(),
        target: "dev@kingdom.lan".into(),
        ..Default::default()
    });
    app.screen.saved.group_machine = true;
    let id = MachineId(9);
    let failure = crate::link_failure::FailureClass::Install;
    app.on_link_state(id, "kingdom".into(), ConnectionState::NeedsUpdate { failure });
    (app, id)
}

fn menu_labels(app: &App) -> Vec<String> {
    let Mode::ScreenMenu(m) = &app.mode else {
        panic!("no menu: {:?}", app.mode)
    };
    m.items.iter().map(|(l, _)| l.clone()).collect()
}

#[test]
fn a_machine_with_no_app_has_an_install_chip_on_its_heading_that_opens_the_popup() {
    let (mut app, _) = with_kingdom_needing_the_app();
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    let rows = text(&mut app, 140, 36);
    show(&rows, "kingdom needs the app");
    let y = rows
        .iter()
        .position(|r| side(std::slice::from_ref(r), 0).contains(" kingdom 0 "))
        .expect("kingdom's heading");
    let head = side(&rows, y);
    assert!(head.contains(" Install ") && !head.contains(" + "), "{head}");
    let x = head.find(" Install ").expect("the chip") as u16 + 2;
    click(&mut app, x, y as u16);
    let popups: Vec<String> = std::iter::from_fn(|| rx.try_recv().ok())
        .filter_map(|o| match o.msg {
            ClientMsg::Command(crate::protocol::Command::Popup { cmd, .. }) => Some(cmd),
            _ => None,
        })
        .collect();
    assert!(
        popups.len() == 1 && popups[0].ends_with(" machine update kingdom --hold"),
        "{popups:?}"
    );
    let said = app.notice.as_ref().map(|(m, ..)| m.clone()).unwrap_or_default();
    assert!(said.starts_with(&format!("Installing {} on kingdom", crate::brand::APP_NAME)), "{said}");
}

#[test]
fn hiding_the_sidebar_leaves_a_narrow_rail_that_brings_it_back() {
    let mut app = reference_fixture::world(Stage::None);
    app.cfg.ui.motion = false;
    text(&mut app, 140, 36);
    app.act(Action::ToggleSidebar);
    let rows = text(&mut app, 140, 36);
    show(&rows, "hidden");
    let rail = |y: usize| rows[y].chars().take(usize::from(side::RAIL_W)).collect::<String>();
    assert!(rail(1).contains('»') && rail(2).contains('⌕') && rail(3).contains('+'), "the buttons at the top: {} {} {}", rail(1), rail(2), rail(3));
    assert!(rows.iter().any(|r| r.chars().take(usize::from(side::RAIL_W)).any(|c| c == '≡')), "the menu button at the bottom");
    assert!(!rows.iter().any(|r| r.contains("This computer")));
    let marks: String = (5..20).flat_map(|y| rail(y).chars().collect::<Vec<_>>()).collect();
    for mark in ['!', '✓', '–', '─'] {
        assert!(marks.contains(mark), "a status mark {mark} per session, a rule between groups: {marks}");
    }
    let x = rail(1).chars().position(|c| c == '»').unwrap() as u16;
    click(&mut app, x, 1);
    let rows = text(&mut app, 140, 36);
    assert!(side(&rows, 1).contains("Maiker"), "the sidebar is back: {}", side(&rows, 1));
}

/// The world with three subagents reported in add-payments' (2) current turn.
fn with_subagents() -> App {
    use crate::protocol::{SubagentActivity, SubagentState};
    let mut app = reference_fixture::world(Stage::None);
    let info = app.snap.terms.get_mut(&2).unwrap();
    let since = info.since;
    info.subagent_activity = [
        ("Check migration order", SubagentState::Completed),
        ("Write drafts tests", SubagentState::Working),
        ("Lint the routes", SubagentState::AwaitingApproval),
    ]
    .into_iter()
    .map(|(name, state)| SubagentActivity {
        id: name.into(),
        name: name.into(),
        parent: None,
        state,
        task: None,
        model: None,
        effort: None,
        started_at: Some(since + 1),
        updated_at: since + 1,
        latest_activity: None,
        result: None,
    })
    .collect();
    app.screen_fresh();
    app
}

#[test]
fn a_session_shows_its_subagents_as_marks_or_when_open_one_row_each() {
    let mut app = with_subagents();
    let rows = text(&mut app, 140, 36);
    show(&rows, "subagents, not open");
    let y = row_of(&app, 2);
    let peek = side(&rows, y + 2);
    assert!(peek.trim_start_matches('│').trim_start().starts_with('└'), "{peek}");
    assert!(peek.contains('✓') && peek.contains('!'), "done is a tick and needs you a bang, working spins: {peek}");
    assert_eq!(peek.matches(['✓', '!']).count(), 2, "{peek}");
    assert!(!rows.iter().any(|r| side_of(r).contains("Lint the routes")));
    reference_fixture::focus(&mut app, 2);
    let rows = text(&mut app, 140, 36);
    show(&rows, "subagents, open");
    let y = row_of(&app, 2);
    assert!(side(&rows, y + 3).contains("├ ✓ Check migration order"), "{}", side(&rows, y + 3));
    assert!(side(&rows, y + 5).contains("└ ! Lint the routes"), "{}", side(&rows, y + 5));
}

#[test]
fn enter_on_a_subagents_steps_opens_its_parents_pane() {
    let mut app = with_subagents();
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    reference_fixture::focus(&mut app, 2);
    text(&mut app, 140, 36);
    let y = app.screen.row_y[&ClientTerm::local(2)] + 3;
    // Another pane is focused first, so the click has something to change.
    reference_fixture::focus(&mut app, 1);
    click(&mut app, 12, y);
    // The click shows the subagent's own steps; Enter goes to the pane where its agent shows it.
    key(&mut app, KeyCode::Enter);
    let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
    assert!(
        sent.iter().any(|o| matches!(&o.msg, ClientMsg::Command(Command::FocusPane { term: 2 }))),
        "{sent:?}"
    );
}

// ---- the status glyphs ---------------------------------------------------------------------

#[test]
fn while_the_daemon_is_away_every_row_shows_the_unknown_mark() {
    let mut app = reference_fixture::world(Stage::None);
    let unknown_rows = |rows: &[String]| {
        (0..rows.len())
            .filter(|y| side(rows, *y).trim_start_matches(['│', ' ']).starts_with('┆'))
            .count()
    };
    let live = text(&mut app, 140, 30);
    assert_eq!(unknown_rows(&live), 0, "a live daemon has no unknown marks:\n{}", live.join("\n"));
    app.service_lost();
    let away = text(&mut app, 140, 30);
    show(&away, "the daemon is away");
    assert!(unknown_rows(&away) >= 2, "every session's mark is the dashed one:\n{}", away.join("\n"));
}

#[test]
fn the_unicode_setting_gives_each_state_a_shape_of_its_own() {
    let mut app = reference_fixture::world(Stage::None);
    app.cfg.ui.glyphs = "unicode".into();
    let t = app.theme.clone();
    let mut glyphs: Vec<String> = [
        State::Needs,
        State::Done,
        State::Problem,
        State::Idle,
        State::Unknown,
    ]
    .into_iter()
    .map(|s| app.state_mark(s, &t).glyph)
    .collect();
    glyphs.sort();
    glyphs.dedup();
    assert_eq!(glyphs.len(), 5, "{glyphs:?}");
}

#[test]
fn a_failed_command_is_the_problem_state_and_its_row_says_so_in_red() {
    let mut app = reference_fixture::world(Stage::None);
    app.snap.terms.get_mut(&5).unwrap().exit = Some(crate::protocol::ExitInfo {
        code: Some(1),
        at: 1,
    });
    let buf = cells(&mut app, 140, 50);
    let t = app.theme.clone();
    let y = app.screen.row_y[&ClientTerm::local(5)];
    assert_eq!(buf[(2, y)].symbol(), "×");
    assert_eq!(buf[(2, y)].fg, t.err);
}

/// A sidebar wide enough that a limit's day and time, or a pull request, follow `project / branch` whole.
const WIDE: u16 = 50;

/// The sidebar's columns of row `y` when it is `WIDE`.
fn wide(rows: &[String], y: usize) -> String {
    rows[y].chars().take(WIDE as usize).collect()
}

#[test]
fn a_limit_that_resets_on_another_day_says_which_day() {
    let mut app = reference_fixture::world(Stage::None);
    let resets = reference_fixture::at(16, 30, 0) + 3 * 24 * 3600;
    app.snap.terms.get_mut(&5).unwrap().resume_at = Some(resets);
    app.screen.saved.side_w = Some(WIDE);
    let rows = text(&mut app, 140, 50);
    show(&rows, "limited, three days away");
    let y = row_of(&app, 5);
    let (day, time) = (crate::clock::local_weekday(resets), crate::clock::local_hm(resets));
    assert_ne!(day, crate::clock::local_weekday(reference_fixture::now()));
    let line = wide(&rows, y + 1);
    assert!(line.contains(&format!("limited {day} {time}")), "{line}");
}

#[test]
fn a_limited_session_that_needs_you_keeps_its_needs_you_mark() {
    let mut app = reference_fixture::world(Stage::None);
    let info = app.snap.terms.get_mut(&5).unwrap();
    info.resume_at = Some(reference_fixture::at(16, 30, 0));
    info.status = Status::Blocked;
    let buf = cells(&mut app, 140, 50);
    let rows = text(&mut app, 140, 50);
    let y = row_of(&app, 5);
    assert_eq!((buf[(2, y as u16)].symbol(), buf[(2, y as u16)].fg), ("!", app.theme.blocked));
    assert!(side(&rows, y + 1).contains("limited 16:30"), "{}", side(&rows, y + 1));
}

#[test]
fn a_reset_time_that_has_passed_shows_nothing() {
    let mut app = reference_fixture::world(Stage::None);
    app.snap.terms.get_mut(&5).unwrap().resume_at = Some(reference_fixture::now());
    let rows = text(&mut app, 140, 50);
    assert!(!rows.iter().any(|r| side_of(r).contains("limited")), "{rows:#?}");
}

#[test]
fn the_working_spinner_is_still_with_reduce_motion_and_turns_with_it() {
    let braille: Vec<String> = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".chars().map(String::from).collect();
    assert_eq!(status_mark::frame_at(&braille, 10_000, false), "⠋");
    assert_eq!(status_mark::frame_at(&braille, 80, true), "⠙");
}

// ---- the workspace -------------------------------------------------------------------------

/// The workspace's columns of row `y`: everything right of the sidebar and its gap.
fn work(rows: &[String], y: usize) -> String {
    rows[y].chars().skip(35).collect()
}

#[test]
fn a_narrow_pane_cuts_its_folder_and_the_name_and_close_stay() {
    let mut app = reference_fixture::world(Stage::None);
    let rows = text(&mut app, 70, 24);
    let top = work(&rows, 0);
    show(&rows, "70x24");
    assert!(top.contains(" fix-footer ") && top.contains(" × "), "{top}");
    let bottom = rows.iter().map(|r| r.chars().skip(35).collect::<String>()).find(|r| r.contains('╰')).expect("the bottom border");
    assert!(bottom.contains('…'), "{bottom}");
}

#[test]
fn a_panes_folder_sits_on_its_bottom_border_and_files_and_changes_are_in_the_menu() {
    let mut app = reference_fixture::world(Stage::None);
    let rows = text(&mut app, 140, 36);
    let top = rows[0].clone();
    assert!(!top.contains("files") && !top.contains("changes"), "no tool chips on the top border: {top}");
    assert!(top.contains(" × "), "the close chip stays: {top}");
    let bottom = rows.iter().rev().find(|r| r.contains('╰') || r.contains('└')).cloned().expect("a bottom border");
    assert!(bottom.contains("code") || bottom.contains('~'), "the folder is on the bottom border: {bottom}");
    // A click on it opens the pane's Project menu, where Files and Changes now are.
    let at = app.hits.iter().find_map(|(r, h)| matches!(h, Hit::Screen(ScreenHit::PaneProject(_))).then_some(*r)).expect("the bottom chips");
    click(&mut app, at.x + 1, at.y);
    let Mode::ScreenMenu(m) = &app.mode else { panic!("{:?}", app.mode) };
    let labels: Vec<&str> = m.items.iter().map(|(label, _)| label.as_str()).collect();
    assert!(labels.contains(&"Files") && labels.contains(&"Changes"), "{labels:?}");
}

#[test]
fn a_pane_with_changes_shows_a_changes_button_that_focuses_it_and_opens_changes() {
    let mut app = reference_fixture::world(Stage::None);
    let rows = text(&mut app, 140, 36);
    assert!(!work(&rows, 0).contains("± changes"), "no button while the checkout is clean: {}", work(&rows, 0));
    app.snap.terms.get_mut(&1).unwrap().diff_files = 3;
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    let rows = text(&mut app, 140, 36);
    let top = work(&rows, 0);
    assert!(top.contains(" ± changes 3 ") && top.trim_end().ends_with(" × ─╮"), "before the close: {top}");
    let x = rows[0].chars().position(|c| c == '±').expect("the button") as u16;
    click(&mut app, x, 0);
    let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
    assert!(
        sent.iter().any(|o| matches!(&o.msg, ClientMsg::Command(Command::FocusPane { term: 1 }))),
        "the pane takes the focus: {sent:?}"
    );
    // The reference's folder is no git repository, so Changes opens by offering to make it one.
    assert!(matches!(&app.mode, Mode::Confirm(c) if c.title == "changes"), "Changes opens: {:?}", app.mode);
}

#[test]
fn an_agent_pane_with_a_nearly_full_context_says_so_and_a_click_sends_compact() {
    let mut app = reference_fixture::world(Stage::None);
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    let rows = text(&mut app, 140, 36);
    assert!(!rows.iter().any(|r| r.contains("Context almost full")), "nothing while there is room");
    app.snap.terms.get_mut(&1).unwrap().usage.context = Some(91.0);
    let rows = text(&mut app, 140, 36);
    let y = rows
        .iter()
        .position(|r| r.contains("▲ Context almost full · 91% used. Compact to keep the important parts."))
        .expect("the caution along the bottom of the pane");
    let x = rows[y].chars().position(|c| c == '▲').unwrap() as u16;
    click(&mut app, x, y as u16);
    let typed: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok())
        .filter_map(|o| match o.msg {
            ClientMsg::Input { term: 1, data } => Some(data),
            _ => None,
        })
        .collect();
    assert_eq!(typed, [b"/compact\r".to_vec()]);
    app.snap.terms.get_mut(&1).unwrap().usage.context = Some(84.0);
    let rows = text(&mut app, 140, 36);
    assert!(!rows.iter().any(|r| r.contains("Context almost full")), "below 85% there is no caution");
}

#[test]
fn the_sidebar_menu_button_orders_groups_and_switches_between_status_and_machine() {
    let mut app = reference_fixture::world(Stage::None);
    let rows = text(&mut app, 140, 36);
    let x = side(&rows, 1).chars().position(|c| c == '≡').expect("the ≡ button") as u16;
    click(&mut app, x, 1);
    assert_eq!(
        menu_labels(&app),
        ["✓ Group by status", "  Group by machine", "✓ Newest first", "  Oldest first", "  A–Z"]
    );
    app.menu_pick(3);
    let rows = text(&mut app, 140, 36);
    assert!(side(&rows, 1).contains("Maiker status · o") && side(&rows, 1).contains("⌕  +  ≡  «"), "the grouping words stop short of the buttons: {}", side(&rows, 1));
    assert!(row_of(&app, 4) < row_of(&app, 1), "oldest first: quick-fox (9h) before fix-footer (2m)");
    click(&mut app, x, 1);
    app.menu_pick(1);
    let rows = text(&mut app, 140, 36);
    assert!(rows.iter().any(|r| side_of(r).contains("This computer")), "now one section per machine");
}

#[test]
fn the_host_terminals_tab_title_names_the_focused_session_with_its_state_mark() {
    let mut app = reference_fixture::world(Stage::None);
    cells(&mut app, 140, 36);
    let title = super::window_title(&app);
    assert!(title.contains("fix-footer"), "{title}");
    assert!(title.ends_with(crate::brand::APP_NAME), "{title}");
    assert!(!title.chars().any(char::is_control), "{title:?}");
    app.sync_window_title();
    assert_eq!(app.window_title.as_deref(), Some(title.as_str()), "written once, remembered");
}

#[test]
fn exactly_one_pane_has_the_bright_border() {
    let mut app = split_world(4);
    let buf = cells(&mut app, 140, 36);
    let t = app.theme.clone();
    let line = |c: &ratatui::buffer::Cell| "│─╭╮╰╯".contains(c.symbol());
    let area = Rect::new(35, 0, 105, 35);
    let accent: Vec<(u16, u16)> = area
        .positions()
        .filter(|p| line(&buf[(p.x, p.y)]) && buf[(p.x, p.y)].fg == t.text)
        .map(|p| (p.x, p.y))
        .collect();
    assert!(!accent.is_empty(), "the focused pane's lines");
    let (mid_x, mid_y) = (area.x + area.width / 2, area.height / 2);
    assert!(accent.iter().all(|(x, y)| *x < mid_x && *y < mid_y), "{accent:?}");
}

#[test]
fn a_view_holds_four_panes_and_the_split_commands_say_which_side_the_new_one_goes() {
    assert_eq!(split_dir(&Action::SplitUp), Some(Dir::Up));
    assert_eq!(split_dir(&Action::SplitDown), Some(Dir::Down));
    assert_eq!(split_dir(&Action::SplitLeft), Some(Dir::Left));
    assert_eq!(split_dir(&Action::SplitRight), Some(Dir::Right));
    // Up and left insert before the pane, down and right after it.
    let mut node = Node::Leaf(1);
    node.split(1, Dir::Left, 2);
    assert_eq!(node.leaves(), [2, 1]);
    let mut node = Node::Leaf(1);
    node.split(1, Dir::Right, 2);
    assert_eq!(node.leaves(), [1, 2]);

    let mut app = split_world(4);
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    text(&mut app, 140, 36);
    app.act(Action::SplitRight);
    assert!(
        std::iter::from_fn(|| rx.try_recv().ok()).next().is_none(),
        "no fifth pane is asked for"
    );
    assert!(
        app.notice
            .as_ref()
            .is_some_and(|(m, _, _)| m.contains("4 panes"))
    );
}

#[test]
fn zoom_fills_the_view_with_the_focused_pane_and_again_brings_the_split_back() {
    let mut app = split_world(2);
    text(&mut app, 140, 36);
    app.act(Action::ZoomPane);
    let rows = text(&mut app, 140, 36);
    assert_eq!(work(&rows, 0).matches('╭').count(), 1);
    app.act(Action::ZoomPane);
    let rows = text(&mut app, 140, 36);
    assert_eq!(work(&rows, 0).matches('╭').count(), 2);
}

#[test]
fn tab_keys_step_through_the_sidebars_sessions_in_the_order_they_are_listed() {
    let mut app = reference_fixture::world(Stage::None);
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    text(&mut app, 140, 36);
    // Needs you, working, then done newest first, then idle.
    for (n, term) in [(1, 3), (2, 2), (3, 1), (4, 4), (5, 5)] {
        app.act(Action::SelectTab(n));
        let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
        assert!(
            sent.iter().any(|o| matches!(&o.msg, ClientMsg::Command(Command::FocusPane { term: t }) if *t == term)),
            "row {n} is pane {term}: {sent:?}"
        );
    }
}

#[test]
fn a_narrow_status_bar_drops_pieces_instead_of_running_them_together() {
    for w in 40..=140u16 {
        let mut app = reference_fixture::world(Stage::None);
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        let rows = text(&mut app, w, 24);
        let bar = &rows[23];
        let out = bar.find("esc back").unwrap_or_else(|| panic!("{w}: the way out stays: {bar}"));
        assert!(bar[..out].ends_with("  "), "{w}: a gap before the hints: {bar}");
        assert!(bar.trim_start().starts_with("keys"), "{w}: {bar}");
    }
}

/// How many rows of the sidebar column have anything in them.
fn side_rows_used(rows: &[String]) -> usize {
    (0..rows.len()).filter(|y| !side(rows, *y).trim_matches(|c: char| !c.is_alphanumeric()).is_empty()).count()
}

#[test]
fn a_machine_heading_has_a_fold_arrow_and_a_click_on_its_name_folds_it_and_opens_it_again() {
    let mut app = reference_fixture::world(Stage::None);
    app.screen.saved.group_machine = true;
    let rows = text(&mut app, 140, 36);
    let y = rows.iter().position(|r| side(std::slice::from_ref(r), 0).contains("This computer")).expect("this computer's heading");
    let head = side(&rows, y);
    assert!(head.contains("▾"), "an open machine shows the arrow that says it folds: {head}");
    let before = side_rows_used(&rows);

    let x = head.find("This computer").expect("the name") as u16 + 2;
    click(&mut app, x, y as u16);
    let rows = text(&mut app, 140, 36);
    let head = side(&rows, y);
    assert!(head.contains("▸") && head.contains("This computer"), "folded: {head}");
    assert!(side_rows_used(&rows) < before, "its sessions are gone from the list");

    click(&mut app, x, y as u16);
    let rows = text(&mut app, 140, 36);
    assert!(side(&rows, y).contains("▾"), "a second click opens it again");
    assert_eq!(side_rows_used(&rows), before);
}

#[test]
fn a_two_cell_working_spinner_is_drawn_whole_in_the_sidebar_not_clipped_to_one_cell() {
    let mut app = reference_fixture::world(Stage::None);
    app.cfg.ui.spinner = crate::config::BARS_FRAMES.iter().map(|frame| (*frame).to_string()).collect();
    let rows = text(&mut app, 140, 36);
    let whole = crate::config::BARS_FRAMES.iter().any(|frame| rows.iter().any(|row| side_of(row).contains(frame)));
    assert!(whole, "a whole Bars frame (two cells) is on a working row:\n{}", rows.iter().map(|r| side_of(r)).collect::<Vec<_>>().join("\n"));
}

/// How many close commands were sent (a pane, a session, or putting a chat away).
fn closes_sent(rx: &mut mpsc::UnboundedReceiver<crate::client::ids::Outgoing>) -> usize {
    std::iter::from_fn(|| rx.try_recv().ok())
        .filter(|o| {
            matches!(
                &o.msg,
                ClientMsg::Command(Command::CloseSession { .. } | Command::ClosePane { .. } | Command::ConversationArchive { .. })
            )
        })
        .count()
}

/// A shell and a working agent of the reference world, as the sessions to close.
fn a_shell_and_a_working_agent(app: &mut App) -> [ClientTerm; 2] {
    let mut ids: Vec<_> = app.snap.terms.keys().copied().collect();
    ids.sort_unstable();
    let [shell, agent] = [ids[0], ids[1]];
    app.snap.terms.get_mut(&shell).unwrap().agent = None;
    let t = app.snap.terms.get_mut(&agent).unwrap();
    t.agent = Some("claude".into());
    t.status = crate::protocol::Status::Working;
    [ClientTerm::local(shell), ClientTerm::local(agent)]
}

#[test]
fn declining_a_close_with_esc_or_n_closes_nothing_for_a_shell_and_a_working_agent() {
    for code in [KeyCode::Esc, KeyCode::Char('n')] {
        let mut app = reference_fixture::world(Stage::None);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        for term in a_shell_and_a_working_agent(&mut app) {
            app.menu_act(crate::client::menu::Act::End(vec![term]));
            assert!(matches!(app.mode, Mode::Confirm(_)), "{code:?}: closing {term:?} asks first");
            app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
            assert_eq!(app.mode, Mode::Normal, "{code:?}: declined");
            assert_eq!(app.closing.last_closed(), None, "{code:?}: nothing is closed");
        }
        assert_eq!(closes_sent(&mut rx), 0, "{code:?}: nothing is sent");
    }
}

#[test]
fn the_close_question_is_answered_by_a_click_on_its_buttons() {
    let button = |app: &App, want: ScreenHit| {
        app.hits
            .iter()
            .rev()
            .find_map(|(r, h)| matches!(h, Hit::Screen(s) if *s == want).then_some(*r))
            .unwrap_or_else(|| panic!("no {want:?} button"))
    };
    for accept in [true, false] {
        let mut app = reference_fixture::world(Stage::None);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        let [shell, _] = a_shell_and_a_working_agent(&mut app);
        app.menu_act(crate::client::menu::Act::End(vec![shell]));
        cells(&mut app, 140, 36);
        let r = button(&app, if accept { ScreenHit::ConfirmYes } else { ScreenHit::ConfirmNo });
        click(&mut app, r.x + 1, r.y);
        assert_eq!(app.mode, Mode::Normal, "answered");
        let sent = closes_sent(&mut rx);
        assert_eq!(sent > 0, accept, "the Close button closes and Cancel does not ({sent} sent)");
        assert_eq!(app.closing.last_closed(), accept.then_some(shell));
    }
}

#[test]
fn every_way_to_close_a_session_opens_the_same_question() {
    let asks = |app: &App, term: ClientTerm| {
        matches!(&app.mode, Mode::Confirm(c) if matches!(&c.act, crate::client::menu::Act::End(ts) if ts == &vec![term]))
    };
    // The pane's × chip.
    let mut app = reference_fixture::world(Stage::None);
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    cells(&mut app, 140, 36);
    let (r, term) = app
        .hits
        .iter()
        .find_map(|(r, h)| match h {
            Hit::Screen(ScreenHit::CloseSplit(t)) => Some((*r, *t)),
            _ => None,
        })
        .expect("a × chip");
    click(&mut app, r.x + 1, r.y);
    assert!(asks(&app, term), "the × chip asks");
    assert_eq!(closes_sent(&mut rx), 0);

    // The leader, then x, on the focused pane.
    let mut app = reference_fixture::world(Stage::None);
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    let focused = app.focused().expect("a focused pane");
    app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
    app.on_key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE));
    assert!(asks(&app, focused), "leader then x asks");
    assert_eq!(closes_sent(&mut rx), 0);

    // Alt+X on the sidebar's row (when Alt keys are turned on), and the row menu's own item (the same act).
    let mut app = reference_fixture::world(Stage::None);
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    let [shell, _] = a_shell_and_a_working_agent(&mut app);
    app.screen_side_set(SideItem::Sess(ClientSession::local(SessionKey::Pane(shell.term))));
    // Alt+letters are opt-in.
    app.cfg.ui.alt_keys = true;
    app.keymap = app.cfg.keymap();
    app.on_key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::ALT));
    assert!(asks(&app, shell), "Alt+X in the sidebar asks");
    app.mode = Mode::Normal;
    app.menu_act(crate::client::menu::Act::End(vec![shell]));
    assert!(asks(&app, shell), "the row menu's Close shell asks");
    assert_eq!(closes_sent(&mut rx), 0);
}

#[test]
fn finished_subagents_fold_into_a_count_that_lists_them_when_clicked() {
    let mut app = with_subagents();
    for activity in &mut app.snap.terms.get_mut(&2).unwrap().subagent_activity {
        if activity.state == crate::protocol::SubagentState::Completed {
            // Finished long ago: past the time a finished subagent stays listed.
            activity.updated_at = 1;
        }
    }
    reference_fixture::focus(&mut app, 2);
    let rows = text(&mut app, 140, 36);
    show(&rows, "a finished subagent folded");
    let y = row_of(&app, 2);
    assert!(!rows.iter().any(|r| side_of(r).contains("Check migration order")));
    let done = (y..y + 6).find(|&n| side(&rows, n).contains("1 done · show")).expect("an \"N done\" line");
    let x = side(&rows, done).chars().position(|c| c == '1').unwrap() as u16;
    click(&mut app, x, done as u16);
    let rows = text(&mut app, 140, 36);
    show(&rows, "the finished subagent listed");
    assert!(rows.iter().any(|r| side_of(r).contains("Check migration order")));
    assert!(rows.iter().any(|r| side_of(r).contains("1 done · hide")));
}

#[test]
fn clicking_a_subagent_shows_its_own_steps_from_its_record() {
    use crate::conversation::history::{Content, Entry, ItemState, Role, SourceId};
    use crate::protocol::{HelperRecord, PROTOCOL_VERSION, Query, Reply, ServerMsg};
    let mut app = with_subagents();
    app.local_protocol = PROTOCOL_VERSION;
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    reference_fixture::focus(&mut app, 2);
    text(&mut app, 140, 36);
    let y = app.screen.row_y[&ClientTerm::local(2)] + 4;
    click(&mut app, 12, y);
    let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
    assert!(
        sent.iter().any(|o| matches!(&o.msg, ClientMsg::Query(Query::HelperRead { term: 2, helper }) if helper == "Write drafts tests")),
        "{sent:?}"
    );
    assert!(matches!(app.mode, Mode::Helper(_)));
    let said = |item: &str, role, text: &str| Entry {
        source: SourceId { conversation: crate::conversation::ConversationId(0), turn: "t".into(), item: item.into() },
        content: Content::Message { role, text: text.into() },
        state: ItemState::Completed,
        started_at_ms: None,
        completed_at_ms: None,
    };
    app.on_server(ServerMsg::Reply(Reply::HelperRead(HelperRecord {
        term: 2,
        helper: "Write drafts tests".into(),
        entries: vec![said("u", Role::User, "write the drafts tests"), said("a", Role::Assistant, "Added 4 tests for drafts.")],
        start_missing: false,
    })));
    let rows = text(&mut app, 140, 36);
    show(&rows, "a subagent's own steps");
    let all = rows.join("\n");
    assert!(all.contains("subagent Write drafts tests"));
    assert!(all.contains("asked write the drafts tests"));
    assert!(all.contains("Added 4 tests for drafts."));
}

// ---- helpers: who started whom --------------------------------------------------------------

/// The world with sessions 2 and 3 started by session 1's agent.
fn world_with_helpers() -> App {
    let mut app = reference_fixture::world(Stage::None);
    for helper in [2, 3] {
        app.snap.terms.get_mut(&helper).expect("a session").started_by = Some(1);
    }
    app
}

/// Where `words` start on row `y` of the sidebar.
fn column_of(rows: &[String], y: usize, words: &str) -> u16 {
    let at = side_of(&rows[y]).find(words).unwrap_or_else(|| panic!("{words} on {}", rows[y]));
    rows[y][..at].chars().count() as u16
}

#[test]
fn a_helper_names_its_starter_and_the_starter_counts_its_helpers() {
    let mut app = world_with_helpers();
    let plain = text(&mut reference_fixture::world(Stage::None), 140, 36);
    let rows = text(&mut app, 140, 36);
    show(&rows, "helpers 140x36");
    let lead = row_of(&app, 1);
    assert!(side(&rows, lead).contains("✓ fix-footer") && side(&rows, lead).contains("2 helpers 2m"), "{}", side(&rows, lead));
    for helper in [2, 3] {
        let y = row_of(&app, helper) + 1;
        assert!(side(&rows, y).contains("↳ fix-footer  "), "the starter, then the place: {}", side(&rows, y));
    }
    // Nothing moves: only the three rows that gained words differ from the same list without helpers.
    let changed: Vec<usize> = (0..rows.len()).filter(|y| side_of(&rows[*y]) != side_of(&plain[*y])).collect();
    assert_eq!(changed, [row_of(&app, 3) + 1, row_of(&app, 2) + 1, lead], "{changed:?}");
}

#[test]
fn a_starters_count_is_in_the_needs_you_colour_only_while_a_helper_waits() {
    let mut app = world_with_helpers();
    let rows = text(&mut app, 140, 36);
    let lead = row_of(&app, 1);
    let x = column_of(&rows, lead, "2 helpers");
    // Session 3 waits on you in this world.
    assert_eq!(app.snap.terms[&3].status, Status::Blocked);
    assert_eq!(cells(&mut app, 140, 36)[(x, lead as u16)].fg, app.theme.blocked);
    app.snap.terms.get_mut(&3).expect("a session").started_by = None;
    let rows = text(&mut app, 140, 36);
    let lead = row_of(&app, 1);
    let x = column_of(&rows, lead, "1 helper ");
    assert_eq!(cells(&mut app, 140, 36)[(x, lead as u16)].fg, app.theme.muted);
}

#[test]
fn a_helper_whose_starter_is_gone_is_an_ordinary_row() {
    let mut app = reference_fixture::world(Stage::None);
    let plain = text(&mut app, 140, 36);
    app.snap.terms.get_mut(&2).expect("a session").started_by = Some(999);
    let rows = text(&mut app, 140, 36);
    assert_eq!(rows.iter().map(|r| side_of(r)).collect::<Vec<_>>(), plain.iter().map(|r| side_of(r)).collect::<Vec<_>>());
}

#[test]
fn a_helper_a_chat_started_names_the_chat_and_the_chat_counts_it() {
    use crate::conversation::{ConversationId, ExecutionKind, Provider, RecoveryState};
    let mut app = reference_fixture::world(Stage::None);
    let cwd = app.snap.terms[&2].cwd.clone();
    app.snap.conversations.push(crate::protocol::ConversationSummary {
        id: ConversationId(41),
        generation: 1,
        provider: Provider::Claude,
        execution: ExecutionKind::Structured,
        cwd,
        worktree: None,
        state: RecoveryState::Running,
        status: Status::Working,
        native_term: None,
        checks: Vec::new(),
        title: Some("lead-chat".into()),
        archived: false,
        root: None,
        branch: None,
        helpers: Vec::new(),
        helper_ask: Vec::new(),
        capabilities: None,
        agent: None,
        status_since: None,
        interrupted: false,
    });
    app.snap.terms.get_mut(&2).expect("a session").started_by_chat = Some(ConversationId(41));
    // A chat the list does not hold started nothing that shows as its helper.
    app.snap.terms.get_mut(&3).expect("a session").started_by_chat = Some(ConversationId(404));
    let rows = text(&mut app, 140, 40);
    show(&rows, "a chat's helper 140x40");
    assert!(side(&rows, row_of(&app, 2) + 1).contains("↳ lead-chat  "), "{}", side(&rows, row_of(&app, 2) + 1));
    assert!(!side(&rows, row_of(&app, 3) + 1).contains('↳'), "{}", side(&rows, row_of(&app, 3) + 1));
    let chat = rows.iter().find(|r| side_of(r).contains("lead-chat") && !side_of(r).contains('↳')).expect("the chat's row");
    assert!(side_of(chat).contains("1 helper"), "{chat}");
}
