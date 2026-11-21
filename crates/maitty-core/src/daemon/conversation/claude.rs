use anyhow::{Context, Result, bail};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio_util::codec::{FramedRead, FramedWrite, LinesCodec};

use crate::conversation::TurnChoice;
use maitty_provider::ProviderEvent;
use maitty_provider_claude::approvals::approval_request;
use maitty_provider_claude::{
    MAX_FRAME_BYTES, MAX_PENDING_TOOLS, OutputFrame, TurnProjector,
    command_arguments_for_turn, parse_output_frame, session_id, verified_version,
    version_number,
};

const STDERR_CHUNK_BYTES: usize = 8192;
const PROCESS_EXIT_TIMEOUT: Duration = Duration::from_secs(2);
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(30);
const INITIALIZE_REQUEST_ID: &str = "claude-initialize";
/// How long a process started for the next message waits for it before it is stopped: long
/// enough to read a reply and write the next message, short enough that idle chats do not each
/// hold a Claude Code process.
const WARM_IDLE_LIMIT: Duration = Duration::from_secs(10 * 60);

struct Client {
    process: super::process::OwnedChild,
    /// `None` once closed.
    input: Option<FramedWrite<tokio::process::ChildStdin, LinesCodec>>,
    output: FramedRead<tokio::process::ChildStdout, LinesCodec>,
    stderr_task: Option<tokio::task::JoinHandle<std::io::Result<()>>>,
}

impl Client {
    async fn spawn(
        executable: &Path,
        cwd: &Path,
        config_root: &Path,
        environment: &[(OsString, OsString)],
        arguments: &[OsString],
    ) -> std::result::Result<Self, super::transport::StartupFailure> {
        let mut command = Command::new(executable);
        command
            .env_clear()
            .envs(environment.iter().filter_map(|(key, value)| {
                let name = key.to_string_lossy();
                (!crate::ipc::is_identity_env(&name) && !name.eq_ignore_ascii_case("CODEX_HOME"))
                    .then_some((key, value))
            }))
            .env("CLAUDE_CONFIG_DIR", config_root)
            .env_remove("CLAUDECODE")
            .args(arguments)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::proc::quiet(&mut command);
        let mut process = super::process::OwnedChild::spawn(command)
            .await
            .map_err(|failure| {
                super::transport::StartupFailure::spawn(failure, "Launch Claude Code CLI")
            })?;
        let (Some(stdin), Some(stdout), Some(stderr)) = (
            process.child.stdin.take(),
            process.child.stdout.take(),
            process.child.stderr.take(),
        ) else {
            return Err(super::transport::StartupFailure::dispose(
                process,
                anyhow::anyhow!("Claude Code CLI pipes are unavailable"),
            )
            .await);
        };
        let stderr_task = tokio::spawn(discard_stderr(stderr));
        Ok(Self {
            process,
            input: Some(FramedWrite::new(
                stdin,
                LinesCodec::new_with_max_length(MAX_FRAME_BYTES),
            )),
            output: FramedRead::new(stdout, LinesCodec::new_with_max_length(MAX_FRAME_BYTES)),
            stderr_task: Some(stderr_task),
        })
    }

    async fn write(&mut self, value: &Value) -> Result<()> {
        self.input
            .as_mut()
            .context("Claude Code input is already closed")?
            .send(serde_json::to_string(value)?)
            .await
            .context("Write Claude Code stream input")
    }

    async fn next(&mut self) -> Result<OutputFrame> {
        let line = self
            .output
            .next()
            .await
            .context("Claude Code stdout closed before a complete frame")?
            .context("Read Claude Code stream frame")
            .map_err(|_| anyhow::anyhow!("Claude Code stream frame is invalid or too large"))?;
        parse_output_frame(&line)
    }

    async fn initialize(&mut self, expected_session: &str) -> Result<()> {
        self.request_initialize().await?;
        self.initialized(expected_session).await
    }

    async fn request_initialize(&mut self) -> Result<()> {
        self.write(&serde_json::json!({
            "type":"control_request",
            "request_id":INITIALIZE_REQUEST_ID,
            "request":{"subtype":"initialize","hooks":null}
        }))
        .await
    }

    async fn initialized(&mut self, expected_session: &str) -> Result<()> {
        tokio::time::timeout(INITIALIZE_TIMEOUT, async {
            loop {
                match self.next().await? {
                    OutputFrame::Initialized { session_id } => {
                        anyhow::ensure!(
                            session_id == expected_session,
                            "Claude initialized a different session than the requested identity"
                        );
                    }
                    OutputFrame::ControlResponse { response } => {
                        anyhow::ensure!(
                            response.get("request_id").and_then(Value::as_str)
                                == Some(INITIALIZE_REQUEST_ID)
                                && response.get("subtype").and_then(Value::as_str) != Some("error"),
                            "Claude Code rejected adapter initialization"
                        );
                        return Ok(());
                    }
                    OutputFrame::Other => {}
                    _ => {
                        bail!("Claude Code sent an unexpected frame during adapter initialization")
                    }
                }
            }
        })
        .await
        .context("Claude Code initialization timed out")?
    }

