use anyhow::{Context, Result};
use interprocess::local_socket::Name;
use interprocess::local_socket::tokio::{Stream, prelude::*};
pub use maitty_ipc_transport::{Reader, Writer};
use maitty_ipc_transport::{framed_parts, receive, send};
use maitty_shared::protocol::{self, ClientMsg, ServerMsg};

const APP_COMMAND: &str = env!("APP_COMMAND");

#[derive(Debug)]
pub struct OtherVersion {
    pub daemon: u32,
}

impl std::fmt::Display for OtherVersion {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "the running {APP_COMMAND} service uses protocol v{}, while this GUI needs v{}",
            self.daemon,
            protocol::PROTOCOL_VERSION
        )
    }
}

impl std::error::Error for OtherVersion {}

pub fn other_version(error: &anyhow::Error) -> Option<u32> {
    error
        .chain()
        .find_map(|cause| cause.downcast_ref::<OtherVersion>())
        .map(|version| version.daemon)
}

pub fn pid_file() -> std::path::PathBuf {
    data_dir().join(format!("{}.pid", socket_id()))
}

pub fn remove_pid_file() {
    let _ = std::fs::remove_file(pid_file());
}

pub fn data_dir() -> std::path::PathBuf {
    if let Some(path) = maitty_shared::brand::env_var_os("DATA_DIR") {
        return path.into();
    }
    directories::ProjectDirs::from("", "", APP_COMMAND)
        .map(|dirs| dirs.data_local_dir().to_path_buf())
        .unwrap_or_else(std::env::temp_dir)
}

fn socket_id() -> String {
    let label = maitty_shared::brand::env_var("SOCKET").ok();
    let username = std::env::var("USERNAME").ok();
    let user = std::env::var("USER").ok();
    maitty_ipc_transport::socket_id(
        APP_COMMAND,
        label.as_deref(),
        username.as_deref(),
        user.as_deref(),
    )
}

pub async fn is_running() -> bool {
    connect().await.is_ok()
}

fn name() -> Result<Name<'static>> {
    let id = socket_id();
    #[cfg(unix)]
    let directory = Some(socket_dir()?);
    #[cfg(windows)]
    let directory: Option<std::path::PathBuf> = None;
    maitty_ipc_transport::socket_name(&id, directory.as_deref())
}

#[cfg(unix)]
fn socket_dir() -> Result<std::path::PathBuf> {
    let runtime_dir = std::env::var_os("XDG_RUNTIME_DIR").map(std::path::PathBuf::from);
    maitty_ipc_transport::private_socket_dir(
        APP_COMMAND,
        &format!("restart {APP_COMMAND}"),
        runtime_dir.as_deref(),
        &std::env::temp_dir(),
    )
}

async fn connect() -> Result<Stream> {
    Ok(Stream::connect(name()?).await?)
}

fn framed(stream: Stream) -> (Reader, Writer) {
    let (read, write) = stream.split();
    framed_parts(read, write)
}

pub async fn receive_server(reader: &mut Reader) -> Result<Option<ServerMsg>> {
    receive(reader).await.map_err(|error| {
        if maitty_ipc_transport::is_decode_error(&error) {
            error.context(UNREADABLE_ANSWER)
        } else {
            error
        }
    })
}

/// A message from the service this app cannot read: one a newer service sent.
pub const UNREADABLE_ANSWER: &str =
    "The Maiker service sent something this app cannot read. Update the app; if it is already up to date, restart the service in Settings.";

/// The next message on a stream, passing over one this app cannot read: a newer service may push
/// one added after this app, and the rest of the stream is still good.
pub async fn receive_pushed(reader: &mut Reader) -> Result<Option<ServerMsg>> {
    loop {
        match receive(reader).await {
            Err(error) if maitty_ipc_transport::is_decode_error(&error) => {
                tracing::warn!("skipped a message from the service: {error:#}");
            }
            other => return other,
        }
    }
}

pub async fn open_for_user() -> Result<(Reader, Writer)> {
    open_as(false).await
}

/// A connection that receives the terminal panes this app owns, live (replays, then output).
pub async fn open_stream_for_user(daemon_executable: &std::path::Path) -> Result<(Reader, Writer)> {
    match open_as(true).await {
        Ok(connection) => return Ok(connection),
        Err(error) if other_version(&error).is_some() => return Err(error),
        Err(_) => {}
    }
    spawn_daemon(daemon_executable)?;
    let mut last_error = None;
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        match open_as(true).await {
            Ok(connection) => return Ok(connection),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("The Maiker service did not start. Try again; if it keeps happening, run maiker in a terminal to see why.")))
}

async fn open_as(attach: bool) -> Result<(Reader, Writer)> {
    open_knowing_version(attach).await.map(|(connection, _)| connection)
}

/// A connection to the daemon that is running, and the protocol version it said: what a caller
/// checks before a request an older daemon would pass over without an answer.
pub async fn open_for_user_knowing_version() -> Result<((Reader, Writer), u32)> {
    open_knowing_version(false).await
}

