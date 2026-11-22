//! Installing a coding agent on this computer from the window. What runs is each agent's own
//! documented install command, picked from a table in this file: the window sends an agent's name
//! and nothing else, so no text from the window ever reaches a command line. Every command is on
//! the allowlist below (an https address on a fixed host, or a fixed npm package), runs as the
//! person who runs the app and never elevated, is shown to the person before it runs
//! (`agent_install_command`), and has its output streamed to the window while it runs.
//! See docs/SECURITY.md, "Installing an agent from the desktop".

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::Emitter;

/// What the window hears while an install runs.
const PROGRESS_EVENT: &str = "install-progress";
/// Longest an install may run before it is stopped.
const INSTALL_LIMIT: Duration = Duration::from_secs(10 * 60);
/// Longest `<agent> --version` may take.
const VERSION_LIMIT: Duration = Duration::from_secs(2);
const POLL: Duration = Duration::from_millis(20);
const LINE_WAIT: Duration = Duration::from_millis(250);
const MOST_LINE_CHARS: usize = 400;
/// How many of the last lines are kept to say why an install failed.
const KEPT_LINES: usize = 12;
const PERCENT_MAX: f32 = 100.0;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Hosts an install script may be fetched from. Anything else is refused whatever the table says.
const SCRIPT_HOSTS: &[&str] = &["claude.ai", "chatgpt.com", "opencode.ai"];
/// npm packages an install may fetch.
const NPM_PACKAGES: &[&str] = &["@google/gemini-cli", "@opencode/cli@latest"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Agent {
    Claude,
    Codex,
    Gemini,
    OpenCode,
}

impl Agent {
    const ALL: [Agent; 4] = [Agent::Claude, Agent::Codex, Agent::Gemini, Agent::OpenCode];

    fn parse(id: &str) -> Option<Agent> {
        Agent::ALL.into_iter().find(|agent| agent.id() == id)
    }

    /// The name the window uses, which is also the program the agent installs.
    fn id(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
            Agent::Gemini => "gemini",
            Agent::OpenCode => "opencode",
        }
    }
}

/// What is run: built only from constants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Plan {
    /// `curl -fsSL <url> | <shell>`, as two programs joined by a pipe (no shell line is built).
    UnixScript { url: &'static str, shell: &'static str },
    /// `irm <url> | iex` in Windows PowerShell.
    PowerShellScript { url: &'static str },
    /// `npm install -g <package>`.
    Npm { package: &'static str },
}

/// Each agent's own documented install, per system:
/// Claude Code https://code.claude.com/docs/en/setup, Codex https://github.com/openai/codex,
/// Gemini CLI https://github.com/google-gemini/gemini-cli, OpenCode https://opencode.ai/docs/
fn plan_for(agent: Agent, windows: bool) -> Plan {
    match (agent, windows) {
        (Agent::Claude, false) => Plan::UnixScript { url: "https://claude.ai/install.sh", shell: "bash" },
        (Agent::Claude, true) => Plan::PowerShellScript { url: "https://claude.ai/install.ps1" },
        (Agent::Codex, false) => Plan::UnixScript { url: "https://chatgpt.com/codex/install.sh", shell: "sh" },
        (Agent::Codex, true) => Plan::PowerShellScript { url: "https://chatgpt.com/codex/install.ps1" },
        (Agent::Gemini, _) => Plan::Npm { package: "@google/gemini-cli" },
        (Agent::OpenCode, false) => Plan::UnixScript { url: "https://opencode.ai/v2/install", shell: "bash" },
        (Agent::OpenCode, true) => Plan::Npm { package: "@opencode/cli@latest" },
    }
}

/// Whether `url` is `https://<allowed host>/<path>` with no credentials, port, query or fragment.
fn script_url_allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    SCRIPT_HOSTS.contains(&host)
        && !path.is_empty()
        && !path.contains(['?', '#', '@', ' '])
        && url.chars().all(|c| c.is_ascii_graphic())
}