    async fn stop(&mut self) -> Result<()> {
        if let Some(mut input) = self.input.take() {
            SinkExt::<String>::close(&mut input)
                .await
                .context("Close Claude Code input")?;
            // Shutting a child's stdin down does not close it (a no-op on Unix); only dropping the
            // pipe ends Claude Code's input, so it exits on its own instead of being killed.
            drop(input);
        }
        let _ = tokio::time::timeout(PROCESS_EXIT_TIMEOUT, self.process.child.wait()).await;
        self.process
            .stop()
            .await
            .context("Dispose Claude Code process tree")?;
        if let Some(stderr_task) = self.stderr_task.take() {
            stderr_task
                .await
                .context("Join Claude Code stderr reader")?
                .context("Read Claude Code stderr")?;
        }
        Ok(())
    }
}

async fn discard_stderr(mut stderr: impl AsyncRead + Unpin) -> std::io::Result<()> {
    let mut chunk = [0; STDERR_CHUNK_BYTES];
    while stderr.read(&mut chunk).await? != 0 {}
    Ok(())
}

/// A `claude` process started for the conversation's next message once a turn has ended, so the
/// message does not wait on Claude Code's start-up (node, settings, MCP servers, the transcript).
/// It has been asked to initialize and sent nothing of the conversation, so stopping it loses
/// nothing. Its output is read only once a message is handed to it, so until then it cannot
/// change status.
struct Warm {
    client: Client,
    /// The exact arguments it was started with; a message that needs others gets a new process.
    arguments: Vec<OsString>,
    /// Claude Code reads the transcript once, at start-up, and only touches its time while it
    /// waits. A transcript that has grown since (the session resumed elsewhere) means this
    /// process would answer without those turns.
    transcript: PathBuf,
    transcript_length: u64,
    /// When it is stopped to free its memory if no message has come.
    expires: tokio::time::Instant,
}

/// Where Claude Code keeps this session's transcript. `None` for a session id that is not a plain
/// file name, so no path outside the folder is ever looked at.
fn transcript_path(config_root: &Path, cwd: &Path, session: &str) -> Option<PathBuf> {
    (!session.is_empty() && session.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).then(
        || {
            config_root
                .join("projects")
                .join(super::saved::claude_folder_name(cwd))
                .join(format!("{session}.jsonl"))
        },
    )
}

async fn transcript_length(transcript: &Path) -> std::io::Result<u64> {
    let transcript = transcript.to_path_buf();
    tokio::task::spawn_blocking(move || std::fs::metadata(transcript).map(|metadata| metadata.len()))
        .await
        .map_err(std::io::Error::other)?
}

/// Starts the process for the next message. Without a transcript to check it against, none is
/// started: the message then starts its own, as before.
async fn prewarm(
    launch: &super::transport::Launch,
    settings: &crate::conversation::LaunchSettings,
    transcript: Option<&Path>,
    arguments: Vec<OsString>,
) -> Option<Warm> {
    let transcript = transcript?.to_path_buf();
    let transcript_length = match transcript_length(&transcript).await {
        Ok(length) => length,
        Err(error) => {
            tracing::debug!(%error, "Claude transcript cannot be checked; the next message starts its own process");
            return None;
        }
    };
    let (_, executable, cwd) = launch.paths();
    let mut client = match Client::spawn(
        executable,
        cwd,
        &settings.config_root,
        &launch.environment,
        &arguments,
    )
    .await
    {
        Ok(client) => client,
        Err(failure) => {
            // A process left behind is dropped here, and its guard ends its tree.
            tracing::warn!(error = %failure.error, "Claude process for the next message failed to start; the message starts its own");
            return None;
        }
    };
    if let Err(error) = client.request_initialize().await {
        retire(client, &format!("it refused initialization: {error:#}")).await;
        return None;
    }
    Some(Warm {
        client,
        arguments,
        transcript,
        transcript_length,
        expires: tokio::time::Instant::now() + WARM_IDLE_LIMIT,
    })
}

