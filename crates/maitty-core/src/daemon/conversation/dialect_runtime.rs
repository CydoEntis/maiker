//! Runs any [`ProviderDialect`]: owns the provider's process and pipes, hands the dialect each
//! command and each line, and carries out the steps it gets back.
//!
//! Codex and Claude do not run here yet: each still has its own loop (`runtime.rs`,
//! `claude.rs`), which holds what this one has not learned (Codex's handshake and version
//! checks, Claude's process started ahead of the next message). No agent in the registry uses
//! it, so it is built only for its tests until the first one does.

use super::runtime::{Command, Owner, Payload, Rpc, emit};
use super::transport::RpcError;
use crate::daemon::Ev;
use anyhow::{Context, Result, bail};
use futures_util::{SinkExt, StreamExt};
use maitty_provider::{Asked, LaunchPlan, ProviderDialect, ProviderEvent, Step};
use serde_json::{Value, json};
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::mpsc;
use tokio_util::codec::{FramedRead, FramedWrite, LinesCodec};

const STDERR_CHUNK_BYTES: usize = 8192;
/// How long a process whose input was closed is given to exit by itself before it is stopped.
const PROCESS_EXIT_TIMEOUT: Duration = Duration::from_secs(2);
/// The error code for a command the dialect itself refused, as JSON-RPC names a server error.
const REFUSED_BY_ADAPTER: i64 = -32000;

/// Where a dialect's processes run. The daemon chooses the program; the dialect only its
/// arguments.
pub(super) struct Host {
    pub(super) executable: PathBuf,
    pub(super) cwd: PathBuf,
    /// The effective environment. Values can hold credentials, so it is never logged.
    pub(super) environment: Vec<(OsString, OsString)>,
}

struct Process {
    child: super::process::OwnedChild,
    /// `None` once the dialect closed it.
    input: Option<FramedWrite<tokio::process::ChildStdin, LinesCodec>>,
    output: FramedRead<tokio::process::ChildStdout, LinesCodec>,
    stderr: Option<tokio::task::JoinHandle<std::io::Result<()>>>,
}

impl Process {
    async fn spawn(host: &Host, plan: &LaunchPlan) -> Result<Self> {
        let mut command = std::process::Command::new(&host.executable);
        command
            .env_clear()
            .envs(host.environment.iter().filter_map(|(key, value)| {
                let name = key.to_string_lossy();
                let removed = plan
                    .removed_environment
                    .iter()
                    .any(|removed| name.eq_ignore_ascii_case(removed));
                // The daemon's own identity is never a provider's to hold.
                (!crate::ipc::is_identity_env(&name) && !removed).then_some((key, value))
            }))
            .envs(&plan.environment)
            .args(&plan.arguments)
            .current_dir(&host.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::proc::quiet(&mut command);
        let mut child = super::process::OwnedChild::spawn(command)
            .await
            .map_err(|failure| anyhow::Error::new(failure.error).context("Launch provider"))?;
        let (Some(stdin), Some(stdout), Some(stderr)) =
            (child.child.stdin.take(), child.child.stdout.take(), child.child.stderr.take())
        else {
            let cleanup = child.stop().await;
            bail!("Provider pipes are unavailable (stopped: {})", cleanup.is_ok());
        };
        let limit = super::transport::MAX_FRAME_BYTES;
        Ok(Self {
            child,
            input: Some(FramedWrite::new(stdin, LinesCodec::new_with_max_length(limit))),
            output: FramedRead::new(stdout, LinesCodec::new_with_max_length(limit)),
            stderr: Some(tokio::spawn(discard_stderr(stderr))),
        })
    }

    async fn write(&mut self, line: String) -> Result<()> {
        self.input
            .as_mut()
            .context("Provider input is already closed")?
            .send(line)
            .await
            .context("Write provider input")
    }

    async fn close_input(&mut self) -> Result<()> {
        if let Some(mut input) = self.input.take() {
            SinkExt::<String>::close(&mut input)
                .await
                .context("Close provider input")?;
            // Only dropping the pipe ends a child's input; shutting it down does not on Unix.
            drop(input);
        }
        Ok(())
    }

    /// The next line, or `None` when the provider closed its output.
    async fn next(&mut self) -> Result<Option<String>> {
        match self.output.next().await {
            None => Ok(None),
            // The codec's error can quote the frame, so it is not kept.
            Some(Err(_)) => bail!("Provider frame is invalid or too large"),
            Some(Ok(line)) => Ok(Some(line)),
        }
    }

    async fn stop(&mut self) -> Result<()> {
        self.close_input().await?;
        // Given the chance to exit by itself; the tree is stopped either way.
        let _ = tokio::time::timeout(PROCESS_EXIT_TIMEOUT, self.child.child.wait()).await;
        self.child.stop().await.context("Dispose provider process tree")?;
        if let Some(stderr) = self.stderr.take() {
            stderr
                .await
                .context("Join provider stderr reader")?
                .context("Read provider stderr")?;
        }
        Ok(())
    }
}

async fn discard_stderr(mut stderr: impl AsyncRead + Unpin) -> std::io::Result<()> {
    let mut chunk = [0; STDERR_CHUNK_BYTES];
    while stderr.read(&mut chunk).await? != 0 {}
    Ok(())
}

/// The daemon's request tokens still waiting for the provider's answer, one of each kind.
#[derive(Default)]
struct Waiting {
    open: Option<u64>,
    send: Option<u64>,
    steer: Option<u64>,
    interrupt: Option<u64>,
    history: Option<u64>,
}

impl Waiting {
    fn slot(&mut self, asked: Asked) -> &mut Option<u64> {
        match asked {
            Asked::Open => &mut self.open,
            Asked::Send => &mut self.send,
            Asked::Steer => &mut self.steer,
            Asked::Interrupt => &mut self.interrupt,
            Asked::ReadHistory => &mut self.history,
        }
    }

