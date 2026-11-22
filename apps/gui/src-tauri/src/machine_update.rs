//! Updating the app on another machine from the window (ADR 0007). The installed `maiker` does
//! the work, the same as `maiker machine update <name>` in a terminal, so there is one update
//! path. The machine's saved sessions come back on the new daemon; a turn in progress is lost.

use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::Stdio;
use tauri::Emitter;

/// What the window hears while an update runs: which machine, and how far along it is.
const PROGRESS_EVENT: &str = "machine-update-progress";

#[derive(Clone, serde::Serialize)]
struct Progress {
    name: String,
    percent: u8,
}

/// The update's `progress: 55` line on stderr, which it prints only because the window asked (`<APP>_UPDATE_PROGRESS`).
fn parse_progress(line: &str) -> Option<u8> {
    line.trim()
        .strip_prefix("progress: ")?
        .trim()
        .parse::<u8>()
        .ok()
        .filter(|percent| *percent <= 100)
}

/// Keeps a window-supplied name from ever being read as an option.
fn valid_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('-') && !name.chars().any(char::is_control)
}

fn arguments(name: &str, install: bool, when_idle: bool) -> Vec<String> {
    let restart = if when_idle { "--wait" } else { "--restart" };
    let mut arguments: Vec<String> = ["machine", "update", name, "--yes", restart]
        .map(String::from)
        .into();
    if install {
        arguments.push("--install".into());
    }
    arguments
}

/// How `machine update` passes on the far side's answer to the restart it asked for (`restart_daemon` in the CLI).
const DAEMON_PREFIX: &str = "daemon: ";
/// How that answer starts when the old service was left running (the CLI's `LEFT_RUNNING`; the two must agree).
const LEFT_RUNNING: &str = "left running";

fn last_line(text: &str) -> Option<&str> {
    text.lines().rev().map(str::trim).find(|line| !line.is_empty())
}

/// The far side's answer to the restart, without its prefix; `None` when it was not asked or said nothing.
fn daemon_answer(stderr: &str) -> Option<&str> {
    stderr.lines().rev().map(str::trim).find_map(|line| line.strip_prefix(DAEMON_PREFIX))
}

/// What to tell the person after a success: the result line, then what the daemon said to the restart and any note,
/// so a restart that did not happen is never hidden.
fn summary(stdout: &str, stderr: &str) -> String {
    let mut said = vec![last_line(stdout).unwrap_or("Updated.").to_string()];
    said.extend(daemon_answer(stderr).map(str::to_string));
    said.extend(stderr.lines().rev().map(str::trim).find(|line| line.starts_with("note:")).map(str::to_string));
    said.join("\n")
}

/// A restart asked for now that the far side refused: the binary may be new, but the old service still runs, and an
/// app that speaks a newer protocol cannot connect to it. The command itself exits 0, so this is the one place that
/// can tell the person it did not work and what would.
fn refused_restart(name: &str, stderr: &str) -> Option<String> {
    let answer = daemon_answer(stderr)?;
    let why = answer.strip_prefix(LEFT_RUNNING)?.trim_start_matches(':').trim();
    Some(format!(
        "The service on {name} was not restarted ({why}), so it still runs the old Maiker and this app cannot connect to it. \
         Its open sessions are not saved where the new version can bring them back, so Maiker will not end them for you. \
         To restart it anyway, run `maiker kill-server` on {name} (this ends what runs in those sessions), then press Retry."
    ))
}

