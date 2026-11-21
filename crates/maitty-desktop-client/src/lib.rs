use maitty_shared::conversation::{ApprovalPolicy, LaunchSettings, Provider, Sandbox, StartTarget};
mod host_env;
mod ipc;
mod shared_daemon;
use anyhow::{Context, Result, bail};
pub use host_env::host_command;
pub use ipc::data_dir;
pub use shared_daemon::{ensure_shared_daemon, shared_daemon_path};
use maitty_shared::protocol::{COMPATIBLE_SINCE, ClientMsg, Command, Query, Reply, ServerMsg};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

/// The most one keystroke message may carry.
pub const MAX_TERMINAL_INPUT_BYTES: usize = 16 * 1024;
/// The longest message the daemon is asked to hold for a starting agent.
pub const MAX_HELD_MESSAGE_BYTES: usize = 256 * 1024;
const APP_COMMAND: &str = env!("APP_COMMAND");
const APP_NAME: &str = env!("APP_NAME");

/// What the window may ask a pane's daemon to do, whichever machine the pane is on. One place
/// makes each message, so this computer's panes and another machine's are asked the same way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PaneCommand {
    Input(Vec<u8>),
    WantReplay,
    Resize { cols: u16, rows: u16 },
    Rename(String),
    /// A message for the agent starting in the pane, held by its daemon until the agent takes input.
    SendWhenReady(String),
    /// A message for the agent working in the pane, held by its daemon until the turn is over;
    /// `first` puts it ahead of the ones already waiting.
    Queue { text: String, first: bool },
    /// Takes back the queued message at `index`, while it still reads `text`.
    DropQueued { index: u32, text: String },
    Pin(bool),
    Archive(bool),
    /// Out of the way until a time (unix seconds), or awake again (`None`).
    Snooze(Option<u64>),
    Seen,
    /// Restart an agent in place so it loads hooks it missed.
    Reload,
    Close,
    /// End the session after an undo window; `UndoClose` inside it brings the session back.
    CloseSession,
    UndoClose,
    /// The person's answer to a session that asked to start helpers.
    AnswerHelpers(maitty_shared::protocol::HelperChoice),
    /// Run the pane's check `name` again (None: all of them).
    RerunCheck { name: Option<String> },
    /// Accept a failed check as it is (None: the headline one), for the reason given (it may be empty).
    OverrideCheck { name: Option<String>, reason: String },
    /// Take an override back: the check reads as failed again.
    UndoOverride { name: Option<String> },
    /// The person's answer to a repo-supplied check command, as shown (`command` is hashed here, so the
    /// daemon refuses the answer if a different command waits by then).
    ApproveCheck {
        name: String,
        choice: maitty_shared::protocol::ApprovalChoice,
        command: String,
    },
}

impl PaneCommand {
    /// The message that asks `term`'s daemon.
    pub fn message(self, term: u32) -> ClientMsg {
        match self {
            PaneCommand::Input(data) => ClientMsg::Input { term, data },
            PaneCommand::WantReplay => ClientMsg::WantReplay { term },
            PaneCommand::Resize { cols, rows } => {
                ClientMsg::Command(Command::TerminalResize { term, cols, rows })
            }
            PaneCommand::Rename(name) => ClientMsg::Command(Command::RenamePane { term, name }),
            PaneCommand::SendWhenReady(text) => {
                ClientMsg::Command(Command::SendWhenReady { term, text, operation: None })
            }
            PaneCommand::Queue { text, first } => {
                ClientMsg::Command(Command::QueueFollowUp { term, text, first, operation: None })
            }
            PaneCommand::DropQueued { index, text } => {
                ClientMsg::Command(Command::DropQueued { term, index, text })
            }
            PaneCommand::Pin(pinned) => ClientMsg::Command(Command::PinPane { term, pinned }),
            PaneCommand::Archive(archived) => {
                ClientMsg::Command(Command::ArchivePane { term, archived })
            }
            PaneCommand::Snooze(until) => ClientMsg::Command(Command::SnoozePane { term, until }),
            PaneCommand::Seen => ClientMsg::Command(Command::MarkSeen { term }),
            PaneCommand::Reload => ClientMsg::Command(Command::ReloadAgent { term }),
            PaneCommand::Close => ClientMsg::Command(Command::ClosePane { term }),
            PaneCommand::CloseSession => ClientMsg::Command(Command::CloseSession { term }),
            PaneCommand::UndoClose => ClientMsg::Command(Command::UndoClose { term }),
            PaneCommand::AnswerHelpers(choice) => {
                ClientMsg::Command(Command::AnswerHelpers { term, choice })
            }
            PaneCommand::RerunCheck { name } => ClientMsg::Command(Command::RerunCheck { term, name }),
            PaneCommand::OverrideCheck { name, reason } => {
                ClientMsg::Command(Command::OverrideCheck { term, name, reason })
            }
            PaneCommand::UndoOverride { name } => {
                ClientMsg::Command(Command::UndoOverride { term, name })
            }
            PaneCommand::ApproveCheck { name, choice, command } => {
                ClientMsg::Command(Command::ApproveCheck {
                    term,
                    name,
                    choice,
                    command_sha256: maitty_shared::protocol::command_hash(&command),
                })
            }
        }
    }
}

