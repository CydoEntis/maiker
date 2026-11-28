//! With `restore.keep_running` on, a pane's shell is the same process after the server restarts
//! (ADR 0022): the pane host held it while no server ran, and the next server took it up.

use maitty_test_support::Sandbox;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

const WITHIN: Duration = Duration::from_secs(60);

fn run(mut command: Command) -> Output {
    command.stdin(Stdio::null());
    maitty_test_support::output_within(command, WITHIN)
}

fn maiker(sandbox: &Sandbox, args: &[&str]) -> String {
    let mut command = sandbox.maiker();
    command.args(args);
    let out = run(command);
    assert!(out.status.success(), "maiker {args:?}: {}", maitty_test_support::text(&out.stderr));
    maitty_test_support::text(&out.stdout)
}

/// The first pane's id in `ls --json`.
fn first_pane(sandbox: &Sandbox) -> Option<String> {
    let listing = maiker(sandbox, &["ls", "--json"]);
    let panes = &listing[listing.find("\"panes\"")?..];
    let id = &panes[panes.find("\"id\":")? + 5..];
    Some(id.trim_start().chars().take_while(char::is_ascii_digit).collect())
}

/// Type `line` into the pane until its screen shows the process id after `marker`: a shell
/// still starting up can drop what is typed before its prompt.
fn ask_pid(sandbox: &Sandbox, pane: &str, line: &str, marker: &str) -> String {
    let started = Instant::now();
    loop {
        maiker(sandbox, &["send", "--pane", pane, line]);
        let asked = Instant::now();
        while asked.elapsed() < Duration::from_secs(5) {
            let screen = maiker(sandbox, &["read", pane]);
            if let Some(pid) = shell_pid(&screen, marker) {
                return pid;
            }
            assert!(started.elapsed() < WITHIN, "never saw {marker}; the screen:\n{screen}");
            std::thread::sleep(Duration::from_millis(200));
        }
    }
}

/// The number after `marker-` on the screen's last line that has one.
fn shell_pid(screen: &str, marker: &str) -> Option<String> {
    screen
        .lines()
        .rev()
        .find_map(|line| line.split(marker).nth(1))
        .map(|rest| rest.chars().take_while(char::is_ascii_digit).collect::<String>())
        .filter(|pid| !pid.is_empty())
}

/// Ends the pane host and its panes however the test ends: a plain `kill-server`, which the
/// sandbox runs, leaves them running for the next server.
struct EndHost(Command);

impl Drop for EndHost {
    fn drop(&mut self) {
        let mut command = std::mem::replace(&mut self.0, Command::new(""));
        command.args(["kill-server", "--forget"]);
        let _ = run(command);
    }
}

#[test]
fn a_panes_shell_is_the_same_process_after_the_server_restarts() {
    let mut sandbox = Sandbox::new();
    let config = sandbox.dir.join("config.toml");
    let mut text = std::fs::read_to_string(&config).unwrap_or_default();
    text.push_str("\n[restore]\nkeep_running = true\n");
    std::fs::write(&config, text).unwrap();
    let _end_host = EndHost(sandbox.maiker());
    sandbox.start_daemon();
    let folder = sandbox.dir.display().to_string();
    maiker(&sandbox, &["new", &folder]);
    let started = Instant::now();
    let pane = loop {
        if let Some(pane) = first_pane(&sandbox).filter(|p| !p.is_empty()) {
            break pane;
        }
        assert!(started.elapsed() < WITHIN, "no pane appeared");
        std::thread::sleep(Duration::from_millis(100));
    };
    // `$$` in a POSIX shell, `$PID` in PowerShell: the shell's own process id.
    let ask = if cfg!(windows) { "echo \"before-$PID\"" } else { "echo before-$$" };
    let before = ask_pid(&sandbox, &pane, ask, "before-");

    maiker(&sandbox, &["kill-server"]);
    sandbox.start_daemon();

    let ask = if cfg!(windows) { "echo \"after-$PID\"" } else { "echo after-$$" };
    let after = ask_pid(&sandbox, &pane, ask, "after-");
    let screen = maiker(&sandbox, &["read", &pane]);
    assert_eq!(before, after, "the same shell answered; the screen:\n{screen}");
    assert!(!screen.contains("restarted here"), "the pane was not started again; the screen:\n{screen}");
}