fn allowed(plan: Plan) -> bool {
    match plan {
        Plan::UnixScript { url, shell } => script_url_allowed(url) && matches!(shell, "bash" | "sh"),
        Plan::PowerShellScript { url } => script_url_allowed(url),
        Plan::Npm { package } => NPM_PACKAGES.contains(&package),
    }
}

/// The command as the person is shown it and as the vendor documents it.
fn display(plan: Plan) -> String {
    match plan {
        Plan::UnixScript { url, shell } => format!("curl -fsSL {url} | {shell}"),
        Plan::PowerShellScript { url } => format!("irm {url} | iex"),
        Plan::Npm { package } => format!("npm install -g {package}"),
    }
}

/// The command an agent's install will run on this computer, to show before it runs.
#[tauri::command]
pub fn agent_install_command(agent: String) -> Result<String, String> {
    let agent = Agent::parse(&agent).ok_or_else(|| "That is not an agent Maiker can install.".to_string())?;
    Ok(display(plan_for(agent, cfg!(windows))))
}

/// What an install came to. `version` is null when it finished but the program was not found
/// afterwards (often a folder not on this app's PATH yet: a new terminal will see it).
#[derive(Debug, serde::Serialize, PartialEq, Eq)]
pub struct Installed {
    pub version: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct Progress {
    agent: String,
    percent: Option<u8>,
    line: String,
}

/// One install at a time: two would fight over the same folders.
static INSTALLING: AtomicBool = AtomicBool::new(false);

struct Busy;

impl Busy {
    fn take() -> Option<Busy> {
        INSTALLING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Busy)
    }
}

impl Drop for Busy {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::Release);
    }
}

/// Install `agent` with its documented command, streaming its output as `install-progress`, then
/// ask the program for its version. Runs off the UI thread. Rejects with the reason.
#[tauri::command]
pub async fn install_agent(app: tauri::AppHandle, agent: String) -> Result<Installed, String> {
    let agent = Agent::parse(&agent).ok_or_else(|| "That is not an agent Maiker can install.".to_string())?;
    let plan = plan_for(agent, cfg!(windows));
    if !allowed(plan) {
        return Err("That install is not on the list of installs Maiker may run.".to_string());
    }
    let busy = Busy::take().ok_or_else(|| "Another install is still running.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = busy;
        run_install(&app, agent, plan)?;
        Ok(Installed { version: detect_version(agent) })
    })
    .await
    .map_err(|error| format!("The install stopped unexpectedly: {error}"))?
}

/// The running pieces of an install and the lines they print.
struct Running {
    children: Vec<Child>,
    lines: mpsc::Receiver<String>,
}

fn base_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn not_started(program: &str, error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        return match program {
            "npm" | "npm.cmd" => "npm is needed for this install. Install Node.js from https://nodejs.org, then try again.".to_string(),
            other => format!("{other} was not found on this computer, and this install needs it."),
        };
    }
    format!("Could not start {program}: {error}")
}

fn start(plan: Plan) -> Result<Running, String> {
    let mut children = Vec::new();
    let result = match plan {
        Plan::UnixScript { url, shell } => start_script(url, shell, &mut children),
        Plan::PowerShellScript { url } => {
            let line = format!("irm {url} | iex");
            let mut command = base_command("powershell.exe");
            command.args(["-NoProfile", "-NonInteractive", "-Command", &line]);
            command.spawn().map(|child| children.push(child)).map_err(|error| not_started("powershell.exe", &error))
        }
        Plan::Npm { package } => {
            let program = if cfg!(windows) { "npm.cmd" } else { "npm" };
            let mut command = base_command(program);
            command.args(["install", "-g", package]);
            command.spawn().map(|child| children.push(child)).map_err(|error| not_started(program, &error))
        }
    };
    if let Err(why) = result {
        end_all(&mut children);
        return Err(why);
    }
    Ok(Running { lines: pump(&mut children), children })
}