pub async fn list_sessions(daemon_executable: PathBuf) -> Result<Value> {
    let reply = request(ClientMsg::Query(Query::List), daemon_executable).await?;
    match reply {
        Reply::List(snapshot) => Ok(serde_json::to_value(snapshot)?),
        _ => bail!("The Maiker service gave an answer this app does not understand (session list). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Report whether a local daemon speaks an older protocol and can be replaced by this build.
pub async fn daemon_restart_status() -> Result<Value> {
    let daemon_protocol = match ipc::open_for_user().await {
        Err(error) => ipc::other_version(&error)
            .ok_or_else(|| error.context("Could not ask the Maiker service which version it is"))?,
        Ok((reader, writer)) => {
            drop((reader, writer));
            bail!("the local {APP_NAME} service is already compatible with this GUI")
        }
    };
    let activity = read_activity();
    let session_count = activity
        .as_ref()
        .map_or_else(saved_agent_count, |activity| activity.sessions);
    Ok(json!({
        "daemonProtocol": daemon_protocol,
        "guiProtocol": maitty_shared::protocol::PROTOCOL_VERSION,
        "canRestart": can_restart_mismatched_daemon(
            daemon_protocol,
            activity.as_ref(),
            session_file().is_file(),
        ),
        "sessionCount": session_count,
        "activeTurnCount": activity.as_ref().map(Activity::busy),
    }))
}

/// An older daemon may be replaced when its sessions are saved on disk (the next daemon
/// restores them) or when it provably has none. One that owns sessions it isn't saving
/// would lose them, so it is left running.
fn can_restart_mismatched_daemon(
    daemon_protocol: u32,
    activity: Option<&Activity>,
    sessions_saved: bool,
) -> bool {
    daemon_protocol < maitty_shared::protocol::PROTOCOL_VERSION
        && sessions_survive_restart(activity, sessions_saved)
}

/// Whether stopping the daemon loses nothing: its sessions are saved on disk, or it has none.
fn sessions_survive_restart(activity: Option<&Activity>, sessions_saved: bool) -> bool {
    sessions_saved || activity.is_some_and(|activity| activity.sessions == 0)
}

/// Whether the local daemon runs an older release than this app though the two still talk to each
/// other. Such a daemon is never replaced unasked (it may hold running sessions), so the window
/// says so and offers the restart.
pub fn daemon_update_status(app_version: &str) -> Value {
    update_status(
        read_activity().as_ref(),
        app_version,
        session_file().is_file(),
    )
}

fn update_status(activity: Option<&Activity>, app_version: &str, sessions_saved: bool) -> Value {
    let behind = activity.is_some_and(|a| shared_daemon::is_older(&a.version, app_version));
    json!({
        "daemonVersion": activity.map(|a| a.version.as_str()).filter(|_| behind),
        "behind": behind,
        "canRestart": behind && sessions_survive_restart(activity, sessions_saved),
        "sessionCount": activity.map_or(0, |a| a.sessions),
        "activeTurnCount": activity.map(Activity::busy),
    })
}

fn validate_restart_activity(activity: Option<&Activity>, sessions_saved: bool) -> Result<()> {
    if sessions_survive_restart(activity, sessions_saved) {
        return Ok(());
    }
    match activity {
        Some(activity) => bail!(
            "the older Maiker service owns {} sessions but isn't saving them, so a restart would lose them; it was left running",
            activity.sessions
        ),
        None => bail!(
            "couldn't verify that the older Maiker service's sessions are saved; it was left running"
        ),
    }
}

#[derive(serde::Deserialize)]
struct Activity {
    pid: u32,
    /// Empty for a daemon from before it published its version.
    #[serde(default)]
    version: String,
    sessions: usize,
    working: usize,
    waiting: usize,
}

impl Activity {
    fn busy(&self) -> usize {
        self.working + self.waiting
    }
}

fn read_activity() -> Option<Activity> {
    let pid_path = ipc::pid_file();
    let activity_path = pid_path.with_extension("activity");
    let activity: Activity = serde_json::from_slice(&std::fs::read(activity_path).ok()?).ok()?;
    let pid = std::fs::read_to_string(pid_path)
        .ok()?
        .trim()
        .parse::<u32>()
        .ok()?;
    (activity.pid == pid).then_some(activity)
}

/// Where the daemon keeps this socket's saved sessions, which the next daemon restores.
fn session_file() -> PathBuf {
    let label = maitty_shared::brand::env_var("SOCKET").unwrap_or_else(|_| "default".into());
    ipc::data_dir().join(format!("session-{label}.json"))
}

fn saved_agent_count() -> usize {
    let Ok(saved) = std::fs::read(session_file()) else {
        return 0;
    };
    let Ok(saved) = serde_json::from_slice::<Value>(&saved) else {
        return 0;
    };
    saved
        .get("workspaces")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|workspace| workspace.get("tabs").and_then(Value::as_array))
        .flatten()
        .filter_map(|tab| tab.get("panes").and_then(Value::as_object))
        .flat_map(|panes| panes.values())
        .filter(|pane| pane.get("agent").is_some_and(|agent| !agent.is_null()))
        .count()
}

/// The process the pid file names as this socket's daemon.
fn daemon_pid() -> Option<u32> {
    std::fs::read_to_string(ipc::pid_file())
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
}

/// Stops the daemon the pid file names, and says which process that was.
fn stop_mismatched_daemon() -> Result<u32> {
    let pid = daemon_pid()
        .filter(|pid| is_app_daemon(*pid))
        .ok_or_else(|| {
            anyhow::anyhow!("couldn't identify the local {APP_NAME} ({APP_COMMAND}) daemon process")
        })?;
    let mut command = if cfg!(windows) {
        let mut command = std::process::Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/F"]);
        command
    } else {
        let mut command = std::process::Command::new("kill");
        command.arg(pid.to_string());
        command
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let status = command
        .status()
        .context("stopping the old daemon process")?;
    anyhow::ensure!(
        status.success(),
        "couldn't stop the old daemon process {pid}"
    );
    Ok(pid)
}

fn is_app_daemon(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    {
        std::fs::read(format!("/proc/{pid}/cmdline"))
            .is_ok_and(|command_line| is_daemon_command_line(&command_line))
    }
    #[cfg(not(target_os = "linux"))]
    {
        // Another program that took the number when the daemon died must never be stopped.
        let (program, first) = process_command(pid);
        is_daemon_invocation(&program, first.as_deref())
    }
}

/// A process's program and first argument, as bytes; empty when it cannot be read.
#[cfg(not(target_os = "linux"))]
fn process_command(pid: u32) -> (Vec<u8>, Option<Vec<u8>>) {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
    let Some(process) = system.process(pid) else {
        return (Vec::new(), None);
    };
    let command = process.cmd();
    (
        command.first().map(|program| program.as_encoded_bytes().to_vec()).unwrap_or_default(),
        command.get(1).map(|argument| argument.as_encoded_bytes().to_vec()),
    )
}

/// Whether a process's NUL-separated command line is this product's daemon: the terminal app's
/// program, or the copy the desktop app bundles (named `DAEMON_NAME` or a name it had before, and
/// with the target triple when it runs from a development build), started with `daemon`.
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
fn is_daemon_command_line(command_line: &[u8]) -> bool {
    let mut args = command_line.split(|byte| *byte == 0);
    let program = args.next().unwrap_or_default();
    is_daemon_invocation(program, args.next())
}

const EXE_SUFFIX: &[u8] = b".exe";

/// Whether a program (a path or a bare name) started with this first argument is this product's
/// daemon. One rule for stopping a daemon and for listing them.
pub fn is_daemon_invocation(program: &[u8], first_argument: Option<&[u8]>) -> bool {
    let file = program
        .rsplit(|byte| matches!(byte, b'/' | b'\\'))
        .next()
        .unwrap_or_default();
    // Windows names the program with its extension.
    let name = match file.len().checked_sub(EXE_SUFFIX.len()) {
        Some(stem) if file[stem..].eq_ignore_ascii_case(EXE_SUFFIX) => &file[..stem],
        _ => file,
    };
    let bundled = |bundled: &str| {
        name == bundled.as_bytes()
            || name
                .strip_prefix(bundled.as_bytes())
                .is_some_and(|rest| rest.starts_with(b"-"))
    };
    (name == APP_COMMAND.as_bytes()
        || std::iter::once(maitty_shared::brand::DAEMON_NAME)
            .chain(maitty_shared::brand::previous_daemon_names())
            .any(bundled))
        && first_argument == Some(b"daemon".as_slice())
}

/// Stop only the exact older local daemon the user confirmed replacing.
pub async fn restart_mismatched_daemon(expected_protocol: u32) -> Result<()> {
    let daemon_protocol = match ipc::open_for_user().await {
        Err(error) => ipc::other_version(&error)
            .ok_or_else(|| error.context("Could not ask the Maiker service which version it is"))?,
        Ok((reader, writer)) => {
            drop((reader, writer));
            bail!("the local {APP_NAME} service is already compatible with this GUI")
        }
    };
    validate_restart_confirmation(daemon_protocol, expected_protocol)?;
    stop_local_daemon().await
}

/// Stop the exact older release the user confirmed replacing. It must still be the version the
/// prompt named and still older than this app, so a daemon another window already replaced is
/// never stopped by a stale prompt.
pub async fn restart_stale_daemon(app_version: &str, expected_version: &str) -> Result<()> {
    let activity = read_activity();
    let running = activity.as_ref().map_or("", |a| a.version.as_str());
    anyhow::ensure!(
        running == expected_version && shared_daemon::is_older(running, app_version),
        "the local {APP_NAME} service changed since the restart prompt opened"
    );
    stop_local_daemon().await
}

/// Stop the local daemon, after checking that its sessions are saved or that it has none, and
/// wait until it lets go of the socket.
async fn stop_local_daemon() -> Result<()> {
    validate_restart_activity(read_activity().as_ref(), session_file().is_file())?;
    let stopped = tokio::task::spawn_blocking(stop_mismatched_daemon)
        .await
        .context(format!("waiting for the local {APP_NAME} service to stop"))??;
    for _ in 0..50 {
        let listening = ipc::is_running().await;
        let named = daemon_pid();
        if stopped_daemon_is_gone(stopped, listening, named) {
            // A daemon that already took over wrote its own pid file: only the stopped one's goes.
            if named == Some(stopped) {
                ipc::remove_pid_file();
            }
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    bail!(
        "the old {APP_NAME} service (process {stopped}) did not stop within 5 seconds, so it still holds the local service socket"
    )
}

/// Whether the stopped daemon let go of the socket. Something listening is not proof that it
/// has not: this app's own connections start the next daemon the moment the old one drops, and
/// only one daemon holds a socket, so a pid file naming another process means the old one is gone.
fn stopped_daemon_is_gone(stopped: u32, listening: bool, named: Option<u32>) -> bool {
    !listening || named.is_some_and(|pid| pid != stopped)
}

fn validate_restart_confirmation(daemon_protocol: u32, expected_protocol: u32) -> Result<()> {
    anyhow::ensure!(
        daemon_protocol == expected_protocol,
        "the local {APP_NAME} service changed since the restart prompt opened"
    );
    anyhow::ensure!(
        daemon_protocol < maitty_shared::protocol::PROTOCOL_VERSION,
        "the local {APP_NAME} service is newer than this GUI; update the GUI before reconnecting"
    );
    Ok(())
}

pub async fn read_conversation(
    id: u64,
    cursor: Option<Value>,
    limit: usize,
    daemon: impl Into<Daemon>,
) -> Result<Value> {
    let cursor = cursor
        .map(serde_json::from_value)
        .transpose()
        .context("invalid conversation history cursor")?;
    let reply = request(
        ClientMsg::Query(Query::ConversationRead {
            id: maitty_shared::conversation::ConversationId(id),
            cursor,
            limit,
        }),
        daemon,
    )
    .await?;
    match reply {
        Reply::ConversationRead(history) => Ok(serde_json::to_value(history)?),
        _ => bail!("The Maiker service gave an answer this app does not understand (conversation history). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// The longest helper id the window may ask about; the daemon checks it again.
const HELPER_ID_MAX: usize = 128;

/// What one of a pane's helpers did, from its own record (ADR 0010), as JSON for the window.
pub async fn read_helper(term: u32, helper: String, daemon: impl Into<Daemon>) -> Result<Value> {
    if helper.is_empty()
        || helper.len() > HELPER_ID_MAX
        || !helper.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        bail!("invalid helper id");
    }
    match request(ClientMsg::Query(Query::HelperRead { term, helper }), daemon).await? {
        Reply::HelperRead(record) => Ok(serde_json::to_value(record)?),
        _ => bail!("The Maiker service gave an answer this app does not understand (helper). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// The Claude Code and Codex agent files of a pane's project and its user's home, read-only (ADR
/// 0010), as JSON for the window.
pub async fn read_specialists(term: u32, daemon: impl Into<Daemon>) -> Result<Value> {
    match request(ClientMsg::Query(Query::Specialists { term }), daemon).await? {
        Reply::Specialists(list) => Ok(serde_json::to_value(list)?),
        _ => bail!("The Maiker service gave an answer this app does not understand (specialists). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn conversation_diff(
    id: u64,
    generation: u64,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Query(Query::ConversationDiff {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::ConversationDiff(diff) => Ok(serde_json::to_value(diff)?),
        _ => bail!("The Maiker service gave an answer this app does not understand (conversation diff). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn conversation_files(
    id: u64,
    generation: u64,
    path: Option<String>,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Query(Query::ConversationFiles {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
            path,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::ConversationFiles(entries) => Ok(serde_json::to_value(entries)?),
        _ => bail!("The Maiker service gave an answer this app does not understand (project file listing). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn conversation_file(
    id: u64,
    generation: u64,
    path: String,
    daemon_executable: PathBuf,
) -> Result<String> {
    let reply = request(
        ClientMsg::Query(Query::ConversationFileRead {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
            path,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::ConversationFile(content) => Ok(content),
        _ => bail!("The Maiker service gave an answer this app does not understand (project file). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn terminal_screen(
    id: u64,
    generation: u64,
    daemon_executable: PathBuf,
) -> Result<String> {
    let reply = request(
        ClientMsg::Query(Query::ConversationTerminalScreen {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Text(screen) => Ok(screen),
        _ => bail!("The Maiker service gave an answer this app does not understand (terminal screen). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn terminal_replay(
    id: u64,
    generation: u64,
    daemon_executable: PathBuf,
) -> Result<Vec<u8>> {
    let reply = request(
        ClientMsg::Query(Query::ConversationTerminalReplay {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::TerminalReplay(replay) => Ok(replay),
        _ => bail!("The Maiker service gave an answer this app does not understand (terminal replay). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn send_terminal_input(
    id: u64,
    generation: u64,
    data: Vec<u8>,
    daemon_executable: PathBuf,
) -> Result<String> {
    anyhow::ensure!(
        !data.is_empty() && data.len() <= MAX_TERMINAL_INPUT_BYTES,
        "Terminal input must contain between 1 and {MAX_TERMINAL_INPUT_BYTES} bytes"
    );
    let (mut reader, mut writer) = ipc::open_or_spawn_for_user(&daemon_executable)
        .await
        .context("Could not reach the Maiker service")?;
    ipc::send_message(
        &mut writer,
        &ClientMsg::Command(Command::ConversationTerminalInput {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
            data,
        }),
    )
    .await?;
    match receive_reply(&mut reader).await? {
        Reply::Ok => {}
        _ => bail!("The Maiker service gave an answer this app does not understand (terminal input). Restart the service in Settings, or update the app so both are the same version."),
    }
    ipc::send_message(
        &mut writer,
        &ClientMsg::Query(Query::ConversationTerminalScreen {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
        }),
    )
    .await?;
    receive_reply(&mut reader)
        .await
        .and_then(|reply| match reply {
            Reply::Text(screen) => Ok(screen),
            _ => bail!("The Maiker service gave an answer this app does not understand (terminal screen). Restart the service in Settings, or update the app so both are the same version."),
        })
}

pub async fn resize_terminal(
    id: u64,
    generation: u64,
    cols: u16,
    rows: u16,
    daemon_executable: PathBuf,
) -> Result<()> {
    let reply = request(
        ClientMsg::Command(Command::ConversationTerminalResize {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
            cols,
            rows,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(()),
        _ => bail!("The Maiker service gave an answer this app does not understand (terminal resize). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// What the checkout has changed and not committed, as the handoff brief lists it. Git is run as a program
/// with fixed arguments, never through a shell. The branch's committed changes are not listed here, and the
/// brief says so.
fn uncommitted_changes(checkout: &std::path::Path) -> std::result::Result<maitty_shared::handoff::Changed, String> {
    let status = run_git(checkout, &["status", "--porcelain", "-z", "--untracked-files=all"])?;
    let mut files = maitty_shared::handoff::uncommitted(&status);
    files.sort();
    files.dedup();
    Ok(maitty_shared::handoff::Changed { files, committed_unknown: Some("only uncommitted files are listed here".into()) })
}

/// Runs git with fixed arguments in `dir`; its output, or the first line it complained with.
fn run_git(dir: &std::path::Path, args: &[&str]) -> std::result::Result<String, String> {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|error| format!("could not run git: {error}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).lines().next().unwrap_or("git failed").trim().to_string())
    }
}

/// The files that more than one of these checkouts (name, folder) changed since their branches parted. Git runs
/// off the caller's thread; a checkout git cannot read is left out.
pub async fn checkout_overlaps(checkouts: Vec<(String, PathBuf)>) -> Result<Vec<maitty_shared::overlap::Overlap>> {
    tokio::task::spawn_blocking(move || maitty_shared::overlap::between(&checkouts, &run_git))
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))
}

/// The text a new agent starts with when the work of the agent in pane `term` is handed to it: the task, the
/// branch, the uncommitted files and the end of the screen. This computer's panes only.
pub async fn handoff_brief(
    term: u32,
    agent: String,
    task: String,
    last_prompt: String,
    branch: Option<String>,
    checkout: PathBuf,
    daemon_executable: PathBuf,
) -> Result<String> {
    let screen = pane_terminal_screen(term, daemon_executable).await?;
    let folder = checkout.clone();
    let changed = tokio::task::spawn_blocking(move || uncommitted_changes(&folder))
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;
    Ok(maitty_shared::handoff::brief(
        &maitty_shared::handoff::Facts { pane: term, agent, task, last_prompt, branch, checkout, changed, screen },
        env!("APP_COMMAND"),
    ))
}

/// The visible screen of a terminal session, by its pane number.
pub async fn pane_terminal_screen(term: u32, daemon_executable: PathBuf) -> Result<String> {
    let reply = request(
        ClientMsg::Query(Query::TerminalScreen { term }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Text(screen) => Ok(screen),
        _ => bail!("The Maiker service gave an answer this app does not understand (terminal screen). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn pane_terminal_replay(term: u32, daemon_executable: PathBuf) -> Result<Vec<u8>> {
    let reply = request(
        ClientMsg::Query(Query::TerminalReplay { term }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::TerminalReplay(replay) => Ok(replay),
        _ => bail!("The Maiker service gave an answer this app does not understand (terminal replay). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn pane_terminal_resize(
    term: u32,
    cols: u16,
    rows: u16,
    daemon_executable: PathBuf,
) -> Result<()> {
    let reply = request(
        PaneCommand::Resize { cols, rows }.message(term),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(()),
        _ => bail!("The Maiker service gave an answer this app does not understand (terminal resize). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// A live stream of the terminal panes this app owns: each pane's replay, then its output as
/// it happens. Pushed by the daemon, so the window never polls (ADR 0004).
pub struct TerminalStream {
    reader: ipc::Reader,
}

impl TerminalStream {
    /// The next message, or `None` when the daemon closed the connection.
    pub async fn next(&mut self) -> Result<Option<maitty_shared::protocol::ServerMsg>> {
        ipc::receive_server(&mut self.reader).await
    }
}

/// The other half of the stream's connection: what the user types goes back over it.
pub struct TerminalInput {
    writer: ipc::Writer,
}

impl TerminalInput {
    pub async fn send(&mut self, term: u32, data: Vec<u8>) -> Result<()> {
        anyhow::ensure!(
            !data.is_empty() && data.len() <= MAX_TERMINAL_INPUT_BYTES,
            "Terminal input must contain between 1 and {MAX_TERMINAL_INPUT_BYTES} bytes"
        );
        ipc::send_message(&mut self.writer, &PaneCommand::Input(data).message(term)).await
    }

    /// Ask for the pane's replay on this stream, in order with its output.
    pub async fn want_replay(&mut self, term: u32) -> Result<()> {
        ipc::send_message(&mut self.writer, &PaneCommand::WantReplay.message(term)).await
    }
}

/// This computer's daemon as a live line for the panes this app owns (replays, then output),
/// started when none answers. The caller reads and writes it.
pub async fn open_terminal_line(daemon_executable: PathBuf) -> Result<(ipc::Reader, ipc::Writer)> {
    ipc::open_stream_for_user(&daemon_executable)
        .await
        .context("Could not reach the Maiker service")
}

pub async fn open_terminal_stream(
    daemon_executable: PathBuf,
) -> Result<(TerminalStream, TerminalInput)> {
    let (reader, writer) = ipc::open_stream_for_user(&daemon_executable)
        .await
        .context("Could not reach the Maiker service")?;
    Ok((TerminalStream { reader }, TerminalInput { writer }))
}

/// Start a plain shell in a folder. The user types what they want to run in it.
pub async fn start_shell_session(cwd: PathBuf, daemon_executable: PathBuf) -> Result<Value> {
    let cwd = cwd.canonicalize().context("The start folder is not there. It may have been moved or deleted")?;
    if !cwd.is_dir() {
        bail!("The start folder is a file, not a folder. Pick a folder to start in.");
    }
    let reply = request(
        ClientMsg::Command(Command::NewWorkspace {
            cwd: Some(cwd),
            name: None,
            cmd: None,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (shell session). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Run a command line in a new terminal session on this computer, named `name`. For a login that
/// needs a person (ssh asking for a password or a host key): the person answers in the pane.
pub async fn start_command_session(
    command: String,
    name: String,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::NewWorkspace {
            cwd: None,
            name: Some(name),
            cmd: Some(command),
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (reply to a command session). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Start an agent in a terminal session (a pane the daemon owns) in a project folder.
pub async fn start_terminal_session(
    cwd: PathBuf,
    provider: Provider,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let cwd = cwd
        .canonicalize()
        .context("The project folder is not there. It may have been moved or deleted")?;
    if !cwd.is_dir() {
        bail!("The project path is a file, not a folder.");
    }
    let program = provider.agent_name();
    let reply = request(
        ClientMsg::Command(Command::NewWorkspace {
            cwd: Some(cwd),
            name: None,
            cmd: Some(program.into()),
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (terminal session). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// The agents a window may start by name, and the program each one runs.
const STARTABLE_AGENTS: [&str; 3] = ["claude", "codex", "gemini"];

/// The command line for an agent and its launch flags. Only a known agent runs, and a flag is one plain word
/// (letters, digits and `. _ : = @ / + -`), so nothing the window sends can add a second command.
pub fn agent_command(agent: &str, flags: &[String]) -> Result<String> {
    if !STARTABLE_AGENTS.contains(&agent) {
        bail!("{agent} cannot be started from here");
    }
    let plain = |word: &str| {
        !word.is_empty()
            && word
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "._:=@/+-".contains(c))
    };
    if let Some(bad) = flags.iter().find(|word| !plain(word)) {
        bail!("{bad:?} is not a valid launch flag");
    }
    Ok(std::iter::once(agent).chain(flags.iter().map(String::as_str)).collect::<Vec<_>>().join(" "))
}

/// Start an agent as the first command of a new terminal session in a folder. The pane is the shell with the
/// agent already running in it, as if it had been typed, without waiting for the shell to be ready for typing.
pub async fn start_agent_session(
    cwd: PathBuf,
    agent: String,
    flags: Vec<String>,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let command = agent_command(&agent, &flags)?;
    let cwd = cwd.canonicalize().context("The start folder is not there. It may have been moved or deleted")?;
    if !cwd.is_dir() {
        bail!("The start folder is a file, not a folder. Pick a folder to start in.");
    }
    let reply = request(
        ClientMsg::Command(Command::NewWorkspace {
            cwd: Some(cwd),
            name: None,
            cmd: Some(command),
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (agent session). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub use maitty_shared::protocol::GITHUB_SIGN_IN_COMMAND;

/// The request that starts a terminal session in `cwd` running GitHub's sign-in, for this computer's daemon or
/// another machine's.
pub fn github_sign_in_message(cwd: PathBuf) -> ClientMsg {
    ClientMsg::Command(Command::NewWorkspace {
        cwd: Some(cwd),
        name: None,
        cmd: Some(GITHUB_SIGN_IN_COMMAND.to_owned()),
    })
}

/// Start GitHub's sign-in as the first command of a new terminal session on this computer, in `home`.
pub async fn start_github_sign_in(home: PathBuf, daemon_executable: PathBuf) -> Result<Value> {
    match request(github_sign_in_message(home), daemon_executable).await? {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (terminal session). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// The command that keeps an agent warm in a folder: the same line `start_agent_session` sends, so the session started
/// next with the same agent, flags and folder is the one already running.
pub fn prewarm_message(cwd: PathBuf, agent: &str, flags: &[String]) -> Result<ClientMsg> {
    let cmd = agent_command(agent, flags)?;
    let cwd = cwd.canonicalize().context("The start folder is not there. It may have been moved or deleted")?;
    if !cwd.is_dir() {
        bail!("The start folder is a file, not a folder. Pick a folder to start in.");
    }
    Ok(ClientMsg::Command(Command::Prewarm { cwd, cmd }))
}

/// Start an agent ahead of its first message, hidden until its session is started. False when the daemon running is
/// from before this and was not asked.
pub async fn prewarm_agent_session(cwd: PathBuf, agent: String, flags: Vec<String>) -> Result<Value> {
    let asked = ask_if_known(prewarm_message(cwd, &agent, &flags)?).await?;
    Ok(Value::Bool(asked))
}

/// Stop the agent kept warm, if no session took it.
pub async fn drop_prewarmed_agent() -> Result<Value> {
    ask_if_known(ClientMsg::Command(Command::DropPrewarm)).await?;
    Ok(Value::Null)
}

/// Whether a daemon at `daemon_version` reads `message`. An older one passes over what it cannot read and never answers.
fn daemon_reads(message: &ClientMsg, daemon_version: u32) -> bool {
    daemon_version >= message.introduced_in()
}

/// Ask the running daemon for something it may be too old to know: true when it was asked and said yes.
async fn ask_if_known(message: ClientMsg) -> Result<bool> {
    answered_within(REQUEST_TIMEOUT, async {
        let (mut connection, version) = ipc::open_for_user_knowing_version()
            .await
            .context("Could not reach the Maiker service")?;
        if !daemon_reads(&message, version) {
            return Ok(false);
        }
        match ask(&mut connection, &message).await? {
            Reply::Ok => Ok(true),
            _ => bail!("The Maiker service gave an answer this app does not understand. Restart the service in Settings, or update the app so both are the same version."),
        }
    })
    .await
}

/// Ask the running daemon a question newer than the oldest daemon this app talks to. An older one would
/// never answer it, so it is refused in words instead of left to time out.
async fn ask_running_daemon_if_it_reads(message: &ClientMsg) -> Result<Reply> {
    answered_within(REQUEST_TIMEOUT, async {
        let (mut connection, version) = ipc::open_for_user_knowing_version()
            .await
            .context("Could not reach the Maiker service")?;
        refuse_unless_daemon_reads(message, version)?;
        ask(&mut connection, message).await
    })
    .await
}

/// Whether a repository question is newer than the oldest daemon this app talks to, so the running daemon's
/// version is checked before it is asked.
fn repo_question_needs_version(message: &ClientMsg) -> bool {
    message.introduced_in() > COMPATIBLE_SINCE
}

/// Refuses `message` in words when a daemon at `daemon_version` would never answer it.
fn refuse_unless_daemon_reads(message: &ClientMsg, daemon_version: u32) -> Result<()> {
    if !daemon_reads(message, daemon_version) {
        bail!(
            "the Maiker service running is older than this app and cannot answer this yet: restart it (Settings › Daemon)"
        );
    }
    Ok(())
}

/// What may be held for a starting agent: some words, and not more than the daemon is asked to keep.
pub fn held_message(text: String) -> Result<PaneCommand> {
    if text.trim().is_empty() {
        bail!("there is no message to hold");
    }
    if text.len() > MAX_HELD_MESSAGE_BYTES {
        bail!("the message is too long to hold for the agent");
    }
    Ok(PaneCommand::SendWhenReady(text))
}

pub async fn send_when_ready(
    term: u32,
    text: String,
    operation: Option<u64>,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = send_named(held_message(text)?.message(term), operation, daemon_executable).await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (reply to a held message). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// What may be queued for a working agent: some words, and not more than the daemon is asked to keep.
pub fn queued_message(text: String, first: bool) -> Result<PaneCommand> {
    if text.trim().is_empty() {
        bail!("there is no message to queue");
    }
    if text.len() > MAX_HELD_MESSAGE_BYTES {
        bail!("the message is too long to queue for the agent");
    }
    Ok(PaneCommand::Queue { text, first })
}

pub async fn queue_follow_up(
    term: u32,
    text: String,
    first: bool,
    operation: Option<u64>,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply =
        send_named(queued_message(text, first)?.message(term), operation, daemon_executable).await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (reply to a queued message). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Sends a held or queued message to this computer's daemon, named by `operation` when that daemon
/// honours it, so a retry is acknowledged instead of typed twice.
async fn send_named(
    message: ClientMsg,
    operation: Option<u64>,
    daemon_executable: PathBuf,
) -> Result<Reply> {
    let Some(operation) = operation else {
        return request(message, daemon_executable).await;
    };
    answered_within(REQUEST_TIMEOUT, async {
        match ipc::open_for_user_knowing_version().await {
            Ok((mut connection, version)) => {
                ask(&mut connection, &named_send(message, operation, version)).await
            }
            // No daemon is running: the one `request` starts has no earlier send to match a retry against.
            Err(error) if ipc::other_version(&error).is_none() => {
                request(message, daemon_executable).await
            }
            Err(error) => Err(error),
        }
    })
    .await
}

/// `message` carrying `operation` when a daemon at `daemon_version` honours it. An older daemon reads
/// the field and ignores it, so a retry there would be typed twice: it is sent the message unnamed.
fn named_send(message: ClientMsg, operation: u64, daemon_version: u32) -> ClientMsg {
    let mut named = message.clone();
    if let ClientMsg::Command(
        Command::SendWhenReady { operation: slot, .. }
        | Command::QueueFollowUp { operation: slot, .. },
    ) = &mut named
    {
        *slot = Some(operation);
    }
    if daemon_reads(&named, daemon_version) {
        named
    } else {
        message
    }
}

/// Takes one queued message back. A daemon from before this could only drop them all, and would
/// never answer, so it is not asked.
pub async fn drop_queued(term: u32, index: u32, text: String) -> Result<Value> {
    if ask_if_known(PaneCommand::DropQueued { index, text }.message(term)).await? {
        Ok(Value::Null)
    } else {
        bail!("the Maiker service is from an older release: restart it to take back one queued message")
    }
}

pub async fn rename_terminal_session(
    term: u32,
    name: String,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(PaneCommand::Rename(name).message(term), daemon_executable).await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (rename). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// A read-only question about the repository a pane is in, asked of the daemon that owns the
/// pane; that daemon scopes it to the pane's own checkout. A question newer than the oldest local
/// daemon this app talks to is refused in words when the running one is older.
pub async fn repo_query(term: u32, question: maitty_shared::repo::RepoRequest, daemon: impl Into<Daemon>) -> Result<Value> {
    let message = ClientMsg::Query(Query::Repo {
        term,
        tag: 0,
        request: question,
    });
    let reply = match daemon.into() {
        Daemon::Local(_) if repo_question_needs_version(&message) => ask_running_daemon_if_it_reads(&message).await?,
        daemon => request(message, daemon).await?,
    };
    match reply {
        Reply::Repo { reply, .. } => Ok(serde_json::to_value(reply)?),
        _ => bail!("The Maiker service gave an answer this app does not understand (repository). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Which commit name and email git uses on a daemon's machine, and its folder rules, as a
/// `GitIdentityReport` in JSON. The daemon reads them and writes nothing.
pub async fn git_identities(daemon: impl Into<Daemon>) -> Result<Value> {
    match request(ClientMsg::Query(Query::GitIdentities { tag: 0 }), daemon).await? {
        Reply::GitIdentities { report, .. } => Ok(serde_json::to_value(report)?),
        _ => bail!("The Maiker service gave an answer this app does not understand (answer about who commits). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Preview, write or remove a folder's rule on a daemon's machine. The lines it would write, wrote
/// or took away, by file, as JSON; or an error whose text is the daemon's one line saying why not.
pub async fn git_identity_rule(change: maitty_shared::protocol::GitRuleChange, daemon: impl Into<Daemon>) -> Result<Value> {
    match request(ClientMsg::Query(Query::GitIdentityRule { change, tag: 0 }), daemon).await? {
        Reply::GitIdentityRuleDone { outcome: Ok(files), .. } => Ok(serde_json::to_value(files)?),
        Reply::GitIdentityRuleDone { outcome: Err(why), .. } => bail!("{why}"),
        _ => bail!("The Maiker service gave an answer this app does not understand (answer about a folder's rule). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// How long an answer to `request` is waited for: a little longer than the daemon gives it, so
/// the daemon's own "stopped after" line is what arrives.
fn git_request_timeout(request: &maitty_shared::protocol::GitRequest) -> Duration {
    use maitty_shared::protocol::{GIT_COMMIT_LIMIT_SECS, GIT_SYNC_LIMIT_SECS, GitRequest};
    const SLACK_SECS: u64 = 15;
    Duration::from_secs(SLACK_SECS + match request {
        GitRequest::Commit { .. } => GIT_COMMIT_LIMIT_SECS,
        GitRequest::Fetch | GitRequest::Pull | GitRequest::Push | GitRequest::PullRequest => GIT_SYNC_LIMIT_SECS,
    })
}

/// Have the daemon that owns pane `term` do `request` to the checkout the pane is in. The line
/// saying what happened, or an error whose text is the daemon's one line saying why not.
pub async fn git_request(term: u32, request: maitty_shared::protocol::GitRequest, daemon: impl Into<Daemon>) -> Result<String> {
    let limit = git_request_timeout(&request);
    let asked = ClientMsg::Query(Query::Git { term, request, tag: 0 });
    match request_within(asked, daemon, limit).await? {
        Reply::GitDone { outcome: Ok(line), .. } => Ok(line),
        Reply::GitDone { outcome: Err(why), .. } => bail!("{why}"),
        _ => bail!("The Maiker service gave an answer this app does not understand (git). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// `git worktree add` for `branch` next to the repository `term` is in (new from `base`, or the
/// repo's HEAD); the daemon opens it as a new session. `branch` names an existing branch to
/// check it out instead. `daemon` is the one that owns the pane: this computer's, or another
/// machine's, whose list is asked of it for the pane's workspace.
pub async fn new_worktree_session(
    term: u32,
    branch: String,
    base: Option<String>,
    daemon: impl Into<Daemon>,
) -> Result<Value> {
    let daemon = daemon.into();
    let snapshot = match request(ClientMsg::Query(Query::List), daemon.clone()).await? {
        Reply::List(snapshot) => snapshot,
        _ => bail!("The Maiker service gave an answer this app does not understand (session list). Restart the service in Settings, or update the app so both are the same version."),
    };
    let ws = snapshot
        .workspaces
        .iter()
        .find(|workspace| {
            workspace
                .tabs
                .iter()
                .any(|tab| tab.layout.leaves().contains(&term))
        })
        .map(|workspace| workspace.id)
        .with_context(|| format!("pane {term} is not open"))?;
    let reply = request(
        ClientMsg::Command(Command::NewWorktree {
            ws,
            branch,
            base,
            cmd: None,
            split: None,
            from: None,
            agent: None,
            prompt: None,
        }),
        daemon,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (worktree). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Remove worktrees (a folder and whether to go on with uncommitted changes in it, which are lost).
/// The daemon closes what runs in a worktree before it goes and answers at once; one something
/// still runs in is left alone.
pub async fn tidy_worktrees(items: Vec<(PathBuf, bool)>, daemon_executable: PathBuf) -> Result<Value> {
    match request(ClientMsg::Command(Command::TidyWorktrees { items }), daemon_executable).await? {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (worktree). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Where the worktree at `folder` of the repository at `repo` stands, as this computer's daemon
/// reads it (`gh` and `worktree.inactive_days` included), with `missing` set when git still lists
/// it but its folder is gone. A daemon built before the question is told so in words, since it would never answer.
pub async fn worktree_standing(repo: PathBuf, folder: PathBuf) -> Result<Value> {
    let message = ClientMsg::Query(Query::WorktreeStanding { repo, folder });
    answered_within(REQUEST_TIMEOUT, async {
        let (mut connection, version) = ipc::open_for_user_knowing_version()
            .await
            .context("Could not reach the Maiker service")?;
        if !daemon_reads(&message, version) {
            bail!(
                "the Maiker service running is older than this app and cannot say where a worktree stands: restart it (Settings › Daemon)"
            );
        }
        match ask(&mut connection, &message).await? {
            Reply::WorktreeStanding(standing) => standing_shown(standing),
            _ => bail!("The Maiker service gave an answer this app does not understand (worktree standing). Restart the service in Settings, or update the app so both are the same version."),
        }
    })
    .await
}

fn standing_shown(standing: Option<maitty_shared::protocol::WorktreeStanding>) -> Result<Value> {
    let missing = standing.is_none();
    let mut shown = serde_json::to_value(standing.unwrap_or_default())?;
    shown["missing"] = Value::Bool(missing);
    Ok(shown)
}

/// How long a worktree for a branch may take, connecting included. The repo's setup hook runs
/// before the daemon answers (it may take ten minutes), so the usual request limit is too short.
const BRANCH_WORKTREE_TIMEOUT: Duration = Duration::from_secs(11 * 60);

/// A worktree of `project` on `branch`, made by the daemon of the machine the project is on, the
/// way every other one is: trusted like its repo, the repo's setup run, tracked for tidy-up. The
/// answer is its folder there, the place to start an agent. This computer's daemon built before the
/// command is told so in words, since it would never answer; another machine's is on this version
/// or not used.
pub async fn branch_worktree(project: PathBuf, branch: String, daemon: impl Into<Daemon>) -> Result<Value> {
    let message = ClientMsg::Command(Command::BranchWorktree { project, branch });
    let reply = match daemon.into() {
        Daemon::Local(_) => {
            answered_within(BRANCH_WORKTREE_TIMEOUT, async {
                let (mut connection, version) = ipc::open_for_user_knowing_version()
                    .await
                    .context("Could not reach the Maiker service")?;
                if !daemon_reads(&message, version) {
                    bail!(
                        "the Maiker service running is older than this app and cannot make a worktree yet: restart it (Settings › Daemon), then try again"
                    );
                }
                ask(&mut connection, &message).await
            })
            .await?
        }
        remote => request_within(message, remote, BRANCH_WORKTREE_TIMEOUT).await?,
    };
    match reply {
        Reply::Text(folder) => Ok(Value::String(folder)),
        _ => bail!("The Maiker service gave an answer this app does not understand (worktree). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Where `query` appears in what the app's terminal sessions printed recently.
pub async fn search_panes(query: String, daemon_executable: PathBuf) -> Result<Value> {
    let reply = request(
        ClientMsg::Query(Query::PaneSearch { query }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Search(hits) => Ok(serde_json::to_value(hits)?),
        _ => bail!("The Maiker service gave an answer this app does not understand (search). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// What agents reported using over `period`: totals, per session and per day.
pub async fn usage_report(
    period: maitty_shared::usage_report::UsagePeriod,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Query(Query::UsageReport { period }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::UsageReport(report) => Ok(serde_json::to_value(report)?),
        _ => bail!("The Maiker service gave an answer this app does not understand (usage). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Put a pane's checkout back as it was in one of the daemon's snapshots. Returns how many
/// files changed.
pub async fn restore_snapshot(
    term: u32,
    commit: String,
    daemon_executable: PathBuf,
) -> Result<u64> {
    let reply = request(
        ClientMsg::Command(Command::RestoreSnapshot {
            term,
            tag: 0,
            commit,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Repo {
            reply: maitty_shared::repo::RepoReply::Restored(changed),
            ..
        } => Ok(changed as u64),
        _ => bail!("The Maiker service gave an answer this app does not understand (restore). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// How many files restoring one of the checkout's snapshots would change now. A daemon from before the question
/// would never answer it, so it is not asked.
pub async fn restore_count(term: u32, commit: String) -> Result<u64> {
    let message = ClientMsg::Query(Query::Repo {
        term,
        tag: 0,
        request: maitty_shared::repo::RepoRequest::RestoreCount { commit },
    });
    answered_within(REQUEST_TIMEOUT, async {
        let (mut connection, version) = ipc::open_for_user_knowing_version()
            .await
            .context("Could not reach the Maiker service")?;
        if !daemon_reads(&message, version) {
            bail!(
                "the Maiker service running is older than this app and cannot count a restore yet: restart it (Settings › Daemon), then try again"
            );
        }
        match ask(&mut connection, &message).await? {
            Reply::Repo {
                reply: maitty_shared::repo::RepoReply::RestoreCount(changed),
                ..
            } => Ok(changed as u64),
            _ => bail!("The Maiker service gave an answer this app does not understand (restore count). Restart the service in Settings, or update the app so both are the same version."),
        }
    })
    .await
}

/// Replace the text of one existing file of the checkout `term` is in (the daemon checks the path and refuses
/// anything but a plain file of the checkout).
pub async fn write_project_file(
    term: u32,
    path: String,
    contents: String,
) -> Result<Value> {
    let message = ClientMsg::Command(Command::WriteFile {
        term,
        tag: 0,
        path,
        contents,
    });
    answered_within(Duration::from_secs(30), async {
        let (mut connection, version) = ipc::open_for_user_knowing_version()
            .await
            .context("Could not reach the Maiker service")?;
        if !daemon_reads(&message, version) {
            bail!(
                "the Maiker service running is older than this app and cannot save a file yet: restart it (Settings › Daemon), then try again"
            );
        }
        match ask(&mut connection, &message).await? {
            Reply::Repo {
                reply: maitty_shared::repo::RepoReply::Written,
                ..
            } => Ok(Value::Null),
            _ => bail!("The Maiker service gave an answer this app does not understand (save). Restart the service in Settings, or update the app so both are the same version."),
        }
    })
    .await
}

/// Save an editor's text over an existing file of the checkout `term` is in, when the file is still
/// the `version` the editor read (`None`: overwrite). The answer is `{"Saved": {"version"}}` or
/// `"ChangedOnDisk"`, as the daemon gave it; this computer's daemon from before saving is refused in words (a
/// machine's is never older than this app: the window turns that away when it connects).
pub async fn save_project_file(term: u32, path: String, contents: String, version: Option<String>, daemon: impl Into<Daemon>) -> Result<Value> {
    let message = ClientMsg::Command(Command::SaveFile {
        term,
        tag: 0,
        path,
        contents,
        version,
    });
    let reply = match daemon.into() {
        Daemon::Local(_) => ask_running_daemon_if_it_reads(&message).await?,
        daemon => request(message, daemon).await?,
    };
    match reply {
        Reply::Repo {
            reply: reply @ (maitty_shared::repo::RepoReply::Saved { .. } | maitty_shared::repo::RepoReply::ChangedOnDisk),
            ..
        } => Ok(serde_json::to_value(reply)?),
        _ => bail!("daemon returned an unexpected save reply"),
    }
}

/// End a terminal session: its process stops, as when it is closed in the terminal app.
pub async fn close_terminal_session(term: u32, daemon_executable: PathBuf) -> Result<Value> {
    let reply = request(PaneCommand::Close.message(term), daemon_executable).await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (close). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// End a terminal session with an undo window: the daemon hides it at once and closes it after
/// the window unless `undo_close_terminal_session` comes first.
pub async fn close_session_with_undo(term: u32, daemon_executable: PathBuf) -> Result<Value> {
    let reply = request(PaneCommand::CloseSession.message(term), daemon_executable).await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (close). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Bring back a session `close_session_with_undo` hid, while the undo window is open.
pub async fn undo_close_terminal_session(term: u32, daemon_executable: PathBuf) -> Result<Value> {
    let reply = request(PaneCommand::UndoClose.message(term), daemon_executable).await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (undo). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Pin a pane to the top of its project, or let it go back to its place.
pub async fn pin_terminal_session(
    term: u32,
    pinned: bool,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(PaneCommand::Pin(pinned).message(term), daemon_executable).await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (pin). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Put a pane away from the project lists without stopping it, or bring it back.
pub async fn archive_terminal_session(
    term: u32,
    archived: bool,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(
        PaneCommand::Archive(archived).message(term),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (archive). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Snooze a pane until a time (unix seconds), or wake it with `None`. The daemon refuses a pane that needs you.
pub async fn snooze_terminal_session(
    term: u32,
    until: Option<u64>,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(PaneCommand::Snooze(until).message(term), daemon_executable).await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (snooze). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Restart an agent in place, keeping its name, so it loads hooks it missed.
pub async fn reload_terminal_session(term: u32, daemon_executable: PathBuf) -> Result<Value> {
    let reply = request(PaneCommand::Reload.message(term), daemon_executable).await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (reload). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// The user looked at a pane: the daemon turns a finished agent's done into idle.
/// The words the window uses for each answer to a helper request.
pub fn helper_choice(word: &str) -> Result<maitty_shared::protocol::HelperChoice> {
    use maitty_shared::protocol::HelperChoice;
    match word {
        "allow" => Ok(HelperChoice::Allow),
        "always" => Ok(HelperChoice::Always),
        "no" => Ok(HelperChoice::No),
        _ => bail!("unknown answer to a helper request"),
    }
}

pub async fn answer_helpers(
    term: u32,
    choice: maitty_shared::protocol::HelperChoice,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(PaneCommand::AnswerHelpers(choice).message(term), daemon_executable).await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (helper answer). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// The person's answer to a chat that asked to start helpers (ADR 0016). A service too old to
/// read the command is refused in words here.
pub async fn answer_chat_helpers(
    conversation: u64,
    choice: maitty_shared::protocol::HelperChoice,
) -> Result<Value> {
    let message = ClientMsg::Command(Command::AnswerChatHelpers {
        conversation: maitty_shared::conversation::ConversationId(conversation),
        choice,
    });
    match ask_running_daemon_if_it_reads(&message).await? {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (helper answer). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// What the person chose for a repo-supplied check command: `once`, `always` or `never`.
pub fn approval_choice(word: &str) -> Result<maitty_shared::protocol::ApprovalChoice> {
    use maitty_shared::protocol::ApprovalChoice;
    match word {
        "once" => Ok(ApprovalChoice::Once),
        "always" => Ok(ApprovalChoice::Always),
        "never" => Ok(ApprovalChoice::Never),
        _ => bail!("unknown answer to a check approval"),
    }
}

/// Ask this computer's daemon to do something to a pane's checks (see `PaneCommand`).
pub async fn check_command(term: u32, command: PaneCommand, daemon_executable: PathBuf) -> Result<Value> {
    match request(command.message(term), daemon_executable).await? {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (check). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// The tail of a pane's last output for check `name` (None: the headline one).
pub async fn check_output(term: u32, name: Option<String>, daemon_executable: PathBuf) -> Result<Value> {
    match request(ClientMsg::Query(Query::CheckOutput { term, name }), daemon_executable).await? {
        Reply::Text(output) => Ok(Value::String(output)),
        _ => bail!("The Maiker service gave an answer this app does not understand (check output). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// The person's answer to an agent's request for a secret (`value`: the secret, or None to decline). The value
/// goes into the message as `SecretText`, which prints as `<hidden>`, and is not kept or logged here.
pub async fn answer_secret(id: u64, value: Option<String>, daemon_executable: PathBuf) -> Result<Value> {
    let message = ClientMsg::Command(Command::AnswerSecret {
        id,
        value: value.map(maitty_shared::protocol::SecretText),
    });
    match request(message, daemon_executable).await? {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (secret). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn mark_terminal_seen(term: u32, daemon_executable: PathBuf) -> Result<Value> {
    let reply = request(PaneCommand::Seen.message(term), daemon_executable).await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (mark-seen reply). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn send_conversation(
    id: u64,
    generation: u64,
    operation: u64,
    text: String,
    choice: Option<maitty_shared::conversation::TurnChoice>,
    daemon: impl Into<Daemon>,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::ConversationSend {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
            operation,
            text,
            choice: choice.filter(|picked| !picked.is_empty()),
        }),
        daemon,
    )
    .await?;
    match reply {
        Reply::ConversationSent(receipt) => Ok(serde_json::to_value(receipt)?),
        // The conversation was busy: the daemon holds the message and sends it when the turn ends.
        Reply::ConversationQueued(queued) => Ok(serde_json::to_value(queued)?),
        _ => bail!("The Maiker service gave an answer this app does not understand (conversation send). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn dequeue_conversation(
    id: u64,
    generation: u64,
    operation: u64,
    daemon: impl Into<Daemon>,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::ConversationDequeue {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
            operation,
        }),
        daemon,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (queued message removal). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Sends a message waiting in a chat's queue now, instead of when the turn ends. The daemon answers `Ok` only once the
/// message was taken (steered into the turn, or the turn stopped for it) and an error with the reason when it was
/// refused, so the message is still queued then. A local daemon built before the command is told so in words, since
/// it would never answer; another machine's is asked as it is and answers or times out.
pub async fn send_conversation_now(
    id: u64,
    generation: u64,
    operation: u64,
    daemon: impl Into<Daemon>,
) -> Result<Value> {
    let message = ClientMsg::Command(Command::ConversationSendNow {
        id: maitty_shared::conversation::ConversationId(id),
        generation,
        operation,
    });
    let reply = match daemon.into() {
        Daemon::Local(_) => ask_running_daemon_if_it_reads(&message).await?,
        Daemon::Remote(remote) => remote.request(message, REQUEST_TIMEOUT).await?,
    };
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (send now). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn approve_conversation(
    id: u64,
    generation: u64,
    request_id: maitty_shared::conversation::ProviderRequestId,
    decision: maitty_shared::conversation::ApprovalDecision,
    daemon: impl Into<Daemon>,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::ConversationApprove {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
            request_id,
            decision,
        }),
        daemon,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (conversation approval). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn answer_user_input(
    id: u64,
    generation: u64,
    request_id: maitty_shared::conversation::ProviderRequestId,
    answers: std::collections::BTreeMap<String, Vec<String>>,
    daemon: impl Into<Daemon>,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::ConversationAnswerInput {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
            request_id,
            answers,
        }),
        daemon,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (conversation input). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn cancel_conversation(
    id: u64,
    generation: u64,
    daemon: impl Into<Daemon>,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::ConversationCancel {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
        }),
        daemon,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (turn cancellation). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn rename_conversation(
    id: u64,
    title: String,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::ConversationRename {
            id: maitty_shared::conversation::ConversationId(id),
            title,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (rename). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn archive_conversation(
    id: u64,
    archived: bool,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::ConversationArchive {
            id: maitty_shared::conversation::ConversationId(id),
            archived,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (close). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub async fn resume_codex_conversation(
    id: u64,
    generation: u64,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::ConversationStart {
            target: StartTarget::Conversation {
                id: maitty_shared::conversation::ConversationId(id),
                generation,
            },
            branch: None,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::ConversationStarted { id, generation } => {
            Ok(json!({"id": id.0, "generation": generation}))
        }
        _ => bail!("The Maiker service gave an answer this app does not understand (conversation resume). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Approve a command request of a chat and have the daemon remember it for the chat's project.
pub async fn allow_conversation_always(
    id: u64,
    generation: u64,
    request_id: maitty_shared::conversation::ProviderRequestId,
    daemon: impl Into<Daemon>,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::ConversationAllowAlways {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
            request_id,
        }),
        daemon,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (remembered approval). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Close a chat with an undo window: the daemon hides it at once and ends it when the window passes.
pub async fn close_conversation_with_undo(id: u64, generation: u64, daemon_executable: PathBuf) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::ConversationClose {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (close). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Bring back a chat closed with `close_conversation_with_undo` while its window is open.
pub async fn undo_close_conversation(id: u64, daemon_executable: PathBuf) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::ConversationUndoClose {
            id: maitty_shared::conversation::ConversationId(id),
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (undo). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// The commands approved "always in this project" for chats.
pub async fn allowed_commands(daemon_executable: PathBuf) -> Result<Value> {
    let reply = request(ClientMsg::Query(Query::AllowedCommands), daemon_executable).await?;
    match reply {
        Reply::AllowedCommands(commands) => Ok(serde_json::to_value(commands)?),
        _ => bail!("The Maiker service gave an answer this app does not understand (approved commands). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// The conversations `agent` saved for `folder` on this computer, newest first, as the daemon's
/// `SavedConversations`. Null when the daemon running is older than the question: it would never answer.
pub async fn saved_conversations(agent: String, folder: String) -> Result<Value> {
    let message = ClientMsg::Query(Query::SavedConversations { agent, folder, tag: 0 });
    answered_within(REQUEST_TIMEOUT, async {
        let (mut connection, version) = ipc::open_for_user_knowing_version()
            .await
            .context("Could not reach the Maiker service")?;
        if !daemon_reads(&message, version) {
            return Ok(Value::Null);
        }
        match ask(&mut connection, &message).await? {
            Reply::SavedConversations { found, .. } => Ok(serde_json::to_value(found)?),
            _ => bail!("The Maiker service gave an answer this app does not understand (saved conversations). Restart the service in Settings, or update the app so both are the same version."),
        }
    })
    .await
}

/// How long a side answer may take: the daemon's own limit, with a margin for the connection.
const SIDE_ANSWER_TIMEOUT: Duration = Duration::from_secs(100);

/// Claude Code's answer beside conversation `id`, from the daemon of the machine the chat is on, as its `SideAnswer`,
/// without adding to the conversation. Refused in words when this computer's daemon is older than the question.
pub async fn side_answer(id: u64, side: maitty_shared::protocol::SideAsk, daemon: impl Into<Daemon>) -> Result<Value> {
    let message = ClientMsg::Query(Query::SideAnswer {
        id: maitty_shared::conversation::ConversationId(id),
        ask: side,
        tag: 0,
    });
    let reply = match daemon.into() {
        // This computer's daemon may be older than the app; another machine's is on this version or not used (`dial`).
        Daemon::Local(_) => {
            answered_within(SIDE_ANSWER_TIMEOUT, async {
                let (mut connection, version) = ipc::open_for_user_knowing_version()
                    .await
                    .context("Could not reach the Maiker service")?;
                refuse_unless_daemon_reads(&message, version)?;
                ask(&mut connection, &message).await
            })
            .await?
        }
        remote => request_within(message, remote, SIDE_ANSWER_TIMEOUT).await?,
    };
    match reply {
        Reply::SideAnswer { answer, .. } => Ok(serde_json::to_value(answer)?),
        _ => bail!("The Maiker service gave an answer this app does not understand (side answer). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// The agent sessions this computer's daemon recorded as closed, newest first, each with `folder_present`: whether its
/// folder is still there, looked at off the async workers. Null when the daemon running is older than the question.
pub async fn closed_sessions() -> Result<Value> {
    let message = ClientMsg::Query(Query::ClosedSessions);
    answered_within(REQUEST_TIMEOUT, async {
        let (mut connection, version) = ipc::open_for_user_knowing_version()
            .await
            .context("Could not reach the Maiker service")?;
        if !daemon_reads(&message, version) {
            return Ok(Value::Null);
        }
        match ask(&mut connection, &message).await? {
            Reply::ClosedSessions(list) => with_folder_presence(list, FOLDER_LOOK_LIMIT, |path| path.is_dir()).await,
            _ => bail!("The Maiker service gave an answer this app does not understand (closed sessions). Restart the service in Settings, or update the app so both are the same version."),
        }
    })
    .await
}

/// Have this computer's daemon reopen a closed session it keeps, making its worktree again when the folder is gone.
/// The daemon starts the agent itself. False when the daemon running is from before this and was not asked.
pub async fn reopen_closed_session(agent: String, session: String) -> Result<Value> {
    let asked = ask_if_known(reopen_closed_message(agent, session)).await?;
    Ok(Value::Bool(asked))
}

fn reopen_closed_message(agent: String, session: String) -> ClientMsg {
    ClientMsg::Command(Command::ReopenClosedSession { agent, session })
}

/// How long the closed sessions' folders are looked for, all of them together.
const FOLDER_LOOK_LIMIT: Duration = Duration::from_secs(2);

/// Each closed session as JSON with `folder_present`. The folders are looked at side by side on blocking threads, and
/// one that has not answered by `limit` (a network share that is gone can hang for a long time) reads as missing.
async fn with_folder_presence(
    list: Vec<maitty_shared::protocol::ClosedSession>,
    limit: Duration,
    look: impl Fn(&std::path::Path) -> bool + Send + Sync + Clone + 'static,
) -> Result<Value> {
    let deadline = tokio::time::Instant::now() + limit;
    let looks: Vec<_> = list
        .iter()
        .map(|closed| {
            let (cwd, look) = (closed.cwd.clone(), look.clone());
            tokio::task::spawn_blocking(move || look(&cwd))
        })
        .collect();
    let mut rows = Vec::with_capacity(list.len());
    for (closed, folder_look) in list.into_iter().zip(looks) {
        let folder_present = match tokio::time::timeout_at(deadline, folder_look).await {
            Ok(answer) => answer.context("looking for a closed session's folder")?,
            Err(_) => false,
        };
        let mut row = serde_json::to_value(closed)?;
        row["folder_present"] = Value::Bool(folder_present);
        rows.push(row);
    }
    Ok(Value::Array(rows))
}

/// Take back a command approved "always in this project".
pub async fn forget_allowed_command(
    project: PathBuf,
    command_sha256: String,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::ForgetAllowedCommand { project, command_sha256 }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (forget). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// Stop a chat conversation's agent. Its record and history stay.
pub async fn end_conversation(
    id: u64,
    generation: u64,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let reply = request(
        ClientMsg::Command(Command::ConversationEnd {
            id: maitty_shared::conversation::ConversationId(id),
            generation,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (end conversation). Restart the service in Settings, or update the app so both are the same version."),
    }
}

/// What a new conversation may do. The provider enforces it; Maiker only picks it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Permissions {
    ReadOnly,
    WorkspaceWrite,
    /// No sandbox and no approval prompts. Chosen only on request.
    FullAccess,
}

impl Permissions {
    pub fn parse(text: &str) -> Result<Self> {
        match text {
            "read-only" => Ok(Self::ReadOnly),
            "workspace-write" => Ok(Self::WorkspaceWrite),
            "full-access" => Ok(Self::FullAccess),
            other => bail!("unknown permissions {other:?}"),
        }
    }

    fn launch_policy(self) -> (Sandbox, ApprovalPolicy) {
        match self {
            Self::ReadOnly => (Sandbox::ReadOnly, ApprovalPolicy::OnRequest),
            Self::WorkspaceWrite => (Sandbox::WorkspaceWrite, ApprovalPolicy::OnRequest),
            Self::FullAccess => (Sandbox::FullAccess, ApprovalPolicy::Never),
        }
    }
}

/// Start a chat session: a structured conversation the daemon owns (ADR 0003), with the posture the
/// person picked for it (ADR 0018: the New session draft starts chats, and carries its mode). With a
/// `branch` the daemon makes a worktree for it from the project at `cwd` and starts there.
pub async fn start_chat_session(
    cwd: PathBuf,
    provider: Provider,
    branch: Option<String>,
    permissions: Permissions,
    daemon_executable: PathBuf,
) -> Result<Value> {
    create_conversation(cwd, provider, permissions, branch, daemon_executable).await
}

pub async fn create_conversation(
    cwd: PathBuf,
    provider: Provider,
    permissions: Permissions,
    branch: Option<String>,
    daemon_executable: PathBuf,
) -> Result<Value> {
    let cwd = cwd
        .canonicalize()
        .context("The project folder is not there. It may have been moved or deleted")?;
    if !cwd.is_dir() {
        bail!("The project path is a file, not a folder.");
    }
    let (executable, config_root) = match provider {
        Provider::Codex => (codex_app_server_executable()?, codex_config_dir()),
        Provider::Claude => (claude_executable()?, claude_config_dir()?),
        // Gemini runs in a terminal and its chat is read from the transcript; it has no structured runtime.
        Provider::Gemini => bail!("Gemini has no structured chat; start it in a terminal"),
        // The daemon picks an ACP agent's program from its own config; this start names a program itself.
        Provider::Acp => bail!("An agent run over ACP cannot be started from here yet"),
    };
    let (sandbox, approval_policy) = permissions.launch_policy();
    let settings = LaunchSettings {
        agent: None,
        provider,
        executable,
        config_root,
        cwd,
        model: None,
        model_provider: None,
        approval_policy,
        sandbox,
    };
    let reply = request(
        ClientMsg::Command(Command::ConversationStart {
            target: StartTarget::Create(settings),
            branch,
        }),
        daemon_executable,
    )
    .await?;
    match reply {
        Reply::ConversationStarted { id, generation } => {
            Ok(json!({"id": id, "generation": generation}))
        }
        _ => bail!("The Maiker service gave an answer this app does not understand (conversation start). Restart the service in Settings, or update the app so both are the same version."),
    }
}

pub fn claude_executable() -> Result<PathBuf> {
    #[cfg(windows)]
    {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let home = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf());
        windows_claude_from(&path, home.as_deref())
            .ok_or_else(|| anyhow::anyhow!("Claude Code is not installed: no claude.exe or claude.cmd on PATH"))
    }
    #[cfg(not(windows))]
    {
        executable_on_path("claude")
    }
}

/// Where Claude Code is on Windows. Its native installer puts `claude.exe` in `~/.local/bin`, which
/// a window started before PATH was updated does not see; an npm install leaves only `claude.cmd`.
/// Either still runs it, so neither leaves the window without Claude Code's own model list.
#[cfg(any(windows, test))]
fn windows_claude_from(path: &std::ffi::OsStr, home: Option<&std::path::Path>) -> Option<PathBuf> {
    let on_path = |name: &str| std::env::split_paths(path).map(|directory| directory.join(name)).find(|file| file.is_file());
    let native = on_path("claude.exe")
        .or_else(|| home.map(|home| home.join(".local").join("bin").join("claude.exe")).filter(|file| file.is_file()));
    match native {
        Some(file) => Some(file.canonicalize().unwrap_or(file)),
        // A batch file runs through cmd, which cannot start one by a `\\?\` path, so it is not canonicalized.
        None => on_path("claude.cmd"),
    }
}

fn claude_config_dir() -> Result<PathBuf> {
    if let Some(config_root) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Ok(PathBuf::from(config_root));
    }
    let home = directories::BaseDirs::new()
        .map(|dirs| dirs.home_dir().to_path_buf())
        .context("resolving the user home directory")?;
    Ok(home.join(".claude"))
}

pub fn codex_app_server_executable() -> Result<PathBuf> {
    #[cfg(windows)]
    {
        windows_codex_app_server_executable()
    }
    #[cfg(not(windows))]
    {
        executable_on_path("codex")
    }
}

#[cfg(windows)]
fn windows_codex_app_server_executable() -> Result<PathBuf> {
    match executable_on_path("codex") {
        Ok(executable) => Ok(executable),
        Err(error) => {
            if let Some(executable) = windows_npm_codex_binary(windows_npm_search_roots(
                std::env::var_os("PATH")
                    .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
                    .unwrap_or_default(),
                std::env::var_os("NVM_SYMLINK").map(PathBuf::from),
                std::env::var_os("APPDATA").map(PathBuf::from),
                std::env::var_os("ProgramFiles").map(PathBuf::from),
            )) {
                return Ok(executable);
            }
            Err(error
                .context("Codex executable not found on PATH or in common Windows npm locations"))
        }
    }
}

fn codex_config_dir() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            directories::BaseDirs::new()
                .map(|dirs| dirs.home_dir().join(".codex"))
                .unwrap_or_default()
        })
}

fn executable_on_path(tool: &str) -> Result<PathBuf> {
    let path = std::env::var_os("PATH").ok_or_else(|| anyhow::anyhow!("PATH is not set"))?;
    executable_from_path(tool, &path)
}

fn executable_from_path(tool: &str, path: &std::ffi::OsStr) -> Result<PathBuf> {
    let extensions: &[&str] = if cfg!(windows) { &["exe"] } else { &[""] };
    for directory in std::env::split_paths(path) {
        for extension in extensions {
            let name = if extension.is_empty() {
                tool.to_string()
            } else {
                format!("{tool}.{extension}")
            };
            let candidate = directory.join(name);
            if !candidate.is_file() {
                continue;
            }
            #[cfg(unix)]
            {
                let file_name = candidate
                    .file_name()
                    .ok_or_else(|| anyhow::anyhow!("Executable path has no file name"))?;
                let parent = candidate
                    .parent()
                    .filter(|parent| !parent.as_os_str().is_empty())
                    .unwrap_or(std::path::Path::new("."));
                return Ok(std::fs::canonicalize(parent)?.join(file_name));
            }
            #[cfg(windows)]
            return candidate.canonicalize().map_err(Into::into);
        }
    }
    bail!("{tool} is not installed as a native executable on PATH")
}

#[cfg(windows)]
fn windows_npm_search_roots(
    path_entries: impl IntoIterator<Item = PathBuf>,
    nvm_symlink: Option<PathBuf>,
    app_data: Option<PathBuf>,
    program_files: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut roots = path_entries.into_iter().collect::<Vec<_>>();
    if let Some(nvm_symlink) = nvm_symlink {
        roots.push(nvm_symlink);
    }
    if let Some(app_data) = app_data {
        roots.push(app_data.join("npm"));
    }
    if let Some(program_files) = program_files {
        roots.push(program_files.join("nodejs"));
    }
    roots
}

#[cfg(windows)]
fn windows_npm_codex_binary(paths: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    const PLATFORM_BINARY: &str = "vendor/x86_64-pc-windows-msvc/bin/codex.exe";
    const PACKAGE_LAYOUTS: &[&str] = &[
        "node_modules/@openai/codex/node_modules/@openai/codex-win32-x64",
        "node_modules/@openai/codex-win32-x64",
        "node_modules/@openai/codex",
    ];

    for path in paths {
        for ancestor in path.ancestors() {
            for layout in PACKAGE_LAYOUTS {
                let executable = ancestor.join(layout).join(PLATFORM_BINARY);
                if executable.is_file() {
                    return executable.canonicalize().ok();
                }
            }
        }
    }
    None
}

#[cfg(all(test, windows))]
mod tests {
    use super::{windows_npm_codex_binary, windows_npm_search_roots};
    use std::path::PathBuf;

    #[test]
    fn finds_codex_in_the_nested_windows_npm_package() {
        let root = std::env::temp_dir().join(format!(
            "{}-codex-app-server-{}-{}",
            env!("APP_COMMAND"),
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let prefix = root.join("npm");
        let executable = prefix.join(
            "node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
        );
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, b"").unwrap();

        let resolved = windows_npm_codex_binary([PathBuf::from(&prefix)]).unwrap();

        assert_eq!(resolved, executable.canonicalize().unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn finds_codex_under_nvm_symlink_when_node_is_not_on_path() {
        let root = std::env::temp_dir().join(format!(
            "{}-codex-nvm-path-{}-{}",
            env!("APP_COMMAND"),
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let nvm_symlink = root.join("nodejs");
        let executable = nvm_symlink.join(
            "node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
        );
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, b"").unwrap();

        let roots = windows_npm_search_roots([], Some(nvm_symlink.clone()), None, None);
        let resolved = super::windows_npm_codex_binary(roots).unwrap();

        assert_eq!(resolved, executable.canonicalize().unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn finds_codex_under_the_standard_npm_root_when_node_is_not_on_path() {
        let root = std::env::temp_dir().join(format!(
            "{}-codex-npm-root-{}-{}",
            env!("APP_COMMAND"),
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let app_data = root.join("roaming");
        let executable = app_data.join(
            "npm/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
        );
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, b"").unwrap();

        let roots = windows_npm_search_roots([], None, Some(app_data), None);
        let resolved = super::windows_npm_codex_binary(roots).unwrap();

        assert_eq!(resolved, executable.canonicalize().unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn finds_codex_under_the_system_node_root_when_node_is_not_on_path() {
        let root = std::env::temp_dir().join(format!(
            "{}-codex-system-node-{}-{}",
            env!("APP_COMMAND"),
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let program_files = root.join("program-files");
        let executable = program_files.join(
            "nodejs/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
        );
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, b"").unwrap();

        let roots = windows_npm_search_roots([], None, None, Some(program_files));
        let resolved = super::windows_npm_codex_binary(roots).unwrap();

        assert_eq!(resolved, executable.canonicalize().unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
}

/// How long one request may take, connecting included. The slowest answers (a diff of a large
/// tree, a new checkout) take seconds; a daemon that says nothing for this long is stuck, and the
/// window must be told so instead of waiting on it for ever.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// Connections kept open between questions, so each one does not connect and say hello again:
/// an open chat asks several times a second. Only a `Query` uses them. It changes nothing, so
/// when a kept connection turns out to be dead (its daemon restarted) the question is simply
/// asked again on a new one; a command asked twice could act twice.
static IDLE_CONNECTIONS: IdleConnections = std::sync::Mutex::new(Vec::new());
const MAX_IDLE_CONNECTIONS: usize = 4;
/// Another machine's lines are ssh processes, so fewer are kept for each.
const MAX_IDLE_REMOTE_CONNECTIONS: usize = 2;

/// One line to a daemon: what it reads, what it writes.
pub type Connection = (ipc::Reader, ipc::Writer);
/// Kept lines, each with when it was last used.
type IdleConnections = std::sync::Mutex<Vec<(Connection, std::time::Instant)>>;

/// A kept line unused for longer is closed rather than tried. An open chat asks every few seconds,
/// so a line that sat this long most likely outlived a sleep or a network change, and a line to
/// another machine that died that way says nothing until ssh's own check gives up (45 s).
const KEPT_FOR: Duration = Duration::from_secs(30);
/// How long a question waits on a kept line before it is asked again on a new one. It is a
/// `Query`, so asking twice changes nothing; a live line answers a page well within this.
const KEPT_ANSWER_WITHIN: Duration = Duration::from_secs(8);

/// Where a request goes: this computer's daemon, started when none answers, or another machine's.
#[derive(Clone)]
pub enum Daemon {
    Local(PathBuf),
    Remote(RemoteDaemon),
}

impl From<PathBuf> for Daemon {
    fn from(daemon_executable: PathBuf) -> Daemon {
        Daemon::Local(daemon_executable)
    }
}

type Opening = Pin<Box<dyn Future<Output = Result<Connection>> + Send>>;

/// Another machine's daemon, reached over lines the caller knows how to open. The host makes the
/// lines (the ssh line, attach only, ADR 0007) and says how to vet a reply, so this crate holds no
/// ssh and trusts nothing a remote says: every reply goes through `vet` before anything reads it.
#[derive(Clone)]
pub struct RemoteDaemon {
    /// Whose list it is in and the machine's number there, which never names another machine.
    key: RemoteKey,
    name: String,
    open: Arc<dyn Fn() -> Opening + Send + Sync>,
    vet: Arc<dyn Fn(Reply) -> Result<Reply, String> + Send + Sync>,
}

impl RemoteDaemon {
    pub fn new(
        key: RemoteKey,
        name: String,
        open: impl Fn() -> Opening + Send + Sync + 'static,
        vet: impl Fn(Reply) -> Result<Reply, String> + Send + Sync + 'static,
    ) -> RemoteDaemon {
        RemoteDaemon {
            key,
            name,
            open: Arc::new(open),
            vet: Arc::new(vet),
        }
    }

    async fn request(&self, message: ClientMsg, limit: Duration) -> Result<Reply> {
        let idle = remote_idle(self.key);
        let asked = ask_reusing(&idle, MAX_IDLE_REMOTE_CONNECTIONS, &message, || {
            (self.open)()
        });
        let reply = match tokio::time::timeout(limit, asked).await {
            Ok(answer) => answer.with_context(|| format!("asking {}", self.name))?,
            Err(_) => bail!(
                "{} did not answer within {} seconds",
                self.name,
                limit.as_secs()
            ),
        };
        (self.vet)(reply).map_err(|why| anyhow::anyhow!("{} sent an answer that was refused: {why}", self.name))
    }
}

/// The lines kept for each machine, by its number for this run. A machine's number is never
/// reused (ADR 0007), so one machine's lines cannot serve another.
static REMOTE_IDLE: std::sync::Mutex<BTreeMap<RemoteKey, Arc<IdleConnections>>> =
    std::sync::Mutex::new(BTreeMap::new());

/// A machine as the kept lines know it: the list it is in (each machines hub numbers its own from
/// 1) and its number there.
pub type RemoteKey = (u64, u16);

fn remote_idle(key: RemoteKey) -> Arc<IdleConnections> {
    let mut all = REMOTE_IDLE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    all.entry(key).or_default().clone()
}

/// Close the lines kept for a machine that was taken out of the list.
pub fn forget_remote(key: RemoteKey) {
    REMOTE_IDLE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&key);
}

/// Whether asking `query` a second time, after a kept line failed or went quiet while the first
/// may still be running, changes nothing. Only these go out on kept lines: a commit, push or pull
/// request asked twice would act twice. Every variant is listed so a new one must be decided.
fn safe_to_ask_twice(query: &Query) -> bool {
    match query {
        Query::Git { .. }
        | Query::GitIdentityRule { .. }
        | Query::CloneRepo { .. }
        | Query::FolderGit { .. }
        | Query::CreateFolder { .. }
        | Query::Extensions { .. }
        | Query::SideAnswer { .. } => false,
        Query::Settings
        | Query::AllowedCommands
        | Query::ConversationRead { .. }
        | Query::ConversationDiff { .. }
        | Query::ConversationFiles { .. }
        | Query::ConversationFileRead { .. }
        | Query::ConversationTerminalScreen { .. }
        | Query::ConversationTerminalReplay { .. }
        | Query::TerminalScreen { .. }
        | Query::TerminalReplay { .. }
        | Query::Repo { .. }
        | Query::PaneSearch { .. }
        | Query::UsageReport { .. }
        | Query::ListFolders { .. }
        | Query::AgentSignIn { .. }
        | Query::MachineFacts { .. }
        | Query::GitHubAccounts { .. }
        | Query::GitHubRepos { .. }
        | Query::GitHubOwners { .. }
        | Query::AgentCommands { .. }
        | Query::Repositories { .. }
        | Query::GitIdentities { .. }
        | Query::SavedConversations { .. }
        | Query::List
        | Query::HelperRead { .. }
        | Query::Specialists { .. }
        | Query::Read { .. }
        | Query::Worktrees { .. }
        | Query::WorktreeStanding { .. }
        | Query::CheckOutput { .. }
        | Query::ClosedSessions => true,
    }
}

async fn ask(connection: &mut Connection, message: &ClientMsg) -> Result<Reply> {
    ipc::send_message(&mut connection.1, message).await?;
    receive_reply(&mut connection.0).await
}

/// Ask `message`: on a kept connection when it is a question, else on one from `open`. At most
/// `keep_at_most` are kept.
async fn ask_reusing<Open, Opening>(
    idle: &IdleConnections,
    keep_at_most: usize,
    message: &ClientMsg,
    open: Open,
) -> Result<Reply>
where
    Open: FnOnce() -> Opening,
    Opening: std::future::Future<Output = Result<Connection>>,
{
    ask_reusing_within(idle, keep_at_most, message, open, KEPT_ANSWER_WITHIN).await
}

/// `ask_reusing`, giving a kept line `kept_wait` to answer before the question goes on a new one.
async fn ask_reusing_within<Open, Opening>(
    idle: &IdleConnections,
    keep_at_most: usize,
    message: &ClientMsg,
    open: Open,
    kept_wait: Duration,
) -> Result<Reply>
where
    Open: FnOnce() -> Opening,
    Opening: std::future::Future<Output = Result<Connection>>,
{
    let reusable = matches!(message, ClientMsg::Query(query) if safe_to_ask_twice(query));
    let keep = |connection: Connection| {
        if let Ok(mut idle) = idle.lock()
            && idle.len() < keep_at_most
        {
            idle.push((connection, std::time::Instant::now()));
        }
    };
    let kept = if reusable {
        idle.lock().ok().and_then(|mut idle| {
            // The newest is last; one that sat too long is dropped, and so is every older one.
            let fresh = idle.pop().filter(|(_, since)| since.elapsed() < KEPT_FOR);
            if fresh.is_none() {
                idle.clear();
            }
            fresh.map(|(connection, _)| connection)
        })
    } else {
        None
    };
    // The daemon refusing a question is an answer on a line that works: the line is kept and the
    // refusal returned, not asked again on a new one (on another machine, a new ssh process).
    if let Some(mut kept) = kept
        && let Ok(Ok(answer)) = tokio::time::timeout(kept_wait, ask_answer(&mut kept, message)).await
    {
        keep(kept);
        return answer.map_err(|refused| anyhow::anyhow!(refused));
    }
    let mut fresh = open().await?;
    let answer = ask_answer(&mut fresh, message).await?;
    if reusable {
        keep(fresh);
    }
    answer.map_err(|refused| anyhow::anyhow!(refused))
}

async fn request(message: ClientMsg, daemon: impl Into<Daemon>) -> Result<Reply> {
    request_within(message, daemon, REQUEST_TIMEOUT).await
}

/// `request`, for a question the daemon may take up to `limit` to answer.
async fn request_within(message: ClientMsg, daemon: impl Into<Daemon>, limit: Duration) -> Result<Reply> {
    match daemon.into() {
        Daemon::Local(daemon_executable) => {
            answered_within(
                limit,
                ask_reusing(&IDLE_CONNECTIONS, MAX_IDLE_CONNECTIONS, &message, || async {
                    ipc::open_or_spawn_for_user(&daemon_executable)
                        .await
                        .context("Could not reach the Maiker service")
                }),
            )
            .await
        }
        Daemon::Remote(remote) => remote.request(message, limit).await,
    }
}

#[cfg(test)]
mod kept_connection_tests {
    use super::{Connection, Daemon, IdleConnections, MAX_IDLE_CONNECTIONS, RemoteDaemon, ask_reusing, forget_remote, request};
    use maitty_shared::protocol::{ClientMsg, Command, Query, Reply, ServerMsg};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A connection to a daemon that answers everything with `Ok`, until `answers` have gone out.
    fn daemon_answering(answers: usize) -> Connection {
        let (ours, theirs) = tokio::io::duplex(64 * 1024);
        let (their_read, their_write) = tokio::io::split(theirs);
        let (mut reader, mut writer) = maitty_ipc_transport::framed_parts(their_read, their_write);
        tokio::spawn(async move {
            for _ in 0..answers {
                let Ok(Some(_)) = maitty_ipc_transport::receive::<ClientMsg>(&mut reader).await
                else {
                    return;
                };
                if maitty_ipc_transport::send(&mut writer, &ServerMsg::Reply(Reply::Ok))
                    .await
                    .is_err()
                {
                    return;
                }
            }
        });
        let (our_read, our_write) = tokio::io::split(ours);
        maitty_ipc_transport::framed_parts(our_read, our_write)
    }

    fn question() -> ClientMsg {
        ClientMsg::Query(Query::Settings)
    }

    #[tokio::test]
    async fn a_second_question_goes_out_on_the_connection_the_first_one_opened() {
        let idle = IdleConnections::default();
        let opened = Arc::new(AtomicUsize::new(0));
        for _ in 0..3 {
            let opened = opened.clone();
            let reply = ask_reusing(&idle, MAX_IDLE_CONNECTIONS, &question(), || async move {
                opened.fetch_add(1, Ordering::SeqCst);
                Ok(daemon_answering(usize::MAX))
            })
            .await;
            assert!(matches!(reply, Ok(Reply::Ok)));
        }
        assert_eq!(opened.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_question_on_a_kept_connection_whose_daemon_went_away_is_asked_again_on_a_new_one() {
        let idle = IdleConnections::default();
        let opened = Arc::new(AtomicUsize::new(0));
        for _ in 0..2 {
            let opened = opened.clone();
            let reply = ask_reusing(&idle, MAX_IDLE_CONNECTIONS, &question(), || async move {
                opened.fetch_add(1, Ordering::SeqCst);
                // Each daemon answers once and is gone.
                Ok(daemon_answering(1))
            })
            .await;
            assert!(matches!(reply, Ok(Reply::Ok)));
        }
        assert_eq!(opened.load(Ordering::SeqCst), 2);
    }

    /// A remote machine whose lines each answer everything with `Ok`; `opened` counts the lines made.
    fn remote(key: u16, opened: &Arc<AtomicUsize>, vet_ok: bool) -> RemoteDaemon {
        let opened = opened.clone();
        RemoteDaemon::new(
            (0, key),
            "box".into(),
            move || {
                opened.fetch_add(1, Ordering::SeqCst);
                Box::pin(async { Ok(daemon_answering(usize::MAX)) })
            },
            move |reply| if vet_ok { Ok(reply) } else { Err("not a reply it may give".into()) },
        )
    }

    #[tokio::test]
    async fn a_remote_machines_questions_reuse_its_own_lines_and_no_other_machines() {
        let (first, second) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
        for _ in 0..3 {
            request(question(), Daemon::Remote(remote(60_001, &first, true))).await.unwrap();
        }
        request(question(), Daemon::Remote(remote(60_002, &second, true))).await.unwrap();
        assert_eq!(first.load(Ordering::SeqCst), 1);
        assert_eq!(second.load(Ordering::SeqCst), 1, "a line kept for one machine never serves another");

        forget_remote((0, 60_001));
        request(question(), Daemon::Remote(remote(60_001, &first, true))).await.unwrap();
        assert_eq!(first.load(Ordering::SeqCst), 2, "a machine taken out of the list keeps no lines");
        forget_remote((0, 60_001));
        forget_remote((0, 60_002));
    }

    #[tokio::test]
    async fn an_answer_the_host_will_not_vet_is_an_error_not_a_reply() {
        let opened = Arc::new(AtomicUsize::new(0));
        let failure = request(question(), Daemon::Remote(remote(60_003, &opened, false)))
            .await
            .unwrap_err();
        assert!(format!("{failure:#}").contains("refused"), "{failure:#}");
        forget_remote((0, 60_003));
    }

    /// A line whose far end takes questions and never answers, like an ssh line that died quietly.
    fn silent_line() -> Connection {
        let (ours, theirs) = tokio::io::duplex(64 * 1024);
        tokio::spawn(async move {
            let _held = theirs;
            std::future::pending::<()>().await;
        });
        let (our_read, our_write) = tokio::io::split(ours);
        maitty_ipc_transport::framed_parts(our_read, our_write)
    }

    #[tokio::test]
    async fn a_kept_line_that_went_quiet_is_given_up_quickly_and_the_question_asked_on_a_new_one() {
        let idle = IdleConnections::default();
        idle.lock().unwrap().push((silent_line(), std::time::Instant::now()));
        let wait = std::time::Duration::from_millis(50);

        let reply = super::ask_reusing_within(&idle, MAX_IDLE_CONNECTIONS, &question(), || async { Ok(daemon_answering(1)) }, wait).await;

        assert!(matches!(reply, Ok(Reply::Ok)), "asked again on a new line");
        assert!(super::KEPT_ANSWER_WITHIN < super::REQUEST_TIMEOUT / 2, "well before the request gives up");
    }

    #[tokio::test]
    async fn a_kept_line_that_sat_too_long_is_not_tried() {
        let idle = IdleConnections::default();
        let long_ago = std::time::Instant::now().checked_sub(super::KEPT_FOR * 2).expect("a clock that far back");
        idle.lock().unwrap().push((silent_line(), long_ago));
        let opened = Arc::new(AtomicUsize::new(0));
        let counted = opened.clone();

        let reply = ask_reusing(&idle, MAX_IDLE_CONNECTIONS, &question(), || async move {
            counted.fetch_add(1, Ordering::SeqCst);
            Ok(daemon_answering(1))
        })
        .await;

        assert!(matches!(reply, Ok(Reply::Ok)));
        assert_eq!(opened.load(Ordering::SeqCst), 1);
    }

    /// A daemon that refuses every question with an error, and keeps the line.
    fn daemon_refusing() -> Connection {
        let (ours, theirs) = tokio::io::duplex(64 * 1024);
        let (their_read, their_write) = tokio::io::split(theirs);
        let (mut reader, mut writer) = maitty_ipc_transport::framed_parts(their_read, their_write);
        tokio::spawn(async move {
            while let Ok(Some(_)) = maitty_ipc_transport::receive::<ClientMsg>(&mut reader).await {
                let refused = ServerMsg::Error("no such conversation".into());
                if maitty_ipc_transport::send(&mut writer, &refused).await.is_err() {
                    return;
                }
            }
        });
        let (our_read, our_write) = tokio::io::split(ours);
        maitty_ipc_transport::framed_parts(our_read, our_write)
    }

    #[tokio::test]
    async fn a_refusal_on_a_kept_line_is_the_answer_and_opens_no_new_line() {
        let idle = IdleConnections::default();
        idle.lock().unwrap().push((daemon_refusing(), std::time::Instant::now()));
        let opened = Arc::new(AtomicUsize::new(0));
        for _ in 0..3 {
            let counted = opened.clone();
            let reply = ask_reusing(&idle, MAX_IDLE_CONNECTIONS, &question(), || async move {
                counted.fetch_add(1, Ordering::SeqCst);
                Ok(daemon_refusing())
            })
            .await;
            assert_eq!(reply.unwrap_err().to_string(), "no such conversation");
        }
        assert_eq!(opened.load(Ordering::SeqCst), 0, "the one line answered every time");
    }

    #[tokio::test]
    async fn a_push_never_goes_out_on_a_kept_line_so_it_is_never_sent_twice() {
        use maitty_shared::protocol::GitRequest;
        let idle = IdleConnections::default();
        idle.lock().unwrap().push((silent_line(), std::time::Instant::now()));
        let push = ClientMsg::Query(Query::Git { term: 1, request: GitRequest::Push, tag: 0 });
        let wait = std::time::Duration::from_millis(50);

        let reply = super::ask_reusing_within(&idle, MAX_IDLE_CONNECTIONS, &push, || async { Ok(daemon_answering(1)) }, wait).await;

        assert!(matches!(reply, Ok(Reply::Ok)));
        assert_eq!(idle.lock().unwrap().len(), 1, "the kept line was left alone, and the new one not kept");
    }

    #[tokio::test]
    async fn a_command_never_goes_out_on_a_kept_connection_and_leaves_none_behind() {
        let idle = IdleConnections::default();
        idle.lock().unwrap().push((daemon_answering(0), std::time::Instant::now()));
        let command = ClientMsg::Command(Command::SelectWorkspace { ws: 1 });

        let reply = ask_reusing(&idle, MAX_IDLE_CONNECTIONS, &command, || async { Ok(daemon_answering(1)) }).await;

        assert!(matches!(reply, Ok(Reply::Ok)));
        assert_eq!(idle.lock().unwrap().len(), 1, "only the one that was there");
    }
}

async fn answered_within<T>(
    limit: Duration,
    request: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    match tokio::time::timeout(limit, request).await {
        Ok(answer) => answer,
        Err(_) => bail!(
            "the local daemon did not answer within {} seconds",
            limit.as_secs()
        ),
    }
}

#[cfg(test)]
mod request_timeout_tests {
    use super::answered_within;
    use std::time::Duration;

    #[tokio::test]
    async fn a_request_the_daemon_never_answers_fails_instead_of_waiting_for_ever() {
        let stuck = std::future::pending::<anyhow::Result<()>>();

        let error = answered_within(Duration::from_millis(20), stuck)
            .await
            .unwrap_err();

        assert!(error.to_string().contains("did not answer"), "{error}");
    }

    #[tokio::test]
    async fn an_answer_in_time_is_passed_on_as_it_is() {
        let answer = answered_within(Duration::from_secs(5), async { Ok(7) }).await;

        assert_eq!(answer.unwrap(), 7);
    }
}

/// Ask `message` and tell the daemon's refusal (the inner `Err`, the line still good) from a line
/// that failed (the outer one).
async fn ask_answer(connection: &mut Connection, message: &ClientMsg) -> Result<std::result::Result<Reply, String>> {
    ipc::send_message(&mut connection.1, message).await?;
    loop {
        match ipc::receive_server(&mut connection.0).await? {
            Some(ServerMsg::Reply(reply)) => return Ok(Ok(reply)),
            Some(ServerMsg::Error(error)) => return Ok(Err(error)),
            Some(ServerMsg::Bye) | None => bail!("The Maiker service closed the connection before answering. Try again; if it keeps happening, restart it in Settings."),
            Some(_) => continue,
        }
    }
}

async fn receive_reply(reader: &mut ipc::Reader) -> Result<Reply> {
    loop {
        match ipc::receive_server(reader).await? {
            Some(ServerMsg::Reply(reply)) => return Ok(reply),
            Some(ServerMsg::Error(error)) => bail!(error),
            Some(ServerMsg::Bye) => bail!("The Maiker service closed the connection before answering. Try again; if it keeps happening, restart it in Settings."),
            Some(_) => continue,
            None => bail!("The Maiker service closed the connection before answering. Try again; if it keeps happening, restart it in Settings."),
        }
    }
}

#[cfg(test)]
mod restart_confirmation_tests {
    use super::{
        Activity, can_restart_mismatched_daemon, is_daemon_command_line, stopped_daemon_is_gone,
        update_status, validate_restart_activity, validate_restart_confirmation,
    };

    #[test]
    fn a_daemon_that_took_over_the_socket_means_the_stopped_one_is_gone() {
        assert!(stopped_daemon_is_gone(7, false, Some(7)));
        assert!(stopped_daemon_is_gone(7, false, None));
        assert!(stopped_daemon_is_gone(7, true, Some(8)));
        assert!(!stopped_daemon_is_gone(7, true, Some(7)));
        assert!(!stopped_daemon_is_gone(7, true, None));
    }

    #[test]
    fn the_daemon_to_restart_may_be_the_terminal_apps_or_the_one_the_desktop_app_bundles() {
        let command = env!("APP_COMMAND");
        let daemon = maitty_shared::brand::DAEMON_NAME;
        // A service started before the rename keeps its old name until it is restarted.
        let old = maitty_shared::brand::previous_daemon_names()
            .next()
            .expect("the old bundled name is carried");
        let line = |program: &str, args: &str| format!("{program}\0{args}\0").into_bytes();
        for program in [
            format!("/home/me/.local/bin/{command}"),
            command.to_string(),
            format!("/tmp/.mount_AppXyZ/usr/bin/{daemon}"),
            format!("/repo/target/debug/{daemon}-x86_64-unknown-linux-gnu"),
            format!("/tmp/.mount_AppXyZ/usr/bin/{old}"),
            format!("/repo/target/debug/{old}-x86_64-unknown-linux-gnu"),
            format!(r"C:\Users\me\AppData\Local\Maiker\{command}.exe"),
            format!(r"C:\Program Files\Maiker\{daemon}.EXE"),
            format!(r"C:\Program Files\Maiker\{old}.EXE"),
        ] {
            assert!(is_daemon_command_line(&line(&program, "daemon")), "{program}");
        }
        for (program, args) in [
            (format!("/usr/bin/not{command}"), "daemon"),
            (format!("/usr/bin/{daemon}x"), "daemon"),
            (format!("/usr/bin/{command}"), "mcp"),
            (format!("/usr/bin/{command}"), ""),
            ("/usr/bin/bash".to_string(), "daemon"),
        ] {
            assert!(!is_daemon_command_line(&line(&program, args)), "{program} {args}");
        }
        assert!(!is_daemon_command_line(b""));
    }

    #[test]
    fn accepts_only_the_confirmed_older_protocol() {
        let current = maitty_shared::protocol::PROTOCOL_VERSION;
        assert!(validate_restart_confirmation(current - 1, current - 1).is_ok());
        assert!(validate_restart_confirmation(current - 2, current - 1).is_err());
        assert!(validate_restart_confirmation(current + 1, current + 1).is_err());
    }

    fn activity(sessions: usize, working: usize, waiting: usize) -> Activity {
        Activity {
            pid: 1,
            version: "0.71.0".into(),
            sessions,
            working,
            waiting,
        }
    }

    #[test]
    fn an_older_service_with_saved_sessions_can_be_replaced_even_mid_turn() {
        let older = maitty_shared::protocol::PROTOCOL_VERSION - 1;
        assert!(can_restart_mismatched_daemon(
            older,
            Some(&activity(4, 1, 1)),
            true
        ));
        assert!(can_restart_mismatched_daemon(older, None, true));
    }

    #[test]
    fn an_older_service_with_no_sessions_can_be_replaced() {
        let older = maitty_shared::protocol::PROTOCOL_VERSION - 1;
        assert!(can_restart_mismatched_daemon(
            older,
            Some(&activity(0, 0, 0)),
            false
        ));
    }

    #[test]
    fn sessions_that_are_not_saved_are_never_thrown_away() {
        let older = maitty_shared::protocol::PROTOCOL_VERSION - 1;
        assert!(!can_restart_mismatched_daemon(
            older,
            Some(&activity(2, 0, 0)),
            false
        ));
        assert!(!can_restart_mismatched_daemon(older, None, false));
        assert!(validate_restart_activity(Some(&activity(2, 0, 0)), false).is_err());
        assert!(validate_restart_activity(None, false).is_err());
        assert!(validate_restart_activity(Some(&activity(2, 1, 0)), true).is_ok());
        assert!(validate_restart_activity(Some(&activity(0, 0, 0)), false).is_ok());
    }

    #[test]
    fn a_daemon_a_release_behind_is_reported_with_what_a_restart_costs() {
        let status = update_status(Some(&activity(11, 1, 0)), "0.72.0", true);

        assert_eq!(status["behind"], true);
        assert_eq!(status["daemonVersion"], "0.71.0");
        assert_eq!(status["canRestart"], true, "its sessions are saved");
        assert_eq!(status["sessionCount"], 11);
        assert_eq!(status["activeTurnCount"], 1);
    }

    #[test]
    fn a_behind_daemon_whose_sessions_are_not_saved_is_reported_but_not_restartable() {
        let status = update_status(Some(&activity(3, 0, 0)), "0.72.0", false);

        assert_eq!(status["behind"], true);
        assert_eq!(status["canRestart"], false);
    }

    #[test]
    fn a_daemon_on_this_release_or_newer_or_silent_is_not_behind() {
        for version in ["0.72.0", "0.73.0", ""] {
            let mut current = activity(2, 0, 0);
            current.version = version.into();
            let status = update_status(Some(&current), "0.72.0", true);
            assert_eq!(status["behind"], false, "{version:?}");
            assert_eq!(status["canRestart"], false, "{version:?}");
        }
        assert_eq!(update_status(None, "0.72.0", true)["behind"], false);
    }

    #[test]
    fn a_newer_service_is_never_replaced_by_an_older_gui() {
        assert!(!can_restart_mismatched_daemon(
            maitty_shared::protocol::PROTOCOL_VERSION + 1,
            Some(&activity(0, 0, 0)),
            true
        ));
    }
}

#[cfg(all(test, unix))]
mod executable_lookup_tests {
    use super::executable_from_path;
    use std::os::unix::fs::{PermissionsExt, symlink};

    #[test]
    fn preserves_a_mise_shim_name_when_resolving_codex() {
        let directory = std::env::temp_dir().join(format!(
            "{}-mise-shim-{}-{}",
            env!("APP_COMMAND"),
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let mise = directory.join("mise");
        std::fs::write(&mise, "#!/bin/sh\nprintf '%s\\n' \"$0\" \"$1\"\n").unwrap();
        std::fs::set_permissions(&mise, std::fs::Permissions::from_mode(0o755)).unwrap();
        let codex = directory.join("codex");
        symlink(&mise, &codex).unwrap();
        let path = std::env::join_paths([&directory]).unwrap();

        let executable = executable_from_path("codex", &path).unwrap();
        let output = std::process::Command::new(&executable)
            .arg("app-server")
            .output()
            .unwrap();
        let expected = format!(
            "{}\napp-server\n",
            std::path::absolute(&codex).unwrap().display()
        );

        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout), expected);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[cfg(test)]
mod windows_claude_tests {
    use super::windows_claude_from;

    fn folder(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("{}-{name}-{}", env!("APP_COMMAND"), std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn claude_is_found_on_path_then_in_its_installers_folder_then_as_an_npm_batch_file() {
        let root = folder("claude-lookup");
        let (on_path, home) = (root.join("bin"), root.join("home"));
        let installed = home.join(".local").join("bin");
        std::fs::create_dir_all(&on_path).unwrap();
        std::fs::create_dir_all(&installed).unwrap();
        let path = std::env::join_paths([&on_path]).unwrap();

        assert_eq!(windows_claude_from(&path, Some(&home)), None);
        std::fs::write(on_path.join("claude.cmd"), b"").unwrap();
        assert_eq!(windows_claude_from(&path, Some(&home)), Some(on_path.join("claude.cmd")));
        std::fs::write(installed.join("claude.exe"), b"").unwrap();
        assert_eq!(windows_claude_from(&path, Some(&home)), installed.join("claude.exe").canonicalize().ok());
        std::fs::write(on_path.join("claude.exe"), b"").unwrap();
        assert_eq!(windows_claude_from(&path, Some(&home)), on_path.join("claude.exe").canonicalize().ok());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod agent_command_tests {
    use super::agent_command;

    #[test]
    fn the_github_sign_in_is_one_fixed_line_whatever_folder_it_starts_in() {
        use super::{ClientMsg, Command, github_sign_in_message};
        for folder in ["~", "/home/dev", "; rm -rf ~"] {
            let ClientMsg::Command(Command::NewWorkspace { cwd, name, cmd }) = github_sign_in_message(folder.into()) else {
                panic!("a sign-in is a new terminal session");
            };
            assert_eq!(cmd.as_deref(), Some("gh auth login --web --git-protocol https"));
            assert_eq!((cwd, name), (Some(folder.into()), None));
        }
    }

    fn words(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_string()).collect()
    }

    #[test]
    fn an_agent_and_its_flags_make_one_command_line() {
        assert_eq!(agent_command("claude", &[]).unwrap(), "claude");
        assert_eq!(
            agent_command("claude", &words(&["--model", "opus", "--effort", "high"])).unwrap(),
            "claude --model opus --effort high"
        );
        assert_eq!(
            agent_command("codex", &words(&["-c", "model_reasoning_effort=high"])).unwrap(),
            "codex -c model_reasoning_effort=high"
        );
    }

    #[test]
    fn an_unknown_agent_or_a_flag_that_could_add_a_command_is_refused() {
        assert!(agent_command("rm", &[]).is_err());
        for bad in ["a;b", "$(x)", "a b", "`x`", "a&&b", "a|b", "", "a\nb"] {
            assert!(agent_command("claude", &words(&[bad])).is_err(), "{bad:?} was allowed");
        }
    }

    #[test]
    fn keeping_an_agent_warm_asks_for_the_same_line_a_start_sends_and_refuses_what_a_start_refuses() {
        use super::{ClientMsg, Command, prewarm_message};
        let here = std::env::temp_dir();
        let flags = words(&["--model", "opus"]);
        match prewarm_message(here.clone(), "claude", &flags).unwrap() {
            ClientMsg::Command(Command::Prewarm { cwd, cmd }) => {
                assert_eq!(cmd, agent_command("claude", &flags).unwrap());
                assert_eq!(cwd, here.canonicalize().unwrap());
            }
            other => panic!("{other:?}"),
        }
        assert!(prewarm_message(here.clone(), "rm", &[]).is_err());
        assert!(prewarm_message(here.clone(), "claude", &words(&["a;b"])).is_err());
        assert!(prewarm_message(here.join("no-such-folder-here"), "claude", &[]).is_err());
    }

    #[test]
    fn a_message_queued_for_a_working_agent_is_checked_and_one_is_dropped_only_by_a_daemon_that_can() {
        use super::{ClientMsg, Command, PaneCommand, daemon_reads, queued_message};
        use maitty_shared::protocol::PROTOCOL_VERSION;
        assert!(queued_message("  ".into(), false).is_err());
        assert!(queued_message("x".repeat(super::MAX_HELD_MESSAGE_BYTES + 1), false).is_err());
        assert!(matches!(
            queued_message("/model opus".into(), true).unwrap().message(4),
            ClientMsg::Command(Command::QueueFollowUp { term: 4, text, first: true, operation: None }) if text == "/model opus"
        ));
        let drop = PaneCommand::DropQueued {
            index: 1,
            text: "then test".into(),
        }
        .message(4);
        assert!(matches!(
            &drop,
            ClientMsg::Command(Command::DropQueued { term: 4, index: 1, text }) if text == "then test"
        ));
        assert!(daemon_reads(&drop, PROTOCOL_VERSION));
    }


    #[test]
    fn a_terminal_send_carries_its_operation_only_to_a_daemon_that_honours_it() {
        use super::{ClientMsg, Command, held_message, named_send, queued_message};
        use maitty_shared::protocol::PROTOCOL_VERSION;
        // The window draws operations within a JavaScript number's exact integers; the largest arrives whole.
        const LARGEST: u64 = (1 << 53) - 1;
        assert_eq!(serde_json::from_str::<u64>("9007199254740991").unwrap(), LARGEST);
        let held = held_message("fix it".into()).unwrap().message(3);
        let queued = queued_message("next".into(), false).unwrap().message(3);
        assert!(matches!(
            named_send(held.clone(), LARGEST, PROTOCOL_VERSION),
            ClientMsg::Command(Command::SendWhenReady { term: 3, operation: Some(LARGEST), .. })
        ));
        assert!(matches!(
            named_send(queued.clone(), 9, PROTOCOL_VERSION),
            ClientMsg::Command(Command::QueueFollowUp { term: 3, operation: Some(9), .. })
        ));
    }



    #[test]
    fn a_worktree_standing_reaches_the_app_with_missing_said() {
        use super::standing_shown;
        use maitty_shared::protocol::WorktreeStanding;
        let stale = WorktreeStanding {
            dirty: 0,
            branch: Some("task".into()),
            merged: false,
            last_commit: "5 weeks ago".into(),
            inactive_days: Some(30),
        };
        assert_eq!(
            standing_shown(Some(stale)).unwrap(),
            serde_json::json!({ "dirty": 0, "branch": "task", "merged": false, "last_commit": "5 weeks ago", "inactive_days": 30, "missing": false })
        );
        let gone = standing_shown(None).unwrap();
        assert_eq!((gone["missing"].as_bool(), gone["inactive_days"].is_null()), (Some(true), true));
    }



    fn closed_in(cwd: std::path::PathBuf) -> maitty_shared::protocol::ClosedSession {
        maitty_shared::protocol::ClosedSession {
            agent: "claude".into(),
            session: "abc-123".into(),
            cwd,
            branch: Some("dev".into()),
            title: Some("Fix the parser".into()),
            at: 1_700_000_000,
            worktree: None,
            repo: None,
        }
    }

    #[tokio::test]
    async fn a_closed_session_says_whether_its_folder_is_still_there() {
        let here = std::env::temp_dir();
        let gone = here.join("maitty-closed-session-folder-that-was-removed");
        let list = vec![closed_in(here), closed_in(gone)];
        let rows = super::with_folder_presence(list, super::FOLDER_LOOK_LIMIT, |path| path.is_dir())
            .await
            .unwrap();
        assert_eq!(rows[0]["folder_present"], true);
        assert_eq!(rows[1]["folder_present"], false);
        assert_eq!(rows[0]["session"], "abc-123");
        assert_eq!(rows[0]["branch"], "dev");
    }

    #[tokio::test]
    async fn a_folder_that_does_not_answer_in_time_reads_as_missing_and_holds_up_nothing() {
        use std::time::Duration;
        let hung = std::path::PathBuf::from("//dead-share/app");
        let list = vec![closed_in(hung.clone()), closed_in(hung.clone()), closed_in(std::env::temp_dir())];
        let limit = Duration::from_millis(100);
        let started = std::time::Instant::now();
        let rows = super::with_folder_presence(list, limit, move |path| {
            if path == hung {
                std::thread::sleep(Duration::from_secs(2));
            }
            true
        })
        .await
        .unwrap();
        assert!(started.elapsed() < Duration::from_secs(1), "the looks run side by side under one deadline");
        assert_eq!(rows[0]["folder_present"], false);
        assert_eq!(rows[1]["folder_present"], false);
        assert_eq!(rows[2]["folder_present"], true);
    }

}

#[cfg(test)]
mod pane_command_tests {
    use super::*;

    #[test]
    fn each_pane_command_is_one_message_for_its_pane() {
        let cases = [
            (
                PaneCommand::Input(b"ls\r".to_vec()),
                ClientMsg::Input {
                    term: 4,
                    data: b"ls\r".to_vec(),
                },
            ),
            (PaneCommand::WantReplay, ClientMsg::WantReplay { term: 4 }),
            (
                PaneCommand::Resize {
                    cols: 100,
                    rows: 30,
                },
                ClientMsg::Command(Command::TerminalResize {
                    term: 4,
                    cols: 100,
                    rows: 30,
                }),
            ),
            (
                PaneCommand::Rename("build".into()),
                ClientMsg::Command(Command::RenamePane {
                    term: 4,
                    name: "build".into(),
                }),
            ),
            (
                PaneCommand::SendWhenReady("fix the parser".into()),
                ClientMsg::Command(Command::SendWhenReady {
                    term: 4,
                    text: "fix the parser".into(),
                    operation: None,
                }),
            ),
            (
                PaneCommand::Pin(true),
                ClientMsg::Command(Command::PinPane {
                    term: 4,
                    pinned: true,
                }),
            ),
            (
                PaneCommand::Archive(false),
                ClientMsg::Command(Command::ArchivePane {
                    term: 4,
                    archived: false,
                }),
            ),
            (
                PaneCommand::Snooze(Some(1_000)),
                ClientMsg::Command(Command::SnoozePane {
                    term: 4,
                    until: Some(1_000),
                }),
            ),
            (
                PaneCommand::Snooze(None),
                ClientMsg::Command(Command::SnoozePane {
                    term: 4,
                    until: None,
                }),
            ),
            (
                PaneCommand::Seen,
                ClientMsg::Command(Command::MarkSeen { term: 4 }),
            ),
            (
                PaneCommand::Close,
                ClientMsg::Command(Command::ClosePane { term: 4 }),
            ),
            (
                PaneCommand::CloseSession,
                ClientMsg::Command(Command::CloseSession { term: 4 }),
            ),
            (
                PaneCommand::UndoClose,
                ClientMsg::Command(Command::UndoClose { term: 4 }),
            ),
        ];
        for (command, expected) in cases {
            let shown = format!("{command:?}");
            assert_eq!(
                serde_json::to_string(&command.message(4)).unwrap(),
                serde_json::to_string(&expected).unwrap(),
                "{shown}"
            );
        }
    }
}

#[cfg(test)]
mod chat_posture_tests {
    use super::Permissions;
    use maitty_shared::conversation::{ApprovalPolicy, Sandbox};

    #[test]
    fn a_chat_session_asks_unless_full_access_is_picked() {
        let policy = |picked: &str| Permissions::parse(picked).unwrap().launch_policy();

        assert_eq!(policy("read-only"), (Sandbox::ReadOnly, ApprovalPolicy::OnRequest));
        assert_eq!(policy("workspace-write"), (Sandbox::WorkspaceWrite, ApprovalPolicy::OnRequest));
        assert_eq!(policy("full-access"), (Sandbox::FullAccess, ApprovalPolicy::Never));
    }

    #[test]
    fn a_posture_this_app_does_not_know_is_refused() {
        assert!(Permissions::parse("anything").is_err());
    }
}

/// The workspace-palette indexes a fleet may be coloured with, in the order the window shows
/// them: teal, violet, blue, green, pink, orange. They are positions in the default
/// `ui.workspace_colors`, whose meaning saved colours keep; amber (4) and red are left out so a
/// fleet never looks like a status.
pub const FLEET_COLORS: [u8; 6] = [3, 0, 1, 7, 2, 5];

/// What the window may ask a machine's daemon to do with a fleet (a workspace) or with a session
/// moving between fleets. Like `PaneCommand`, one place makes each message for this computer and
/// for another machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FleetCommand {
    /// A named fleet with one shell; its colour is the first of `FLEET_COLORS` not in use.
    Create { name: String },
    Rename { fleet: u32, name: String },
    /// `color` is a palette index from `FLEET_COLORS`.
    Recolor { fleet: u32, color: u8 },
    /// Move a session to another fleet on the same machine.
    MoveSession { term: u32, fleet: u32 },
    /// A new shell in the fleet, in `folder` or, when that is left out, the fleet's own folder.
    StartShell { fleet: u32, folder: Option<String> },
}

impl FleetCommand {
    /// The message that asks the daemon, or why the window's request is refused.
    pub fn message(self) -> Result<ClientMsg, String> {
        let command = match self {
            FleetCommand::Create { name } => Command::NewFleet {
                name: fleet_name(&name)?,
                cwd: None,
                colors: FLEET_COLORS.to_vec(),
            },
            FleetCommand::Rename { fleet, name } => Command::RenameWorkspace {
                ws: fleet,
                name: fleet_name(&name)?,
            },
            FleetCommand::Recolor { fleet, color } => {
                if !FLEET_COLORS.contains(&color) {
                    return Err("That is not one of the fleet colours".to_string());
                }
                Command::SetWorkspaceColor { ws: fleet, color }
            }
            FleetCommand::MoveSession { term, fleet } => Command::MovePane {
                term,
                to: Some(fleet),
                name: None,
            },
            FleetCommand::StartShell { fleet, folder } => Command::NewShip {
                ws: fleet,
                cwd: folder
                    .map(|f| f.trim().to_string())
                    .filter(|f| !f.is_empty())
                    .map(PathBuf::from),
                cmd: None,
            },
        };
        Ok(ClientMsg::Command(command))
    }
}

/// The most bytes a fleet name may have; the daemon holds the same limit.
const MOST_FLEET_NAME_BYTES: usize = 80;

/// A fleet name as the daemon will take it: trimmed, not empty, short, no control characters.
fn fleet_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.len() > MOST_FLEET_NAME_BYTES || name.chars().any(char::is_control)
    {
        return Err("Give the fleet a short name".to_string());
    }
    Ok(name.to_string())
}

/// Ask this computer's daemon to do `command` to a fleet.
pub async fn fleet_command(command: FleetCommand, daemon_executable: PathBuf) -> Result<Value> {
    let message = command.message().map_err(anyhow::Error::msg)?;
    let reply = request(message, daemon_executable).await?;
    match reply {
        Reply::Ok => Ok(Value::Null),
        _ => bail!("The Maiker service gave an answer this app does not understand (fleet). Restart the service in Settings, or update the app so both are the same version."),
    }
}

#[cfg(test)]
mod fleet_tests {
    use super::{FLEET_COLORS, FleetCommand};
    use maitty_shared::protocol::{ClientMsg, Command};

    fn command(of: FleetCommand) -> Command {
        match of.message().unwrap() {
            ClientMsg::Command(command) => command,
            other => panic!("not a command: {other:?}"),
        }
    }

    #[test]
    fn a_fleet_is_created_with_a_trimmed_name_and_only_the_fleet_colours() {
        let Command::NewFleet { name, colors, .. } = command(FleetCommand::Create {
            name: " api ".into(),
        }) else {
            panic!("expected NewFleet")
        };
        assert_eq!(name, "api");
        assert_eq!(colors, FLEET_COLORS);
        assert!(!colors.contains(&4), "amber is not a fleet colour");
    }

    #[test]
    fn a_nameless_or_oversized_fleet_name_is_refused() {
        for name in ["", "   ", "a\nb", &"x".repeat(81)] {
            assert!(
                FleetCommand::Create { name: name.into() }.message().is_err(),
                "{name:?}"
            );
            assert!(
                FleetCommand::Rename {
                    fleet: 1,
                    name: name.into()
                }
                .message()
                .is_err()
            );
        }
    }

    #[test]
    fn only_a_fleet_colour_can_be_set() {
        for color in FLEET_COLORS {
            assert!(FleetCommand::Recolor { fleet: 1, color }.message().is_ok());
        }
        for color in [4, 6, 8, 255] {
            assert!(FleetCommand::Recolor { fleet: 1, color }.message().is_err());
        }
    }

    #[test]
    fn moving_and_starting_name_the_fleet_and_a_blank_folder_means_the_fleets_own() {
        assert!(matches!(
            command(FleetCommand::MoveSession { term: 4, fleet: 2 }),
            Command::MovePane {
                term: 4,
                to: Some(2),
                name: None
            }
        ));
        let Command::NewShip { ws, cwd, cmd } = command(FleetCommand::StartShell {
            fleet: 2,
            folder: Some("  ".into()),
        }) else {
            panic!("expected NewShip")
        };
        assert_eq!((ws, cwd, cmd), (2, None, None));
        let Command::NewShip { cwd, .. } = command(FleetCommand::StartShell {
            fleet: 2,
            folder: Some("/srv/app".into()),
        }) else {
            panic!("expected NewShip")
        };
        assert_eq!(cwd, Some("/srv/app".into()));
    }
}

#[cfg(test)]
mod handoff_tests {
    use super::*;

    #[test]
    fn the_brief_lists_uncommitted_files_and_says_the_commits_are_not_listed() {
        let folder = std::env::temp_dir().join(format!("maitty-handoff-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).expect("a folder");
        let git = |args: &[&str]| assert!(std::process::Command::new("git").args(args).current_dir(&folder).status().expect("git").success());
        git(&["init", "-q"]);
        std::fs::write(folder.join("b.txt"), "x").expect("a file");
        std::fs::write(folder.join("a.txt"), "x").expect("a file");
        let changed = uncommitted_changes(&folder).expect("a status");
        assert_eq!(changed.files, ["a.txt", "b.txt"]);
        assert!(changed.committed_unknown.is_some());
        assert!(uncommitted_changes(&folder.join("missing")).is_err());
        let _ = std::fs::remove_dir_all(&folder);
    }
}
