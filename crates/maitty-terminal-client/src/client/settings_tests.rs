//! The settings-side views the desktop app has and the terminal app now shares: usage by period,
//! approved commands, and a machine's details (GitHub, git identity, this computer's service).
//! `MAIKER_SHOW=1 cargo test settings_tests -- --nocapture` prints the frames.

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

mod machine_details {
    use super::*;
    use crate::client::ids::Remote;
    use crate::client::link::ConnectionState;
    use crate::protocol::{
        GITHUB_SIGN_IN_COMMAND, GitConfigWrite, GitHubAccount, GitHubReport, GitIdentity,
        GitIdentityReport, GitIdentityRule, GitRuleChange,
    };

    const BUILD: MachineId = MachineId(1);

    fn with_build() -> (App, mpsc::UnboundedReceiver<Outgoing>) {
        let (mut app, rx) = app_with_outbox();
        app.cfg.machines = vec![maitty_settings::config::MachineDef {
            name: "build".into(),
            target: "ci@build.lan".into(),
            ..Default::default()
        }];
        let mut remote = Remote {
            name: "build".into(),
            state: ConnectionState::Connected,
            ..Remote::default()
        };
        remote.snap.daemon_version = "0.76.0".into();
        app.remotes.insert(BUILD, remote);
        (app, rx)
    }

    /// The tags asked of `machine`, GitHub's first.
    fn asked(out: &[Outgoing], machine: MachineId) -> (u64, u64) {
        let mut github = None;
        let mut git = None;
        for o in out.iter().filter(|o| o.machine == machine) {
            match o.msg {
                ClientMsg::Query(Query::GitHubAccounts { tag }) => github = Some(tag),
                ClientMsg::Query(Query::GitIdentities { tag }) => git = Some(tag),
                _ => {}
            }
        }
        (github.expect("GitHub asked"), git.expect("git asked"))
    }

    fn reports(app: &mut App, machine: MachineId, (github, git): (u64, u64)) {
        let report = GitHubReport {
            installed: true,
            accounts: vec![
                GitHubAccount { login: "cydo".into(), active: true },
                GitHubAccount { login: "cydo-work".into(), active: false },
            ],
            problem: None,
        };
        app.on_machine_server(machine, ServerMsg::Reply(Reply::GitHubAccounts { tag: github, report }));
        let report = GitIdentityReport {
            installed: true,
            name: Some("Cydo".into()),
            email: Some("cydo@home.example".into()),
            rules: vec![
                GitIdentityRule {
                    folder: "~/work".into(),
                    identity: Some(GitIdentity {
                        name: "Cydo W".into(),
                        email: "cydo@work.example".into(),
                        login: "cydo-work".into(),
                    }),
                },
                GitIdentityRule { folder: "~/oss".into(), identity: None },
            ],
            problem: None,
        };
        app.on_machine_server(machine, ServerMsg::Reply(Reply::GitIdentities { tag: git, report }));
    }

    #[test]
    fn this_computer_says_its_service_socket_and_log_and_who_commits() {
        let (mut app, mut rx) = app_with_outbox();
        app.snap.daemon_version = "0.76.0".into();
        sent(&mut rx);
        app.open_machine_info(MachineId::LOCAL);
        let tags = asked(&sent(&mut rx), MachineId::LOCAL);
        let asking = frame(&mut app, "this computer · asking", 100, 30);
        assert!(asking.contains("asking this computer…"), "{asking}");
        reports(&mut app, MachineId::LOCAL, tags);
        for (w, h) in [(100, 30), (80, 24), (160, 45)] {
            let text = frame(&mut app, "this computer", w, h);
            assert!(text.contains("service 0.76.0 · 5 sessions · socket"), "{text}");
            assert!(text.contains("daemon.log"), "{text}");
            assert!(text.contains("cydo") && text.contains("active"), "{text}");
            assert!(text.contains("Cydo <cydo@home.example>"), "{text}");
            assert!(text.contains("~/work") && text.contains("set outside Maiker"), "{text}");
        }
    }

    #[test]
    fn a_heading_menu_opens_another_machines_details_and_asks_that_machine() {
        let (mut app, mut rx) = with_build();
        app.menu_for_machine(BUILD, (2, 2));
        let Mode::ScreenMenu(m) = &app.mode else { panic!("{:?}", app.mode) };
        assert!(m.items.iter().any(|(label, _)| label == "Details…"));
        sent(&mut rx);
        app.open_machine_info(BUILD);
        let tags = asked(&sent(&mut rx), BUILD);
        reports(&mut app, BUILD, tags);
        let text = frame(&mut app, "machine · build", 100, 30);
        assert!(text.contains("machine · build"), "{text}");
        assert!(text.contains("ci@build.lan · version 0.76.0 · 0 sessions · connected"), "{text}");
        assert!(!text.contains("daemon.log"), "the log is this computer's only");
    }

    #[test]
    fn an_answer_from_another_machine_or_an_old_question_changes_nothing() {
        let (mut app, mut rx) = with_build();
        sent(&mut rx);
        app.open_machine_info(BUILD);
        let (github, git) = asked(&sent(&mut rx), BUILD);
        reports(&mut app, MachineId::LOCAL, (github, git));
        reports(&mut app, BUILD, (github + 100, git + 100));
        let text = frame(&mut app, "machine · build, answers not its", 100, 30);
        assert!(text.contains("asking build…"), "{text}");
    }