    fn take(&mut self, asked: Asked) -> Result<u64> {
        self.slot(asked)
            .take()
            .context("Provider answered a command nobody is waiting on")
    }
}

/// Whether the conversation goes on after a step.
enum Outcome {
    Continue,
    /// The dialect reported the provider gone, with why.
    Ended(String),
}

struct Runner<'a> {
    dialect: Box<dyn ProviderDialect>,
    host: Host,
    owner: Owner,
    events: &'a mpsc::Sender<Ev>,
    process: Option<Process>,
    waiting: Waiting,
}

impl Runner<'_> {
    async fn respond(&mut self, token: u64, result: Result<Value, RpcError>) -> Result<()> {
        emit(self.events, self.owner, Payload::Response { token, result }).await
    }

    /// Turns the daemon's command into the dialect's, remembering which token its answer is for.
    fn command(&mut self, command: Command) -> Result<(maitty_provider::Command, Option<Asked>)> {
        use maitty_provider::Command as Asking;
        let (asking, asked) = match command.request {
            Rpc::Open { session, .. } => (Asking::Open { session }, Some(Asked::Open)),
            Rpc::Send { text, message, choice, .. } => {
                // The dialect is given a name for the turn; a provider that names turns itself
                // reports its own.
                let turn = crate::daemon::term::new_secret()?;
                (Asking::Send { turn, user_item: message, text, choice }, Some(Asked::Send))
            }
            Rpc::Steer { turn, text, .. } => (Asking::Steer { turn, text }, Some(Asked::Steer)),
            Rpc::Interrupt { turn, .. } => (Asking::Interrupt { turn }, Some(Asked::Interrupt)),
            Rpc::ReadHistory { cursor, limit, .. } => {
                (Asking::ReadHistory { cursor, limit }, Some(Asked::ReadHistory))
            }
            Rpc::Answer { request, decision, .. } => (Asking::Answer { request, decision }, None),
            Rpc::AnswerInput { request, answers } => (Asking::AnswerInput { request, answers }, None),
        };
        if let Some(asked) = asked {
            let slot = self.waiting.slot(asked);
            anyhow::ensure!(slot.is_none(), "Provider is still answering the same kind of command");
            *slot = Some(command.token);
        }
        Ok((asking, asked))
    }

    async fn on_command(&mut self, command: Command) -> Result<Outcome> {
        let token = command.token;
        let (asking, asked) = self.command(command)?;
        match self.dialect.on_command(asking) {
            Ok(steps) => self.carry_out(steps).await,
            // A refused command leaves the conversation as it was; only its asker is told.
            Err(error) => {
                tracing::warn!(conversation = self.owner.conversation.0, error = %error, "Provider adapter refused a command");
                match asked {
                    Some(asked) => {
                        self.waiting.slot(asked).take();
                        self.respond(token, Err(RpcError::adapter_failure(REFUSED_BY_ADAPTER))).await?;
                        Ok(Outcome::Continue)
                    }
                    // An answer has nobody waiting on it, so a refused one cannot be reported
                    // back: the request it was for would stay open for ever.
                    None => Err(error.context("Provider adapter refused an answer")),
                }
            }
        }
    }

    async fn carry_out(&mut self, steps: Vec<Step>) -> Result<Outcome> {
        for step in steps {
            match step {
                Step::Spawn(plan) => {
                    if let Some(mut finished) = self.process.take() {
                        finished.stop().await?;
                    }
                    let mut process = Process::spawn(&self.host, &plan).await?;
                    for line in plan.preamble {
                        process.write(line).await?;
                    }
                    self.process = Some(process);
                }
                Step::Write(line) => {
                    self.process
                        .as_mut()
                        .context("Provider adapter wrote with no process running")?
                        .write(line)
                        .await?;
                }
                Step::CloseInput => {
                    if let Some(process) = &mut self.process {
                        process.close_input().await?;
                    }
                }
                Step::Emit(event) => {
                    if let Outcome::Ended(failure) = self.report(event).await? {
                        return Ok(Outcome::Ended(failure));
                    }
                }
            }
        }
        Ok(Outcome::Continue)
    }

    /// Hands an event to the daemon: an answer to a command goes to the token that asked it, in
    /// the shape the daemon reads every provider's answers in; anything else goes as it is.
    async fn report(&mut self, event: ProviderEvent) -> Result<Outcome> {
        match event {
            ProviderEvent::Ready { session, .. } => {
                let token = self.waiting.take(Asked::Open)?;
                self.respond(token, Ok(json!({"thread":{"id":session}}))).await?;
            }
            ProviderEvent::Delivered { turn } => {
                let token = self.waiting.take(Asked::Send)?;
                let started = json!({"turn":{"id":turn,"status":"inProgress","items":[]}});
                self.respond(token, Ok(started)).await?;
            }
            ProviderEvent::Steered { turn } => {
                let token = self.waiting.take(Asked::Steer)?;
                self.respond(token, Ok(json!({"turnId":turn}))).await?;
            }
            ProviderEvent::InterruptAcknowledged { .. } => {
                let token = self.waiting.take(Asked::Interrupt)?;
                self.respond(token, Ok(json!({}))).await?;
            }
            ProviderEvent::NoHistoryYet { .. } => {
                let token = self.waiting.take(Asked::ReadHistory)?;
                self.respond(token, Ok(json!({"data":[],"nextCursor":null}))).await?;
            }
            ProviderEvent::HistoryPage { .. } => {
                bail!("Saved history pages are not carried for this provider yet")
            }
            ProviderEvent::Refused { asked, code } => {
                let token = self.waiting.take(asked)?;
                self.respond(token, Err(RpcError::adapter_failure(code))).await?;
            }
            ProviderEvent::Invalid { asked, reason } => {
                tracing::warn!(conversation = self.owner.conversation.0, reason = %reason, "Provider answer was not accepted");
                let token = self.waiting.take(asked)?;
                self.respond(token, Err(RpcError::adapter_failure(REFUSED_BY_ADAPTER))).await?;
            }
            ProviderEvent::Terminated { failure } => return Ok(Outcome::Ended(failure)),
            event => emit(self.events, self.owner, Payload::Event(event)).await?,
        }
        Ok(Outcome::Continue)
    }

    async fn work(&mut self, requests: &mut mpsc::Receiver<Command>) -> Result<Outcome> {
        emit(self.events, self.owner, Payload::Ready).await?;
        loop {
            let outcome = tokio::select! {
                command = requests.recv() => {
                    let command = command.context("Provider command sender closed")?;
                    self.on_command(command).await?
                }
                line = next_line(&mut self.process) => match line? {
                    Some(line) => {
                        let steps = self.dialect.on_line(&line)?;
                        self.carry_out(steps).await?
                    }
                    None => {
                        if let Some(mut exited) = self.process.take() {
                            exited.stop().await?;
                        }
                        let steps = self.dialect.on_exit();
                        self.carry_out(steps).await?
                    }
                },
            };
            if let Outcome::Ended(failure) = outcome {
                return Ok(Outcome::Ended(failure));
            }
        }
    }
}

