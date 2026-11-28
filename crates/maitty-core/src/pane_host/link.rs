//! The daemon's end of the pane host (ADR 0022): one connection, read and written on threads
//! of its own so the daemon's loop never waits on the host except for a spawn's answer.

use super::wire::{FromHost, HOST_VERSION, HostedPane, PaneId, ToHost, read_frame, write_frame};
use anyhow::{Context, Result, bail};
use interprocess::local_socket::ConnectOptions;
use interprocess::local_socket::prelude::*;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

/// How long a spawn waits for the host's answer before it gives up on the host.
const SPAWN_ANSWER_WITHIN: Duration = Duration::from_secs(10);
/// How long a host that was just started gets to open its socket.
const HOST_STARTS_WITHIN: Duration = Duration::from_secs(5);
/// How long the first exchange may take.
const HELLO_WITHIN: Duration = Duration::from_secs(5);

/// What the host says about a pane, for the daemon's loop.
#[derive(Debug, PartialEq)]
pub enum Event {
    Output(PaneId, Vec<u8>),
    OutputEnded(PaneId),
    Exited(PaneId, bool),
}

/// The daemon's own note on a pane, kept by the host and given back to the next daemon.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Keep {
    /// The pane's secret (`AGENT_PANE_TOKEN`), which its hooks still send.
    pub token: String,
    /// The program it was started with, by name.
    #[serde(default)]
    pub process: String,
}

type Answers = Arc<Mutex<HashMap<PaneId, mpsc::Sender<std::result::Result<Option<u32>, String>>>>>;

pub struct Link {
    out: mpsc::Sender<ToHost>,
    answers: Answers,
    /// The panes this daemon has on the host, so a lost host ends each of them.
    live: Arc<Mutex<BTreeSet<PaneId>>>,
    alive: Arc<AtomicBool>,
}

