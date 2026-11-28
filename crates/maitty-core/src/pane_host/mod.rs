//! The pane host (ADR 0022): a small process that holds every pane's terminal, so the daemon
//! can restart (an update, a crash) without ending them. `host` is the process, `link` the
//! daemon's end, `wire` the frozen contract between them.

mod host;
mod link;
mod wire;

#[cfg(test)]
mod tests;

pub use host::run;
pub use link::{Event, Keep, Link, end_running_host};
pub use wire::{HostedPane, ToHost};

/// End a pane's program and everything it started. Its shell leads its own process group on
/// Unix; Windows has `taskkill /T`.
pub fn kill_tree(pid: Option<u32>) -> Result<(), String> {
    let Some(pid) = pid else {
        return Err("pane process ID is unavailable".into());
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        match std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(crate::proc::CREATE_NO_WINDOW)
            .status()
        {
            Ok(status) if status.success() => Ok(()),
            Ok(status) => Err(format!("taskkill exited with {status}")),
            Err(error) => Err(format!("could not run taskkill: {error}")),
        }
    }
    #[cfg(not(windows))]
    {
        // Not `kill -KILL -<pid>`: util-linux's kill reads the bare negative pid as an option
        // and signals every process the user owns (pid -1).
        match libc::pid_t::try_from(pid) {
            Ok(group) if group > 1 => {
                // SAFETY: signals only the process group the pane's shell leads.
                if unsafe { libc::kill(-group, libc::SIGKILL) } == 0 {
                    return Ok(());
                }
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::ESRCH) {
                    Ok(())
                } else {
                    Err(format!("could not stop pane process group: {error}"))
                }
            }
            _ => Err("pane process has no valid process group".into()),
        }
    }
}