async fn open_knowing_version(attach: bool) -> Result<((Reader, Writer), u32)> {
    let (mut reader, mut writer) = framed(connect().await?);
    send(
        &mut writer,
        &ClientMsg::Hello {
            version: protocol::PROTOCOL_VERSION,
            attach,
            from: None,
            structured: None,
            surface: protocol::Surface::Desktop,
            // The window asks for a pane's replay when it shows the pane (`WantReplay`).
            replays: false,
        },
    )
    .await?;
    let daemon = maitty_ipc_transport::welcome_version(&mut reader).await?;
    if daemon.speaks_with_us() {
        Ok(((reader, writer), daemon.version))
    } else {
        Err(OtherVersion {
            daemon: daemon.version,
        }
        .into())
    }
}

pub async fn open_or_spawn_for_user(
    daemon_executable: &std::path::Path,
) -> Result<(Reader, Writer)> {
    match open_for_user().await {
        Ok(connection) => return Ok(connection),
        Err(error) if other_version(&error).is_some() => return Err(error),
        Err(_) => {}
    }
    spawn_daemon(daemon_executable)?;
    let mut last_error = None;
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        match open_for_user().await {
            Ok(connection) => return Ok(connection),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("The Maiker service did not start. Try again; if it keeps happening, run maiker in a terminal to see why.")))
}

fn spawn_daemon(executable: &std::path::Path) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        const ERROR_ACCESS_DENIED: i32 = 5;
        // Out of the app's job, so whatever ends the app's process tree leaves every pane running.
        // A job that does not allow it refuses with access denied; then it starts in it.
        let mut away = daemon_command(executable);
        away.creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB);
        match away.spawn() {
            Ok(_) => return Ok(()),
            Err(e) if e.raw_os_error() == Some(ERROR_ACCESS_DENIED) => {}
            Err(e) => return Err(e).context("starting the daemon"),
        }
    }
    daemon_command(executable)
        .spawn()
        .context("starting the daemon")?;
    Ok(())
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn daemon_command(executable: &std::path::Path) -> std::process::Command {
    // The daemon's environment is every session's, so it must be the user's and not the app bundle's.
    let mut command = crate::host_env::host_command(executable);
    command
        .arg("daemon")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    for key in [
        "CONVERSATION_ID",
        "CONVERSATION_GENERATION",
        "CONVERSATION_CONNECTION",
        "CONVERSATION_AUTH",
        "TERM_ID",
        "PANE_TOKEN",
        "REMOTE",
        "SSH",
        "REMOTE_CMD",
    ] {
        maitty_shared::brand::remove_child_env(&mut command, key);
    }
    command
}

pub async fn send_message(writer: &mut Writer, message: &ClientMsg) -> Result<()> {
    send(writer, message).await
}

#[cfg(test)]
mod tests {
    use super::daemon_command;

    /// A newer service may push a message added after this app: the stream goes on past it, and
    /// an answer that will not decode says what to do instead of a decoder's words.
    #[tokio::test]
    async fn a_pushed_message_this_app_cannot_read_is_passed_over() {
        let (here, there) = tokio::io::duplex(1024);
        let (here_read, here_write) = tokio::io::split(here);
        let (there_read, there_write) = tokio::io::split(there);
        let (mut reader, _writer) = maitty_ipc_transport::framed_parts(here_read, here_write);
        let (_their_reader, mut writer) = maitty_ipc_transport::framed_parts(there_read, there_write);
        for _ in 0..2 {
            super::send(&mut writer, &"AMessageAddedLater").await.unwrap();
            super::send(&mut writer, &super::ServerMsg::Bye).await.unwrap();
        }
        assert!(matches!(super::receive_pushed(&mut reader).await, Ok(Some(super::ServerMsg::Bye))));
        let error = super::receive_server(&mut reader).await.unwrap_err();
        assert!(error.to_string().contains("cannot read"), "{error}");
    }

    #[test]
    fn gui_daemon_drops_pane_and_remote_identity_but_keeps_user_configuration() {
        let command = daemon_command(std::path::Path::new("maiker"));
        let removed = command
            .get_envs()
            .filter(|(_, value)| value.is_none())
            .map(|(key, _)| key.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        for key in [
            "CONVERSATION_ID",
            "CONVERSATION_GENERATION",
            "CONVERSATION_CONNECTION",
            "CONVERSATION_AUTH",
            "TERM_ID",
            "PANE_TOKEN",
            "REMOTE",
            "SSH",
            "REMOTE_CMD",
        ] {
            for name in maitty_shared::brand::env_names(key) {
                assert!(removed.contains(&name), "{name}");
            }
        }
        for key in ["CONFIG", "DATA_DIR", "SOCKET"] {
            for name in maitty_shared::brand::env_names(key) {
                assert!(!removed.contains(&name), "{name}");
            }
        }
    }
}
