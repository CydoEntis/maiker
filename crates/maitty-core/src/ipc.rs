//! Local-socket transport: named pipes on Windows, Unix domain sockets elsewhere. With
//! `--remote host` the same messages go through `ssh host <app> proxy` instead, to the
//! server on that machine.

use crate::brand::APP_COMMAND;
use crate::protocol::{self, ClientMsg, ServerMsg};
use anyhow::{Context, Result};
use interprocess::local_socket::tokio::Stream;
use interprocess::local_socket::{ConnectOptions, ListenerOptions, Name};
use maitty_ipc_transport::framed_parts;
use std::pin::Pin;
use std::sync::Arc;
use std::task::Poll;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
pub use maitty_ipc_transport::{Reader, STREAM_MARKER, Writer, is_decode_error, send};
pub use maitty_machines::{
    CONNECT_BUDGET, Machine, NO_DAEMON_EXIT, OtherVersion, PROXY_ATTACH_ONLY_FLAG, SSH_PROGRAM,
    other_version,
};

/// One end of a local-socket stream that both ends share. The library deprecated splitting a stream into halves
/// (`interprocess` 2.4.7): a shared reference to the stream already reads and writes, so each end holds the stream
/// itself and the socket closes when the last end is dropped.
pub struct Shared(Arc<Stream>);

/// The read end and the write end of `stream`.
pub fn halves(stream: Stream) -> (Shared, Shared) {
    let stream = Arc::new(stream);
    (Shared(Arc::clone(&stream)), Shared(stream))
}

impl AsyncRead for Shared {
    fn poll_read(self: Pin<&mut Self>, cx: &mut std::task::Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut &*self.0).poll_read(cx, buf)
    }
}

impl AsyncWrite for Shared {
    fn poll_write(self: Pin<&mut Self>, cx: &mut std::task::Context<'_>, buf: &[u8]) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut &*self.0).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut &*self.0).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut &*self.0).poll_shutdown(cx)
    }
}

/// The structured chat's identity variables, without the app's prefix (ADR 0003).
pub(crate) const STRUCTURED_KEYS: [&str; 4] = [
    "CONVERSATION_ID",
    "CONVERSATION_GENERATION",
    "CONVERSATION_CONNECTION",
    "CONVERSATION_AUTH",
];
/// The variables that send this client's commands to another machine.
pub(crate) const REMOTE_ROUTE_KEYS: [&str; 3] = ["REMOTE", "SSH", "REMOTE_CMD"];
const RUNTIME_ROUTE_KEYS: [&str; 6] = ["SOCKET", "CONFIG", "DATA_DIR", "REMOTE", "SSH", "REMOTE_CMD"];
/// What a pane's agent is told about its pane (ADR 0003): never copied into another process.
const PANE_KEYS: [&str; 2] = ["TERM_ID", "PANE_TOKEN"];

/// Every name `keys` have, the current prefix first and the old ones after (ADR 0012).
fn names_of(keys: &[&str]) -> Vec<String> {
    keys.iter()
        .flat_map(|key| maitty_shared::brand::env_names(key))
        .collect()
}

pub(crate) fn structured_env() -> Vec<String> {
    names_of(&STRUCTURED_KEYS)
}

pub(crate) fn remote_route_env() -> Vec<String> {
    names_of(&REMOTE_ROUTE_KEYS)
}

pub(crate) fn runtime_route_env() -> Vec<String> {
    names_of(&RUNTIME_ROUTE_KEYS)
}

/// The variables that make a process a pane's agent or a structured chat's provider.
pub(crate) fn identity_env() -> Vec<String> {
    names_of(&STRUCTURED_KEYS)
        .into_iter()
        .chain(names_of(&PANE_KEYS))
        .collect()
}

/// Whether `name` is one of [`identity_env`], in any case (Windows folds case).
pub(crate) fn is_identity_env(name: &str) -> bool {
    identity_env()
        .iter()
        .any(|identity| name.eq_ignore_ascii_case(identity))
}

