//! The process a Claude chat starts ahead for its next message (`claude.rs`, `Warm`), with the
//! scripted fake `claude`: the next message goes to it; a changed choice, a dead process or a
//! transcript written elsewhere gets a new one; it says nothing until a message is handed to it,
//! so it cannot change status (ADR 0003); and an interrupt still reaches the turn it runs.

use super::*;

/// Long enough for a stray event to arrive, short enough to keep the tests quick.
const QUIET: Duration = Duration::from_millis(300);
const LOG_DEADLINE: Duration = Duration::from_secs(10);

#[derive(Debug)]
struct LogLine {
    kind: String,
    pid: u32,
    arguments: String,
}

/// What the fake logged beside its executable, in order: `start`, `message` and `eof` lines.
async fn fake_log(executable: &Path) -> Vec<LogLine> {
    let path = executable.with_extension("log");
    let text = tokio::task::spawn_blocking(move || std::fs::read_to_string(path).unwrap_or_default())
        .await
        .unwrap();
    text.lines()
        .map(|line| {
            let mut parts = line.splitn(3, ' ');
            LogLine {
                kind: parts.next().unwrap().to_owned(),
                pid: parts.next().unwrap().parse().unwrap(),
                arguments: parts.next().unwrap_or_default().to_owned(),
            }
        })
        .collect()
}

fn pids(log: &[LogLine], kind: &str) -> Vec<u32> {
    log.iter().filter(|line| line.kind == kind).map(|line| line.pid).collect()
}

