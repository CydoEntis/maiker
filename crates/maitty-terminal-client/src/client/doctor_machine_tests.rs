//! `doctor`'s machine checks against the fake-ssh shim (see TESTING, "testing over ssh"): a
//! machine that is fine, one on another protocol (the shared update sentence), one that needs a
//! login, and ones that never answer, which must cost the budget and no more, all at the same
//! time.

use super::cli_machine_tests::Build;
use crate::cli::doctor_machines::{Check, MachineReport, check_all};
use crate::link_failure::{FailureClass, Subject, sentence_here};
use crate::protocol::PROTOCOL_VERSION;
use std::process::Command;
use std::time::{Duration, Instant};

/// What the shim's `--version` answers (`0.0.0-fake`) compares equal to.
const OURS: &str = "0.0.0";

/// How long past its budget a check may take to hand back on a busy machine.
const HANDOFF_SLACK: Duration = Duration::from_secs(15);

fn doctor(build: &Build, only: &[&str], budget: Duration) -> Vec<MachineReport> {
    let machines: Vec<_> = build
        .cfg
        .machines
        .iter()
        .filter(|m| only.contains(&m.name.as_str()))
        .cloned()
        .collect();
    let shim = build.sandbox.shim.to_string_lossy().into_owned();
    check_all(&machines, &shim, OURS, budget)
}

fn find<'a>(reports: &'a [MachineReport], name: &str) -> &'a [Check] {
    &reports
        .iter()
        .find(|r| r.name == name)
        .expect("a report")
        .checks
}

fn marks(checks: &[Check]) -> Vec<(Option<bool>, &str)> {
    checks.iter().map(|c| (c.ok, c.what)).collect()
}

fn is_running(pid: &str) -> bool {
    #[cfg(windows)]
    let probe = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).contains(pid));
    #[cfg(unix)]
    let probe = Command::new("kill")
        .args(["-0", pid])
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success());
    probe.expect("probe the process")
}

#[test]
fn a_good_machine_passes_every_check() {
    let build = Build::start(&[]);
    let reports = doctor(&build, &["build"], Duration::from_secs(30));
    let checks = find(&reports, "build");
    assert_eq!(
        marks(checks),
        [
            (Some(true), "reachable"),
            (Some(true), "maiker version"),
            (Some(true), "protocol"),
            (Some(true), "login PATH"),
            (Some(true), "ssh options"),
        ],
        "{checks:?}"
    );
    assert!(
        checks[1].detail.contains("same as this computer"),
        "{checks:?}"
    );
    assert!(
        checks[2]
            .detail
            .contains(&format!("protocol {PROTOCOL_VERSION}")),
        "{checks:?}"
    );
    assert_eq!(checks[3].detail, "maiker found at /fake/bin/maiker");
    assert!(checks[4].detail.contains("BatchMode=yes"), "{checks:?}");
    assert!(
        checks[4].detail.contains("your ssh_args: --mode=proxy"),
        "{checks:?}"
    );
}

#[test]
fn a_daemon_of_another_protocol_fails_the_protocol_check_with_the_shared_update_sentence() {
    let build = Build::start(&[("skew", "mismatch")]);
    let reports = doctor(&build, &["skew"], Duration::from_secs(30));
    let protocol = find(&reports, "skew")
        .iter()
        .find(|c| c.what == "protocol")
        .expect("a protocol line");
    let def = build
        .cfg
        .machines
        .iter()
        .find(|m| m.name == "skew")
        .expect("a skew machine");
    assert_eq!(protocol.ok, Some(false));
    assert_eq!(
        protocol.detail,
        format!(
            "protocol {} there, {PROTOCOL_VERSION} here. {}",
            crate::protocol::COMPATIBLE_SINCE - 1,
            sentence_here(&FailureClass::Update, &Subject::of_def(def))
        )
    );
}

#[test]
fn a_machine_that_needs_a_login_stops_after_one_failed_line_and_a_skip() {
    let build = Build::start(&[("locked", "auth-fail")]);
    let reports = doctor(&build, &["locked"], Duration::from_secs(30));
    let checks = find(&reports, "locked");
    assert_eq!(checks[0].ok, Some(false));
    assert_eq!(checks[0].what, "reachable");
    assert!(
        checks[0].detail.starts_with("locked refused your key: run `"),
        "the shared sentence: {checks:?}"
    );
    assert_eq!(checks[1].detail, "skipped: not reachable");
    assert_eq!(
        checks[2].what, "ssh options",
        "what is in use is still shown"
    );
    assert_eq!(checks.len(), 3, "{checks:?}");
}

#[test]
fn a_machine_that_never_answers_costs_the_budget_and_its_ssh_is_ended() {
    let build = Build::start(&[("slow", "hang")]);
    let budget = Duration::from_secs(2);
    let started = Instant::now();
    let reports = doctor(&build, &["slow"], budget);
    let took = started.elapsed();
    // The hung ssh never exits, so ending at all shows the budget ended it. The slack over the
    // budget is for a machine busy with other tests, where starting the shim alone can take
    // seconds; it is not a looser promise to the user.
    assert!(
        took >= budget && took < budget + HANDOFF_SLACK,
        "a {budget:?} budget took {took:?}"
    );
    let checks = find(&reports, "slow");
    assert_eq!(checks[0].ok, Some(false));
    assert!(checks[0].detail.contains("no answer within"), "{checks:?}");
    assert_eq!(checks[1].detail, "skipped: not reachable");

    let calls = std::fs::read_to_string(&build.calls).expect("the shim was called");
    let pid = calls
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().next());
    assert!(
        !is_running(pid.expect("a shim pid")),
        "the hung ssh was ended"
    );
}

#[test]
fn machines_are_checked_at_the_same_time() {
    let build = Build::start(&[("a", "hang"), ("b", "hang"), ("c", "hang")]);
    let budget = Duration::from_secs(3);
    let started = Instant::now();
    let reports = doctor(&build, &["a", "b", "c"], budget);
    let took = started.elapsed();
    // One after another, three hung machines cost at least three budgets; anything under that
    // means they overlapped, whatever else the machine is doing.
    assert!(
        took >= budget && took < budget * 3,
        "three {budget:?} waits in parallel took {took:?}"
    );
    assert_eq!(reports.len(), 3);
    assert!(reports.iter().all(|r| r.checks[0].ok == Some(false)));
    assert_eq!(
        reports.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
        ["a", "b", "c"],
        "in name order"
    );
}