pub fn has_structured_identity() -> bool {
    STRUCTURED_KEYS
        .iter()
        .any(|key| maitty_shared::brand::env_var_os(key).is_some())
}

pub fn framed(stream: Stream) -> (Reader, Writer) {
    let (read, write) = halves(stream);
    framed_parts(read, write)
}

fn structured_identity(
    values: [Option<std::ffi::OsString>; 4],
) -> Result<Option<protocol::StructuredIdentity>> {
    if values.iter().all(Option::is_none) {
        return Ok(None);
    }
    let parsed = || -> Option<_> {
        let number = |index: usize| {
            values[index]
                .as_ref()?
                .to_str()?
                .parse::<u64>()
                .ok()
                .filter(|number| *number != 0)
        };
        let token = values[3].as_ref()?.to_str()?.to_owned();
        if token.is_empty() || token.chars().any(char::is_control) {
            return None;
        }
        Some(protocol::StructuredIdentity {
            conversation: crate::conversation::ConversationId(number(0)?),
            generation: number(1)?,
            connection: number(2)?,
            token,
        })
    };
    parsed()
        .map(Some)
        .ok_or_else(|| anyhow::anyhow!("Structured runtime identity is incomplete or malformed"))
}

/// Where the server notes its process id, so the app of another version can still stop it.
pub fn pid_file() -> std::path::PathBuf {
    crate::config::data_dir().join(format!("{}.pid", socket_id()))
}

/// The process groups of the providers this daemon started (`daemon/provider_groups.rs`).
#[cfg(unix)]
pub fn providers_file() -> std::path::PathBuf {
    crate::config::data_dir().join(format!("{}.providers", socket_id()))
}

/// Server identity. `<APP>_SOCKET` picks a separate server (like `tmux -L`).
pub fn socket_id() -> String {
    socket_id_for(APP_COMMAND)
}

/// The server identity the app had under the command `app` (an older name, for the rename handover).
fn socket_id_for(app: &str) -> String {
    let label = maitty_shared::brand::env_var("SOCKET").ok();
    let username = std::env::var("USERNAME").ok();
    let user = std::env::var("USER").ok();
    maitty_ipc_transport::socket_id(
        app,
        label.as_deref(),
        username.as_deref(),
        user.as_deref(),
    )
}

/// Windows: a named pipe (its default security lets only this user and admins write).
/// Unix: a socket file in a folder only this user can open, so no other local user can
/// reach the daemon (an abstract socket would have no permissions at all).
fn name() -> Result<Name<'static>> {
    name_for(APP_COMMAND)
}

fn name_for(app: &str) -> Result<Name<'static>> {
    let id = socket_id_for(app);
    #[cfg(unix)]
    let directory = Some(socket_dir_for(app)?);
    #[cfg(windows)]
    let directory: Option<std::path::PathBuf> = None;
    maitty_ipc_transport::socket_name(&id, directory.as_deref())
}

/// `$XDG_RUNTIME_DIR/<app>-<uid>` (or the temp folder's), created 0700 and checked to be
/// ours and private before use.
#[cfg(unix)]
fn socket_dir_for(app: &str) -> Result<std::path::PathBuf> {
    let runtime_dir = std::env::var_os("XDG_RUNTIME_DIR").map(std::path::PathBuf::from);
    maitty_ipc_transport::private_socket_dir(
        app,
        &format!("start {APP_COMMAND} again"),
        runtime_dir.as_deref(),
        &std::env::temp_dir(),
    )
}

/// No daemon runs here and `proxy --attach-only` was asked not to start one.
#[derive(Debug)]
pub struct NoDaemonHere;

impl std::fmt::Display for NoDaemonHere {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "no {APP_COMMAND} server is running here")
    }
}

impl std::error::Error for NoDaemonHere {}

