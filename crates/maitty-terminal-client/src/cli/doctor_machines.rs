//! The machines part of `<app> doctor`: for each `[[machines]]` entry, whether ssh gets in, what
//! app version is there, whether the two can talk, where its login shell finds the app, and which
//! ssh options are in use. One line per check; a failed one ends with the same sentence the window
//! shows (`link_failure`).
//!
//! Every machine is checked at the same time and has one budget for all of its steps, so a
//! machine that does not answer costs the budget and not more; the steps after an unreachable
//! machine are not tried. What a machine says is cleaned before it is kept (`machine_probe`,
//! `link_failure`), and nothing here runs a command the user or the machine could change: the
//! ssh lines are the fixed ones `ssh_command` builds.

use super::block_on;
use crate::brand::APP_COMMAND;
use crate::ipc::{self, Machine, other_version};
use crate::link_failure::{FailureClass, Subject, classify, sentence_here};
use crate::machine_probe::{self, Located, Probe};
use crate::protocol::PROTOCOL_VERSION;
use crate::remote_install::{State, classify_version, state_of};
use maitty_settings::config::MachineDef;
use std::fmt::Display;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

/// How long one machine has for all of its checks: a connection's own budget and some slack.
pub(crate) const MACHINE_BUDGET: Duration =
    ipc::CONNECT_BUDGET.saturating_add(Duration::from_secs(10));

const REACHABLE: &str = "reachable";
const VERSION: &str = "maiker version";
const PROTOCOL: &str = "protocol";
const LOGIN_PATH: &str = "login PATH";
const SSH_OPTIONS: &str = "ssh options";
const CUSTOM_TRANSPORT: &str = "custom transport";
const NEEDS_SSH: &str = "not available over a custom transport";

/// One line of the report: ✓ (`Some(true)`), ✕ (`Some(false)`) or a note (`None`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Check {
    pub ok: Option<bool>,
    pub what: &'static str,
    pub detail: String,
}

impl Check {
    fn pass(what: &'static str, detail: impl Into<String>) -> Check {
        Check {
            ok: Some(true),
            what,
            detail: detail.into(),
        }
    }

    fn fail(what: &'static str, detail: impl Into<String>) -> Check {
        Check {
            ok: Some(false),
            what,
            detail: detail.into(),
        }
    }

    fn note(what: &'static str, detail: impl Into<String>) -> Check {
        Check {
            ok: None,
            what,
            detail: detail.into(),
        }
    }