fn run(
    app: &tauri::AppHandle,
    executable: &Path,
    name: &str,
    install: bool,
    when_idle: bool,
) -> Result<String, String> {
    let mut command = maitty_desktop_client::host_command(executable);
    // Under every name it has had: the `maitty` that answers may be an older build.
    maitty_shared::brand::set_child_env(&mut command, "UPDATE_PROGRESS", "1");
    command
        .args(arguments(name, install, when_idle))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not run the update: {error}"))?;
    // Standard output is read on its own thread so neither pipe can fill and stall the update.
    let stdout_pipe = child.stdout.take();
    let stdout_reader = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut pipe) = stdout_pipe
            && let Err(error) = pipe.read_to_string(&mut text)
        {
            tracing::warn!("could not read the update's output: {error}");
        }
        text
    });
    let mut stderr = String::new();
    if let Some(pipe) = child.stderr.take() {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            match parse_progress(&line) {
                Some(percent) => {
                    let progress = Progress {
                        name: name.to_string(),
                        percent,
                    };
                    if let Err(error) = app.emit(PROGRESS_EVENT, progress) {
                        tracing::warn!("could not tell the window how far the update is: {error}");
                    }
                }
                None => {
                    stderr.push_str(&line);
                    stderr.push('\n');
                }
            }
        }
    }
    let status = child
        .wait()
        .map_err(|error| format!("The update stopped unexpectedly: {error}"))?;
    let stdout = stdout_reader
        .join()
        .map_err(|_| "The update's output could not be read.".to_string())?;
    if status.success() {
        if !when_idle && let Some(refused) = refused_restart(name, &stderr) {
            return Err(refused);
        }
        return Ok(summary(&stdout, &stderr));
    }
    Err(last_line(&stderr)
        .or_else(|| last_line(&stdout))
        .map_or_else(|| format!("The update of {name} failed."), str::to_string))
}

/// What is open on a machine: the sessions, and how many of them are mid-turn.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
pub struct Activity {
    sessions: usize,
    busy: usize,
    /// The app there is already this version, so an update is only a daemon restart.
    current: bool,
}

/// The far side's one line, `activity: sessions=3 busy=1`; `None` when it could not say.
fn parse_activity(text: &str) -> Option<Activity> {
    let line = last_line(text)?;
    let numbers = line.strip_prefix("activity: ")?;
    let mut sessions = None;
    let mut busy = None;
    let mut current = false;
    for part in numbers.split_whitespace() {
        match part.split_once('=') {
            Some(("sessions", value)) => sessions = value.parse().ok(),
            Some(("busy", value)) => busy = value.parse().ok(),
            Some(("current", value)) => current = value == "yes",
            _ => {}
        }
    }
    Some(Activity {
        sessions: sessions?,
        busy: busy?,
        current,
    })
}

fn ask_activity(executable: &Path, name: &str) -> Result<Option<Activity>, String> {
    let mut command = maitty_desktop_client::host_command(executable);
    command
        .args(["machine", "activity", name])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command
        .output()
        .map_err(|error| format!("Could not ask {name}: {error}"))?;
    if !output.status.success() {
        let said = String::from_utf8_lossy(&output.stderr);
        return Err(last_line(&said).map_or_else(|| format!("Could not ask {name}."), str::to_string));
    }
    Ok(parse_activity(&String::from_utf8_lossy(&output.stdout)))
}

/// How many sessions are open on a machine and how many are busy, so the question before an
/// update can say what it will interrupt. `None` when the machine's app is too old to say.
#[tauri::command]
pub async fn machine_activity(
    app: tauri::AppHandle,
    name: String,
) -> Result<Option<Activity>, String> {
    if !valid_name(&name) {
        return Err("That is not a machine name.".into());
    }
    let executable = crate::daemon_executable(&app)?;
    tauri::async_runtime::spawn_blocking(move || ask_activity(&executable, &name))
        .await
        .map_err(|error| format!("The question stopped unexpectedly: {error}"))?
}

/// Install or update the app on the machine called `name`, off the UI thread, with progress on
/// `machine-update-progress`. The one path the Fix flow and the add flow share.
pub(crate) async fn run_update(
    app: tauri::AppHandle,
    name: String,
    install: bool,
    when_idle: bool,
) -> Result<String, String> {
    if !valid_name(&name) {
        return Err("That is not a machine name.".into());
    }
    let executable = crate::daemon_executable(&app)?;
    tauri::async_runtime::spawn_blocking(move || run(&app, &executable, &name, install, when_idle))
        .await
        .map_err(|error| format!("The update stopped unexpectedly: {error}"))?
}

