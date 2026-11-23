//! A third dialect, for an agent that is neither Codex nor Claude, run by the generic runner.

use super::*;
use crate::conversation::history::{Content, ItemState, Role};
use crate::conversation::{ConversationId, TurnChoice};
use maitty_provider::Item;
use maitty_shared::conversation::capabilities::Capabilities;

/// Speaks the fake agent's protocol: one process per message, `say` in, `heard` and `done` out.
#[derive(Default)]
struct Parrot {
    turn: Option<String>,
    arguments: Vec<OsString>,
}

impl Parrot {
    fn completed(turn: String) -> Step {
        Step::Emit(ProviderEvent::TurnCompleted {
            turn,
            state: ItemState::Completed,
            error: None,
            started_at_ms: None,
            completed_at_ms: None,
        })
    }
}

impl ProviderDialect for Parrot {
    fn on_command(&mut self, command: maitty_provider::Command) -> Result<Vec<Step>> {
        use maitty_provider::Command as Asking;
        match command {
            Asking::Open { .. } => Ok(vec![Step::Emit(ProviderEvent::Ready {
                session: "parrot-session".into(),
                model: None,
                model_provider: None,
            })]),
            Asking::Send { turn, text, .. } => {
                anyhow::ensure!(self.turn.is_none(), "The parrot is still talking");
                self.turn = Some(turn.clone());
                let plan = LaunchPlan { arguments: self.arguments.clone(), ..LaunchPlan::default() };
                Ok(vec![
                    Step::Spawn(plan),
                    Step::Write(format!("say {text}")),
                    Step::Emit(ProviderEvent::Delivered { turn: turn.clone() }),
                    Step::Emit(ProviderEvent::TurnStarted { turn, started_at_ms: None }),
                ])
            }
            other => bail!("The parrot cannot {other:?}"),
        }
    }

    fn on_line(&mut self, line: &str) -> Result<Vec<Step>> {
        let turn = self.turn.clone().context("The parrot spoke outside a turn")?;
        if let Some(text) = line.strip_prefix("heard ") {
            return Ok(vec![Step::Emit(ProviderEvent::Item(Item {
                turn,
                id: "answer".into(),
                content: Content::Message { role: Role::Assistant, text: text.into() },
                state: ItemState::Completed,
                started_at_ms: None,
                completed_at_ms: None,
            }))]);
        }
        anyhow::ensure!(line == "done", "The parrot said something else");
        self.turn = None;
        Ok(vec![Self::completed(turn), Step::Write("bye".into()), Step::CloseInput])
    }

    fn on_exit(&mut self) -> Vec<Step> {
        match self.turn.take() {
            Some(_) => vec![Step::Emit(ProviderEvent::Terminated { failure: "The parrot flew off".into() })],
            None => Vec::new(),
        }
    }

    fn next_launch(&self) -> Option<LaunchPlan> {
        None
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities::default()
    }
}

struct Running {
    task: tokio::task::JoinHandle<()>,
    stop: mpsc::Sender<()>,
    requests: mpsc::Sender<Command>,
    received: mpsc::Receiver<Ev>,
    owner: Owner,
    /// The name the runner gave the turn it last started; it makes the name up.
    turn: Option<String>,
    _directory: crate::daemon::persist::ScratchDir,
}

impl Running {
    fn start(dialect: impl ProviderDialect + 'static) -> Self {
        static BUILT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
        Self::start_on(dialect, super::super::tests::compiled(&BUILT, "fake_agent.rs"))
    }

    /// Runs `dialect` against the fixture program `built`.
    fn start_on(dialect: impl ProviderDialect + 'static, built: &std::path::Path) -> Self {
        let directory = crate::daemon::persist::scratch_dir();
        std::fs::create_dir_all(directory.path()).unwrap();
        let executable = super::super::tests::placed(built, directory.path(), "fake-agent");
        let host = Host {
            executable,
            cwd: directory.path().to_path_buf(),
            environment: std::env::vars_os().collect(),
        };
        let owner = super::super::runtime::test_owner(ConversationId(7), 1);
        let (events, received) = mpsc::channel(16);
        let (stop, stopped) = mpsc::channel(1);
        let (requests, incoming) = mpsc::channel(4);
        let task = tokio::spawn(run(Box::new(dialect), host, owner, events, stopped, incoming));
        Self { task, stop, requests, received, owner, turn: None, _directory: directory }
    }

    async fn ask(&self, token: u64, request: Rpc) {
        self.requests.send(Command { token, request }).await.unwrap();
    }

    async fn next(&mut self) -> Payload {
        let event = tokio::time::timeout(Duration::from_secs(10), self.received.recv())
            .await
            .expect("the runner reports in time")
            .expect("the runner is still there");
        let Ev::Conversation(event) = event else {
            panic!("a conversation event");
        };
        assert_eq!(event.owner, self.owner);
        if let Payload::Response { result: Ok(value), .. } = &event.payload
            && let Some(turn) = value["turn"]["id"].as_str()
        {
            self.turn = Some(turn.to_owned());
        }
        event.payload
    }