pub fn is_no_daemon_here(e: &anyhow::Error) -> bool {
    e.is::<NoDaemonHere>()
}

/// `<app> proxy`, run by ssh on the far side: this machine's server over stdin and stdout.
/// Started if needed, unless `attach_only`: then a missing server is `NoDaemonHere`, before
/// anything is written to stdout.
pub async fn proxy(attach_only: bool) -> Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut stream = connect().await;
    if stream.is_err() {
        if attach_only {
            return Err(NoDaemonHere.into());
        }
        spawn_daemon(None)?;
        for _ in 0..60 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            stream = connect().await;
            if stream.is_ok() {
                break;
            }
        }
    }
    let (mut sr, mut sw) = halves(stream.context(concat!(
        "couldn't reach or start the ",
        env!("APP_COMMAND"),
        " server here"
    ))?);
    // Before any frame, so the client can tell the stream from login text printed ahead of it.
    let mut out = tokio::io::stdout();
    out.write_all(STREAM_MARKER).await?;
    out.flush().await?;
    let up = async {
        let mut stdin = tokio::io::stdin();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = stdin.read(&mut buf).await?;
            if n == 0 {
                return anyhow::Ok(());
            }
            sw.write_all(&buf[..n]).await?;
        }
    };
    let down = async {
        let mut stdout = tokio::io::stdout();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = sr.read(&mut buf).await?;
            if n == 0 {
                return anyhow::Ok(());
            }
            stdout.write_all(&buf[..n]).await?;
            stdout.flush().await?;
        }
    };
    tokio::select! {
        r = up => r,
        r = down => r,
    }
}

/// How long a connect waits for a daemon whose pipe has no free end. Without a limit the wait is
/// for ever (Windows parks a thread on the busy pipe), and a window that asks from its event loop
/// stops reading keys.
const CONNECT_WITHIN: std::time::Duration = std::time::Duration::from_secs(3);

pub async fn connect() -> Result<Stream> {
    connect_named(name()?).await
}

async fn connect_named(name: Name<'static>) -> Result<Stream> {
    let options = ConnectOptions::new()
        .name(name)
        .wait_mode(interprocess::ConnectWaitMode::Timeout(CONNECT_WITHIN));
    Ok(options.connect_tokio().await?)
}

/// How long a daemon still running under an older name gets to save its sessions and let go.
const PREVIOUS_STOPS_WITHIN: std::time::Duration = std::time::Duration::from_secs(10);

/// The oldest daemon that reads this build's `Hello` and `KillServer`: the window before the in-app tickets were
/// removed (ADR 0013). A daemon of the old name from that window no longer speaks this version, but those two
/// messages kept their shape, so it can still be asked to stop and save its sessions.
const PREVIOUS_STOP_READ_SINCE: u32 = 78;

