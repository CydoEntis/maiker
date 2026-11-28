//! The pane host process (`<app> pane-host`, ADR 0022): it holds every pseudo-terminal and the
//! program in it, so a daemon that stops (an update, a crash) leaves them running for the next
//! one. It does no terminal emulation, status or saving: it relays bytes, keeps each pane's
//! latest output, and takes orders only from the daemon over its private socket.

use super::wire::{FromHost, HOST_VERSION, HostedPane, PaneId, ToHost, read_frame, write_frame};
use anyhow::{Context, Result};
use interprocess::local_socket::ListenerOptions;
use interprocess::local_socket::prelude::*;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::collections::{BTreeMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

/// How long a host with no running pane and no daemon waits before it ends.
const IDLE_EXIT_AFTER: Duration = Duration::from_secs(30);
/// How often it checks.
const IDLE_CHECK_EVERY: Duration = Duration::from_secs(5);
/// The most a pane may ask the host to keep of its output.
const MAX_KEPT_BYTES: usize = 16 * 1024 * 1024;

struct Pane {
    master: Box<dyn MasterPty + Send>,
    input: mpsc::Sender<Vec<u8>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
    rows: u16,
    cols: u16,
    keep: Vec<u8>,
    kept: VecDeque<u8>,
    kept_bytes: usize,
    exited: Option<bool>,
}

#[derive(Default)]
struct State {
    panes: BTreeMap<PaneId, Pane>,
    /// The connection that asked for the list last: each pane's output and exit go to it.
    sink: Option<(u64, mpsc::Sender<FromHost>)>,
    connections: usize,
    idle_since: Option<Instant>,
}

type Shared = Arc<Mutex<State>>;

fn lock(state: &Shared) -> std::sync::MutexGuard<'_, State> {
    // A thread that panicked holding the lock left the map whole: every change to it is one
    // insert or remove.
    state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl State {
    fn tell(&mut self, message: FromHost) {
        if let Some((_, sink)) = &self.sink
            && sink.send(message).is_err()
        {
            self.sink = None;
        }
    }
}

/// Run the host until it is told to stop, or has had nothing to hold for a while.
pub fn run() -> Result<()> {
    init_logging();
    // Its panes go when it goes, however it goes, as the daemon's do (`contain`).
    crate::contain_children();
    let listener = {
        #[cfg(unix)]
        let _ = std::fs::remove_file(crate::ipc::pane_host_path()?);
        ListenerOptions::new()
            .name(crate::ipc::pane_host_name()?)
            .create_sync()
            .context("creating the pane host's socket")?
    };
    tracing::info!("pane host listening");
    let state: Shared = Arc::new(Mutex::new(State {
        idle_since: Some(Instant::now()),
        ..State::default()
    }));
    {
        let state = state.clone();
        std::thread::Builder::new()
            .name("pane-host-idle".into())
            .spawn(move || {
                loop {
                    std::thread::sleep(IDLE_CHECK_EVERY);
                    let s = lock(&state);
                    // A pane whose program ended is no reason to stay: no daemon is there to
                    // take it up, and the next one starts it again from its saved session.
                    if s.panes.values().all(|p| p.exited.is_some())
                        && s.connections == 0
                        && s.idle_since.is_some_and(|since| since.elapsed() >= IDLE_EXIT_AFTER)
                    {
                        tracing::info!("pane host: nothing to hold, ending");
                        std::process::exit(0);
                    }
                }
            })?;
    }
    accept(listener, state);
    Ok(())
}

/// Serve each connection on a thread of its own, for as long as the socket takes them.
fn accept(listener: interprocess::local_socket::Listener, state: Shared) {
    let mut next_connection = 0u64;
    for stream in listener.incoming() {
        let stream = match stream {
            Ok(stream) => stream,
            Err(error) => {
                tracing::warn!("pane host: a connection failed: {error}");
                continue;
            }
        };
        next_connection += 1;
        let state = state.clone();
        let connection = next_connection;
        if let Err(error) = std::thread::Builder::new()
            .name(format!("pane-host-conn-{connection}"))
            .spawn(move || serve(stream, connection, state))
        {
            tracing::warn!("pane host: no thread for a connection: {error}");
        }
    }
}

/// A host on `name`, on threads of this process, for tests.
#[cfg(test)]
pub(super) fn serve_for_test(name: interprocess::local_socket::Name<'static>) -> Result<()> {
    let listener = ListenerOptions::new().name(name).create_sync()?;
    std::thread::spawn(move || accept(listener, Shared::default()));
    Ok(())
}

fn serve(stream: interprocess::local_socket::Stream, connection: u64, state: Shared) {
    let (mut input, mut output) = stream.split();
    let (tx, rx) = mpsc::channel::<FromHost>();
    let writer = std::thread::spawn(move || {
        for message in rx {
            if write_frame(&mut output, &message).is_err() {
                break;
            }
        }
    });
    {
        let mut s = lock(&state);
        s.connections += 1;
        s.idle_since = None;
    }
    loop {
        match read_frame::<ToHost>(&mut input) {
            Ok(Some(message)) => handle(message, connection, &tx, &state),
            Ok(None) => break,
            Err(error) => {
                tracing::warn!("pane host: dropped a connection that sent something unreadable: {error:#}");
                break;
            }
        }
    }
    {
        let mut s = lock(&state);
        s.connections -= 1;
        if s.sink.as_ref().is_some_and(|(id, _)| *id == connection) {
            s.sink = None;
        }
        if s.connections == 0 {
            s.idle_since = Some(Instant::now());
        }
    }
    drop(tx);
    let _ = writer.join();
}

fn handle(
    message: ToHost,
    connection: u64,
    reply: &mpsc::Sender<FromHost>,
    state: &Shared,
) {
    match message {
        ToHost::Hello { .. } => {
            let _ = reply.send(FromHost::Welcome {
                version: HOST_VERSION,
                build: env!("APP_VERSION").into(),
            });
        }
        ToHost::List => {
            let mut s = lock(state);
            let panes = s
                .panes
                .iter()
                .map(|(id, p)| HostedPane {
                    id: *id,
                    pid: p.pid,
                    rows: p.rows,
                    cols: p.cols,
                    keep: p.keep.clone(),
                    output: p.kept.iter().copied().collect(),
                    exited: p.exited,
                })
                .collect();
            // Under the lock, so no output lands between the list and the live stream.
            let _ = reply.send(FromHost::Panes { panes });
            s.sink = Some((connection, reply.clone()));
        }
        ToHost::Spawn { id, argv, cwd, env, rows, cols, kept_bytes, keep } => {
            let answer = match spawn(state, id, argv, cwd, env, rows, cols, kept_bytes, keep) {
                Ok(pid) => FromHost::Spawned { id, pid },
                Err(error) => FromHost::SpawnFailed { id, error: format!("{error:#}") },
            };
            let _ = reply.send(answer);
        }
        ToHost::Write { id, data } => {
            if let Some(pane) = lock(state).panes.get(&id) {
                let _ = pane.input.send(data);
            }
        }
        ToHost::Resize { id, rows, cols } => {
            if let Some(pane) = lock(state).panes.get_mut(&id) {
                (pane.rows, pane.cols) = (rows, cols);
                let _ = pane.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
            }
        }
        ToHost::Kill { id } => {
            if let Some(pane) = lock(state).panes.get_mut(&id) {
                end(pane);
            }
        }
        ToHost::Forget { id } => {
            let removed = lock(state).panes.remove(&id);
            if let Some(mut pane) = removed {
                if pane.exited.is_none() {
                    end(&mut pane);
                }
                // Closing a Windows pseudo-terminal can block: never under the lock.
                std::thread::spawn(move || drop(pane));
            }
            let mut s = lock(state);
            if s.panes.is_empty() && s.connections == 0 {
                s.idle_since = Some(Instant::now());
            }
        }
        ToHost::Shutdown => {
            let mut s = lock(state);
            for pane in s.panes.values_mut() {
                end(pane);
            }
            tracing::info!("pane host: told to stop, ending {} pane(s)", s.panes.len());
            // A moment for the kills to land before the process (and its job) goes.
            std::thread::sleep(Duration::from_millis(200));
            std::process::exit(0);
        }
    }
}

fn init_logging() {
    let dir = crate::config::data_dir();
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("pane-host.log"))
    {
        let _ = tracing_subscriber::fmt()
            .with_writer(Mutex::new(file))
            .with_ansi(false)
            .with_env_filter("info")
            .try_init();
    }
}