/// `curl -fsSL url` with its body fed to `shell`'s standard input.
fn start_script(url: &str, shell: &str, children: &mut Vec<Child>) -> Result<(), String> {
    let mut curl = base_command("curl")
        .args(["-fsSL", url])
        .spawn()
        .map_err(|error| not_started("curl", &error))?;
    let body = curl.stdout.take();
    children.push(curl);
    let body = body.ok_or_else(|| "Could not read what curl downloaded.".to_string())?;
    let mut command = base_command(shell);
    command.stdin(Stdio::from(body));
    let shell = command.spawn().map_err(|error| not_started(shell, &error))?;
    children.push(shell);
    Ok(())
}

/// A thread per output pipe, each sending cleaned lines until its pipe closes; the receiver ends
/// when all of them have.
fn pump(children: &mut [Child]) -> mpsc::Receiver<String> {
    let (sender, lines) = mpsc::channel();
    for child in children {
        if let Some(out) = child.stdout.take() {
            read_lines(out, sender.clone());
        }
        if let Some(err) = child.stderr.take() {
            read_lines(err, sender.clone());
        }
    }
    lines
}

fn read_lines(mut pipe: impl Read + Send + 'static, sender: mpsc::Sender<String>) {
    std::thread::spawn(move || {
        let mut pending: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 4096];
        while let Ok(read) = pipe.read(&mut chunk) {
            if read == 0 {
                break;
            }
            for &byte in &chunk[..read] {
                if byte == b'\n' || byte == b'\r' {
                    if !send_line(&pending, &sender) {
                        return;
                    }
                    pending.clear();
                } else {
                    pending.push(byte);
                }
            }
        }
        send_line(&pending, &sender);
    });
}

/// Send a cleaned line unless it is blank; false when nobody is listening any more.
fn send_line(bytes: &[u8], sender: &mpsc::Sender<String>) -> bool {
    let text = maitty_shared::hidden::sanitize(&String::from_utf8_lossy(bytes), false);
    let text: String = text.trim().chars().take(MOST_LINE_CHARS).collect();
    text.is_empty() || sender.send(text).is_ok()
}

fn end_all(children: &mut [Child]) {
    for child in children.iter_mut() {
        if let Err(error) = child.kill() {
            tracing::debug!("an install process had already ended: {error}");
        }
        if let Err(error) = child.wait() {
            tracing::warn!("could not wait for an install process: {error}");
        }
    }
}

fn emit(app: &tauri::AppHandle, agent: Agent, line: String) {
    let progress = Progress { agent: agent.id().to_string(), percent: parse_percent(&line), line };
    if let Err(error) = app.emit(PROGRESS_EVENT, progress) {
        tracing::warn!("could not tell the window how the install is going: {error}");
    }
}