/// Stop a daemon still running under the app's older command `app`, so the sessions it saves on the way out are
/// the ones brought over with its data, and the new name's daemon restores them with their agents resumed.
/// Nothing running under that name, or one too old to be asked, is left as it is (`false`); the caller still
/// brings the data over.
pub async fn stop_previous_daemon(app: &str) -> Result<bool> {
    let Ok(stream) = connect_named(name_for(app)?).await else {
        return Ok(false);
    };
    let hello = maitty_machines::hello(&Machine::current(), terminal_dial(false)?);
    let (mut r, mut w) = framed(stream);
    send(&mut w, &hello).await?;
    let daemon = maitty_ipc_transport::welcome_version(&mut r).await?;
    anyhow::ensure!(
        daemon.speaks_with_us() || daemon.version >= PREVIOUS_STOP_READ_SINCE,
        "the {app} service is too old to be asked to stop (protocol {}); stop it, then start {APP_COMMAND} again",
        daemon.version
    );
    send(
        &mut w,
        &ClientMsg::Command(protocol::Command::KillServer { forget: false }),
    )
    .await?;
    // It says goodbye, then lets go of its socket a moment later.
    let deadline = std::time::Instant::now() + PREVIOUS_STOPS_WITHIN;
    while std::time::Instant::now() < deadline {
        if connect_named(name_for(app)?).await.is_err() {
            return Ok(true);
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    anyhow::bail!("the {app} service did not stop within {} seconds", PREVIOUS_STOPS_WITHIN.as_secs())
}

/// Proof that this process is the one daemon for its socket. The OS releases it when the process
/// ends, so a crashed daemon never leaves a stale lock.
#[derive(Debug)]
pub struct DaemonLock {
    _file: std::fs::File,
}

fn lock_path() -> std::path::PathBuf {
    crate::config::data_dir().join(format!("{}.lock", socket_id()))
}

/// Take the right to be the daemon. Two clients starting at once both pass the "does a daemon
/// answer?" check, and `listen` then deletes the other's socket; each restores the saved session
/// and spawns every pane. Only one process can hold this lock, so only one gets that far.
pub fn lock_daemon() -> Result<DaemonLock> {
    lock_daemon_at(&lock_path())
}

fn lock_daemon_at(path: &std::path::Path) -> Result<DaemonLock> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).context("creating the daemon data folder")?;
    }
    let file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(path)
        .context("opening the daemon lock file")?;
    match file.try_lock() {
        Ok(()) => Ok(DaemonLock { _file: file }),
        Err(std::fs::TryLockError::WouldBlock) => anyhow::bail!(
            "a {APP_COMMAND} daemon is already running on {}",
            socket_id()
        ),
        Err(std::fs::TryLockError::Error(e)) => Err(e).context("locking the daemon lock file"),
    }
}

pub fn listen() -> Result<interprocess::local_socket::tokio::Listener> {
    // A stale socket file from a crashed daemon would make bind fail. (Callers check
    // that no daemon answers first.)
    #[cfg(unix)]
    {
        let _ = std::fs::remove_file(socket_dir_for(APP_COMMAND)?.join(socket_id()));
    }
    ListenerOptions::new()
        .name(name()?)
        .create_tokio()
        .context("creating the daemon socket")
}

pub async fn recv_server(r: &mut Reader) -> Result<Option<ServerMsg>> {
    maitty_ipc_transport::receive(r).await
}

pub async fn recv_client(r: &mut Reader) -> Result<Option<ClientMsg>> {
    maitty_ipc_transport::receive(r).await
}

/// Connect to the machine `--remote` names (else this one) and complete the handshake.
pub async fn open(attach: bool) -> Result<(Reader, Writer)> {
    open_to(&Machine::current(), attach).await
}

/// What the terminal app says about itself in a Hello: the pane and the conversation it runs in,
/// from the environment.
pub fn terminal_dial(attach: bool) -> Result<maitty_machines::Dial> {
    let structured = structured_identity(STRUCTURED_KEYS.map(maitty_shared::brand::env_var_os))?;
    Ok(maitty_machines::Dial {
        attach,
        surface: protocol::Surface::Terminal,
        replays: true,
        term: maitty_shared::brand::env_var("TERM_ID").ok(),
        token: maitty_shared::brand::env_var("PANE_TOKEN").ok(),
        structured,
        newest_only: false,
    })
}

/// A connection and the protocol the daemon named in its handshake: None over ssh, where the
/// far side's supervisor does the handshake.
pub type KnownConnection = ((Reader, Writer), Option<u32>);

/// Connect to `machine` and complete the handshake.
pub async fn open_to(machine: &Machine, attach: bool) -> Result<(Reader, Writer)> {
    open_to_knowing_version(machine, attach).await.map(|(c, _)| c)
}

async fn open_to_knowing_version(machine: &Machine, attach: bool) -> Result<KnownConnection> {
    open_accepting(machine, attach, |_| false).await
}

