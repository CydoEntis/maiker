//! Settings › Updates & repair for the local service. Nothing here speaks the daemon's protocol: the service's state
//! comes from the files it publishes, and a repair replaces the daemon file, stops the old process and starts the
//! new one, so it works on a service that is old, stale, wedged or not running.

use super::{
    Activity, APP_NAME, daemon_pid, identified_daemon_pid, is_app_daemon, ipc, list_sessions,
    read_activity, session_file, sessions_survive_restart, shared_daemon, stop_local_daemon,
};
use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::path::Path;
use std::time::Duration;

/// How long `kill-server` has to save the sessions and stop the service before its process is ended instead.
const GRACEFUL_LIMIT: Duration = Duration::from_secs(15);
/// How long the new service has to publish its version after it was started.
const START_LIMIT: Duration = Duration::from_secs(10);

/// The local service as the Updates & repair page shows it. `fileBehind`: the installed daemon file is older than
/// this app (or unreadable), which a repair replaces. `behind`: what runs is older than this app.
fn service_report(
    activity: Option<&Activity>,
    running: bool,
    file_version: Option<&str>,
    app_version: &str,
    sessions_saved: bool,
) -> Value {
    let daemon_version = activity
        .map(|activity| activity.version.as_str())
        .filter(|version| running && !version.is_empty());
    let behind = running
        && activity.is_some_and(|activity| shared_daemon::is_older(&activity.version, app_version));
    let file_behind =
        file_version.is_none_or(|version| shared_daemon::is_older(version, app_version));
    json!({
        "appVersion": app_version,
        "running": running,
        "daemonVersion": daemon_version,
        "fileVersion": file_version,
        "behind": behind,
        "fileBehind": file_behind,
        "canRestart": !running || sessions_survive_restart(activity, sessions_saved),
        "sessionCount": activity.map_or(0, |activity| activity.sessions),
        "activeTurnCount": activity.map(Activity::busy),
    })
}

async fn is_service_running() -> bool {
    ipc::is_running().await || daemon_pid().is_some_and(is_app_daemon)
}

pub async fn local_service_report(app_version: &str) -> Value {
    let running = is_service_running().await;
    let file_version = tokio::task::spawn_blocking(shared_daemon::installed_daemon_version)
        .await
        .ok()
        .flatten();
    service_report(
        read_activity().as_ref(),
        running,
        file_version.as_deref(),
        app_version,
        session_file().is_file(),
    )
}

/// Asks the service, through the daemon file's own `kill-server`, to save its sessions and stop. Best effort: a
/// service that cannot be asked (wedged, or too old to talk to) is ended by its process afterwards.
pub(super) async fn ask_to_stop(executable: &Path) {
    let executable = executable.to_path_buf();
    let _ = tokio::task::spawn_blocking(move || run_within(&executable, "kill-server", GRACEFUL_LIMIT)).await;
}

/// Runs `executable argument`, ending it when it is not done within `limit`. True when it exited successfully.
fn run_within(executable: &Path, argument: &str, limit: Duration) -> bool {
    let mut command = super::host_command(executable);
    command
        .arg(argument)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let Ok(mut child) = command.spawn() else {
        return false;
    };
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if started.elapsed() < limit => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

/// Brings the local service up to this app and restarts it: `executable` is the daemon file already made current,
/// the running service (if any) is asked to save and stop, then the new one is started and waited for.
/// `discard_unsaved` lets the restart go ahead when the service's sessions are not saved: the person was told.
pub async fn repair_local_service(
    executable: &Path,
    app_version: &str,
    discard_unsaved: bool,
) -> Result<Value> {
    if is_service_running().await {
        if identified_daemon_pid().is_ok() {
            stop_local_daemon(Some(executable), discard_unsaved).await?;
        } else {
            anyhow::bail!(
                "the local {APP_NAME} service answers on its socket but its process could not be identified, so it was left running"
            );
        }
    }
    list_sessions(executable.to_path_buf())
        .await
        .context(format!("the new {APP_NAME} service did not start"))?;
    let deadline = std::time::Instant::now() + START_LIMIT;
    loop {
        let report = local_service_report(app_version).await;
        if report["behind"] == false && report["running"] == true
            || std::time::Instant::now() >= deadline
        {
            return Ok(report);
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::{Activity, service_report};

    fn activity(version: &str, sessions: usize, working: usize) -> Activity {
        Activity {
            pid: 1,
            version: version.into(),
            sessions,
            working,
            waiting: 0,
        }
    }

    #[test]
    fn a_running_older_service_is_behind_and_restartable_when_its_sessions_are_saved() {
        let report = service_report(Some(&activity("0.83.0", 3, 1)), true, Some("0.84.0"), "0.84.0", true);
        assert_eq!(report["behind"], true);
        assert_eq!(report["daemonVersion"], "0.83.0");
        assert_eq!(report["fileBehind"], false);
        assert_eq!(report["canRestart"], true);
        assert_eq!(report["activeTurnCount"], 1);
    }

    #[test]
    fn an_old_file_is_reported_even_when_nothing_runs() {
        let report = service_report(None, false, Some("0.83.0"), "0.84.0", false);
        assert_eq!(report["running"], false);
        assert_eq!(report["behind"], false);
        assert_eq!(report["fileBehind"], true);
        assert_eq!(report["daemonVersion"], serde_json::Value::Null);
        assert_eq!(report["canRestart"], true, "nothing runs, so nothing is lost");
    }

    #[test]
    fn a_missing_or_unreadable_file_needs_installing() {
        assert_eq!(service_report(None, false, None, "0.84.0", false)["fileBehind"], true);
    }

    #[test]
    fn sessions_that_are_not_saved_block_a_restart() {
        let report = service_report(Some(&activity("0.83.0", 2, 0)), true, Some("0.84.0"), "0.84.0", false);
        assert_eq!(report["canRestart"], false);
    }

    #[test]
    fn a_current_service_is_not_behind_and_a_stale_activity_file_is_ignored_when_it_is_not_running() {
        let current = service_report(Some(&activity("0.84.0", 0, 0)), true, Some("0.84.0"), "0.84.0", false);
        assert_eq!(current["behind"], false);
        let stale = service_report(Some(&activity("0.83.0", 0, 0)), false, Some("0.84.0"), "0.84.0", false);
        assert_eq!(stale["behind"], false);
        assert_eq!(stale["daemonVersion"], serde_json::Value::Null);
    }

    #[cfg(unix)]
    mod running {
        use super::super::run_within;
        use std::os::unix::fs::PermissionsExt;
        use std::time::{Duration, Instant};

        fn script(name: &str, body: &str) -> std::path::PathBuf {
            let path = std::env::temp_dir().join(format!("repair-{}-{name}", std::process::id()));
            std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        }

        #[test]
        fn a_stop_that_finishes_in_time_is_a_success() {
            let path = script("quick", "exit 0");
            assert!(run_within(&path, "kill-server", Duration::from_secs(5)));
            std::fs::remove_file(path).unwrap();
        }

        #[test]
        fn a_stop_that_fails_or_hangs_gives_up_so_the_process_is_ended_instead() {
            let failing = script("fails", "exit 3");
            assert!(!run_within(&failing, "kill-server", Duration::from_secs(5)));
            let hanging = script("hangs", "exec sleep 30");
            let started = Instant::now();
            assert!(!run_within(&hanging, "kill-server", Duration::from_millis(200)));
            assert!(started.elapsed() < Duration::from_secs(5));
            std::fs::remove_file(failing).unwrap();
            std::fs::remove_file(hanging).unwrap();
        }
    }
}
