use super::runtime::{Payload, TestCleanupState};

use super::transport::{Envelope, RequestId, decode};

use super::*;

use crate::conversation::{Conversation, ExecutionKind, RecoveryState};

use crate::daemon::{Config, Daemon, Ev, ServerMsg};

use futures_util::FutureExt;

use serde_json::{Value, json};

use std::panic::AssertUnwindSafe;

use std::path::{Path, PathBuf};

use std::sync::{Arc, Mutex};

use std::time::Duration;

use tokio::sync::mpsc;

/// A test helper program compiled from `fixtures/<source>`, once for every test of every run with
/// that source. Each fixture used to compile its own: some sixty compilers at once, and as many
/// new programs for a virus scanner to read, left Windows too busy to stop a process within five
/// seconds or to let go of a fixture's folder within a minute.
fn compiled(cell: &'static std::sync::OnceLock<PathBuf>, source: &str) -> &'static Path {
    cell.get_or_init(|| {
        use std::hash::{Hash, Hasher};
        let file = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/daemon/conversation/fixtures").join(source);
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        std::fs::read(&file).unwrap().hash(&mut hasher);
        let built = std::env::temp_dir().join(format!(
            "{}-test-{}-{:016x}{}",
            crate::brand::APP_COMMAND,
            source.trim_end_matches(".rs"),
            hasher.finish(),
            std::env::consts::EXE_SUFFIX
        ));
        if built.exists() {
            return built;
        }
        // Built under a name of its own and moved into place, so a test run that starts at the
        // same moment never runs half a program.
        let partial = built.with_extension(format!("{}.partial", std::process::id()));
        let mut command = std::process::Command::new("rustc");
        command.arg("--edition=2024").args(["-C", "debuginfo=0"]).arg(&file).arg("-o").arg(&partial);
        let output = crate::proc::quiet(&mut command).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        // Windows writes debugging data beside the program whatever is asked; nothing reads it.
        let _ = std::fs::remove_file(partial.with_extension("pdb"));
        if std::fs::rename(&partial, &built).is_err() {
            // The other run got there first; its program is the same one.
            let _ = std::fs::remove_file(&partial);
            assert!(built.exists(), "the compiled {source} is missing");
        }
        built
    })
}

/// `built` under `name` in a fixture's folder, where the program looks for its fixture. A link
/// costs nothing and is a file the scanner has already read; a copy is for a folder that cannot
/// hold one.
fn placed(built: &Path, root: &Path, name: &str) -> PathBuf {
    let executable = root.join(format!("{name}{}", std::env::consts::EXE_SUFFIX));
    if std::fs::hard_link(built, &executable).is_err() {
        std::fs::copy(built, &executable).unwrap();
    }
    executable
}

fn fake_claude_executable(root: &Path) -> PathBuf {
    static BUILT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    placed(compiled(&BUILT, "fake_claude.rs"), root, "fake-claude")
}

fn claude_launch(root: &Path, scenario: Option<&str>) -> (Launch, super::runtime::Owner) {
    std::fs::create_dir_all(root).unwrap();
    let executable = fake_claude_executable(root);
    let root = std::fs::canonicalize(root).unwrap();
    let settings = crate::conversation::LaunchSettings {
        provider: crate::conversation::Provider::Claude,
        executable: executable.clone(),
        config_root: root.clone(),
        cwd: root.clone(),
        model: None,
        model_provider: None,
        approval_policy: crate::conversation::ApprovalPolicy::OnRequest,
        sandbox: crate::conversation::Sandbox::ReadOnly,
    };
    let conversation = Conversation {
        id: crate::conversation::ConversationId(90),
        binding: crate::conversation::NativeBinding {
            provider: crate::conversation::Provider::Claude,
            session_id: "fixture-session".into(),
            account: None,
            profile: None,
            config_root: root.clone(),
            executable,
            cwd: root,
            worktree: None,
        },
        execution: ExecutionKind::Structured,
        generation: 1,
        state: RecoveryState::Stopped,
        settings: Some(settings),
        awaiting_first_user_message: false,
        title: None,
        archived: false,
        worktree_origin: None,
    };
    let environment = scenario
        .map(|scenario| {
            vec![(
                std::ffi::OsString::from("FAKE_CLAUDE_SCENARIO"),
                std::ffi::OsString::from(scenario),
            )]
        })
        .unwrap_or_default();
    let launch = Launch {
        identity: super::transport::LaunchIdentity::Existing(Box::new(conversation.clone())),
        environment,
        failure_point: None,
    };
    let owner = super::runtime::test_owner(conversation.id, conversation.generation);
    (launch, owner)
}

fn fake_executable(root: &Path) -> PathBuf {
    static BUILT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    placed(compiled(&BUILT, "fake_provider.rs"), root, "fake-codex")
}

/// Every file and folder still under `directory`, for a failure message that names what would not go.
fn left_in(directory: &Path) -> Vec<PathBuf> {
    let Ok(read) = std::fs::read_dir(directory) else {
        return Vec::new();
    };
    read.filter_map(Result::ok)
        .flat_map(|entry| {
            let path = entry.path();
            let mut found = left_in(&path);
            found.push(path);
            found
        })
        .collect()
}

struct Fixture {
    directory: crate::daemon::persist::ScratchDir,
    record: Conversation,
}

impl Fixture {
    async fn new() -> Self {
        let directory = crate::daemon::persist::scratch_dir();
        let root = directory.path().to_owned();
        let record = tokio::task::spawn_blocking(move || {
            std::fs::create_dir_all(&root).unwrap();
            let executable = fake_executable(&root);
            std::fs::create_dir(root.join("different")).unwrap();
            let inventory: Value = serde_json::from_str(include_str!(
                "../../../../../crates/adapters/maitty-provider-codex/src/fixtures/codex-0.164.0.json"
            ))
            .unwrap();
            for (name, section) in [
                ("ClientRequest.json", "clientRequests"),
                ("ServerRequest.json", "serverRequests"),
            ] {
                std::fs::write(root.join(name), inventory[section].to_string()).unwrap();
            }
            let mut record = crate::test_support::conversation();
            record.binding.profile = None;
            record.binding.executable = executable;
            record.binding.config_root = std::fs::canonicalize(&root).unwrap();
            record.binding.cwd = root;
            record.binding.worktree = None;
            record
        })
        .await
        .unwrap();
        Self { directory, record }
    }
    fn launch(&self, mode: &str) -> Launch {
        let environment = [
            (
                "TEST_SCHEMA_DIR",
                self.directory.path().as_os_str().to_owned(),
            ),
            (
                "TEST_PID_FILE",
                self.directory.path().join("pids").into_os_string(),
            ),
            ("TEST_MODE", mode.into()),
            (
                "TEST_ACCOUNT_VALUE",
                "selected-account-effective-env".into(),
            ),
        ]
        .into_iter()
        .map(|(key, value)| (key.into(), value))
        .collect();
        Launch {
            identity: super::transport::LaunchIdentity::Existing(Box::new(self.record.clone())),
            environment,
            failure_point: None,
        }
    }
    async fn pids(&self) -> Vec<u32> {
        let path = self.directory.path().join("pids");
        tokio::task::spawn_blocking(move || {
            std::fs::read_to_string(path)
                .unwrap()
                .split_whitespace()
                .map(|s| s.parse().unwrap())
                .collect()
        })
        .await
        .unwrap()
    }

    // Child-owning test bodies unwind inside with_fixture so disposal finishes
    // before this directory guard can drop on Windows.
    async fn cleanup(self) {
        let directory = self.directory.path().to_owned();
        let executable = self.record.binding.executable.clone();
        tokio::task::spawn_blocking(move || {
            // Windows refuses to delete a folder while a just-killed process or a scanner still
            // holds a handle in it, and the guard's own removal tries once and ignores failure.
            // Retry here until a deadline, then let the assertions judge the result. A CI runner
            // once held the freshly compiled provider past ten seconds, so the deadline is long;
            // a passing test leaves the loop as soon as the removal succeeds.
            let until = std::time::Instant::now() + Duration::from_secs(60);
            let mut refused = None;
            while directory.exists() {
                let Err(error) = std::fs::remove_dir_all(&directory) else {
                    break;
                };
                refused = Some(error);
                if std::time::Instant::now() >= until {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            drop(self);
            assert!(
                !directory.exists(),
                "fixture directory survived cleanup: {refused:?}; still in it: {:?}",
                left_in(&directory)
            );
            assert!(!executable.exists(), "compiled provider survived cleanup");
        })
        .await
        .unwrap();
    }
}

fn daemon(record: Conversation) -> (Daemon, mpsc::Receiver<Ev>) {
    let (tx, rx) = mpsc::channel(32);
    let mut daemon = Daemon::new(Config::default(), tx, || {});
    daemon.conversations.push(record);
    (daemon, rx)
}

struct TestSession {
    fixture: Fixture,
    daemon: Daemon,
    events: mpsc::Receiver<Ev>,
}

type FixtureCheck<'a> = std::pin::Pin<Box<dyn std::future::Future<Output = ()> + 'a>>;

async fn with_fixture(check: impl for<'a> FnOnce(&'a mut TestSession) -> FixtureCheck<'a>) {
    let fixture = Fixture::new().await;
    let (daemon, events) = daemon(fixture.record.clone());
    let mut session = TestSession {
        fixture,
        daemon,
        events,
    };
    let outcome = AssertUnwindSafe(check(&mut session)).catch_unwind().await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

impl TestSession {
    async fn settle_background(&mut self) {
        tokio::time::timeout(Duration::from_secs(20), async {
            while !self.daemon.conversation_cache_writes.is_empty()
                || self
                    .daemon
                    .conversation_states
                    .values()
                    .any(|state| state.checks.running())
            {
                self.daemon.handle(
                    self.events
                        .recv()
                        .await
                        .expect("owned background task completed"),
                );
            }
        })
        .await
        .expect("owned checks and cache writers finish before fixture deletion");
    }
    async fn cleanup(mut self) {
        let native_pids: Vec<_> = self
            .daemon
            .terms
            .values()
            .filter_map(|term| term.pid)
            .collect();
        let terms: Vec<_> = self.daemon.terms.keys().copied().collect();
        for term in terms {
            self.daemon.close_term(term);
        }
        if !native_pids.is_empty() {
            stopped(native_pids).await;
        }
        let id = self.fixture.record.id;
        tokio::time::timeout(Duration::from_secs(40), async {
            loop {
                match self.daemon.conversation_runtimes.test_cleanup_state(id) {
                    None | Some(TestCleanupState::Finished) => break,
                    Some(TestCleanupState::Active) => self.daemon.dispose_conversation(id).unwrap(),
                    Some(TestCleanupState::Requested) => {}
                }
                while let Ok(event) = self.events.try_recv() {
                    self.daemon.handle(event);
                }
                // An assertion may consume a terminal event before applying it;
                // allow the owned actor to finish instead of waiting for a lost event.
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("owned provider disposal completes before fixture cleanup");
        let pid_file = self.fixture.directory.path().join("pids");
        let started = tokio::task::spawn_blocking(move || pid_file.exists())
            .await
            .unwrap();
        if started {
            stopped(self.fixture.pids().await).await;
        }
        self.settle_background().await;
        drop(self.daemon);
        self.fixture.cleanup().await;
    }
}

async fn next(rx: &mut mpsc::Receiver<Ev>) -> Event {
    tokio::time::timeout(Duration::from_secs(40), async {
        loop {
            if let Ev::Conversation(event) = rx.recv().await.unwrap() {
                return event;
            }
        }
    })
    .await
    .expect("provider event within deadline")
}

/// Whether the process a number names has run to its end. Windows goes on listing a process that
/// has ended for as long as anything still holds it open (a scanner reading a program it has not
/// seen before does), so being listed does not mean it is running.
#[cfg(windows)]
fn has_ended(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject};
    // SAFETY: the handle is the one just opened, checked before use and closed once.
    unsafe {
        let handle = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if handle.is_null() {
            // Nothing by that number can be opened: it is gone.
            return true;
        }
        let ended = WaitForSingleObject(handle, 0) == WAIT_OBJECT_0;
        CloseHandle(handle);
        ended
    }
}

#[cfg(not(windows))]
fn has_ended(_pid: u32) -> bool {
    false
}

async fn stopped(pids: Vec<u32>) {
    tokio::task::spawn_blocking(move || {
        // A kill is asked for on another thread and, on Windows, done by `taskkill`: on a busy
        // machine it was measured landing twelve seconds later. A process that stopped ends the
        // wait at once, so the long deadline costs a passing test nothing.
        let until = std::time::Instant::now() + Duration::from_secs(60);
        loop {
            let mut system = sysinfo::System::new();
            system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            let alive: Vec<String> = pids
                .iter()
                .filter_map(|pid| {
                    let process = system.process(sysinfo::Pid::from_u32(*pid))?;
                    let running = process.status() != sysinfo::ProcessStatus::Zombie && !has_ended(*pid);
                    running.then(|| format!("{pid} {:?}", process.name()))
                })
                .collect();
            if alive.is_empty() {
                return;
            }
            assert!(
                std::time::Instant::now() < until,
                "provider process tree survived disposal: {alive:?}"
            );
            std::thread::yield_now();
        }
    })
    .await
    .unwrap();
}

async fn conversation_fixture(mode: &str) -> TestSession {
    let fixture = Fixture::new().await;
    let root = fixture.directory.path().to_path_buf();
    let mode = mode.to_owned();
    let cwd = tokio::task::spawn_blocking(move || {
        std::fs::write(root.join("mode"), mode).unwrap();
        let cwd = root.join("repo");
        std::fs::create_dir(&cwd).unwrap();
        cwd
    })
    .await
    .unwrap();
    let (tx, events) = mpsc::channel(128);
    let mut config = Config::default();
    // Never the real home folder, which is where the default puts worktrees.
    config.worktree.dir = crate::daemon::worktree_path::SIBLING_TEMPLATE.into();
    let mut daemon = Daemon::new(config, tx, || {});
    daemon.session_path = fixture.directory.path().join("data/session.json");
    daemon.check_dir = fixture.directory.path().join("data/checks");
    daemon.approvals_file = fixture.directory.path().join("data/approvals.json");
    let mut session = TestSession {
        fixture,
        daemon,
        events,
    };
    session.fixture.record.binding.cwd = cwd;
    session
}

fn settings(session: &TestSession) -> crate::conversation::LaunchSettings {
    let b = &session.fixture.record.binding;
    crate::conversation::LaunchSettings {
        provider: crate::conversation::Provider::Codex,
        executable: b.executable.clone(),
        config_root: b.config_root.clone(),
        cwd: b.cwd.clone(),
        model: None,
        model_provider: None,
        approval_policy: crate::conversation::ApprovalPolicy::OnRequest,
        sandbox: crate::conversation::Sandbox::ReadOnly,
    }
}

async fn exchange(
    session: &mut TestSession,
    client: u64,
    message: crate::protocol::ClientMsg,
    from: Option<(u32, String)>,
) -> crate::protocol::ServerMsg {
    exchange_claim(session, client, message, from, None, None).await
}

async fn exchange_claim(
    session: &mut TestSession,
    client: u64,
    message: crate::protocol::ClientMsg,
    from: Option<(u32, String)>,
    structured: Option<crate::protocol::StructuredIdentity>,
    mut deferred: Option<&mut Vec<Ev>>,
) -> crate::protocol::ServerMsg {
    use interprocess::local_socket::{
        ListenerOptions,
        tokio::{Stream, prelude::*},
    };
    #[cfg(windows)]
    let name = {
        use interprocess::local_socket::{GenericNamespaced, ToNsName};
        format!(
            "synthetic-conversation-{}-{client}-{}",
            std::process::id(),
            session
                .fixture
                .directory
                .path()
                .file_name()
                .unwrap()
                .to_string_lossy()
        )
        .to_ns_name::<GenericNamespaced>()
        .unwrap()
        .into_owned()
    };
    #[cfg(unix)]
    let name = {
        use interprocess::local_socket::{GenericFilePath, ToFsName};
        session
            .fixture
            .directory
            .path()
            .join(format!("ipc-{client}"))
            .to_fs_name::<GenericFilePath>()
            .unwrap()
            .into_owned()
    };
    let listener = ListenerOptions::new()
        .name(name.clone())
        .create_tokio()
        .unwrap();
    let events = session.daemon.tx.clone();
    let server = tokio::spawn(async move {
        let stream = listener.accept().await.unwrap();
        crate::daemon::serve(client, stream, events).await;
    });
    let stream = Stream::connect(name).await.unwrap();
    let (mut reader, mut writer) = crate::ipc::framed(stream);
    crate::ipc::send(
        &mut writer,
        &crate::protocol::ClientMsg::Hello {
            version: crate::protocol::PROTOCOL_VERSION,
            attach: false,
            from,
            structured,
            surface: crate::protocol::Surface::Terminal,
            replays: true,
        },
    )
    .await
    .unwrap();
    assert!(matches!(
        crate::ipc::recv_server(&mut reader).await.unwrap(),
        Some(ServerMsg::Welcome { .. })
    ));
    crate::ipc::send(&mut writer, &message).await.unwrap();
    let reply=tokio::time::timeout(Duration::from_secs(40),async {
        loop {
            tokio::select! {
                event=session.events.recv()=>{
                    let event=event.unwrap();
                    if matches!(event,Ev::SessionSaved {..}) && let Some(deferred)=deferred.as_mut() {deferred.push(event);}else{session.daemon.handle(event);}
                },
                message=crate::ipc::recv_server(&mut reader)=>match message.unwrap().unwrap() {
                    reply@ServerMsg::Reply(_)|reply@ServerMsg::Error(_)=>break reply,
                    _=>(),
                }
            }
        }
    }).await.expect("real local IPC operation completed");
    drop(writer);
    drop(reader);
    server.abort();
    session.daemon.handle(Ev::Disconnected(client));
    reply
}

async fn create(session: &mut TestSession) -> (crate::conversation::ConversationId, u64) {
    let target = crate::conversation::StartTarget::Create(settings(session));
    match exchange(
        session,
        100,
        crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationStart { target, branch: None }),
        None,
    )
    .await
    {
        ServerMsg::Reply(crate::protocol::Reply::ConversationStarted { id, generation }) => {
            (id, generation)
        }
        other => panic!("{other:?}"),
    }
}

fn authenticated_pane(session: &mut TestSession) -> (u32, String) {
    let mut cfg = session.daemon.cfg.clone();
    cfg.shell = Some(
        session
            .fixture
            .record
            .binding
            .executable
            .to_string_lossy()
            .into_owned(),
    );
    cfg.shell_args = vec!["--descendant".into()];
    // A pane of its own each time: one put in the place of an earlier pane would drop that pane
    // without stopping it, and its process would keep the fixture's folder from being removed.
    const FIRST_TEST_PANE: u32 = 900_001;
    let id = (FIRST_TEST_PANE..)
        .find(|id| !session.daemon.terms.contains_key(id))
        .expect("a free pane id");
    let mut pane = crate::daemon::term::Term::spawn(
        &cfg,
        crate::daemon::term::SpawnSpec {
            id,
            cmd: None,
            direct: None,
            cwd: &session.fixture.record.binding.cwd,
            cols: 80,
            rows: 24,
            once: true,
        },
        session.daemon.tx.clone(),
    )
    .unwrap();
    pane.agent = Some("codex".into());
    pane.grants = Some(vec!["start".into(), "read".into(), "write".into()]);
    let token = pane.token.clone();
    session.daemon.terms.insert(id, pane);
    (id, token)
}

fn running_record(s: &TestSession, id: u64) -> crate::conversation::Conversation {
    let mut record = s.fixture.record.clone();
    record.id = crate::conversation::ConversationId(id);
    record.generation = 3;
    record.execution = crate::conversation::ExecutionKind::Structured;
    record.state = crate::conversation::RecoveryState::Running;
    record.settings = Some(settings(s));
    record
}

async fn receive_claude_payload(
    received: &mut mpsc::Receiver<Ev>,
    owner: super::runtime::Owner,
) -> Payload {
    let event = tokio::time::timeout(Duration::from_secs(5), received.recv())
        .await
        .expect("Claude adapter event should arrive")
        .expect("Claude adapter should remain connected");
    let Ev::Conversation(event) = event else {
        panic!("expected a Claude conversation event");
    };
    assert_eq!(event.owner, owner);
    event.payload
}

async fn start_claude_adapter(
    launch: Launch,
    owner: super::runtime::Owner,
) -> (
    tokio::task::JoinHandle<()>,
    mpsc::Sender<()>,
    mpsc::Sender<super::runtime::Command>,
    mpsc::Receiver<Ev>,
) {
    let (events, mut received) = mpsc::channel(8);
    let (stop, stopped) = mpsc::channel(1);
    let (requests, incoming) = mpsc::channel(2);
    let task = tokio::spawn(super::claude::run(launch, owner, events, stopped, incoming));
    assert!(matches!(
        receive_claude_payload(&mut received, owner).await,
        Payload::Ready
    ));
    (task, stop, requests, received)
}

async fn start_claude_thread(
    requests: &mpsc::Sender<super::runtime::Command>,
    received: &mut mpsc::Receiver<Ev>,
    owner: super::runtime::Owner,
) {
    requests
        .send(super::runtime::Command {
            token: 1,
            request: super::runtime::Rpc::Start { params: json!({}) },
        })
        .await
        .unwrap();
    assert!(matches!(
        receive_claude_payload(received, owner).await,
        Payload::Response {
            token: 1,
            result: Ok(ref value)
        } if value == &json!({"thread":{"id":"fixture-session"}})
    ));
}

async fn stop_claude_adapter(
    task: tokio::task::JoinHandle<()>,
    stop: mpsc::Sender<()>,
    received: &mut mpsc::Receiver<Ev>,
    owner: super::runtime::Owner,
) {
    stop.send(()).await.unwrap();
    assert!(matches!(
        receive_claude_payload(received, owner).await,
        Payload::Terminated {
            failure: None,
            reaped: true
        }
    ));
    task.await.unwrap();
}

async fn drive_reply(
    session: &mut TestSession,
    replies: &mut mpsc::Receiver<ServerMsg>,
) -> ServerMsg {
    tokio::time::timeout(Duration::from_secs(20),async {
        loop {
            tokio::select! {
                event=session.events.recv()=>session.daemon.handle(event.unwrap()),
                reply=replies.recv()=>match reply.unwrap() {reply@ServerMsg::Reply(_)|reply@ServerMsg::Error(_)=>break reply,_=>()}
            }
        }
    }).await.unwrap()
}

/// Handles the daemon's events until `done`, and fails with `what` when that never happens.
async fn handle_until(session: &mut TestSession, what: &str, done: impl Fn(&Daemon) -> bool) {
    tokio::time::timeout(Duration::from_secs(30), async {
        while !done(&session.daemon) {
            let event = session.events.recv().await.expect("the daemon's events stay open");
            session.daemon.handle(event);
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{what}"));
}

/// Starts a Claude chat on the scripted fake `claude` playing `scenario`.
async fn start_claude_chat(session: &mut TestSession, client: u64, scenario: &'static str) -> (PathBuf, crate::conversation::ConversationId, u64) {
    let root = session.fixture.directory.path().to_path_buf();
    let (executable, config_root) = tokio::task::spawn_blocking(move || {
        let executable = fake_claude_executable(&root);
        std::fs::write(executable.with_extension("scenario"), scenario).unwrap();
        (executable, std::fs::canonicalize(&root).unwrap())
    })
    .await
    .unwrap();
    let claude = crate::conversation::LaunchSettings {
        provider: crate::conversation::Provider::Claude,
        executable: executable.clone(),
        config_root,
        cwd: session.fixture.record.binding.cwd.clone(),
        model: None,
        model_provider: None,
        approval_policy: crate::conversation::ApprovalPolicy::OnRequest,
        sandbox: crate::conversation::Sandbox::WorkspaceWrite,
    };
    let started = exchange(
        session,
        client,
        crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationStart { target: crate::conversation::StartTarget::Create(claude), branch: None }),
        None,
    )
    .await;
    let ServerMsg::Reply(crate::protocol::Reply::ConversationStarted { id, generation }) = started else {
        panic!("{started:?}");
    };
    (executable, id, generation)
}

mod queue;

mod send_now;

mod continue_turn;

mod provider_crash;

mod branch_chat;

mod claude_chat;

mod claude_warm;

mod turn_snapshot;

mod worktree_recreate;
mod claude_adapter;
mod starting;
mod approvals;
mod access;
mod ending;
mod reading;
mod delivery;
mod process;
mod resume;
mod golden;