/// Hands over the waiting process when it can take this message: started with exactly these
/// arguments, not idle too long, the transcript unchanged, initialized and still running. Any
/// other is stopped, and the caller starts a new one.
async fn take_warm(
    warm: &mut Option<Warm>,
    arguments: &[OsString],
    session: &str,
) -> Option<Client> {
    let mut warm = warm.take()?;
    let unusable = if warm.arguments != arguments {
        "the message needs other launch arguments".to_owned()
    } else if tokio::time::Instant::now() >= warm.expires {
        "it waited too long for a message".to_owned()
    } else {
        match transcript_length(&warm.transcript).await {
            Ok(length) if length != warm.transcript_length => {
                "the transcript changed since it started".to_owned()
            }
            Err(error) => format!("the transcript cannot be checked: {error}"),
            Ok(_) => match warm.client.initialized(session).await {
                Err(error) => format!("it did not initialize: {error:#}"),
                // Its answers can still be buffered after it died; a dead one is never handed on.
                Ok(()) => match warm.client.process.child.try_wait() {
                    Ok(None) => return Some(warm.client),
                    Ok(Some(status)) => format!("it exited ({status})"),
                    Err(error) => format!("its state cannot be read: {error}"),
                },
            },
        }
    };
    retire(warm.client, &unusable).await;
    None
}

/// Resolves when the waiting process has to go: its idle time is up, or it exited.
async fn expired(warm: &mut Option<Warm>) -> String {
    let Some(warm) = warm else {
        return std::future::pending().await;
    };
    tokio::select! {
        () = tokio::time::sleep_until(warm.expires) => "it waited too long for a message".to_owned(),
        status = warm.client.process.child.wait() => match status {
            Ok(status) => format!("it exited ({status})"),
            Err(error) => format!("its exit cannot be read: {error}"),
        },
    }
}

/// Stops a waiting process that will not be used.
async fn retire(mut client: Client, reason: &str) {
    tracing::debug!(reason, "Stopping the Claude process started for the next message");
    if let Err(error) = client.stop().await {
        // The client is dropped next, and its guard ends the process tree.
        tracing::warn!(error = %format!("{error:#}"), "Claude process started for the next message did not stop cleanly");
    }
}

pub(super) async fn run(
    launch: super::transport::Launch,
    owner: super::runtime::Owner,
    events: tokio::sync::mpsc::Sender<crate::daemon::Ev>,
    mut stop: tokio::sync::mpsc::Receiver<()>,
    mut requests: tokio::sync::mpsc::Receiver<super::runtime::Command>,
) {
    let Some(settings) = launch.settings().cloned() else {
        let _ = super::runtime::emit(
            &events,
            owner,
            super::runtime::Payload::Terminated {
                failure: Some("Claude launch settings are missing".into()),
                reaped: true,
            },
        )
        .await;
        return;
    };
    let (session, mut awaiting_first_message) = match &launch.identity {
        super::transport::LaunchIdentity::Pending(pending) => (
            pending.thread_id.clone().map_or_else(session_id, Ok),
            pending.thread_id.is_none(),
        ),
        super::transport::LaunchIdentity::Existing(conversation) => (
            Ok(conversation.binding.session_id.clone()),
            conversation.awaiting_first_user_message,
        ),
    };
    let session = match session {
        Ok(session) => session,
        Err(error) => {
            let _ = super::runtime::emit(
                &events,
                owner,
                super::runtime::Payload::Terminated {
                    failure: Some(format!("{error:#}")),
                    reaped: true,
                },
            )
            .await;
            return;
        }
    };
    if let Err(error) = verify_cli_version(
        launch.paths().1,
        launch.paths().2,
        launch.paths().0,
        &launch.environment,
    )
    .await
    {
        let _ = super::runtime::emit(
            &events,
            owner,
            super::runtime::Payload::Terminated {
                failure: Some(format!("{error:#}")),
                reaped: true,
            },
        )
        .await;
        return;
    }
    if super::runtime::emit(&events, owner, super::runtime::Payload::Ready)
        .await
        .is_err()
    {
        return;
    }

    let transcript = transcript_path(&settings.config_root, launch.paths().2, &session);
    let mut warm: Option<Warm> = None;
    loop {
        tokio::select! {
            biased;
            _ = stop.recv() => {
                let cleanup = match warm.take() {
                    Some(mut warm) => warm.client.stop().await,
                    None => Ok(()),
                };
                let (failure, reaped) = match cleanup {
                    Ok(()) => (None, true),
                    Err(error) => (Some(format!("Claude process cleanup failed: {error:#}")), false),
                };
                let _ = super::runtime::emit(&events, owner, super::runtime::Payload::Terminated { failure, reaped }).await;
                return;
            }
            command = requests.recv() => {
                let Some(command) = command else {
                    if let Some(warm) = warm.take() {
                        retire(warm.client, "the conversation's commands ended").await;
                    }
                    let _ = super::runtime::emit(&events, owner, super::runtime::Payload::Terminated { failure: Some("Claude command channel closed".into()), reaped: true }).await;
                    return;
                };
                match command.request {
                    super::runtime::Rpc::Start { .. } | super::runtime::Rpc::Resume { .. } => {
                        let _ = super::runtime::emit(&events, owner, super::runtime::Payload::Response {
                            token: command.token,
                            result: Ok(serde_json::json!({"thread":{"id":session}})),
                        }).await;
                    }
                    super::runtime::Rpc::Turns { .. } => {
                        let _ = super::runtime::emit(&events, owner, super::runtime::Payload::Response {
                            token: command.token,
                            result: Ok(serde_json::json!({"data":[],"nextCursor":null})),
                        }).await;
                    }
                    super::runtime::Rpc::Send { params } => {
                        match run_turn(
                            TurnContext {
                                launch: &launch,
                                settings: &settings,
                                session: &session,
                                awaiting_first_message,
                                owner,
                                events: &events,
                                requests: &mut requests,
                                stop: &mut stop,
                                warm: &mut warm,
                            },
                            command.token,
                            params,
                        ).await {
                            Ok((mut client, choice)) => {
                                awaiting_first_message = false;
                                if let Err(error) = client.stop().await {
                                    let _ = super::runtime::emit(&events, owner, super::runtime::Payload::Terminated { failure: Some(format!("Claude process cleanup failed: {error:#}")), reaped: false }).await;
                                    return;
                                }
                                // Started only after the last process exited, so it loads the
                                // whole transcript; it bets the next message keeps this model and effort.
                                let arguments = command_arguments_for_turn(&session, true, &settings, &choice);
                                warm = prewarm(&launch, &settings, transcript.as_deref(), arguments).await;
                            }
                            Err(TurnFailure::BeforeStart { token, error }) => {
                                let _ = super::runtime::emit(&events, owner, super::runtime::Payload::Response {
                                    token,
                                    result: Err(super::transport::RpcError::adapter_failure(-32000)),
                                }).await;
                                tracing::warn!(conversation = owner.conversation.0, error = %error, "Claude turn was rejected before launch");
                            }
                            Err(TurnFailure::Startup { token, failure }) => {
                                let _ = super::runtime::emit(&events, owner, super::runtime::Payload::Response {
                                    token,
                                    result: Err(super::transport::RpcError::adapter_failure(-32000)),
                                }).await;
                                tracing::warn!(conversation = owner.conversation.0, error = %failure.error, "Claude CLI failed to start");
                                super::runtime::retain_failed_startup(failure, owner, &events, &mut stop).await;
                                return;
                            }
                            Err(TurnFailure::Active { token, error }) => {
                                if let Some(token) = token {
                                    let _ = super::runtime::emit(&events, owner, super::runtime::Payload::Response {
                                        token,
                                        result: Err(super::transport::RpcError::adapter_failure(-32000)),
                                    }).await;
                                }
                                let _ = super::runtime::emit(&events, owner, super::runtime::Payload::Terminated { failure: Some(format!("{error:#}")), reaped: true }).await;
                                return;
                            }
                        }
                    }
                    super::runtime::Rpc::Answer { .. } | super::runtime::Rpc::Interrupt { .. } | super::runtime::Rpc::Steer { .. } => {
                        let _ = super::runtime::emit(&events, owner, super::runtime::Payload::Response {
                            token: command.token,
                            result: Err(super::transport::RpcError::adapter_failure(-32001)),
                        }).await;
                    }
                }
            }
            reason = expired(&mut warm) => {
                if let Some(warm) = warm.take() {
                    retire(warm.client, &reason).await;
                }
            }
        }
    }
}

