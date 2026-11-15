//! The settings-side views the desktop app has and the terminal app now shares: usage by period,
//! approved commands, and a machine's details (GitHub, git identity, this computer's service).
//! `MAITTY_SHOW=1 cargo test settings_tests -- --nocapture` prints the frames.

use super::*;
use crate::client::ids::MachineId;
use crate::client::reference_fixture::{Layout, Stage, raw_text, world};
use crate::protocol::{Query, Reply, ServerMsg};
use maitty_shared::usage_report::{DayUsage, SessionUsage, UsageFigures, UsagePeriod, UsageReport};
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

pub(super) fn app_with_outbox() -> (App, mpsc::UnboundedReceiver<Outgoing>) {
    let mut app = world(Stage::None);
    let (tx, rx) = mpsc::unbounded_channel();
    app.out = tx;
    (app, rx)
}

pub(super) fn sent(rx: &mut mpsc::UnboundedReceiver<Outgoing>) -> Vec<Outgoing> {
    std::iter::from_fn(|| rx.try_recv().ok()).collect()
}

pub(super) fn frame(app: &mut App, title: &str, w: u16, h: u16) -> String {
    let text = raw_text(app, Layout::Floating, w, h, "unicode");
    if std::env::var(concat!(env!("APP_ENV"), "_SHOW")).is_ok() {
        println!("---- {title} ({w}x{h})\n{text}");
    }
    text
}

pub(super) fn key(app: &mut App, code: KeyCode) {
    app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
}

fn figures(cost: Option<f64>, tokens: u64, turns: u64, secs: u64) -> UsageFigures {
    UsageFigures {
        tokens_in: Some(tokens),
        tokens_out: Some(tokens / 10),
        cost,
        turns,
        working_secs: secs,
    }
}

fn week_report() -> UsageReport {
    let day = |d: &str, cost: f64| DayUsage {
        day: d.into(),
        figures: figures(Some(cost), 100_000, 3, 600),
    };
    UsageReport {
        period: UsagePeriod::Week,
        from: "2026-11-09".into(),
        to: "2026-11-15".into(),
        retention_days: 30,
        totals: figures(Some(9.5), 1_250_000, 21, 18_200),
        session_count: 2,
        sessions_without_cost: 1,
        sessions: vec![
            SessionUsage {
                session: "a1".into(),
                term: Some(2),
                agent: "claude".into(),
                project: "affiliate-site".into(),
                figures: figures(Some(9.5), 1_000_000, 18, 16_000),
                first_day: "2026-11-10".into(),
                last_day: "2026-11-15".into(),
            },
            SessionUsage {
                session: "c9".into(),
                term: None,
                agent: "codex".into(),
                project: "pixls".into(),
                figures: figures(None, 250_000, 3, 2_200),
                first_day: "2026-11-12".into(),
                last_day: "2026-11-12".into(),
            },
        ],
        days: vec![day("2026-11-10", 1.5), day("2026-11-12", 3.0), day("2026-11-15", 5.0)],
    }
}

fn usage_asked(out: &[Outgoing]) -> Vec<UsagePeriod> {
    out.iter()
        .filter_map(|o| match &o.msg {
            ClientMsg::Query(Query::UsageReport { period }) => {
                assert_eq!(o.machine, MachineId::LOCAL, "usage is this computer's");
                Some(*period)
            }
            _ => None,
        })
        .collect()
}

#[test]
fn usage_opens_on_now_and_tab_asks_this_computer_for_each_period() {
    let (mut app, mut rx) = app_with_outbox();
    app.act(Action::Usage);
    assert!(usage_asked(&sent(&mut rx)).is_empty(), "now needs no report");
    let now = frame(&mut app, "usage · now", 100, 30);
    assert!(now.contains(" now ") && now.contains(" 7 days "), "the tabs show");
    key(&mut app, KeyCode::Tab);
    key(&mut app, KeyCode::Tab);
    assert_eq!(usage_asked(&sent(&mut rx)), [UsagePeriod::Day, UsagePeriod::Week]);
    let asking = frame(&mut app, "usage · 7 days, asking", 100, 30);
    assert!(asking.contains("asking this computer for its usage…"));
}

#[test]
fn a_week_shows_its_totals_a_bar_per_day_and_its_sessions() {
    let (mut app, _rx) = app_with_outbox();
    app.act(Action::Usage);
    key(&mut app, KeyCode::Tab);
    key(&mut app, KeyCode::Tab);
    app.on_machine_server(MachineId::LOCAL, ServerMsg::Reply(Reply::UsageReport(week_report())));
    for (w, h) in [(100, 30), (80, 24)] {
        let text = frame(&mut app, "usage · 7 days", w, h);
        assert!(text.contains("$9.50 · 1.2M in · 125.0k out · 21 turns · 5h 3m working"), "{text}");
        assert!(text.contains("2 sessions · 1 reported no cost · 2026-11-09 to 2026-11-15 (UTC)"));
        assert!(text.contains("11-09") && text.contains("11-15") && text.contains("$5.00"), "the chart's ends and top");
        assert!(text.contains("█"), "the busiest day fills its bar");
        assert!(text.contains("codex · pixls"), "a closed session reads by agent and folder");
    }
}

