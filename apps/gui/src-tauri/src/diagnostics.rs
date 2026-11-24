//! Settings › Export logs: one text file a person can send to the maintainer when something went
//! wrong. Everything is read from disk by the host, so it works when the service is old, stale or
//! not running. The file holds versions, the system, whether the service answers, machine names,
//! the end of the service's log and its recent warnings and errors, all cleaned by `redact`. It
//! never holds chat or conversation content, session files, settings, environment variables or any
//! file this module does not name. A file that cannot be cleaned is left out and the preview says so.
//!
//! The window asks for a preview, which builds the file once and keeps it; Save writes that same text
//! to a place the person picks in the system's own save dialog, so the window never names a path.

mod redact;

use crate::daemon_log::log_tail;
use maitty_desktop_client::ServiceReach;
use redact::Context;
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// The service's log in its data folder (`init_logging` in the daemon).
const LOG_FILE: &str = "daemon.log";
/// How much of the end of the log is read for its tail.
const LOG_TAIL_BYTES: u64 = 256 * 1024;
/// How much of the end of the log is searched for warnings and errors.
const PROBLEM_SEARCH_BYTES: u64 = 1024 * 1024;
/// The most warning and error lines shown, newest last.
const MAX_PROBLEMS: usize = 100;
/// The longest line kept; a longer one is cut.
const MAX_LINE_CHARS: usize = 1000;
/// How long to wait for the service to answer; a stuck one must not stop the export.
const REACH_WAIT: Duration = Duration::from_secs(3);
/// The name offered in the save dialog.
const FILE_NAME: &str = "maiker-diagnostics.txt";

/// The bundle last prepared, which Save writes. Replaced by every preview.
static PREPARED: Mutex<Option<String>> = Mutex::new(None);

/// What the host knows without reading the log.
pub struct Facts {
    pub app_version: String,
    pub service_version: Option<String>,
    pub sessions: Option<usize>,
    pub reach: String,
    pub system: String,
    pub machines: Vec<String>,
}

enum Outcome {
    Included(String),
    LeftOut(String),
}

struct Part {
    title: &'static str,
    outcome: Outcome,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPart {
    title: &'static str,
    included: bool,
    note: String,
}

/// What the window shows before anything is saved: each part and whether it is in, the one-paragraph
/// summary to paste into a chat, and the exact text of the file.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    parts: Vec<PreviewPart>,
    summary: String,
    text: String,
}

fn note_of(part: &Part) -> (bool, String) {
    match &part.outcome {
        Outcome::Included(text) => {
            let lines = text.lines().count();
            (true, format!("{lines} {}", if lines == 1 { "line" } else { "lines" }))
        }
        Outcome::LeftOut(why) => (false, format!("Left out: {why}")),
    }
}

fn facts_part(facts: &Facts) -> Part {
    let service = facts.service_version.as_deref().unwrap_or("not known (no activity file)");
    let sessions = facts.sessions.map_or_else(|| "not known".to_string(), |n| n.to_string());
    let text = format!(
        "App version: {}\nService version: {service}\nCLI version: not collected (the CLI is not run to read it)\nService: {}\nSessions held by the service: {sessions}\nProtocol: {} (oldest this build talks to: {})\nSystem: {}",
        facts.app_version,
        facts.reach,
        maitty_shared::protocol::PROTOCOL_VERSION,
        maitty_shared::protocol::COMPATIBLE_SINCE,
        facts.system,
    );
    Part { title: "Versions, system and service status", outcome: Outcome::Included(text) }
}

fn machines_part(names: &[String], context: &Context) -> Part {
    let text = if names.is_empty() {
        "No remote machines are set up.".to_string()
    } else {
        let listed = names.iter().map(|name| format!("- {}", redact::clean(name, context))).collect::<Vec<_>>().join("\n");
        format!("{listed}\n(Names only. Whether each is reachable is not checked here; the service log below records connection problems.)")
    };
    Part { title: "Remote machine names", outcome: Outcome::Included(text) }
}