fn run_install(app: &tauri::AppHandle, agent: Agent, plan: Plan) -> Result<(), String> {
    emit(app, agent, format!("Running: {}", display(plan)));
    let Running { mut children, lines } = start(plan)?;
    let deadline = Instant::now() + INSTALL_LIMIT;
    let mut last: Vec<String> = Vec::new();
    loop {
        if Instant::now() >= deadline {
            end_all(&mut children);
            return Err("The install took too long and was stopped.".to_string());
        }
        match lines.recv_timeout(LINE_WAIT) {
            Ok(line) => {
                if last.len() == KEPT_LINES {
                    last.remove(0);
                }
                last.push(line.clone());
                emit(app, agent, line);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let mut failed = None;
    for child in &mut children {
        let status = child.wait().map_err(|error| format!("The install stopped unexpectedly: {error}"))?;
        if !status.success() && failed.is_none() {
            failed = Some(status.code());
        }
    }
    match failed {
        None => Ok(()),
        Some(code) => Err(failure_words(&last, code)),
    }
}

fn failure_words(last: &[String], code: Option<i32>) -> String {
    let said = last.iter().rev().find(|line| !line.is_empty());
    match (said, code) {
        (Some(line), _) => format!("The install did not finish: {line}"),
        (None, Some(code)) => format!("The install did not finish (exit code {code})."),
        (None, None) => "The install did not finish.".to_string(),
    }
}

/// The first number in `line` followed by `%`, from 0 to 100 (`45.2%` is 45), or none.
fn parse_percent(line: &str) -> Option<u8> {
    let at = line.find('%')?;
    let digits: String = line[..at]
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let value: f32 = digits.parse().ok()?;
    // Truncation is the intent: 45.9 is shown as 45, and the range was just checked.
    (0.0..=PERCENT_MAX).contains(&value).then_some(value as u8)
}

/// The folders an installer puts a program in that this app's PATH may not list yet.
fn extra_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    let mut dirs = Vec::new();
    if let Some(home) = home {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".opencode").join("bin"));
        dirs.push(home.join(".claude").join("local"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    dirs
}

fn program_files(name: &str) -> Vec<String> {
    if cfg!(windows) {
        ["exe", "cmd", "bat"].iter().map(|ext| format!("{name}.{ext}")).collect()
    } else {
        vec![name.to_string()]
    }
}

/// The program named `name` in the folders of PATH, then in `extra`.
fn find_program(name: &str, path: &std::ffi::OsStr, extra: &[PathBuf]) -> Option<PathBuf> {
    let files = program_files(name);
    std::env::split_paths(path)
        .chain(extra.iter().cloned())
        .find_map(|dir| files.iter().map(|file| dir.join(file)).find(|candidate| candidate.is_file()))
}

fn detect_version(agent: Agent) -> Option<String> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let program = find_program(agent.id(), &path, &extra_dirs())?;
    version_of(&program)
}

/// `<program> --version`, stopped after `VERSION_LIMIT`.
fn version_of(program: &Path) -> Option<String> {
    let mut command = base_command(&program.to_string_lossy());
    command.arg("--version").stderr(Stdio::null());
    let mut child = command.spawn().ok()?;
    let mut out = child.stdout.take()?;
    let deadline = Instant::now() + VERSION_LIMIT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) | Err(_) => return None,
            Ok(None) if Instant::now() >= deadline => {
                end_all(std::slice::from_mut(&mut child));
                return None;
            }
            Ok(None) => std::thread::sleep(POLL),
        }
    }
    let mut text = String::new();
    out.read_to_string(&mut text).ok()?;
    parse_version(&text)
}