    #[test]
    fn g_starts_githubs_own_sign_in_in_a_new_session_there() {
        let (mut app, mut rx) = with_build();
        app.open_machine_info(BUILD);
        sent(&mut rx);
        key(&mut app, KeyCode::Char('g'));
        let out = sent(&mut rx);
        assert!(out.iter().any(|o| o.machine == BUILD && matches!(&o.msg,
            ClientMsg::Command(Command::NewWorkspace { cmd: Some(cmd), .. }) if cmd == GITHUB_SIGN_IN_COMMAND)));
        assert!(matches!(app.mode, Mode::Normal), "the session has the keys");
    }

    #[test]
    fn a_rule_is_previewed_then_written_only_on_enter() {
        let (mut app, mut rx) = with_build();
        app.open_machine_info(BUILD);
        let tags = asked(&sent(&mut rx), BUILD);
        reports(&mut app, BUILD, tags);
        key(&mut app, KeyCode::Char('a'));
        for c in "~/clients".chars() {
            key(&mut app, KeyCode::Char(c));
        }
        key(&mut app, KeyCode::Tab);
        key(&mut app, KeyCode::Tab);
        key(&mut app, KeyCode::Tab);
        key(&mut app, KeyCode::Right);
        let form = frame(&mut app, "machine · new rule", 100, 30);
        assert!(form.contains("~/clients") && form.contains("cydo-work") && form.contains("2/2"), "{form}");
        key(&mut app, KeyCode::Enter);
        let out = sent(&mut rx);
        let preview = out.iter().find_map(|o| match &o.msg {
            ClientMsg::Query(Query::GitIdentityRule { change: GitRuleChange::Preview { folder, identity }, tag }) => {
                assert_eq!(o.machine, BUILD);
                assert_eq!(folder, "~/clients");
                assert_eq!((identity.name.as_str(), identity.email.as_str(), identity.login.as_str()), ("Cydo", "cydo@home.example", "cydo-work"));
                Some(*tag)
            }
            _ => None,
        }).expect("a preview asked");
        assert!(!out.iter().any(|o| matches!(&o.msg, ClientMsg::Query(Query::GitIdentityRule { change: GitRuleChange::Apply { .. }, .. }))));
        let lines = vec![GitConfigWrite { file: "~/.gitconfig".into(), lines: vec!["[includeIf \"gitdir:~/clients/\"]".into(), "path = ~/.config/maiker/git/clients.gitconfig".into()] }];
        app.on_machine_server(BUILD, ServerMsg::Reply(Reply::GitIdentityRuleDone { tag: preview, outcome: Ok(lines) }));
        let shown = frame(&mut app, "machine · preview", 100, 30);
        assert!(shown.contains("Enter writes these lines on build") && shown.contains("gitdir:~/clients/"), "{shown}");
        key(&mut app, KeyCode::Enter);
        let out = sent(&mut rx);
        let apply = out.iter().find_map(|o| match &o.msg {
            ClientMsg::Query(Query::GitIdentityRule { change: GitRuleChange::Apply { .. }, tag }) => Some(*tag),
            _ => None,
        }).expect("Enter writes it");
        app.on_machine_server(BUILD, ServerMsg::Reply(Reply::GitIdentityRuleDone { tag: apply, outcome: Ok(Vec::new()) }));
        let done = frame(&mut app, "machine · written", 100, 30);
        assert!(done.contains("Rule written"), "{done}");
        assert!(sent(&mut rx).iter().any(|o| matches!(o.msg, ClientMsg::Query(Query::GitIdentities { .. }))), "the rules are read again");
    }

    #[test]
    fn removing_asks_first_and_a_rule_set_outside_maitty_is_not_touched() {
        let (mut app, mut rx) = with_build();
        app.open_machine_info(BUILD);
        let tags = asked(&sent(&mut rx), BUILD);
        reports(&mut app, BUILD, tags);
        key(&mut app, KeyCode::Down);
        key(&mut app, KeyCode::Char('x'));
        let text = frame(&mut app, "machine · outside rule", 100, 30);
        assert!(text.contains("set outside Maiker: change it in your git config"), "{text}");
        key(&mut app, KeyCode::Up);
        key(&mut app, KeyCode::Char('x'));
        let ask = frame(&mut app, "machine · remove?", 100, 30);
        assert!(ask.contains("Remove the rule for ~/work?"), "{ask}");
        key(&mut app, KeyCode::Esc);
        assert!(!sent(&mut rx).iter().any(|o| matches!(o.msg, ClientMsg::Query(Query::GitIdentityRule { .. }))), "Esc keeps it");
        key(&mut app, KeyCode::Char('x'));
        key(&mut app, KeyCode::Enter);
        assert!(sent(&mut rx).iter().any(|o| matches!(&o.msg,
            ClientMsg::Query(Query::GitIdentityRule { change: GitRuleChange::Remove { folder }, .. }) if folder == "~/work")));
    }
}