async fn verify_cli_version(
    executable: &Path,
    cwd: &Path,
    config_root: &Path,
    environment: &[(OsString, OsString)],
) -> Result<()> {
    let mut command = tokio::process::Command::new(executable);
    command
        .arg("--version")
        .env_clear()
        .envs(
            environment
                .iter()
                .filter(|(key, _)| {
                    !crate::ipc::is_identity_env(&key.to_string_lossy())
                        && !["CODEX_HOME", "CLAUDECODE"]
                            .iter()
                            .any(|name| key.to_string_lossy().eq_ignore_ascii_case(name))
                })
                .map(|(key, value)| (key.clone(), value.clone())),
        )
        .env("CLAUDE_CONFIG_DIR", config_root)
        .current_dir(cwd)
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command
            .as_std_mut()
            .creation_flags(crate::proc::CREATE_NO_WINDOW);
    }
    let output = tokio::time::timeout(PROCESS_EXIT_TIMEOUT * 5, command.output())
        .await
        .context("Claude Code version check timed out")?
        .context("Read Claude Code version")?;
    anyhow::ensure!(output.status.success(), "Claude Code version check failed");
    let output = String::from_utf8_lossy(&output.stdout);
    let version = version_number(&output).context("Unrecognized Claude Code version output")?;
    anyhow::ensure!(
        verified_version(version),
        "Claude Code version {version} has not been verified for structured chat"
    );
    Ok(())
}

enum TurnFailure {
    BeforeStart {
        token: u64,
        error: anyhow::Error,
    },
    Startup {
        token: u64,
        failure: super::transport::StartupFailure,
    },
    Active {
        token: Option<u64>,
        error: anyhow::Error,
    },
}

