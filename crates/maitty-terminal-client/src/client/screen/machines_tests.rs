//! The Add Machine dialog drawn: loading, with hosts and a typed target, connecting, a failure
//! under the input and naming. Every frame is looked at at 80x24, 100x30 and 160x45.

use super::machines::*;
use super::*;
use crate::client::reference_fixture::{Stage, world};
use crate::client::render;
use crate::client::ssh_hosts::SshHost;
use maitty_settings::config::MachineDef;
use crossterm::event::{KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::Terminal;
use ratatui::backend::TestBackend;

const SIZES: [(u16, u16); 3] = [(80, 24), (100, 30), (160, 45)];

fn host(alias: &str, user: Option<&str>, name: Option<&str>) -> SshHost {
    SshHost {
        alias: alias.into(),
        host_name: name.map(Into::into),
        user: user.map(Into::into),
    }
}

fn hosts() -> Vec<SshHost> {
    vec![
        host("build", Some("dev"), Some("build.example.com")),
        host("gpu", None, Some("10.0.0.7")),
        host("web", Some("deploy"), None),
    ]
}

fn def(name: &str, target: &str) -> MachineDef {
    MachineDef {
        name: name.into(),
        target: target.into(),
        ..MachineDef::default()
    }
}

fn open(app: &mut App, view: MachinesView) {
    app.mode = Mode::Machines(Box::new(view));
}

fn view(hosts: Option<Vec<SshHost>>) -> MachinesView {
    MachinesView {
        hosts,
        ..MachinesView::new(false)
    }
}

/// The frame as text, the dialog's rectangle and the cells.
fn frame(app: &mut App, w: u16, h: u16) -> (String, Rect, ratatui::buffer::Buffer) {
    app.screen.modal_rects.clear();
    app.screen_fresh();
    let mut term = Terminal::new(TestBackend::new(w, h)).expect("a test terminal");
    term.draw(|f| render::draw(app, f)).expect("a frame");
    let buf = term.backend().buffer().clone();
    let text: String = (0..h)
        .map(|y| {
            (0..w)
                .map(|x| buf[(x, y)].symbol())
                .collect::<String>()
                .trim_end()
                .to_string()
                + "\n"
        })
        .collect();
    if maitty_shared::brand::env_var("SHOW").is_ok() {
        println!("===== {w}x{h}\n{text}");
    }
    let rect = *app
        .screen
        .modal_rects
        .last()
        .expect("the dialog drew a panel");
    (text, rect, buf)
}

/// The dialog's border is whole: `│` on both sides of every row, a bottom edge with its
/// corners, and a top edge that opens with a corner and ends in the close chip.
fn assert_box_whole(text: &str, r: Rect, buf: &ratatui::buffer::Buffer) {
    let line = |y: u16| -> String { (r.x..r.right()).map(|x| buf[(x, y)].symbol()).collect() };
    for y in r.y + 1..r.bottom() - 1 {
        let row = line(y);
        assert!(
            row.starts_with('│') && row.ends_with('│'),
            "sides, row {y}:
{text}"
        );
    }
    let (top, bottom) = (line(r.y), line(r.bottom() - 1));
    assert!(
        top.starts_with(['┌', '╭']) && top.trim_end().trim_end_matches(['┐', '╮']).trim_end().ends_with('×'),
        "top edge: {top:?}
{text}"
    );
    let width = r.width as usize;
    assert!(
        bottom.starts_with(['└', '╰'])
            && bottom.ends_with(['┘', '╯'])
            && bottom.chars().filter(|c| *c == '─').count() == width - 2,
        "bottom edge: {bottom:?}
{text}"
    );
}

/// The dialog's words in reading order, its border and whatever is drawn beside it gone and
/// runs of spaces made one, so a line that wrapped can be looked for whole.
fn words(text: &str, r: Rect) -> String {
    text.lines()
        .map(|l| {
            l.chars()
                .skip(r.x as usize + 1)
                .take((r.width as usize).saturating_sub(2))
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn app_with(machines: &[(&str, &str)]) -> App {
    let mut app = world(Stage::None);
    app.cfg.machines = machines.iter().map(|(n, t)| def(n, t)).collect();
    app
}

fn shown(
    app: &mut App,
    v: MachinesView,
    w: u16,
    h: u16,
) -> (String, Rect, ratatui::buffer::Buffer) {
    open(app, v);
    frame(app, w, h)
}

#[test]
fn it_asks_for_the_machine_and_lists_the_hosts_with_the_chosen_one_marked() {
    for (w, h) in SIZES {
        let mut app = app_with(&[]);
        let (text, r, buf) = shown(&mut app, view(Some(hosts())), w, h);
        assert_box_whole(&text, r, &buf);
        let said = words(&text, r);
        for want in [
            "ADD MACHINE",
            "Where's the machine? Type it like scp or ssh.",
            "FROM ~/.ssh/config",
            "build dev@build.example.com",
            "Enter connect",
            "↑↓ input / hosts",
            "Esc cancel",
        ] {
            assert!(said.contains(want), "{w}x{h}: {want:?}\n{text}");
        }
        assert!(
            !said.contains("YOURS") && !said.contains("Machines"),
            "{w}x{h}: no list of machines"
        );
    }
}

#[test]
fn the_parse_line_reads_user_and_host_and_fills_an_alias_from_ssh_config() {
    let mut app = app_with(&[]);
    let typed = |q: &str| MachinesView {
        query: q.into(),
        ..view(Some(hosts()))
    };
    let (text, r, _) = shown(&mut app, typed("dev@kingdom.lan"), 100, 30);
    let said = words(&text, r);
    assert!(said.contains("user dev host kingdom.lan"), "{text}");
    let (text, r, _) = shown(&mut app, typed("web"), 100, 30);
    let said = words(&text, r);
    assert!(
        said.contains("user deploy host web"),
        "the alias's user: {text}"
    );
    let (text, r, _) = shown(&mut app, typed(""), 100, 30);
    assert!(words(&text, r).contains("user — host —"), "{text}");
}

#[test]
fn typing_filters_the_suggestions_by_the_host_part_only() {
    let v = MachinesView {
        query: "dev@bui".into(),
        ..view(Some(hosts()))
    };
    let names: Vec<String> = suggestions(&v, &[]).into_iter().map(|h| h.alias).collect();
    assert_eq!(names, ["build"]);
    let v = MachinesView {
        query: "10.0".into(),
        ..view(Some(hosts()))
    };
    let names: Vec<String> = suggestions(&v, &[]).into_iter().map(|h| h.alias).collect();
    assert_eq!(names, ["gpu"]);
    let taken = [def("b", "build")];
    let v = view(Some(hosts()));
    assert!(
        !suggestions(&v, &taken).iter().any(|h| h.alias == "build"),
        "a host that is a machine is not offered"
    );
}

#[test]
fn enter_connects_to_the_typed_text_or_the_host_the_keys_are_on() {
    let at = |q: &str, in_list: bool, sel: usize| {
        let v = MachinesView {
            query: q.into(),
            in_list,
            host_sel: sel,
            ..view(Some(hosts()))
        };
        connect_target(&v, &[])
    };
    assert_eq!(
        at("dev@kingdom.lan", false, 0).as_deref(),
        Some("dev@kingdom.lan")
    );
    assert_eq!(
        at("g", false, 0).as_deref(),
        Some("g"),
        "in the input: what was typed"
    );
    assert_eq!(at("", false, 0), None, "an empty input connects to nothing");
    assert_eq!(
        at("", true, 1).as_deref(),
        Some("gpu"),
        "in the list: the chosen host"
    );
    assert_eq!(
        at("g", true, 0).as_deref(),
        Some("gpu"),
        "the list is filtered by the input"
    );
}

#[test]
fn down_walks_into_the_hosts_and_up_from_the_first_one_is_back_in_the_input() {
    let mut app = app_with(&[]);
    open(&mut app, view(Some(hosts())));
    let key = |c: KeyCode| KeyEvent::new(c, KeyModifiers::NONE);
    let state = |app: &App| match &app.mode {
        Mode::Machines(v) => (v.in_list, v.host_sel),
        _ => panic!("the dialog"),
    };
    assert_eq!(state(&app), (false, 0), "it opens with the input");
    app.on_key(key(KeyCode::Down));
    assert_eq!(state(&app), (true, 0), "Down is the first host");
    app.on_key(key(KeyCode::Down));
    assert_eq!(state(&app), (true, 1));
    app.on_key(key(KeyCode::Up));
    app.on_key(key(KeyCode::Up));
    assert_eq!(
        state(&app),
        (false, 0),
        "Up from the first host is the input"
    );
    app.on_key(key(KeyCode::Down));
    app.on_key(key(KeyCode::Char('x')));
    assert_eq!(state(&app), (false, 0), "typing is the input again");
    let Mode::Machines(v) = &app.mode else {
        panic!("the dialog")
    };
    assert_eq!(v.query, "x");
}

#[test]
fn parse_reads_user_host_and_path() {
    assert_eq!(
        parse_target("dev@kingdom.lan:~/maiker"),
        Some(Parsed {
            user: Some("dev".into()),
            host: "kingdom.lan".into(),
            path: Some("~/maiker".into()),
        })
    );
    assert_eq!(
        parse_target("pi").map(|p| (p.user, p.host)),
        Some((None, "pi".into()))
    );
    assert_eq!(parse_target("  "), None);
    assert_eq!(parse_target("dev@"), None);
    assert_eq!(parse_target("a b"), None, "no spaces in a host");
}

#[test]
fn hosts_still_loading_say_so() {
    let mut app = app_with(&[]);
    let (text, r, _) = shown(&mut app, view(None), 100, 30);
    assert!(
        words(&text, r).contains("loading hosts from ~/.ssh/config"),
        "{text}"
    );
}

#[test]
fn with_no_hosts_it_says_to_type_user_at_host() {
    let mut app = app_with(&[]);
    let (text, r, _) = shown(&mut app, view(Some(vec![])), 100, 30);
    assert!(
        words(&text, r).contains("no hosts in ~/.ssh/config: type user@host above"),
        "{text}"
    );
}

#[test]
fn the_windows_hint_is_said_on_windows_only() {
    let mut app = app_with(&[]);
    let on = MachinesView {
        windows: true,
        ..view(Some(hosts()))
    };
    let (text, r, _) = shown(&mut app, on, 120, 40);
    assert!(
        words(&text, r).contains("Windows: use ssh keys or an agent"),
        "{text}"
    );
    let (text, r, _) = shown(&mut app, view(Some(hosts())), 120, 40);
    assert!(!words(&text, r).contains("Windows:"), "{text}");
}

#[test]
fn connecting_is_one_working_line_under_the_field_and_no_steps() {
    for (w, h) in SIZES {
        let mut app = app_with(&[]);
        let v = MachinesView {
            in_list: true,
            step: MachineStep::Checking {
                name: "kingdom".into(),
                target: "dev@kingdom.lan".into(),
            },
            ..view(Some(hosts()))
        };
        let (text, r, buf) = shown(&mut app, v, w, h);
        assert_box_whole(&text, r, &buf);
        let said = words(&text, r);
        for want in [
            "ADD MACHINE",
            "› dev@kingdom.lan",
            "Connecting to kingdom…",
            "FROM ~/.ssh/config",
            "Esc cancel",
        ] {
            assert!(said.contains(want), "{w}x{h}: {want:?}\n{text}");
        }
        // No steps, no internal part named, and no host to pick while it connects (ADR 0017).
        for gone in ["sign in as", "maitty-daemon", "reach kingdom", "host key", "█", "⏎ connect", "user —"] {
            assert!(!said.contains(gone), "{w}x{h}: {gone:?}\n{text}");
        }
    }
}

#[test]
fn a_failure_is_said_right_under_the_input_in_place_of_the_parse_line() {
    let sentence = "Can't reach kingdom: check the name or address, and that the machine is on (ssh: connect to host kingdom.lan port 22: Connection refused).";
    for (w, h) in SIZES {
        let mut app = app_with(&[]);
        let v = MachinesView {
            query: "dev@kingdom.lan".into(),
            notice: Some(MachineNotice {
                text: sentence.into(),
                error: true,
            }),
            ..view(Some(hosts()))
        };
        let (text, r, buf) = shown(&mut app, v, w, h);
        assert_box_whole(&text, r, &buf);
        let said = words(&text, r);
        assert!(said.contains(&format!("› dev@kingdom.lan█ {sentence} FROM ~/.ssh/config")), "{w}x{h}\n{text}");
        assert!(!said.contains("user dev"), "the sentence stands where the parse line was: {w}x{h}\n{text}");
    }
    // Typing again (Backspace too) puts the parse line back.
    let mut app = app_with(&[]);
    open(&mut app, MachinesView {
        query: "dev@kingdom.lan".into(),
        notice: Some(MachineNotice { text: sentence.into(), error: true }),
        ..view(Some(hosts()))
    });
    app.on_key(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE));
    let Mode::Machines(v) = &app.mode else { panic!("the dialog is open") };
    assert_eq!(v.notice, None);
}

#[test]
fn naming_a_machine_the_target_gave_no_name_for() {
    for (w, h) in SIZES {
        let mut app = app_with(&[]);
        let v = MachinesView {
            step: MachineStep::Name {
                target: "10.0.0.7".into(),
                name: "gp".into(),
                error: Some("that name is taken".into()),
            },
            ..view(Some(hosts()))
        };
        let (text, r, buf) = shown(&mut app, v, w, h);
        assert_box_whole(&text, r, &buf);
        let said = words(&text, r);
        for want in [
            "Name for 10.0.0.7",
            "› gp",
            "that name is taken",
            "Esc back",
        ] {
            assert!(said.contains(want), "{w}x{h}: {want:?}\n{text}");
        }
    }
}

#[test]
fn the_dialog_keeps_to_a_small_window() {
    let mut app = app_with(&[]);
    let v = MachinesView {
        notice: Some(MachineNotice {
            text:
                "a refusal that wraps over a couple of lines in a narrow window of eighty columns"
                    .into(),
            error: true,
        }),
        query: "dev@build".into(),
        ..view(Some(hosts()))
    };
    let (text, r, buf) = shown(&mut app, v, 80, 24);
    assert_box_whole(&text, r, &buf);
    assert!(words(&text, r).contains("a refusal that wraps"), "{text}");
}

#[test]
fn a_paste_goes_into_the_input_not_the_pane_behind() {
    let mut app = app_with(&[]);
    open(&mut app, view(Some(hosts())));
    app.on_paste("dev@kingdom.lan\nsecond line".into());
    let Mode::Machines(v) = &app.mode else {
        panic!("the dialog")
    };
    assert_eq!(v.query, "dev@kingdom.lan", "the first line, in the input");
    assert!(!v.in_list);
}

/// `kingdom` with no app, `build` on another version and `gpu` connected, as their
/// supervisors said.
fn app_needing_fixes() -> App {
    use crate::client::link::ConnectionState;
    use crate::link_failure::FailureClass;
    let mut app = app_with(&[
        ("build", "dev@build.lan"),
        ("gpu", "gpu"),
        ("kingdom", "dev@kingdom.lan"),
    ]);
    let states = [
        ("build", ConnectionState::NeedsUpdate { failure: FailureClass::Update }),
        ("gpu", ConnectionState::Connected),
        ("kingdom", ConnectionState::NeedsUpdate { failure: FailureClass::Install }),
    ];
    for (n, (name, state)) in states.into_iter().enumerate() {
        app.on_link_state(MachineId(40 + n as u16), name.into(), state);
    }
    app
}

#[test]
fn a_machine_that_needs_the_app_shows_the_key_that_installs_or_updates_it() {
    for (w, h) in SIZES {
        let mut app = app_needing_fixes();
        let v = MachinesView {
            machine_sel: app.machine_listed_at("kingdom"),
            ..view(Some(hosts()))
        };
        let (text, r, buf) = shown(&mut app, v, w, h);
        assert_box_whole(&text, r, &buf);
        let rows: Vec<&str> = text.lines().collect();
        let row = |name: &str| {
            rows.iter()
                .find(|l| l.contains(&format!("⇄ {name}")))
                .copied()
                .unwrap_or_else(|| panic!("{w}x{h}: no row for {name}\n{text}"))
        };
        assert!(row("kingdom").contains(" install "), "{w}x{h}\n{text}");
        assert!(row("build").contains(" update "), "{w}x{h}\n{text}");
        assert!(!row("gpu").contains(" install "), "a connected machine needs no install: {w}x{h}\n{text}");
        let said = words(&text, r);
        assert!(said.contains("u install"), "the bar names what u does: {w}x{h}\n{text}");
        assert!(
            said.contains("run `maiker machine update kingdom --install`"),
            "the fix under the chosen one names the machine: {w}x{h}\n{text}"
        );
    }
}

#[test]
fn a_machine_that_failed_says_the_shared_sentence_under_it() {
    use crate::client::link::ConnectionState;
    use crate::link_failure::{FailureClass, Subject, sentence_here};
    for (w, h) in SIZES {
        let mut app = app_with(&[("build", "dev@build.lan")]);
        let failure = FailureClass::KeyRefused("dev@build.lan: Permission denied (publickey).".into());
        app.on_link_state(MachineId(40), "build".into(), ConnectionState::NeedsLogin { failure: failure.clone() });
        let v = MachinesView {
            machine_sel: app.machine_listed_at("build"),
            ..view(Some(hosts()))
        };
        let (text, r, buf) = shown(&mut app, v, w, h);
        assert_box_whole(&text, r, &buf);
        let said = words(&text, r);
        assert!(
            said.contains("build refused your key: run `"),
            "the list says the sentence both apps share: {w}x{h}\n{text}"
        );
        let toast = app.notice.as_ref().map(|(text, ..)| text.clone());
        assert_eq!(
            toast,
            Some(sentence_here(&failure, &Subject::of_def(&app.cfg.machines[0]))),
            "the toast is the same sentence"
        );
    }
}

/// Click the button named `label` on the row of `name`.
fn click_button(app: &mut App, text: &str, name: &str, label: &str) {
    let (y, row) = text
        .lines()
        .enumerate()
        .find(|(_, l)| l.contains(&format!("⇄ {name}")))
        .unwrap_or_else(|| panic!("no row for {name}\n{text}"));
    let chars: Vec<char> = row.chars().collect();
    let want: Vec<char> = format!(" {label} ").chars().collect();
    let x = chars
        .windows(want.len())
        .position(|w| w == want.as_slice())
        .unwrap_or_else(|| panic!("no {label} button on {name}: {row}"));
    for kind in [
        MouseEventKind::Down(MouseButton::Left),
        MouseEventKind::Up(MouseButton::Left),
    ] {
        app.on_mouse(MouseEvent {
            kind,
            column: x as u16 + 2,
            row: y as u16,
            modifiers: KeyModifiers::NONE,
        });
    }
}

#[test]
fn every_machine_row_has_its_own_buttons() {
    for (w, h) in [(100, 30), (160, 45)] {
        let mut app = app_with(&[("build", "dev@build.lan"), ("gpu", "gpu")]);
        let (text, r, buf) = shown(&mut app, view(Some(hosts())), w, h);
        assert_box_whole(&text, r, &buf);
        for name in ["build", "gpu"] {
            let row = text.lines().find(|l| l.contains(&format!("⇄ {name}"))).unwrap();
            for label in ["update", "reconnect", "edit", "remove"] {
                assert!(row.contains(&format!(" {label} ")), "{w}x{h}: {name} lacks {label}: {row}");
            }
        }
    }
}

#[test]
fn the_remove_and_edit_buttons_open_their_steps_for_the_row_they_are_on() {
    let mut app = app_with(&[("build", "dev@build.lan"), ("gpu", "gpu")]);
    let (text, ..) = shown(&mut app, view(Some(hosts())), 160, 45);
    click_button(&mut app, &text, "gpu", "remove");
    let Mode::Machines(v) = &app.mode else { panic!("{:?}", app.mode) };
    assert!(matches!(&v.step, MachineStep::Remove { name } if name == "gpu"), "{:?}", v.step);

    let mut app = app_with(&[("build", "dev@build.lan"), ("gpu", "gpu")]);
    let (text, ..) = shown(&mut app, view(Some(hosts())), 160, 45);
    click_button(&mut app, &text, "build", "edit");
    let Mode::Machines(v) = &app.mode else { panic!("{:?}", app.mode) };
    assert!(matches!(&v.step, MachineStep::Edit { name, .. } if name == "build"), "{:?}", v.step);
}

#[test]
fn the_reconnect_button_answers_in_the_dialog_and_a_click_on_a_row_chooses_it() {
    let mut app = app_with(&[("build", "dev@build.lan"), ("gpu", "gpu")]);
    let (text, ..) = shown(&mut app, view(Some(hosts())), 160, 45);
    click_button(&mut app, &text, "gpu", "reconnect");
    let Mode::Machines(v) = &app.mode else { panic!("{:?}", app.mode) };
    assert_eq!(v.machine_sel, Some(1));
    assert!(v.notice.is_some(), "it answers in the dialog");
    let (text, ..) = frame(&mut app, 160, 45);
    let (y, row) = text.lines().enumerate().find(|(_, l)| l.contains("⇄ build")).unwrap();
    let x = row.chars().take_while(|c| *c != '⇄').count() as u16 + 2;
    for kind in [MouseEventKind::Down(MouseButton::Left), MouseEventKind::Up(MouseButton::Left)] {
        app.on_mouse(MouseEvent { kind, column: x, row: y as u16, modifiers: KeyModifiers::NONE });
    }
    let Mode::Machines(v) = &app.mode else { panic!("{:?}", app.mode) };
    assert_eq!(v.machine_sel, Some(0));
}

#[test]
fn the_n_and_s_keys_turn_toasts_and_sounds_on_and_off_and_the_chosen_machine_says_so() {
    let mut app = app_with(&[("build", "dev@build.lan")]);
    // The entry has to be in the file for a change to be written to it.
    let dir = std::env::temp_dir().join(format!("grants-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    app.machine_flow.local_config = dir.join("config.local.toml");
    crate::client::machine_config::add_machine(&app.machine_flow.local_config, "build", "dev@build.lan").unwrap();

    let mut v = view(Some(hosts()));
    v.machine_sel = Some(0);
    let (text, ..) = shown(&mut app, v, 200, 45);
    assert!(text.contains("From build: toasts off · sounds off · copies to your clipboard on"), "off until turned on:\n{text}");

    app.on_key(KeyEvent::new(KeyCode::Char('n'), KeyModifiers::NONE));
    assert!(app.cfg.machines[0].notices && !app.cfg.machines[0].sounds);
    let written = std::fs::read_to_string(&app.machine_flow.local_config).unwrap();
    assert!(written.contains("notices = true"), "{written}");
    let (text, ..) = frame(&mut app, 200, 45);
    assert!(text.contains("toasts on · sounds off"), "the line says it took:\n{text}");
    assert!(text.contains("Toasts from build are now on."), "{text}");

    app.on_key(KeyEvent::new(KeyCode::Char('s'), KeyModifiers::NONE));
    assert!(app.cfg.machines[0].sounds);

    app.on_key(KeyEvent::new(KeyCode::Char('n'), KeyModifiers::NONE));
    assert!(!app.cfg.machines[0].notices);
    let written = std::fs::read_to_string(&app.machine_flow.local_config).unwrap();
    assert!(!written.contains("notices"), "off is the default, so the key goes: {written}");
}

#[test]
fn c_turns_copies_off_at_once_and_asks_before_turning_them_on() {
    let mut app = app_with(&[("build", "dev@build.lan")]);
    let dir = std::env::temp_dir().join(format!("clipboard-grant-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    app.machine_flow.local_config = dir.join("config.local.toml");
    let _ = std::fs::remove_file(&app.machine_flow.local_config);
    crate::client::machine_config::add_machine(&app.machine_flow.local_config, "build", "dev@build.lan").unwrap();
    let mut v = view(Some(hosts()));
    v.machine_sel = Some(0);
    open(&mut app, v);
    assert!(app.cfg.machines[0].clipboard, "on unless turned off");

    app.on_key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::NONE));
    assert!(!app.cfg.machines[0].clipboard, "off needs no question");
    let written = std::fs::read_to_string(&app.machine_flow.local_config).unwrap();
    assert!(written.contains("clipboard = false"), "{written}");

    app.on_key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::NONE));
    for (w, h) in SIZES {
        let (text, ..) = frame(&mut app, w, h);
        assert!(text.contains("Let build copy to your clipboard?"), "{text}");
        assert!(text.contains("Enter allow") || text.contains("Enter  allow"), "{text}");
    }
    assert!(!app.cfg.machines[0].clipboard, "asking changes nothing");
    app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
    assert!(!app.cfg.machines[0].clipboard, "Esc keeps it off");
    let Mode::Machines(v) = &app.mode else { panic!("{:?}", app.mode) };
    assert_eq!(v.step, MachineStep::Browse, "and stays in the dialog");

    app.on_key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::NONE));
    app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    assert!(app.cfg.machines[0].clipboard, "Enter allows it");
    let (text, ..) = frame(&mut app, 160, 45);
    assert!(text.contains("Copying to your clipboard from build is now on."), "{text}");
}