/// The running process's next line. Never ready while no process runs.
async fn next_line(process: &mut Option<Process>) -> Result<Option<String>> {
    match process {
        Some(process) => process.next().await,
        None => std::future::pending().await,
    }
}

pub(super) async fn run(
    dialect: Box<dyn ProviderDialect>,
    host: Host,
    owner: Owner,
    events: mpsc::Sender<Ev>,
    mut stop: mpsc::Receiver<()>,
    mut requests: mpsc::Receiver<Command>,
) {
    let mut runner = Runner {
        dialect,
        host,
        owner,
        events: &events,
        process: None,
        waiting: Waiting::default(),
    };
    let result = tokio::select! {
        biased;
        _ = stop.recv() => Ok(None),
        result = runner.work(&mut requests) => result.map(|outcome| match outcome {
            Outcome::Ended(failure) => Some(failure),
            Outcome::Continue => None,
        }),
    };
    let cleanup = match runner.process.take() {
        Some(mut process) => process.stop().await,
        None => Ok(()),
    };
    let reaped = cleanup.is_ok();
    let failure = match (result, cleanup) {
        (Ok(failure), Ok(())) => failure,
        (Ok(Some(failure)), Err(cleanup)) => Some(format!("{failure}; cleanup failed: {cleanup:#}")),
        (Ok(None), Err(cleanup)) => Some(format!("{cleanup:#}")),
        (Err(error), Ok(())) => Some(format!("{error:#}")),
        (Err(error), Err(cleanup)) => Some(format!("{error:#}; cleanup failed: {cleanup:#}")),
    };
    // A closed daemon channel needs no further notification.
    let _ = emit(&events, owner, Payload::Terminated { failure, reaped }).await;
}

#[cfg(test)]
mod tests;
