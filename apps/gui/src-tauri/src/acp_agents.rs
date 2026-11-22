//! The agents that run as a chat over ACP on this computer: listing them and installing one from
//! the ACP registry (ADR 0021). The work is the command line's (`agents list`, `install`,
//! `remove`), run off the UI thread; the window only ever names an agent's id.

use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

/// An install downloads up to 1 GiB or runs npm; past this it is stopped.
const INSTALL_LIMIT: Duration = Duration::from_secs(25 * 60);
const LIST_LIMIT: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_millis(200);

/// One agent as `agents list --json` tells it; read into this shape so nothing else it might
/// print reaches the window.
#[derive(Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct AcpAgent {
    id: String,
    name: String,
    version: String,
    description: String,
    source: String,
    installed: Option<String>,
    unavailable: Option<String>,
}

/// One install or removal at a time: two would write the same folder and list.
static CHANGING: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn last_line(text: &str) -> Option<&str> {
    text.lines().rev().map(str::trim).find(|line| !line.is_empty())
}

/// Runs `agents <arguments>` to its end or `limit`, and answers what it printed, or the last
/// line of what it said went wrong.
fn agents(executable: &Path, arguments: &[&str], limit: Duration) -> Result<String, String> {
    let mut command = maitty_desktop_client::host_command(executable);
    command
        .arg("agents")
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|error| format!("Could not run the agents command: {error}"))?;
    // Each pipe is read on its own thread so neither can fill and stall the command.
    let read = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut pipe) = pipe
                && let Err(error) = pipe.read_to_string(&mut text)
            {
                tracing::warn!("could not read the agents command's output: {error}");
            }
            text
        })
    };
    let stdout = read(child.stdout.take().map(|pipe| Box::new(pipe) as Box<dyn Read + Send>));
    let stderr = read(child.stderr.take().map(|pipe| Box::new(pipe) as Box<dyn Read + Send>));
    let deadline = Instant::now() + limit;
    let status = loop {
        match child.try_wait().map_err(|error| format!("Could not wait for the agents command: {error}"))? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                if let Err(error) = child.kill() {
                    tracing::warn!("could not stop the agents command: {error}");
                }
                let _ = child.wait();
                return Err("It took too long and was stopped.".into());
            }
            None => std::thread::sleep(POLL),
        }
    };
    let (stdout, stderr) = (stdout.join().unwrap_or_default(), stderr.join().unwrap_or_default());
    if status.success() {
        Ok(stdout)
    } else {
        Err(last_line(&stderr).map_or_else(|| "The agents command failed.".to_owned(), str::to_owned))
    }
}

fn parse_list(text: &str) -> Result<Vec<AcpAgent>, String> {
    serde_json::from_str(text.trim()).map_err(|_| "The list of agents was not readable. Update the app so it and its service are the same version.".to_owned())
}

/// An agent's name may start with `-`, which the command line would read as an option, so such
/// an id is refused here and the id is passed after `--` as well.
fn checked(id: &str) -> Result<(), String> {
    if maitty_shared::conversation::acp_agent_name(id) && !id.starts_with('-') {
        Ok(())
    } else {
        Err("That is not an agent's id.".into())
    }
}

/// The agents that can run over ACP here: the config's, and the ACP registry's with which are installed.
#[tauri::command]
pub async fn acp_agents(app: tauri::AppHandle) -> Result<Vec<AcpAgent>, String> {
    let executable = crate::daemon_executable(&app)?;
    tauri::async_runtime::spawn_blocking(move || agents(&executable, &["list", "--json"], LIST_LIMIT).and_then(|text| parse_list(&text)))
        .await
        .map_err(|error| format!("Listing the agents stopped unexpectedly: {error}"))?
}

/// Installs the registry's agent `id`, or replaces it with the newest version. Answers the line that says what was installed.
#[tauri::command]
pub async fn install_acp_agent(app: tauri::AppHandle, id: String) -> Result<String, String> {
    change(app, "install", id, INSTALL_LIMIT).await
}

/// Removes the installed agent `id` and its files.
#[tauri::command]
pub async fn remove_acp_agent(app: tauri::AppHandle, id: String) -> Result<String, String> {
    change(app, "remove", id, LIST_LIMIT).await
}

async fn change(app: tauri::AppHandle, action: &'static str, id: String, limit: Duration) -> Result<String, String> {
    checked(&id)?;
    let executable = crate::daemon_executable(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(_one) = CHANGING.try_lock() else {
            return Err("Another agent is being installed or removed. Try again when it is done.".to_owned());
        };
        agents(&executable, &[action, "--", &id], limit).map(|said| last_line(&said).unwrap_or_default().to_owned())
    })
    .await
    .map_err(|error| format!("It stopped unexpectedly: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_list_is_read_into_its_own_shape_and_anything_else_is_refused() {
        let listed = parse_list(r#"[{"id":"demo","name":"Demo","version":"1.0.0","description":"","source":"registry","installed":null,"unavailable":"it needs uv","extra":1}]"#).unwrap();

        assert_eq!(listed[0].id, "demo");
        assert_eq!(listed[0].unavailable.as_deref(), Some("it needs uv"));
        assert!(parse_list("Installed Demo 1.0.0").unwrap_err().contains("not readable"));
    }

    #[test]
    fn only_an_agents_id_is_passed_to_the_command() {
        assert!(checked("opencode").is_ok());
        for id in ["", "--json", "../x", "Open Code"] {
            assert!(checked(id).is_err(), "{id}");
        }
    }
}