    async fn stopped(mut self) -> Payload {
        self.stop.send(()).await.unwrap();
        let last = self.next().await;
        self.task.await.unwrap();
        last
    }
}

mod acp;

fn open() -> Rpc {
    Rpc::Open { settings: Box::new(super::super::tests::claude_settings()), session: None }
}

fn send(text: &str) -> Rpc {
    Rpc::Send {
        session: "parrot-session".into(),
        text: text.into(),
        message: "message-1".into(),
        choice: TurnChoice::default(),
        permissions: None,
    }
}

/// A payload in a few words, with the turn's made-up name left out.
fn named(payload: Payload) -> String {
    match payload {
        Payload::Ready => "ready".into(),
        Payload::Response { token, result: Ok(value) } => format!("answer {token}: {}", value_shape(&value)),
        Payload::Response { token, result: Err(error) } => format!("refused {token}: {}", error.code),
        Payload::Event(ProviderEvent::TurnStarted { .. }) => "turn started".into(),
        Payload::Event(ProviderEvent::Item(Item { content: Content::Message { text, .. }, .. })) => {
            format!("said {text}")
        }
        Payload::Event(ProviderEvent::TurnCompleted { state, .. }) => format!("turn {state:?}"),
        Payload::Terminated { failure, reaped } => format!("ended {failure:?} reaped {reaped}"),
        _ => panic!("an unexpected payload"),
    }
}

fn value_shape(value: &Value) -> String {
    if let Some(session) = value["thread"]["id"].as_str() {
        return format!("session {session}");
    }
    match value["turn"]["status"].as_str() {
        Some(status) => format!("turn {status}"),
        None => value.to_string(),
    }
}

#[tokio::test]
async fn a_third_dialect_runs_a_whole_turn() {
    let mut running = Running::start(Parrot::default());
    let mut seen = vec![named(running.next().await)];

    running.ask(1, open()).await;
    seen.push(named(running.next().await));
    running.ask(2, send("hello")).await;
    for _ in 0..4 {
        seen.push(named(running.next().await));
    }
    let ended = named(running.stopped().await);

    assert_eq!(
        seen,
        [
            "ready",
            "answer 1: session parrot-session",
            "answer 2: turn inProgress",
            "turn started",
            "said hello",
            "turn Completed",
        ]
    );
    assert_eq!(ended, "ended None reaped true");
}

#[tokio::test]
async fn a_second_message_gets_a_process_of_its_own() {
    let mut running = Running::start(Parrot::default());
    running.next().await;
    let mut said = Vec::new();

    for (token, text) in [(1, "one"), (2, "two")] {
        running.ask(token, send(text)).await;
        for _ in 0..4 {
            said.push(named(running.next().await));
        }
    }
    running.stopped().await;

    assert_eq!(said.iter().filter(|line| line.starts_with("said ")).collect::<Vec<_>>(), ["said one", "said two"]);
}

#[tokio::test]
async fn a_command_the_dialect_refuses_is_answered_and_the_conversation_goes_on() {
    let mut running = Running::start(Parrot::default());
    running.next().await;

    running.ask(1, Rpc::Interrupt { session: "parrot-session".into(), turn: "none".into() }).await;
    let refused = named(running.next().await);
    running.ask(2, open()).await;
    let opened = named(running.next().await);
    running.stopped().await;

    assert_eq!(refused, "refused 1: -32000");
    assert_eq!(opened, "answer 2: session parrot-session");
}

#[tokio::test]
async fn a_process_that_dies_mid_turn_ends_the_conversation_with_the_dialects_reason() {
    let parrot = Parrot { arguments: vec!["--die".into()], ..Parrot::default() };
    let mut running = Running::start(parrot);
    running.next().await;

    running.ask(1, send("hello")).await;
    let mut last = named(running.next().await);
    while !last.starts_with("ended") {
        last = named(running.next().await);
    }
    running.task.await.unwrap();

    assert_eq!(last, "ended Some(\"The parrot flew off\") reaped true");
}

#[tokio::test]
async fn a_line_the_dialect_cannot_read_ends_the_conversation() {
    /// Trusts nothing the agent says.
    struct Deaf(Parrot);
    impl ProviderDialect for Deaf {
        fn on_command(&mut self, command: maitty_provider::Command) -> Result<Vec<Step>> {
            self.0.on_command(command)
        }
        fn on_line(&mut self, _line: &str) -> Result<Vec<Step>> {
            bail!("The line cannot be read")
        }
        fn on_exit(&mut self) -> Vec<Step> {
            Vec::new()
        }
        fn next_launch(&self) -> Option<LaunchPlan> {
            None
        }
        fn capabilities(&self) -> Capabilities {
            Capabilities::default()
        }
    }
    let mut running = Running::start(Deaf(Parrot::default()));
    running.next().await;

    running.ask(1, send("hello")).await;
    let mut last = named(running.next().await);
    while !last.starts_with("ended") {
        last = named(running.next().await);
    }
    running.task.await.unwrap();

    assert_eq!(last, "ended Some(\"The line cannot be read\") reaped true");
}