/// The first version-looking word of the first line: `2.1.211 (Claude Code)` and
/// `codex-cli 0.170.0` give `2.1.211` and `0.170.0`.
fn parse_version(text: &str) -> Option<String> {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    let line = maitty_shared::hidden::sanitize(line, false);
    line.split_whitespace().find_map(|word| {
        let word = word.trim_matches(|c: char| !c.is_ascii_alphanumeric()).trim_start_matches('v');
        let looks = word.starts_with(|c: char| c.is_ascii_digit())
            && word.contains('.')
            && word.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'));
        looks.then(|| word.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_agent_on_every_system_runs_something_on_the_allowlist() {
        for agent in Agent::ALL {
            for windows in [false, true] {
                let plan = plan_for(agent, windows);
                assert!(allowed(plan), "{agent:?} windows={windows}: {plan:?}");
            }
        }
    }

    #[test]
    fn a_script_from_an_unlisted_host_or_in_another_shape_is_refused() {
        for url in [
            "http://claude.ai/install.sh",
            "https://evil.example/install.sh",
            "https://claude.ai.evil.example/install.sh",
            "https://claude.ai@evil.example/install.sh",
            "https://claude.ai:8443/install.sh",
            "https://claude.ai/install.sh?x=1",
            "https://claude.ai/install.sh#x",
            "https://claude.ai/",
            "https://claude.ai",
            "https://claude.ai/in stall",
        ] {
            assert!(!script_url_allowed(url), "{url}");
        }
        assert!(script_url_allowed("https://chatgpt.com/codex/install.sh"));
        assert!(!allowed(Plan::UnixScript { url: "https://claude.ai/install.sh", shell: "zsh -c x" }));
        assert!(!allowed(Plan::Npm { package: "left-pad" }));
    }

    #[test]
    fn the_agents_are_the_four_the_app_installs_and_nothing_else_parses() {
        let ids: Vec<_> = Agent::ALL.iter().map(|agent| agent.id()).collect();
        assert_eq!(ids, ["claude", "codex", "gemini", "opencode"]);
        for bad in ["copilot", "", "claude; rm -rf ~", "../claude", "CLAUDE"] {
            assert_eq!(Agent::parse(bad), None, "{bad:?}");
        }
        assert!(agent_install_command("copilot".into()).is_err());
    }

    #[test]
    fn the_command_shown_is_the_one_the_vendor_documents() {
        assert_eq!(display(plan_for(Agent::Claude, false)), "curl -fsSL https://claude.ai/install.sh | bash");
        assert_eq!(display(plan_for(Agent::Claude, true)), "irm https://claude.ai/install.ps1 | iex");
        assert_eq!(display(plan_for(Agent::Codex, false)), "curl -fsSL https://chatgpt.com/codex/install.sh | sh");
        assert_eq!(display(plan_for(Agent::Gemini, true)), "npm install -g @google/gemini-cli");
        assert_eq!(display(plan_for(Agent::OpenCode, false)), "curl -fsSL https://opencode.ai/v2/install | bash");
        assert_eq!(display(plan_for(Agent::OpenCode, true)), "npm install -g @opencode/cli@latest");
    }

    #[test]
    fn a_percent_is_read_from_a_progress_line_and_anything_else_is_not() {
        assert_eq!(parse_percent("  45%  downloading"), Some(45));
        assert_eq!(parse_percent("Downloading... 45.9%"), Some(45));
        assert_eq!(parse_percent("100%"), Some(100));
        assert_eq!(parse_percent("101%"), None);
        assert_eq!(parse_percent("100% of 4 MB"), Some(100));
        assert_eq!(parse_percent("no number %"), None);
        assert_eq!(parse_percent("installing"), None);
    }

    #[test]
    fn the_version_is_the_first_version_looking_word() {
        assert_eq!(parse_version("2.1.211 (Claude Code)\n"), Some("2.1.211".into()));
        assert_eq!(parse_version("codex-cli 0.170.0\n"), Some("0.170.0".into()));
        assert_eq!(parse_version("\n v0.20.1\nmore"), Some("0.20.1".into()));
        assert_eq!(parse_version("1.0.0-beta.2"), Some("1.0.0-beta.2".into()));
        assert_eq!(parse_version("command not found"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn a_program_is_found_in_the_path_or_in_the_extra_folders() {
        let dir = std::env::temp_dir().join(format!("agent-install-find-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = program_files("fake-agent").remove(0);
        std::fs::write(dir.join(&file), "").unwrap();
        let empty = std::ffi::OsString::new();
        assert_eq!(find_program("fake-agent", &empty, std::slice::from_ref(&dir)), Some(dir.join(&file)));
        assert_eq!(find_program("fake-agent", dir.as_os_str(), &[]), Some(dir.join(&file)));
        assert_eq!(find_program("fake-agent", &empty, &[]), None);
    }

    #[test]
    fn lines_split_on_returns_too_so_a_progress_bar_arrives_as_lines() {
        let (sender, lines) = mpsc::channel();
        read_lines(std::io::Cursor::new(b"10%\r20%\rdone\n\n".to_vec()), sender);
        let got: Vec<String> = lines.iter().collect();
        assert_eq!(got, ["10%", "20%", "done"]);
    }

    #[test]
    fn only_one_install_runs_at_a_time() {
        let first = Busy::take();
        assert!(first.is_some());
        assert!(Busy::take().is_none());
        drop(first);
        assert!(Busy::take().is_some());
    }
}