#[test]
fn enter_on_an_open_session_goes_to_it_and_a_closed_one_says_so() {
    let (mut app, _rx) = app_with_outbox();
    app.act(Action::Usage);
    key(&mut app, KeyCode::Tab);
    key(&mut app, KeyCode::Tab);
    app.on_machine_server(MachineId::LOCAL, ServerMsg::Reply(Reply::UsageReport(week_report())));
    key(&mut app, KeyCode::Down);
    key(&mut app, KeyCode::Enter);
    assert!(matches!(app.mode, Mode::Usage), "a closed session leaves the modal open");
    assert!(app.notice.as_ref().is_some_and(|(n, _, _)| n.contains("closed")));
    key(&mut app, KeyCode::Up);
    key(&mut app, KeyCode::Enter);
    assert!(matches!(app.mode, Mode::Normal));
    assert_eq!(app.screen.show_own, Some(ClientTerm::on(MachineId::LOCAL, 2)));
}

#[test]
fn an_older_service_is_not_asked_for_a_report() {
    let (mut app, mut rx) = app_with_outbox();
    app.local_protocol = 1;
    app.act(Action::Usage);
    key(&mut app, KeyCode::Tab);
    assert!(usage_asked(&sent(&mut rx)).is_empty());
    let text = frame(&mut app, "usage · older service", 100, 30);
    assert!(text.contains("Restart the service to see usage by day."));
}

fn allowed(project: &str, command: &str, sha: &str) -> crate::protocol::AllowedCommand {
    crate::protocol::AllowedCommand {
        project: PathBuf::from(project),
        command: command.into(),
        command_sha256: sha.into(),
        at: crate::client::reference_fixture::now() - 3 * 86_400,
    }
}

fn open_settings_row(app: &mut App, cat: modal::Cat, label: &str) {
    let sel = design::settings_rows(cat)
        .iter()
        .position(|r| matches!(r, design::SRow::Agent(a) if a.label() == label))
        .unwrap_or_else(|| panic!("{label} is on the page"));
    let cat = modal::Cat::ALL.iter().position(|c| *c == cat).unwrap();
    app.mode = Mode::ScreenSettings(Box::new(design::SettingsView {
        cat,
        sel,
        editing: None,
        capturing: false,
        scroll: 0,
    }));
}

#[test]
fn settings_agents_opens_the_approved_commands_and_asks_this_computer() {
    let (mut app, mut rx) = app_with_outbox();
    open_settings_row(&mut app, modal::Cat::Agents, "Approved commands…");
    let page = frame(&mut app, "settings · agents · permissions", 120, 34);
    assert!(page.contains("PERMISSIONS") && page.contains("Approved commands…"), "{page}");
    sent(&mut rx);
    key(&mut app, KeyCode::Enter);
    let out = sent(&mut rx);
    assert!(out.iter().any(|o| o.machine == MachineId::LOCAL
        && matches!(o.msg, ClientMsg::Query(Query::AllowedCommands))));
    let asking = frame(&mut app, "approved · asking", 100, 30);
    assert!(asking.contains("asking this computer…"));
    app.on_machine_server(
        MachineId::LOCAL,
        ServerMsg::Reply(Reply::AllowedCommands(vec![
            allowed("/code/shop-api", "npm test -- checkout", "aa"),
            allowed("/code/pixls", "cargo build \x1b[31m--release", "bb"),
        ])),
    );
    for (w, h) in [(100, 30), (80, 24)] {
        let text = frame(&mut app, "approved · listed", w, h);
        assert!(text.contains("npm test -- checkout") && text.contains("approved 3d ago"), "{text}");
        assert!(!text.contains('\x1b'), "a command is drawn as text");
    }
}

#[test]
fn forgetting_asks_first_and_esc_keeps_it() {
    let (mut app, mut rx) = app_with_outbox();
    app.open_approved();
    app.on_machine_server(
        MachineId::LOCAL,
        ServerMsg::Reply(Reply::AllowedCommands(vec![allowed("/code/shop-api", "npm test", "aa")])),
    );
    sent(&mut rx);
    key(&mut app, KeyCode::Char('x'));
    let asking = frame(&mut app, "approved · forget?", 100, 30);
    assert!(asking.contains("Forget this command?"));
    assert!(sent(&mut rx).is_empty(), "x alone forgets nothing");
    key(&mut app, KeyCode::Esc);
    assert!(sent(&mut rx).is_empty(), "Esc keeps it");
    assert!(matches!(app.mode, Mode::Approved(_)));
    key(&mut app, KeyCode::Char('x'));
    key(&mut app, KeyCode::Enter);
    let out = sent(&mut rx);
    assert!(out.iter().any(|o| matches!(&o.msg,
        ClientMsg::Command(Command::ForgetAllowedCommand { project, command_sha256 })
            if project == std::path::Path::new("/code/shop-api") && command_sha256 == "aa")));
    let after = frame(&mut app, "approved · forgotten", 100, 30);
    assert!(after.contains("None yet."), "{after}");
}