struct TurnContext<'a> {
    launch: &'a super::transport::Launch,
    settings: &'a crate::conversation::LaunchSettings,
    session: &'a str,
    awaiting_first_message: bool,
    owner: super::runtime::Owner,
    events: &'a tokio::sync::mpsc::Sender<crate::daemon::Ev>,
    requests: &'a mut tokio::sync::mpsc::Receiver<super::runtime::Command>,
    stop: &'a mut tokio::sync::mpsc::Receiver<()>,
    /// Taken only once the message is known to be sendable, so a refused one leaves it waiting.
    warm: &'a mut Option<Warm>,
}

/// The model and effort the user picked for this message, read back from its start parameters.
/// They are checked again here because they end up on a command line.
fn turn_choice(params: &Value) -> Result<TurnChoice> {
    let field = |name: &str| params.get(name).and_then(Value::as_str).map(str::to_owned);
    let choice = TurnChoice {
        model: field("model"),
        effort: field("effort"),
    };
    choice.validate().map_err(anyhow::Error::msg)?;
    Ok(choice)
}

async fn run_turn(
    context: TurnContext<'_>,
    token: u64,
    params: Value,
) -> std::result::Result<(Client, TurnChoice), TurnFailure> {
    let TurnContext {
        launch,
        settings,
        session,
        awaiting_first_message,
        owner,
        events,
        requests,
        stop,
        warm,
    } = context;
    if params.get("threadId").and_then(Value::as_str) != Some(session) {
        return Err(TurnFailure::BeforeStart {
            token,
            error: anyhow::anyhow!("Claude send targets a different session identity"),
        });
    }
    let text = params
        .get("input")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
        .and_then(|item| item.get("text").and_then(Value::as_str))
        .filter(|text| !text.is_empty())
        .context("Claude send has no text input")
        .map_err(|error| TurnFailure::BeforeStart { token, error })?
        .to_owned();
    let (_, executable, cwd) = launch.paths();
    let choice = turn_choice(&params)
        .map_err(|error| TurnFailure::BeforeStart { token, error })?;
    let args = command_arguments_for_turn(session, !awaiting_first_message, settings, &choice);
    let mut client = match take_warm(warm, &args, session).await {
        Some(client) => client,
        None => {
            let mut client = Client::spawn(
                executable,
                cwd,
                &settings.config_root,
                &launch.environment,
                &args,
            )
            .await
            .map_err(|failure| TurnFailure::Startup { token, failure })?;
            if let Err(error) = client.initialize(session).await {
                return Err(TurnFailure::Active {
                    token: Some(token),
                    error,
                });
            }
            client
        }
    };
    let turn_id = session_id().map_err(|error| TurnFailure::Active {
        token: Some(token),
        error,
    })?;
    let user_item_id = session_id().map_err(|error| TurnFailure::Active {
        token: Some(token),
        error,
    })?;
    let mut projector = TurnProjector::new(
        session.to_owned(),
        turn_id.clone(),
        text.clone(),
        user_item_id,
    );
    if let Err(error) = client
        .write(&serde_json::json!({
            "type":"user",
            "message":{"role":"user","content":[{"type":"text","text":text}]}
        }))
        .await
    {
        return Err(TurnFailure::Active {
            token: Some(token),
            error,
        });
    }
    let mut pending_token = Some(token);
    let mut approvals = BTreeMap::new();
    let mut interrupts = BTreeMap::new();
    loop {
        tokio::select! {
            biased;
            _ = stop.recv() => {
                return Err(TurnFailure::Active { token: pending_token, error: anyhow::anyhow!("Claude conversation stopped during a turn") });
            }
            command = requests.recv() => {
                let Some(command) = command else {
                    return Err(TurnFailure::Active { token: pending_token, error: anyhow::anyhow!("Claude command channel closed during a turn") });
                };
                match command.request {
                    super::runtime::Rpc::Answer { request_id, response } => {
                        let super::transport::RequestId::Text(request_id) = request_id else {
                            return Err(TurnFailure::Active { token: pending_token, error: anyhow::anyhow!("Claude approval ID is not textual") });
                        };
                        let Some(input) = approvals.remove(&request_id) else {
                            return Err(TurnFailure::Active { token: pending_token, error: anyhow::anyhow!("Claude approval is stale") });
                        };
                        let decision = response.get("decision").and_then(Value::as_str);
                        let (behavior, message) = match decision {
                            Some("accept") => ("allow", None),
                            Some("decline") => ("deny", Some("The user declined this action.")),
                            _ => return Err(TurnFailure::Active { token: pending_token, error: anyhow::anyhow!("Unsupported Claude approval decision") }),
                        };
                        let mut answer = serde_json::json!({"behavior":behavior,"updatedInput":input});
                        if let Some(message) = message { answer["message"] = Value::String(message.into()); }
                        client.write(&serde_json::json!({"type":"control_response","response":{"subtype":"success","request_id":request_id,"response":answer}}))
                            .await
                            .map_err(|error| TurnFailure::Active { token: pending_token, error })?;
                    }
                    super::runtime::Rpc::Interrupt { params } => {
                        if params.get("threadId").and_then(Value::as_str) != Some(session)
                            || params.get("turnId").and_then(Value::as_str) != Some(turn_id.as_str()) {
                            return Err(TurnFailure::Active { token: pending_token, error: anyhow::anyhow!("Claude interruption targets a stale turn") });
                        }
                        let request_id = format!("interrupt-{}", command.token);
                        interrupts.insert(request_id.clone(), command.token);
                        client.write(&serde_json::json!({"type":"control_request","request_id":request_id,"request":{"subtype":"interrupt"}}))
                            .await
                            .map_err(|error| TurnFailure::Active { token: pending_token, error })?;
                    }
                    super::runtime::Rpc::Send { .. } => {
                        super::runtime::emit(events, owner, super::runtime::Payload::Response {
                            token: command.token,
                            result: Err(super::transport::RpcError::adapter_failure(-32001)),
                        }).await.map_err(|error| TurnFailure::Active { token: pending_token, error })?;
                    }
                    _ => return Err(TurnFailure::Active { token: pending_token, error: anyhow::anyhow!("Unsupported Claude command during an active turn") }),
                }
            }
            frame = client.next() => {
                let frame = frame.map_err(|error| TurnFailure::Active { token: pending_token, error })?;
                // Claude Code (2.1.325, 2.1.327) sends its `init` only once the message is in, after
                // the initialize answer, so the session it names is checked here too.
                if let OutputFrame::Initialized { session_id } = &frame
                    && session_id.as_str() != session
                {
                    return Err(TurnFailure::Active { token: pending_token, error: anyhow::anyhow!("Claude initialized a different session than the requested identity") });
                }
                if let OutputFrame::ControlRequest { request_id, request } = &frame {
                    if request.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
                        return Err(TurnFailure::Active { token: pending_token, error: anyhow::anyhow!("Unsupported Claude control request") });
                    }
                    let tool_name = request.get("tool_name").and_then(Value::as_str).unwrap_or_default();
                    let input = request.get("input").filter(|input| input.is_object()).cloned().unwrap_or_else(|| serde_json::json!({}));
                    if tool_name == "AskUserQuestion" {
                        client.write(&serde_json::json!({"type":"control_response","response":{"subtype":"success","request_id":request_id,"response":{"behavior":"deny","message":"Ask the user in your response; chat accepts free-text replies."}}}))
                            .await
                            .map_err(|error| TurnFailure::Active { token: pending_token, error })?;
                        continue;
                    }
                    if approvals.len() >= MAX_PENDING_TOOLS || approvals.insert(request_id.clone(), input.clone()).is_some() {
                        return Err(TurnFailure::Active { token: pending_token, error: anyhow::anyhow!("Claude approval request queue overflow or ID reuse") });
                    }
                    let (request, command_hash) = approval_request(&turn_id, request_id, request, tool_name, &input);
                    let asked = ProviderEvent::ApprovalRequested { request, command_hash };
                    super::runtime::emit(events, owner, super::runtime::Payload::Event(asked)).await.map_err(|error| TurnFailure::Active { token: pending_token, error })?;
                    continue;
                }
                if let OutputFrame::ControlResponse { response } = &frame
                    && let Some(request_id) = response.get("request_id").and_then(Value::as_str)
                {
                        if let Some(token) = interrupts.remove(request_id) {
                            projector.interrupt_acknowledged();
                            super::runtime::emit(events, owner, super::runtime::Payload::Response {
                                token,
                                result: Ok(serde_json::json!({})),
                            }).await.map_err(|error| TurnFailure::Active { token: pending_token, error })?;
                        }
                        continue;
                }
                if matches!(frame, OutputFrame::Result { .. }) && pending_token.is_some() {
                    return Err(TurnFailure::Active { token: pending_token, error: anyhow::anyhow!("Claude completed without echoing the submitted prompt; delivery is uncertain") });
                }
                let finished = matches!(frame, OutputFrame::Result { .. });
                let projected = projector.project(frame).map_err(|error| TurnFailure::Active { token: pending_token, error })?;
                for event in projected {
                    match event {
                        // The delivery receipt answers the send itself, in the shape the
                        // daemon reads every provider's send answer in.
                        ProviderEvent::Delivered { turn } => {
                            let acknowledged = pending_token.take().context("Claude acknowledgement token was already consumed")
                                .map_err(|error| TurnFailure::Active { token: pending_token, error })?;
                            super::runtime::emit(events, owner, super::runtime::Payload::Response {
                                token: acknowledged,
                                result: Ok(serde_json::json!({"turn":{"id":turn,"status":"inProgress","items":[]}})),
                            }).await.map_err(|error| TurnFailure::Active { token: pending_token, error })?;
                        }
                        event => {
                            super::runtime::emit(events, owner, super::runtime::Payload::Event(event))
                                .await
                                .map_err(|error| TurnFailure::Active { token: pending_token, error })?;
                        }
                    }
                }
                if finished { return Ok((client, choice)); }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_output_frame, turn_choice, verified_version};
    use crate::conversation::{ApprovalPolicy, LaunchSettings, Provider, Sandbox};
    use crate::conversation::TurnChoice;
    use maitty_provider_claude::{
        MAX_FRAME_BYTES, OutputFrame, command_arguments, command_arguments_for_turn, session_id,
    };
    use serde_json::json;
    use std::path::PathBuf;

    fn settings(approval_policy: ApprovalPolicy, sandbox: Sandbox) -> LaunchSettings {
        LaunchSettings {
            provider: Provider::Claude,
            executable: PathBuf::from("claude"),
            config_root: PathBuf::from("config"),
            cwd: PathBuf::from("workspace"),
            model: Some("sonnet".into()),
            model_provider: None,
            approval_policy,
            sandbox,
        }
    }

    #[test]
    fn recognizes_only_the_locally_verified_cli_version() {
        assert!(verified_version("2.1.312"));
        assert!(verified_version("2.1.314"));
        assert!(verified_version("2.1.316"));
        assert!(verified_version("2.1.327"));
        assert!(verified_version("2.1.330"));
        assert!(!verified_version("2.1.313"));
        assert!(!verified_version("2.1.31"));
    }

    #[test]
    fn creates_a_valid_unique_provider_session_id() {
        let first = session_id().unwrap();
        let second = session_id().unwrap();
        assert_eq!(first.len(), 36);
        assert_eq!(first.as_bytes()[14], b'4');
        assert!(matches!(first.as_bytes()[19], b'8'..=b'b'));
        assert_ne!(first, second);
    }

    #[test]
    fn maps_read_only_settings_to_claude_plan_mode() {
        let args = command_arguments(
            "session-1",
            false,
            &settings(ApprovalPolicy::OnRequest, Sandbox::ReadOnly),
        );
        let args: Vec<_> = args.iter().map(|arg| arg.to_string_lossy()).collect();
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--permission-mode", "plan"])
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--session-id", "session-1"])
        );
        assert!(args.windows(2).any(|pair| pair == ["--model", "sonnet"]));
    }

    #[test]
    fn full_access_skips_claude_permission_checks_and_says_so() {
        let args = command_arguments(
            "session-1",
            false,
            &settings(ApprovalPolicy::Never, Sandbox::FullAccess),
        );
        let args: Vec<_> = args.iter().map(|arg| arg.to_string_lossy()).collect();
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--permission-mode", "bypassPermissions"])
        );
        assert!(args.iter().any(|arg| arg == "--allow-dangerously-skip-permissions"));
    }

    #[test]
    fn routes_claude_approvals_to_the_agent_sdk_stdio_channel() {
        let args = command_arguments(
            "session-1",
            false,
            &settings(ApprovalPolicy::OnRequest, Sandbox::WorkspaceWrite),
        );
        let args: Vec<_> = args.iter().map(|arg| arg.to_string_lossy()).collect();
        assert!(
            args.iter()
                .any(|argument| argument == "--permission-prompt-tool=stdio")
        );
    }

    #[test]
    fn a_picked_model_and_effort_reach_the_next_message_and_leave_permissions_alone() {
        let launch = settings(ApprovalPolicy::OnRequest, Sandbox::ReadOnly);
        let plain = command_arguments("s", true, &launch);
        let picked = command_arguments_for_turn(
            "s",
            true,
            &launch,
            &TurnChoice { model: Some("opus".into()), effort: Some("max".into()) },
        );
        let text = |args: &[std::ffi::OsString]| -> Vec<String> {
            args.iter().map(|arg| arg.to_string_lossy().into_owned()).collect()
        };
        let (plain, picked) = (text(&plain), text(&picked));
        assert!(picked.windows(2).any(|pair| pair == ["--model", "opus"]));
        assert!(picked.windows(2).any(|pair| pair == ["--effort", "max"]));
        assert_eq!(picked.iter().filter(|arg| *arg == "--model").count(), 1);
        assert!(!plain.iter().any(|arg| arg == "--effort"));
        let without_choice = |args: &[String]| -> Vec<String> {
            let mut kept = Vec::new();
            let mut skip = false;
            for arg in args {
                if skip { skip = false; continue; }
                if arg == "--model" || arg == "--effort" { skip = true; continue; }
                kept.push(arg.clone());
            }
            kept
        };
        // Everything but the model and effort, permissions included, is identical.
        assert_eq!(without_choice(&plain), without_choice(&picked));
    }

    #[test]
    fn a_turns_choice_is_read_from_its_parameters_and_checked() {
        let choice = turn_choice(&json!({"threadId":"t","model":"sonnet","effort":"high"})).unwrap();
        assert_eq!(choice.model.as_deref(), Some("sonnet"));
        assert_eq!(choice.effort.as_deref(), Some("high"));
        assert!(turn_choice(&json!({"threadId":"t"})).unwrap().is_empty());
        assert!(turn_choice(&json!({"model":"--add-dir"})).is_err());
        assert!(turn_choice(&json!({"effort":"warp"})).is_err());
    }

    #[test]
    fn resume_uses_the_exact_existing_provider_session_id() {
        let args = command_arguments(
            "provider-session-exact",
            true,
            &settings(ApprovalPolicy::Never, Sandbox::WorkspaceWrite),
        );
        let args: Vec<_> = args.iter().map(|arg| arg.to_string_lossy()).collect();
        assert!(
            args.iter()
                .any(|arg| arg == "--resume=provider-session-exact")
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--permission-mode", "dontAsk"])
        );
        assert!(!args.iter().any(|arg| arg == "--session-id"));
    }

    #[test]
    fn reads_session_identity_from_initialization() {
        assert_eq!(
            parse_output_frame(r#"{"type":"system","subtype":"init","session_id":"session-1"}"#)
                .unwrap(),
            OutputFrame::Initialized {
                session_id: "session-1".into()
            }
        );
    }

    #[test]
    fn reads_streaming_text_and_content_block_identity() {
        assert_eq!(
            parse_output_frame(r#"{"type":"stream_event","event":{"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"hello"}}}"#).unwrap(),
            OutputFrame::TextDelta { block_index: 2, text: "hello".into() }
        );
    }

    #[test]
    fn reads_message_identity_and_model_from_stream_start() {
        assert_eq!(
            parse_output_frame(r#"{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg-1","model":"claude-sonnet"}}}"#).unwrap(),
            OutputFrame::MessageStarted {
                message_id: "msg-1".into(),
                model: "claude-sonnet".into()
            }
        );
    }

    #[test]
    fn reads_tool_input_deltas_and_content_block_completion() {
        assert_eq!(
            parse_output_frame(r#"{"type":"stream_event","event":{"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"{\"command\":"}}}"#).unwrap(),
            OutputFrame::ToolInputDelta {
                block_index: 3,
                partial_json: "{\"command\":".into()
            }
        );
        assert_eq!(
            parse_output_frame(
                r#"{"type":"stream_event","event":{"type":"content_block_stop","index":3}}"#
            )
            .unwrap(),
            OutputFrame::ContentBlockEnded { block_index: 3 }
        );
    }

    #[test]
    fn reads_tool_name_and_initial_input() {
        assert_eq!(
            parse_output_frame(r#"{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool-1","name":"Bash","input":{"command":"pwd"}}}}"#).unwrap(),
            OutputFrame::ToolUse {
                block_index: 1,
                id: "tool-1".into(),
                name: "Bash".into(),
                input: json!({"command":"pwd"})
            }
        );
    }

    #[test]
    fn ignores_nested_subagent_streams() {
        assert_eq!(
            parse_output_frame(r#"{"type":"stream_event","parent_tool_use_id":"tool-1","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"private child output"}}}"#).unwrap(),
            OutputFrame::Other
        );
    }

    #[test]
    fn bounds_tool_output_and_preserves_error_state() {
        let frame = json!({
            "type": "user",
            "message": {"content": [{
                "type": "tool_result",
                "tool_use_id": "tool-1",
                "content": "x".repeat(9000),
                "is_error": true
            }]}
        });
        let OutputFrame::ToolResults(results) = parse_output_frame(&frame.to_string()).unwrap()
        else {
            panic!("tool result frame was not recognized");
        };
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "tool-1");
        assert!(results[0].is_error);
        assert!(results[0].output.ends_with("[Output truncated]"));
        assert!(results[0].output.len() < 9000);
    }

    #[test]
    fn rejects_oversized_stream_frames() {
        let frame = format!(
            "{{\"type\":\"assistant\",\"padding\":\"{}\"}}",
            "x".repeat(MAX_FRAME_BYTES)
        );
        assert!(parse_output_frame(&frame).is_err());
    }

    #[test]
    fn preserves_control_request_body_for_provider_native_approval() {
        let request =
            json!({"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"git status"}});
        let frame = json!({"type":"control_request","request_id":"request-8","request":request});
        assert_eq!(
            parse_output_frame(&frame.to_string()).unwrap(),
            OutputFrame::ControlRequest {
                request_id: "request-8".into(),
                request
            }
        );
    }

    #[test]
    fn fails_closed_on_malformed_identity_and_unknown_frame_types() {
        assert!(
            parse_output_frame(r#"{"type":"result","session_id":"","is_error":false}"#).is_err()
        );
        assert!(parse_output_frame(r#"{"type":"unknown_future_event"}"#).is_err());
    }
}