/// The pids of the first `count` processes of `kind`, once that many are logged.
async fn wait_for(executable: &Path, kind: &str, count: usize) -> Vec<u32> {
    let until = tokio::time::Instant::now() + LOG_DEADLINE;
    loop {
        let found = pids(&fake_log(executable).await, kind);
        if found.len() >= count {
            return found;
        }
        assert!(tokio::time::Instant::now() < until, "{kind} {count} never logged: {found:?}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn message(token: u64, model: Option<&str>) -> super::runtime::Command {
    let mut params = json!({
        "threadId":"fixture-session",
        "input":[{"type":"text","text":"hello fake Claude"}]
    });
    if let Some(model) = model {
        params["model"] = json!(model);
    }
    super::runtime::Command {
        token,
        request: super::runtime::Rpc::Send { params },
    }
}

/// Reads the turn's events up to its end, and gives its id.
async fn finish_turn(received: &mut mpsc::Receiver<Ev>, owner: super::runtime::Owner) -> String {
    let mut turn = None;
    loop {
        match receive_claude_payload(received, owner).await {
            Payload::Notification { method, params } if method == "turn/started" => {
                turn = params["turn"]["id"].as_str().map(str::to_owned);
            }
            Payload::Notification { method, params } if method == "turn/completed" => {
                assert_eq!(params["turn"]["status"], "completed");
                return turn.expect("the turn started before it completed");
            }
            Payload::Notification { .. } | Payload::Response { result: Ok(_), .. } => {}
            _ => panic!("unexpected Claude turn payload"),
        }
    }
}

/// The adapter emits nothing while no turn runs: a process waiting for a message is never read.
async fn assert_quiet(received: &mut mpsc::Receiver<Ev>) {
    assert!(
        tokio::time::timeout(QUIET, received.recv()).await.is_err(),
        "an event arrived while no turn ran"
    );
}

/// A Claude adapter whose first turn has ended and whose next process waits for a message.
struct Waiting {
    directory: crate::daemon::persist::ScratchDir,
    executable: PathBuf,
    owner: super::runtime::Owner,
    task: tokio::task::JoinHandle<()>,
    stop: mpsc::Sender<()>,
    requests: mpsc::Sender<super::runtime::Command>,
    received: mpsc::Receiver<Ev>,
    /// The waiting process.
    warm: u32,
}

impl Waiting {
    async fn new(scenario: Option<&str>) -> Self {
        let directory = crate::daemon::persist::scratch_dir();
        let (launch, owner) = claude_launch(directory.path(), scenario);
        let executable = launch.paths().1.to_path_buf();
        let (task, stop, requests, mut received) = start_claude_adapter(launch, owner).await;
        start_claude_thread(&requests, &mut received, owner).await;
        requests.send(message(3, None)).await.unwrap();
        if scenario == Some("interrupt") {
            interrupt(&requests, &mut received, owner).await;
        } else {
            finish_turn(&mut received, owner).await;
        }
        let started = wait_for(&executable, "start", 2).await;
        let log = fake_log(&executable).await;
        let warm = log.iter().find(|line| line.pid == started[1]).unwrap();
        assert!(warm.arguments.contains("--resume=fixture-session"), "{warm:?}");
        assert_eq!(pids(&log, "message"), [started[0]]);
        Self { directory, executable, owner, task, stop, requests, received, warm: started[1] }
    }

    /// Sends the second message and reads its turn to the end; gives the process that took it.
    async fn second_message(&mut self, model: Option<&str>) -> u32 {
        self.requests.send(message(5, model)).await.unwrap();
        finish_turn(&mut self.received, self.owner).await;
        pids(&fake_log(&self.executable).await, "message")[1]
    }

    /// Stops the adapter; the folder (with the fake's log) goes when the caller drops it.
    async fn stop(mut self) -> crate::daemon::persist::ScratchDir {
        stop_claude_adapter(self.task, self.stop, &mut self.received, self.owner).await;
        self.directory
    }
}

/// Interrupts the turn that was just sent, as Esc does, and reads it to its end.
async fn interrupt(
    requests: &mpsc::Sender<super::runtime::Command>,
    received: &mut mpsc::Receiver<Ev>,
    owner: super::runtime::Owner,
) {
    let mut turn = None;
    while turn.is_none() {
        match receive_claude_payload(received, owner).await {
            Payload::Notification { method, params } if method == "turn/started" => {
                turn = params["turn"]["id"].as_str().map(str::to_owned);
            }
            Payload::Notification { .. } | Payload::Response { result: Ok(_), .. } => {}
            _ => panic!("unexpected Claude turn payload"),
        }
    }
    // The fake answers only the interrupt it expects, `interrupt-4`.
    requests
        .send(super::runtime::Command {
            token: 4,
            request: super::runtime::Rpc::Interrupt {
                params: json!({"threadId":"fixture-session","turnId":turn}),
            },
        })
        .await
        .unwrap();
    let mut answered = false;
    loop {
        match receive_claude_payload(received, owner).await {
            Payload::Response { token: 4, result: Ok(value) } => {
                assert_eq!(value, json!({}));
                answered = true;
            }
            Payload::Notification { method, .. } if method == "turn/completed" => break,
            Payload::Notification { .. } | Payload::Response { result: Ok(_), .. } => {}
            _ => panic!("unexpected Claude interrupt payload"),
        }
    }
    assert!(answered, "the interrupt was answered");
}

#[tokio::test]
async fn the_next_claude_message_goes_to_the_process_started_after_the_last() {
    let mut chat = Waiting::new(None).await;
    assert_quiet(&mut chat.received).await;

    assert_eq!(chat.second_message(None).await, chat.warm);

    // Stopping the conversation stops the process waiting for its third message, by closing its
    // input as for any Claude process.
    let third = wait_for(&chat.executable, "start", 3).await[2];
    let executable = chat.executable.clone();
    let directory = chat.stop().await;
    stopped(vec![third]).await;
    let log = fake_log(&executable).await;
    assert_eq!(pids(&log, "eof"), [third], "{log:?}");
    drop(directory);
}

#[tokio::test]
async fn a_message_with_another_model_starts_a_new_claude_process() {
    let mut chat = Waiting::new(None).await;

    let sent_to = chat.second_message(Some("opus")).await;
    let log = fake_log(&chat.executable).await;
    assert_ne!(sent_to, chat.warm, "{log:?}");
    let started = log.iter().find(|line| line.kind == "start" && line.pid == sent_to).unwrap();
    assert!(started.arguments.contains("--model opus"), "{started:?}");
    assert!(pids(&log, "eof").contains(&chat.warm), "the unused process was stopped: {log:?}");
    chat.stop().await;
}

#[tokio::test]
async fn a_dead_waiting_claude_process_is_never_used_and_says_nothing() {
    let mut chat = Waiting::new(None).await;
    let warm = chat.warm;
    tokio::task::spawn_blocking(move || {
        let pid = sysinfo::Pid::from_u32(warm);
        let mut system = sysinfo::System::new();
        system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
        assert!(system.process(pid).expect("the waiting process runs").kill());
    })
    .await
    .unwrap();
    stopped(vec![warm]).await;
    // Its end is not the conversation's: no status, no termination.
    assert_quiet(&mut chat.received).await;

    assert_ne!(chat.second_message(None).await, warm);
    chat.stop().await;
}

#[tokio::test]
async fn a_transcript_written_elsewhere_starts_a_new_claude_process() {
    let mut chat = Waiting::new(None).await;
    // The session resumed somewhere else (a terminal) while the chat waited.
    let root = std::fs::canonicalize(chat.directory.path()).unwrap();
    let transcript = root
        .join("projects")
        .join(super::saved::claude_folder_name(&root))
        .join("fixture-session.jsonl");
    let mut file = std::fs::OpenOptions::new().append(true).open(&transcript).unwrap();
    std::io::Write::write_all(&mut file, b"{\"type\":\"user\"}\n").unwrap();
    drop(file);

    assert_ne!(chat.second_message(None).await, chat.warm);
    let log = fake_log(&chat.executable).await;
    assert!(pids(&log, "eof").contains(&chat.warm), "the stale process was stopped: {log:?}");
    chat.stop().await;
}

#[tokio::test]
async fn an_interrupt_reaches_a_turn_on_the_process_started_ahead() {
    let mut chat = Waiting::new(Some("interrupt")).await;

    chat.requests.send(message(5, None)).await.unwrap();
    interrupt(&chat.requests, &mut chat.received, chat.owner).await;
    let log = fake_log(&chat.executable).await;
    assert_eq!(pids(&log, "message")[1], chat.warm, "{log:?}");
    chat.stop().await;
}