/// End the pane's program and what it started; the exit arrives through its wait thread.
fn end(pane: &mut Pane) {
    let _ = super::kill_tree(pane.pid);
    let _ = pane.killer.kill();
}

#[allow(clippy::too_many_arguments)]
fn spawn(
    state: &Shared,
    id: PaneId,
    argv: Vec<std::ffi::OsString>,
    cwd: Option<std::ffi::OsString>,
    env: Vec<(std::ffi::OsString, std::ffi::OsString)>,
    rows: u16,
    cols: u16,
    kept_bytes: u32,
    keep: Vec<u8>,
) -> Result<Option<u32>> {
    if lock(state).panes.contains_key(&id) {
        anyhow::bail!("pane {id} already runs");
    }
    if argv.is_empty() {
        anyhow::bail!("nothing to run");
    }
    let size = PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 };
    let pair = native_pty_system().openpty(size).context("opening pty")?;
    let mut cmd = CommandBuilder::from_argv(argv);
    cmd.env_clear();
    for (key, value) in env {
        cmd.env(key, value);
    }
    if let Some(cwd) = cwd {
        cmd.cwd(cwd);
    }
    let mut child = pair.slave.spawn_command(cmd).context("starting the pane's program")?;
    drop(pair.slave);
    let pid = child.process_id();
    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader()?;
    let mut writer = pair.master.take_writer()?;
    let (input, inputs) = mpsc::channel::<Vec<u8>>();
    std::thread::Builder::new()
        .name(format!("pane-host-in-{id}"))
        .spawn(move || {
            for data in inputs {
                if writer.write_all(&data).and_then(|_| writer.flush()).is_err() {
                    break;
                }
            }
        })?;
    lock(state).panes.insert(
        id,
        Pane {
            master: pair.master,
            input,
            killer,
            pid,
            rows: size.rows,
            cols: size.cols,
            keep,
            kept: VecDeque::new(),
            kept_bytes: (kept_bytes as usize).min(MAX_KEPT_BYTES),
            exited: None,
        },
    );
    {
        let state = state.clone();
        std::thread::Builder::new()
            .name(format!("pane-host-out-{id}"))
            .spawn(move || {
                let mut buf = vec![0u8; 64 * 1024];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let mut s = lock(&state);
                            let Some(pane) = s.panes.get_mut(&id) else { break };
                            pane.kept.extend(&buf[..n]);
                            let over = pane.kept.len().saturating_sub(pane.kept_bytes);
                            pane.kept.drain(..over);
                            s.tell(FromHost::Output { id, data: buf[..n].to_vec() });
                        }
                    }
                }
                lock(&state).tell(FromHost::OutputEnded { id });
            })?;
    }
    {
        let state = state.clone();
        // ConPTY keeps the output open after the program exits, so its exit is watched too.
        std::thread::Builder::new()
            .name(format!("pane-host-wait-{id}"))
            .spawn(move || {
                let failed = child.wait().is_ok_and(|status| !status.success());
                let mut s = lock(&state);
                if let Some(pane) = s.panes.get_mut(&id) {
                    pane.exited = Some(failed);
                }
                s.tell(FromHost::Exited { id, failed });
            })?;
    }
    Ok(pid)
}