/// `open`, and the protocol the daemon speaks: what a caller checks before a request an older
/// daemon would pass over without an answer.
pub async fn open_knowing_version(attach: bool) -> Result<KnownConnection> {
    open_to_knowing_version(&Machine::current(), attach).await
}

/// Connect to send a hook or usage report, and nothing else. Unlike `open`, a daemon older than
/// this build is accepted while it still reads the reports (`protocol::daemon_reads_reports`): an
/// update replaces the binary an agent's hooks run while the old daemon keeps its sessions, and
/// their status must stay right until it restarts.
pub async fn open_for_report() -> Result<(Reader, Writer)> {
    open_accepting(&Machine::current(), false, protocol::daemon_reads_reports)
        .await
        .map(|(c, _)| c)
}

async fn open_accepting(
    machine: &Machine,
    attach: bool,
    also_accepts: fn(u32) -> bool,
) -> Result<KnownConnection> {
    let dial = terminal_dial(attach)?;
    if machine.is_remote() {
        return Ok((maitty_machines::open_remote(machine, dial).await?, None));
    }
    let hello = maitty_machines::hello(machine, dial);
    let (mut r, mut w) = framed(connect().await?);
    send(&mut w, &hello).await?;
    let daemon = maitty_ipc_transport::welcome_version(&mut r).await?;
    if daemon.speaks_with_us() || also_accepts(daemon.version) {
        Ok(((r, w), Some(daemon.version)))
    } else {
        Err(OtherVersion {
            daemon: daemon.version,
        }
        .into())
    }
}

/// Connect, starting the daemon in the background if none is running.
pub async fn open_or_spawn(attach: bool) -> Result<(Reader, Writer)> {
    open_or_spawn_knowing_version(attach).await.map(|(c, _)| c)
}

/// `open_or_spawn`, and the protocol the daemon speaks.
pub async fn open_or_spawn_knowing_version(attach: bool) -> Result<KnownConnection> {
    open_or_spawn_with(&Machine::current(), attach, None).await
}

/// Reconnect after replacing the executable, spawning the newly installed image if needed.
pub async fn open_or_spawn_installed(attach: bool) -> Result<(Reader, Writer)> {
    open_or_spawn_installed_knowing_version(attach)
        .await
        .map(|(c, _)| c)
}

/// `open_or_spawn_installed`, and the protocol the daemon speaks.
pub async fn open_or_spawn_installed_knowing_version(attach: bool) -> Result<KnownConnection> {
    let exe = crate::installed_executable::installed_executable()?;
    open_or_spawn_with(&Machine::current(), attach, Some(exe)).await
}

async fn open_or_spawn_with(
    machine: &Machine,
    attach: bool,
    exe: Option<std::path::PathBuf>,
) -> Result<KnownConnection> {
    if has_structured_identity() {
        return open_to_knowing_version(machine, attach).await;
    }
    // Over ssh the far side starts its own server.
    if machine.is_remote() {
        return open_to_knowing_version(machine, attach).await;
    }
    match open_to_knowing_version(machine, attach).await {
        Ok(c) => return Ok(c),
        // A server is running: starting another would only fail to take its socket.
        Err(e) if other_version(&e).is_some() => return Err(e),
        Err(_) => {}
    }
    spawn_daemon(exe.as_deref())?;
    let mut last = None;
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        match open_to_knowing_version(machine, attach).await {
            Ok(c) => return Ok(c),
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap_or_else(|| anyhow::anyhow!("daemon did not start")))
}