fn cap_lines(text: &str) -> String {
    text.lines()
        .map(|line| match line.char_indices().nth(MAX_LINE_CHARS) {
            Some((at, _)) => format!("{}... (cut)", &line[..at]),
            None => line.to_string(),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The end of the log, cleaned, or the reason it is not in the bundle.
fn read_log(data_dir: &Path, limit: u64, context: &Context) -> Result<String, String> {
    let file = data_dir.join(LOG_FILE);
    if !file.is_file() {
        return Err("there is no service log yet".into());
    }
    let text = log_tail(&file, limit)?;
    if let Some(why) = redact::unsafe_to_clean(text.as_bytes()) {
        return Err(format!("the log could not be cleaned safely, since {why}"));
    }
    Ok(cap_lines(&redact::clean(&text, context)))
}

fn log_part(data_dir: &Path, context: &Context) -> Part {
    let outcome = match read_log(data_dir, LOG_TAIL_BYTES, context) {
        Ok(text) => Outcome::Included(text),
        Err(why) => Outcome::LeftOut(why),
    };
    Part { title: "Service log (recent)", outcome }
}

fn problems_part(data_dir: &Path, context: &Context) -> Part {
    let outcome = match read_log(data_dir, PROBLEM_SEARCH_BYTES, context) {
        Ok(text) => {
            let problems: Vec<&str> = text.lines().filter(|l| l.contains(" WARN ") || l.contains(" ERROR ")).collect();
            let from = problems.len().saturating_sub(MAX_PROBLEMS);
            Outcome::Included(problems[from..].join("\n"))
        }
        Err(why) => Outcome::LeftOut(why),
    };
    Part { title: "Recent warnings and errors", outcome }
}

fn not_collected() -> Part {
    Part {
        title: "Desktop app log",
        outcome: Outcome::LeftOut("the desktop app writes no log file".into()),
    }
}

const HEADER: &str = "Maiker diagnostics\n\
This file was made by Settings > Export logs so a problem can be looked into without access to your computer.\n\
\n\
It holds: versions, your system's name and version, whether the Maiker service answers, the names of your remote\n\
machines, the end of the service's log, and its recent warnings and errors.\n\
It does not hold: chats, conversations, prompts, tool output, file contents, session files, settings,\n\
environment variables, passwords, tokens, API keys or SSH keys.\n\
\n\
Removed from the text before it was saved: your home folder and user names in paths (shown as ~ or [user]),\n\
this computer's name ([this-computer]), IP addresses ([ip]), host names ([host]), values next to names such as\n\
token, password, secret, key or authorization, bearer tokens, web addresses' sign-in parts, private key blocks,\n\
and long keys in the shape of common services. This is automatic and not perfect: read it before you send it.\n\
A part that could not be cleaned safely is left out, and its section says why.";

fn render(parts: &[Part]) -> String {
    let mut text = String::from(HEADER);
    for part in parts {
        let body = match &part.outcome {
            Outcome::Included(body) => body.clone(),
            Outcome::LeftOut(why) => format!("(left out: {why})"),
        };
        text.push_str(&format!("\n\n===== {} =====\n{body}", part.title));
    }
    text.push('\n');
    text
}

fn summary_of(facts: &Facts, parts: &[Part]) -> String {
    let service = facts.service_version.as_deref().unwrap_or("unknown");
    let problems = parts
        .iter()
        .find(|p| p.title == "Recent warnings and errors")
        .and_then(|p| match &p.outcome {
            Outcome::Included(text) => Some(text.lines().count()),
            Outcome::LeftOut(_) => None,
        });
    let problems = problems.map_or_else(|| "warnings: not collected".to_string(), |n| format!("recent warnings and errors: {n}"));
    format!(
        "Maiker app {} | service {service} | {} | protocol {} (since {}) | {} | {problems}",
        facts.app_version,
        facts.reach,
        maitty_shared::protocol::PROTOCOL_VERSION,
        maitty_shared::protocol::COMPATIBLE_SINCE,
        facts.system,
    )
}

/// Builds the bundle for `facts` from the log in `data_dir`.
pub fn build(facts: &Facts, data_dir: &Path, context: &Context) -> Preview {
    let parts = vec![
        facts_part(facts),
        machines_part(&facts.machines, context),
        log_part(data_dir, context),
        problems_part(data_dir, context),
        not_collected(),
    ];
    Preview {
        summary: summary_of(facts, &parts),
        text: render(&parts),
        parts: parts
            .iter()
            .map(|part| {
                let (included, note) = note_of(part);
                PreviewPart { title: part.title, included, note }
            })
            .collect(),
    }
}

fn reach_words(reach: &ServiceReach) -> String {
    match reach {
        ServiceReach::Answering => "running and answering".into(),
        ServiceReach::OtherProtocol(version) => format!("running, speaks protocol {version} which this app does not"),
        ServiceReach::NotAnswering => "not answering".into(),
    }
}

fn system_words() -> String {
    let os = sysinfo::System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_string());
    let kernel = sysinfo::System::kernel_version().unwrap_or_else(|| "unknown".into());
    format!("{os}, kernel {kernel}, {}", std::env::consts::ARCH)
}

fn context_here() -> Context {
    Context {
        home: home_folder(),
        host: sysinfo::System::host_name(),
    }
}

fn home_folder() -> Option<String> {
    std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok()
}

/// Reads what is there and builds the bundle for the window to preview. It asks the service nothing
/// beyond whether it takes a connection, and gives up on that after a few seconds.
#[tauri::command]
pub async fn prepare_diagnostics(app: tauri::AppHandle, machines: tauri::State<'_, crate::machines::Machines>) -> Result<Preview, String> {
    let reach = tokio::time::timeout(REACH_WAIT, maitty_desktop_client::service_reach())
        .await
        .map_or_else(|_| "not answering (no reply in 3 seconds)".to_string(), |reach| reach_words(&reach));
    let service = maitty_desktop_client::service_facts();
    let facts = Facts {
        app_version: app.package_info().version.to_string(),
        service_version: service.as_ref().map(|s| s.version.clone()).filter(|v| !v.is_empty()),
        sessions: service.as_ref().map(|s| s.sessions),
        reach,
        system: system_words(),
        machines: machines.0.machines.iter().map(|m| m.name.clone()).collect(),
    };
    let preview = tauri::async_runtime::spawn_blocking(move || build(&facts, &maitty_desktop_client::data_dir(), &context_here()))
        .await
        .map_err(|error| error.to_string())?;
    *PREPARED.lock().map_err(|_| "the prepared export is unavailable".to_string())? = Some(preview.text.clone());
    Ok(preview)
}

/// Asks where to save the bundle last prepared, in the system's save dialog, and writes it there.
/// Gives the place it went, or `None` when the person closed the dialog.
#[tauri::command]
pub async fn save_diagnostics(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let text = PREPARED
        .lock()
        .map_err(|_| "the prepared export is unavailable".to_string())?
        .clone()
        .ok_or("Prepare the export first.")?;
    let start = app.path().download_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_file_name(FILE_NAME).add_filter("Text", &["txt"]);
        if let Some(start) = start {
            dialog = dialog.set_directory(start);
        }
        let Some(chosen) = dialog.blocking_save_file() else { return Ok(None) };
        let path = chosen.into_path().map_err(|error| format!("That place cannot be saved to: {error}"))?;
        let path = if path.extension().is_some() { path } else { path.with_extension("txt") };
        std::fs::write(&path, text).map_err(|error| format!("Could not save the file: {error}"))?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests;