    fn skipped(why: &str) -> Check {
        Check::note("", format!("skipped: {why}"))
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct MachineReport {
    pub name: String,
    pub checks: Vec<Check>,
}

/// A line of the section as printed.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Row {
    Machine(String),
    Check(Check),
}

/// The section's lines: nothing at all when no machine is configured, so `doctor` is as it was.
pub(crate) fn rows(reports: &[MachineReport]) -> Vec<Row> {
    reports
        .iter()
        .flat_map(|report| {
            std::iter::once(Row::Machine(report.name.clone()))
                .chain(report.checks.iter().cloned().map(Row::Check))
        })
        .collect()
}

/// Every machine in `machines`, in name order, checked at the same time.
pub(crate) fn check_all(
    machines: &[MachineDef],
    ssh: &str,
    ours: &str,
    budget: Duration,
) -> Vec<MachineReport> {
    let mut sorted: Vec<&MachineDef> = machines.iter().collect();
    sorted.sort_by_key(|def| def.name.to_lowercase());
    std::thread::scope(|scope| {
        let running: Vec<_> = sorted
            .iter()
            .map(|def| scope.spawn(move || check_machine(def, ssh, ours, budget)))
            .collect();
        sorted
            .iter()
            .zip(running)
            .map(|(def, running)| MachineReport {
                name: def.name.clone(),
                checks: running
                    .join()
                    .unwrap_or_else(|_| vec![Check::fail("", "the check stopped unexpectedly")]),
            })
            .collect()
    })
}

/// What the first look at a machine decides about the rest.
#[derive(Debug, PartialEq, Eq)]
enum Next {
    /// The app answered `--version` with this line.
    Go(String),
    /// ssh got in and found no app.
    NoApp,
    Stop,
}

/// A machine reached through its own program has only the protocol check: every other step
/// asks ssh something. Only the program is named, never its arguments, which can hold tokens.
fn check_custom(machine: &Machine, program: &str, budget: Duration) -> Vec<Check> {
    vec![
        protocol(&handshake(machine, budget), &Subject::of(machine)),
        Check::note(VERSION, NEEDS_SSH),
        Check::note(LOGIN_PATH, NEEDS_SSH),
        Check::note(CUSTOM_TRANSPORT, program),
    ]
}

fn check_machine(def: &MachineDef, ssh: &str, ours: &str, budget: Duration) -> Vec<Check> {
    let machine = Machine::from_def(def, ssh);
    if let Some(program) = machine.transport_program() {
        return check_custom(&machine, &program, budget);
    }
    let deadline = Instant::now() + budget;
    let left = || deadline.saturating_duration_since(Instant::now());
    let cancel = AtomicBool::new(false);
    let subject = Subject::of(&machine);
    let (reach, next) = after_probe(&machine_probe::probe(&machine, left(), &cancel), &subject);
    let mut checks = vec![reach];
    match next {
        Next::Stop => checks.push(Check::skipped("not reachable")),
        Next::NoApp => {
            checks.push(not_installed(&subject));
            checks.push(Check::skipped("maiker is not installed there"));
        }
        Next::Go(line) => {
            checks.push(version(&line, ours, &subject));
            checks.push(protocol(&handshake(&machine, left()), &subject));
            let found = machine_probe::locate(&machine, left(), &cancel);
            checks.push(login_path(&found, def.remote_cmd.as_deref(), &subject));
        }
    }
    checks.push(options(def, machine.host_key_option()));
    checks
}

/// A failure as the shared sentence, the same words the window shows.
fn explain(class: &FailureClass, subject: &Subject<'_>) -> String {
    sentence_here(class, subject)
}

/// Two versions that differ, then the shared sentence: the numbers are what `doctor` adds.
fn differs(
    there: impl Display,
    here: impl Display,
    class: &FailureClass,
    subject: &Subject<'_>,
) -> String {
    format!("{there} there, {here} here. {}", explain(class, subject))
}

fn after_probe(probe: &Probe, subject: &Subject<'_>) -> (Check, Next) {
    match probe {
        Probe::Ready { version } => (
            Check::pass(REACHABLE, "ssh logs in without a prompt"),
            Next::Go(version.clone()),
        ),
        Probe::Failed(FailureClass::Install) => (
            Check::pass(REACHABLE, "ssh logs in without a prompt"),
            Next::NoApp,
        ),
        Probe::Failed(class) => (Check::fail(REACHABLE, explain(class, subject)), Next::Stop),
        Probe::Cancelled => (Check::fail(REACHABLE, "cancelled"), Next::Stop),
    }
}

fn not_installed(subject: &Subject<'_>) -> Check {
    Check::fail(VERSION, explain(&FailureClass::Install, subject))
}

fn version(line: &str, ours: &str, subject: &Subject<'_>) -> Check {
    let installed = classify_version(Some(0), line);
    match state_of(&installed, ours) {
        Some(State::Matching) => Check::pass(VERSION, format!("{ours} (same as this computer)")),
        Some(State::TooOld { remote }) => Check::fail(
            VERSION,
            differs(remote, ours, &FailureClass::Update, subject),
        ),
        Some(State::Newer { remote }) => Check::fail(
            VERSION,
            differs(remote, ours, &FailureClass::UpdateHere, subject),
        ),
        Some(State::Missing) | None => Check::fail(
            VERSION,
            format!("it did not report a {APP_COMMAND} version"),
        ),
    }
}

/// The attach handshake, which is where two versions that cannot talk find out.
fn handshake(machine: &Machine, limit: Duration) -> Result<(), anyhow::Error> {
    block_on(async {
        match tokio::time::timeout(limit, ipc::open_to(machine, true)).await {
            Ok(opened) => opened.map(drop),
            Err(_) => Err(anyhow::anyhow!(
                "no answer within {} seconds",
                limit.as_secs()
            )),
        }
    })
}

fn protocol(result: &Result<(), anyhow::Error>, subject: &Subject<'_>) -> Check {
    let Err(e) = result else {
        return Check::pass(
            PROTOCOL,
            format!("protocol {PROTOCOL_VERSION}, the same as this computer"),
        );
    };
    // `classify` picks which side to update, so the fix is the one the window gives.
    let class = classify(e);
    Check::fail(
        PROTOCOL,
        match other_version(e) {
            Some(theirs) => differs(format!("protocol {theirs}"), PROTOCOL_VERSION, &class, subject),
            None => explain(&class, subject),
        },
    )
}

/// Where the login shell finds the app, against the `remote_cmd` that is run. Only the program's
/// path is shown, never the PATH, which can name users and private folders.
fn login_path(found: &Located, remote_cmd: Option<&str>, subject: &Subject<'_>) -> Check {
    let custom = remote_cmd.filter(|cmd| *cmd != APP_COMMAND);
    match (found, custom) {
        (Located::At(path), Some(cmd)) if cmd != path => Check::note(
            LOGIN_PATH,
            format!("{APP_COMMAND} found at {path}; your remote_cmd {cmd} is used instead"),
        ),
        (Located::At(path), _) => Check::pass(LOGIN_PATH, format!("{APP_COMMAND} found at {path}")),
        (Located::NotFound, Some(cmd)) => Check::note(
            LOGIN_PATH,
            format!("{APP_COMMAND} is not on its login PATH; your remote_cmd {cmd} is used"),
        ),
        (Located::NotFound, None) => Check::fail(
            LOGIN_PATH,
            format!(
                "{APP_COMMAND} is not on its login PATH; put it on the PATH there, or set remote_cmd to its path"
            ),
        ),
        (Located::Failed(class), _) => Check::fail(LOGIN_PATH, explain(class, subject)),
        (Located::Cancelled, _) => Check::fail(LOGIN_PATH, "cancelled"),
    }
}

/// `host_key` is the host-key option the lines add, when they add one; without it the person's
/// own ssh setup decides how an unseen key is treated.
fn options(def: &MachineDef, host_key: Option<&str>) -> Check {
    let hardening = match host_key {
        Some(option) => format!("{} {option}", Machine::hardening()),
        None => Machine::hardening(),
    };
    let detail = if def.ssh_args.is_empty() {
        hardening
    } else {
        format!("{hardening} + your ssh_args: {}", shown(&def.ssh_args))
    };
    Check::pass(SSH_OPTIONS, detail)
}

/// The user's own ssh arguments as they wrote them, without control characters. The one thing
/// held back is the folder of a key (`-i ~/.ssh/key` shows `key`), which can name the user.
fn shown(args: &[String]) -> String {
    let mut after_key = false;
    let words: Vec<String> = args
        .iter()
        .map(|arg| {
            let arg: String = arg.chars().filter(|c| !c.is_control()).collect();
            let word = if after_key {
                arg.rsplit(['/', '\\']).next().unwrap_or(&arg).to_string()
            } else {
                arg.clone()
            };
            after_key = arg == "-i";
            if word.contains(char::is_whitespace) {
                format!("'{word}'")
            } else {
                word
            }
        })
        .collect();
    words.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOX: Subject<'static> = Subject { name: "box", target: Some("me@box"), port: None };

    fn unreachable(why: &str) -> Probe {
        Probe::Failed(FailureClass::Unreachable(why.into()))
    }

    fn line(check: &Check) -> String {
        let mark = match check.ok {
            Some(true) => "ok",
            Some(false) => "bad",
            None => "note",
        };
        format!("{mark} {} {}", check.what, check.detail)
    }

    #[test]
    fn a_machine_that_logs_in_is_reachable_and_goes_on() {
        let (check, next) = after_probe(
            &Probe::Ready {
                version: "maiker 0.60.0".into(),
            }, &BOX);
        assert_eq!(check.ok, Some(true));
        assert_eq!(next, Next::Go("maiker 0.60.0".into()));
    }

    #[test]
    fn a_machine_that_cannot_be_reached_says_why_and_stops_the_rest() {
        let (check, next) = after_probe(&unreachable("Connection refused"), &BOX);
        assert_eq!(
            line(&check),
            "bad reachable Can't reach box: check the name or address, and that the machine is on (Connection refused)."
        );
        assert_eq!(next, Next::Stop);
        let refused = FailureClass::KeyRefused("denied".into());
        let (check, next) = after_probe(&Probe::Failed(refused.clone()), &BOX);
        assert_eq!(check.detail, sentence_here(&refused, &BOX));
        assert_eq!(next, Next::Stop);
        assert_eq!(
            Check::skipped("not reachable").detail,
            "skipped: not reachable"
        );
    }

    #[test]
    fn ssh_getting_in_with_no_app_is_reachable_and_not_installed() {
        let (check, next) = after_probe(&Probe::Failed(FailureClass::Install), &BOX);
        assert_eq!(check.ok, Some(true));
        assert_eq!(next, Next::NoApp);
        let missing = not_installed(&BOX);
        assert_eq!(missing.ok, Some(false));
        assert!(
            missing.detail.contains("machine update box --install"),
            "{missing:?}"
        );
    }

    #[test]
    fn a_version_that_differs_gives_both_numbers_then_the_shared_sentence() {
        let same = version("maiker 0.60.0", "0.60.0", &BOX);
        assert_eq!(
            line(&same),
            "ok maiker version 0.60.0 (same as this computer)"
        );
        let older = version("maiker 0.58.1", "0.60.0", &BOX);
        assert_eq!(older.ok, Some(false));
        assert_eq!(
            older.detail,
            format!("0.58.1 there, 0.60.0 here. {}", sentence_here(&FailureClass::Update, &BOX))
        );
        let newer = version("maiker 0.62.0", "0.60.0", &BOX);
        assert_eq!(newer.ok, Some(false));
        assert_eq!(
            newer.detail,
            format!("0.62.0 there, 0.60.0 here. {}", sentence_here(&FailureClass::UpdateHere, &BOX))
        );
        let odd = version("hello there", "0.60.0", &BOX);
        assert_eq!(odd.ok, Some(false));
    }

    #[test]
    fn another_protocol_gives_both_numbers_then_the_shared_sentence() {
        let speaking = |daemon| {
            protocol(
                &Err(anyhow::Error::from(ipc::OtherVersion { daemon })), &BOX)
        };
        let older = speaking(PROTOCOL_VERSION - 1);
        assert_eq!(older.ok, Some(false));
        assert_eq!(
            older.detail,
            format!(
                "protocol {} there, {PROTOCOL_VERSION} here. {}",
                PROTOCOL_VERSION - 1,
                sentence_here(&FailureClass::Update, &BOX)
            )
        );
        let newer = speaking(PROTOCOL_VERSION + 1);
        assert_eq!(newer.ok, Some(false));
        assert_eq!(
            newer.detail,
            format!(
                "protocol {} there, {PROTOCOL_VERSION} here. {}",
                PROTOCOL_VERSION + 1,
                sentence_here(&FailureClass::UpdateHere, &BOX)
            )
        );
        for check in [&older, &newer] {
            assert!(!check.detail.contains("daemon"), "no internal part: {check:?}");
        }
        assert_eq!(protocol(&Ok(()), &BOX).ok, Some(true));
        let down = protocol(&Err(anyhow::anyhow!("closed")), &BOX);
        assert_eq!(down.ok, Some(false));
        assert_eq!(
            down.detail,
            sentence_here(&FailureClass::Unreachable("closed".into()), &BOX)
        );
    }

    #[test]
    fn the_login_path_shows_the_program_and_flags_a_remote_cmd_that_differs() {
        let at = |path: &str| Located::At(path.into());
        let plain = login_path(&at("/usr/bin/maiker"), None, &BOX);
        assert_eq!(
            line(&plain),
            "ok login PATH maiker found at /usr/bin/maiker"
        );
        let same = login_path(&at("/opt/maiker"), Some("/opt/maiker"), &BOX);
        assert_eq!(same.ok, Some(true));
        let differs = login_path(&at("/usr/bin/maiker"), Some("~/bin/maiker"), &BOX);
        assert_eq!(differs.ok, None);
        assert!(
            differs
                .detail
                .contains("your remote_cmd ~/bin/maiker is used"),
            "{differs:?}"
        );
        let by_name = login_path(&at("/usr/bin/maiker"), Some("maiker"), &BOX);
        assert_eq!(
            by_name.ok,
            Some(true),
            "the default name is not a different cmd"
        );
    }

    #[test]
    fn an_app_off_the_login_path_is_a_fault_only_when_the_default_command_runs() {
        let default = login_path(&Located::NotFound, None, &BOX);
        assert_eq!(default.ok, Some(false));
        assert!(default.detail.contains("not on its login PATH"));
        let custom = login_path(&Located::NotFound, Some("~/bin/maiker"), &BOX);
        assert_eq!(custom.ok, None);
        let failed = login_path(&Located::Failed(FailureClass::KeyRefused("denied".into())), None, &BOX);
        assert_eq!(failed.ok, Some(false));
    }

    #[test]
    fn the_ssh_options_name_the_hardening_and_the_users_own_arguments() {
        let def = |args: &[&str]| MachineDef {
            name: "box".into(),
            target: "box".into(),
            ssh_args: args.iter().map(|a| a.to_string()).collect(),
            ..MachineDef::default()
        };
        let bare = options(&def(&[]), None);
        assert_eq!(
            bare.detail,
            "BatchMode=yes ForwardAgent=no -a -T ConnectTimeout=15 ServerAlive=15x3"
        );
        let new_keys = options(&def(&["-p", "2222"]), Some("StrictHostKeyChecking=accept-new"));
        assert_eq!(
            new_keys.detail,
            "BatchMode=yes ForwardAgent=no -a -T ConnectTimeout=15 ServerAlive=15x3 StrictHostKeyChecking=accept-new + your ssh_args: -p 2222"
        );
        let with = options(&def(&[
            "-p",
            "2222",
            "-i",
            "/home/me/.ssh/box key",
            "-o",
            "ProxyCommand=ssh jump -W %h:%p",
        ]), None);
        assert_eq!(with.ok, Some(true));
        assert!(
            with.detail.ends_with(
                "+ your ssh_args: -p 2222 -i 'box key' -o 'ProxyCommand=ssh jump -W %h:%p'"
            ),
            "{}",
            with.detail
        );
        let hostile = options(&def(&["-o", "Foo=\u{1b}[2Jbar"]), None);
        assert!(
            hostile.detail.ends_with("-o Foo=[2Jbar"),
            "{}",
            hostile.detail
        );
    }

    #[test]
    fn a_custom_transport_is_one_note_with_its_program_and_no_failed_steps() {
        let def = MachineDef {
            name: "fly".into(),
            target: "fly".into(),
            via: Some(vec!["/no/such/relay".into(), "--token".into(), "s3cret".into()]),
            ..MachineDef::default()
        };
        let checks = check_machine(&def, "ssh", "0.60.0", Duration::from_secs(5));
        let notes: Vec<_> = checks.iter().filter(|c| c.ok.is_none()).collect();
        assert_eq!(
            notes.iter().map(|c| (c.what, c.detail.as_str())).collect::<Vec<_>>(),
            [
                (VERSION, NEEDS_SSH),
                (LOGIN_PATH, NEEDS_SSH),
                (CUSTOM_TRANSPORT, "/no/such/relay"),
            ]
        );
        assert!(!checks.iter().any(|c| c.detail.contains("s3cret")), "{checks:?}");
        assert!(!checks.iter().any(|c| c.what == SSH_OPTIONS));
        assert_eq!(checks[0].what, PROTOCOL);
    }

    #[test]
    fn no_machines_means_no_section() {
        assert!(rows(&[]).is_empty());
        assert!(check_all(&[], "ssh", "0.60.0", Duration::from_secs(1)).is_empty());
    }

    #[test]
    fn each_machine_is_a_heading_then_its_lines() {
        let reports = vec![MachineReport {
            name: "box".into(),
            checks: vec![Check::pass(REACHABLE, "x"), Check::skipped("y")],
        }];
        let rows = rows(&reports);
        assert_eq!(rows[0], Row::Machine("box".into()));
        assert_eq!(rows.len(), 3);
    }
}