impl Link {
    /// Reach the running host, or start one from `exe` (a copy kept for the host, so an update
    /// can replace the installed binary while it runs). Answers the panes it already holds.
    pub fn open(exe: &Path, on_event: impl Fn(Event) + Send + 'static) -> Result<(Link, Vec<HostedPane>)> {
        let mut greeted = match connect() {
            Ok(stream) => greet(stream)?,
            Err(_) => greet(start_host(exe)?)?,
        };
        // A host is replaced only while it holds nothing (ADR 0022): one of another release
        // that does is kept, and speaks the oldest contract both know.
        if greeted.panes.is_empty() && greeted.build != env!("APP_VERSION") {
            tracing::info!("replacing the empty pane host of {} with this release's", greeted.build);
            write_frame(&mut greeted.output, &ToHost::Shutdown)?;
            drop(greeted);
            let started = std::time::Instant::now();
            while connect().is_ok() {
                if started.elapsed() >= HOST_STARTS_WITHIN {
                    bail!("the old pane host did not stop");
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            greeted = greet(start_host(exe)?)?;
        }
        Link::follow(greeted, on_event)
    }

    /// Follow the panes of a host on `stream` (a test's own host).
    #[cfg(test)]
    pub(super) fn over(stream: interprocess::local_socket::Stream, on_event: impl Fn(Event) + Send + 'static) -> Result<(Link, Vec<HostedPane>)> {
        Link::follow(greet(stream)?, on_event)
    }

    /// From here on the host's output and exits go to `on_event`.
    fn follow(greeted: Greeted, on_event: impl Fn(Event) + Send + 'static) -> Result<(Link, Vec<HostedPane>)> {
        let Greeted { mut input, mut output, panes, .. } = greeted;
        let live: Arc<Mutex<BTreeSet<PaneId>>> =
            Arc::new(Mutex::new(panes.iter().map(|p| p.id).collect()));
        let answers: Answers = Arc::default();
        let alive = Arc::new(AtomicBool::new(true));
        let (out, outgoing) = mpsc::channel::<ToHost>();
        {
            let alive = alive.clone();
            std::thread::Builder::new().name("pane-host-send".into()).spawn(move || {
                for message in outgoing {
                    if write_frame(&mut output, &message).is_err() {
                        break;
                    }
                }
                alive.store(false, Ordering::SeqCst);
            })?;
        }
        {
            let (answers, live, alive) = (answers.clone(), live.clone(), alive.clone());
            std::thread::Builder::new().name("pane-host-read".into()).spawn(move || {
                loop {
                    match read_frame::<FromHost>(&mut input) {
                        Ok(Some(FromHost::Spawned { id, pid })) => answer(&answers, id, Ok(pid)),
                        Ok(Some(FromHost::SpawnFailed { id, error })) => answer(&answers, id, Err(error)),
                        Ok(Some(FromHost::Output { id, data })) => on_event(Event::Output(id, data)),
                        Ok(Some(FromHost::OutputEnded { id })) => on_event(Event::OutputEnded(id)),
                        Ok(Some(FromHost::Exited { id, failed })) => on_event(Event::Exited(id, failed)),
                        Ok(Some(other)) => tracing::warn!("pane host: unexpected {}", other.kind()),
                        Ok(None) => break,
                        Err(error) => {
                            tracing::warn!("pane host: {error:#}");
                            break;
                        }
                    }
                }
                // The host is gone, and every pane it held went with it.
                alive.store(false, Ordering::SeqCst);
                tracing::warn!("lost the pane host; its panes have ended");
                let gone: Vec<PaneId> = std::mem::take(&mut *live.lock().unwrap_or_else(|p| p.into_inner())).into_iter().collect();
                for id in gone {
                    on_event(Event::Exited(id, true));
                    on_event(Event::OutputEnded(id));
                }
                for (_, waiting) in answers.lock().unwrap_or_else(|p| p.into_inner()).drain() {
                    let _ = waiting.send(Err("the pane host went away".into()));
                }
            })?;
        }
        Ok((Link { out, answers, live, alive }, panes))
    }

    pub fn alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Start a pane's program on the host; its process id when the system gave one.
    pub fn spawn(&self, id: PaneId, cmd: &portable_pty::CommandBuilder, rows: u16, cols: u16, kept_bytes: usize, keep: &Keep) -> Result<Option<u32>> {
        if !self.alive() {
            bail!("the pane host is gone");
        }
        let (tx, rx) = mpsc::channel();
        self.answers.lock().unwrap_or_else(|p| p.into_inner()).insert(id, tx);
        let env = cmd
            .iter_full_env_as_str()
            .map(|(k, v)| (k.into(), v.into()))
            .collect();
        self.send(ToHost::Spawn {
            id,
            argv: cmd.get_argv().clone(),
            cwd: cmd.get_cwd().cloned(),
            env,
            rows,
            cols,
            kept_bytes: u32::try_from(kept_bytes).unwrap_or(u32::MAX),
            keep: rmp_serde::to_vec_named(keep)?,
        });
        let answered = rx.recv_timeout(SPAWN_ANSWER_WITHIN);
        self.answers.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
        match answered {
            Ok(Ok(pid)) => {
                self.live.lock().unwrap_or_else(|p| p.into_inner()).insert(id);
                Ok(pid)
            }
            Ok(Err(error)) => bail!("{error}"),
            Err(_) => bail!("the pane host did not start the pane"),
        }
    }

    pub fn send(&self, message: ToHost) {
        if let ToHost::Forget { id } = &message {
            self.live.lock().unwrap_or_else(|p| p.into_inner()).remove(id);
        }
        let _ = self.out.send(message);
    }
}

/// End a pane host left running with no daemon, and its panes; false when none answers.
pub fn end_running_host() -> bool {
    let Ok(stream) = connect() else { return false };
    let (_, mut output) = stream.split();
    write_frame(&mut output, &ToHost::Hello { version: HOST_VERSION })
        .and_then(|_| write_frame(&mut output, &ToHost::Shutdown))
        .is_ok()
}

/// A host's answer to the first exchange, with the connection's two halves.
struct Greeted {
    input: interprocess::local_socket::RecvHalf,
    output: interprocess::local_socket::SendHalf,
    build: String,
    panes: Vec<HostedPane>,
}

/// Say hello and ask for the panes: from the answer on, the host sends this connection each
/// pane's output and exit.
fn greet(stream: interprocess::local_socket::Stream) -> Result<Greeted> {
    let (mut input, mut output) = stream.split();
    write_frame(&mut output, &ToHost::Hello { version: HOST_VERSION })?;
    let (first, rest) = mpsc::channel();
    // Read on a thread of its own, so a host that does not answer is given up on rather than
    // waited for.
    std::thread::spawn(move || {
        let welcome = read_frame::<FromHost>(&mut input);
        let _ = first.send((welcome, input));
    });
    let (welcome, mut input) = rest.recv_timeout(HELLO_WITHIN).context("the pane host did not answer")?;
    let build = match welcome? {
        Some(FromHost::Welcome { version, build }) => {
            tracing::info!("pane host answered (version {version}, release {build})");
            build
        }
        other => bail!("the pane host answered {:?}", other.as_ref().map(FromHost::kind)),
    };
    write_frame(&mut output, &ToHost::List)?;
    let panes = match read_frame::<FromHost>(&mut input)? {
        Some(FromHost::Panes { panes }) => panes,
        other => bail!("the pane host listed {:?}", other.as_ref().map(FromHost::kind)),
    };
    Ok(Greeted { input, output, build, panes })
}

/// Start a host from a copy of `exe` and connect to it once it listens.
fn start_host(exe: &Path) -> Result<interprocess::local_socket::Stream> {
    crate::ipc::spawn_pane_host(&host_copy(exe)?)?;
    let started = std::time::Instant::now();
    loop {
        match connect() {
            Ok(stream) => return Ok(stream),
            Err(error) if started.elapsed() >= HOST_STARTS_WITHIN => {
                return Err(error).context("the pane host did not start");
            }
            Err(_) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

fn answer(answers: &Answers, id: PaneId, result: std::result::Result<Option<u32>, String>) {
    if let Some(waiting) = answers.lock().unwrap_or_else(|p| p.into_inner()).remove(&id) {
        let _ = waiting.send(result);
    }
}

fn connect() -> Result<interprocess::local_socket::Stream> {
    Ok(ConnectOptions::new().name(crate::ipc::pane_host_name()?).connect_sync()?)
}

/// The host runs from a copy of this build kept for it, so an update can replace the installed
/// binary while a host holds panes (Windows locks a running executable), and a host of this
/// version is never replaced under itself.
fn host_copy(exe: &Path) -> Result<PathBuf> {
    let dir = crate::config::data_dir().join("pane-host");
    std::fs::create_dir_all(&dir)?;
    let name = format!(
        "{}-pane-host-{}{}",
        env!("APP_COMMAND"),
        env!("APP_VERSION"),
        std::env::consts::EXE_SUFFIX
    );
    let copy = dir.join(name);
    let same = std::fs::metadata(&copy)
        .ok()
        .zip(std::fs::metadata(exe).ok())
        .is_some_and(|(have, want)| have.len() == want.len());
    if !same {
        let partial = copy.with_extension("partial");
        std::fs::copy(exe, &partial).context("copying the build for the pane host")?;
        std::fs::rename(&partial, &copy).context("putting the pane host's copy in place")?;
    }
    Ok(copy)
}