#[tauri::command]
pub async fn update_machine(
    app: tauri::AppHandle,
    name: String,
    install: bool,
    when_idle: bool,
) -> Result<String, String> {
    run_update(app, name, install, when_idle).await
}

#[cfg(test)]
mod tests {
    use super::{Activity, arguments, parse_activity, parse_progress, refused_restart, summary, valid_name};

    #[test]
    fn a_name_that_could_be_an_option_is_refused() {
        assert!(valid_name("box"));
        assert!(!valid_name("--help"));
        assert!(!valid_name(""));
        assert!(!valid_name("a\nb"));
    }

    #[test]
    fn the_update_is_confirmed_and_restarts_the_daemon() {
        assert_eq!(
            arguments("box", false, false),
            ["machine", "update", "box", "--yes", "--restart"]
        );
        assert_eq!(arguments("box", true, false).last().unwrap(), "--install");
    }

    #[test]
    fn updating_when_idle_waits_instead_of_restarting_at_once() {
        let said = arguments("box", false, true);
        assert!(said.contains(&"--wait".to_string()));
        assert!(!said.contains(&"--restart".to_string()));
    }

    #[test]
    fn the_activity_line_is_read_and_anything_else_is_unknown() {
        assert_eq!(
            parse_activity("banner\nactivity: sessions=3 busy=1\n"),
            Some(Activity { sessions: 3, busy: 1, current: false })
        );
        assert_eq!(
            parse_activity("activity: sessions=1 busy=0 current=yes"),
            Some(Activity { sessions: 1, busy: 0, current: true })
        );
        assert_eq!(parse_activity("activity: unknown"), None);
        assert_eq!(parse_activity("activity: sessions=3"), None);
        assert_eq!(parse_activity(""), None);
    }

    #[test]
    fn a_daemon_left_running_is_reported_with_the_result() {
        let said = summary(
            "box: maiker 1.0.0 installed to ~/.local/bin/maiker\n",
            "probing box…\nnote: could not ask the daemon (x); running sessions are untouched\n",
        );
        assert!(said.starts_with("box: maiker 1.0.0 installed"));
        assert!(said.contains("note: could not ask the daemon"));
        assert_eq!(summary("", ""), "Updated.");
    }

    #[test]
    fn the_daemon_answer_to_the_restart_is_reported_with_the_result() {
        let said = summary(
            "box: maiker 1.0.0 is already up to date\n",
            "restarting the daemon on box…\ndaemon: restarted: sessions were saved and come back with the new version\n",
        );
        assert_eq!(said, "box: maiker 1.0.0 is already up to date\nrestarted: sessions were saved and come back with the new version");
    }

    #[test]
    fn a_restart_the_far_side_refused_is_a_failure_that_says_what_to_do() {
        let stderr = "restarting the daemon on box…\ndaemon: left running: 4 open session(s); it keeps them\n";
        let refused = refused_restart("box", stderr).expect("a refusal");
        assert!(refused.starts_with("The service on box was not restarted (4 open session(s); it keeps them)"));
        assert!(refused.contains("`maiker kill-server` on box"));
        assert_eq!(refused_restart("box", "daemon: restarted: no session was open\n"), None);
        assert_eq!(refused_restart("box", "note: could not ask the daemon (x)\n"), None);
    }

    #[test]
    fn a_progress_line_is_a_number_up_to_a_hundred_and_anything_else_is_not_progress() {
        assert_eq!(parse_progress("progress: 55"), Some(55));
        assert_eq!(parse_progress("  progress: 100  "), Some(100));
        assert_eq!(parse_progress("progress: 101"), None);
        assert_eq!(parse_progress("progress: soon"), None);
        assert_eq!(parse_progress("probing box…"), None);
    }
}