fn spawn_daemon(exe: Option<&std::path::Path>) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Out of the job the client runs in (an ssh session, some editor terminals, a scheduled
        // task close theirs with everything in it), so closing the client leaves every pane
        // running. A job that does not allow it refuses with access denied; then it starts in it.
        let mut away = daemon_command(exe)?;
        away.creation_flags(DAEMON_FLAGS | CREATE_BREAKAWAY_FROM_JOB);
        match away.spawn() {
            Ok(_) => return Ok(()),
            Err(e) if e.raw_os_error() == Some(ERROR_ACCESS_DENIED) => {
                tracing::warn!("the daemon could not leave this window's job, so it starts in it");
            }
            Err(e) => return Err(e).context("starting the daemon"),
        }
    }
    daemon_command(exe)?
        .spawn()
        .context("starting the daemon")?;
    Ok(())
}

/// A hidden console of its own, so ConPTY works and closing this window doesn't kill it.
#[cfg(windows)]
const DAEMON_FLAGS: u32 = 0x0000_0200 | crate::proc::CREATE_NO_WINDOW; // CREATE_NEW_PROCESS_GROUP
#[cfg(windows)]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
#[cfg(windows)]
const ERROR_ACCESS_DENIED: i32 = 5;

fn daemon_command(exe: Option<&std::path::Path>) -> Result<std::process::Command> {
    let current = std::env::current_exe()?;
    let mut cmd = std::process::Command::new(exe.unwrap_or(&current));
    cmd.arg("daemon")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(DAEMON_FLAGS);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Own session: survives the client's terminal closing and never sees its Ctrl+C.
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }
    Ok(cmd)
}

#[cfg(test)]
mod tests {
    /// A rename of the daemon or of the variables' prefix must not move the socket: an older client
    /// and a newer daemon have to find each other, and the handshake decides if they can talk (ADR 0012).
    #[test]
    fn the_server_identity_follows_the_command_and_not_the_daemons_name_or_the_prefix() {
        let id = maitty_ipc_transport::socket_id(super::APP_COMMAND, None, None, Some("someone"));
        assert!(id.contains(super::APP_COMMAND), "{id}");
        assert!(!id.contains(maitty_shared::brand::DAEMON_NAME), "{id}");
        assert!(
            !id.to_ascii_uppercase().contains(maitty_shared::brand::ENV_PREFIX),
            "{id}"
        );
    }

    #[test]
    fn a_second_daemon_is_refused_while_the_first_holds_the_lock() {
        let path =
            std::env::temp_dir().join(format!("daemon-lock-test-{}.lock", std::process::id()));
        let first = super::lock_daemon_at(&path).unwrap();
        let second = super::lock_daemon_at(&path).unwrap_err();
        assert!(
            format!("{second:#}").contains("already running"),
            "a second daemon must be refused, got: {second:#}"
        );
        drop(first);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn daemon_command_starts_daemon() {
        let command = super::daemon_command(None).unwrap();
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            [std::ffi::OsStr::new("daemon")]
        );
    }

    #[test]
    fn structured_identity_is_explicit_and_partial_claims_never_become_human() {
        assert!(
            super::structured_identity([None, None, None, None])
                .unwrap()
                .is_none()
        );
        for values in [
            [Some("1".into()), None, None, None],
            [None, None, None, Some("".into())],
            [
                Some("1".into()),
                Some("0".into()),
                Some("1".into()),
                Some("secret".into()),
            ],
        ] {
            assert!(super::structured_identity(values).is_err());
        }
        let claim = super::structured_identity([
            Some("1".into()),
            Some("2".into()),
            Some("3".into()),
            Some("synthetic-token".into()),
        ])
        .unwrap()
        .unwrap();
        assert_eq!(
            (claim.conversation.0, claim.generation, claim.connection),
            (1, 2, 3)
        );
        assert!(!format!("{claim:?}").contains("synthetic-token"));
    }

    #[test]
    fn a_bad_message_is_a_decode_error() {
        let e = crate::protocol::decode::<crate::protocol::ServerMsg>(&[0xc1, 0xff]).unwrap_err();
        assert!(super::is_decode_error(&e));
        assert!(!super::is_decode_error(&anyhow::anyhow!(
            "connection reset"
        )));
    }
}
