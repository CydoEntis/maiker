//! The ACP dialect run by the generic runner against a made-up ACP agent: the whole path a chat
//! with such an agent takes, short of the daemon's own bookkeeping.

use super::*;
use crate::conversation::{ApprovalDecision, ProviderRequestId};
use maitty_provider_acp::{AcpDialect, Settings};

fn agent(arguments: &[&str]) -> Running {
    static BUILT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    let settings = Settings {
        arguments: arguments.iter().map(Into::into).collect(),
        cwd: std::env::temp_dir(),
    };
    Running::start_on(AcpDialect::new(settings), super::super::super::tests::compiled(&BUILT, "fake_acp_agent.rs"))
}

/// A running agent whose session is open.
async fn opened() -> Running {
    let mut running = agent(&[]);
    running.next().await;
    running.ask(1, open()).await;
    assert_eq!(named(running.next().await), "answer 1: session fake-acp-session");
    running
}

fn say(text: &str) -> Rpc {
    Rpc::Send {
        session: "fake-acp-session".into(),
        text: text.into(),
        message: "message-1".into(),
        choice: Default::default(),
        permissions: None,
    }
}

/// A payload in a few words, for what an ACP turn reports beyond a parrot's.
fn told(payload: Payload) -> String {
    match payload {
        Payload::Event(ProviderEvent::Item(Item { content: Content::Message { role: Role::User, text }, .. })) => {
            format!("asked {text}")
        }
        Payload::Event(ProviderEvent::Item(Item { content: Content::Tool { label, .. }, state, .. })) => {
            format!("tool {label} {state:?}")
        }
        Payload::Event(ProviderEvent::TextDelta { text, .. }) => format!("heard {text}"),
        Payload::Event(ProviderEvent::ApprovalRequested { request, .. }) => {
            format!("may I {} {:?}", request.command.unwrap_or_default(), request.choices)
        }
        Payload::Event(ProviderEvent::UnsupportedRequest { method, .. }) => format!("unsupported {method}"),
        Payload::Event(ProviderEvent::InterruptAcknowledged { .. }) => "interrupt acknowledged".into(),
        other => named(other),
    }
}

/// Everything reported up to and including the end of the turn.
async fn until_turn_ends(running: &mut Running) -> Vec<String> {
    let mut seen = Vec::new();
    loop {
        seen.push(told(running.next().await));
        if seen.last().is_some_and(|last| last.starts_with("turn ") && last != "turn started") {
            return seen;
        }
    }
}

#[tokio::test]
async fn an_acp_agent_runs_a_whole_turn() {
    let mut running = opened().await;

    running.ask(2, say("hello")).await;
    let seen = until_turn_ends(&mut running).await;
    let ended = named(running.stopped().await);

    assert_eq!(
        seen,
        [
            "asked hello",
            "answer 2: turn inProgress",
            "turn started",
            "heard You said: hello",
            "said You said: hello",
            "turn Completed",
        ]
    );
    assert_eq!(ended, "ended None reaped true");
}

#[tokio::test]
async fn a_permission_the_agent_asks_for_is_answered_with_the_persons_choice() {
    let mut running = opened().await;
    running.ask(2, say("permission please")).await;
    let mut asked = Vec::new();
    while !asked.last().is_some_and(|last: &String| last.starts_with("may I")) {
        asked.push(told(running.next().await));
    }

    let answer = Rpc::Answer {
        request: ProviderRequestId::Text("perm-1".into()),
        decision: ApprovalDecision::Decline,
        permissions: None,
    };
    running.ask(3, answer).await;
    let seen = until_turn_ends(&mut running).await;
    running.stopped().await;

    assert_eq!(asked.last().unwrap(), "may I cargo test [Accept, Decline]");
    assert_eq!(seen, ["tool cargo test Failed", "heard You chose reject.", "said You chose reject.", "turn Completed"]);
}

#[tokio::test]
async fn interrupting_ends_the_turn_as_interrupted_and_the_next_message_still_goes() {
    let mut running = opened().await;
    running.ask(2, say("wait")).await;
    for _ in 0..3 {
        running.next().await;
    }

    let turn = running.turn.clone().expect("a turn was started");
    running.ask(3, Rpc::Interrupt { session: "fake-acp-session".into(), turn }).await;
    let stopped = until_turn_ends(&mut running).await;
    running.ask(4, say("again")).await;
    let next = until_turn_ends(&mut running).await;
    running.stopped().await;

    assert_eq!(stopped, ["answer 3: {}", "turn Interrupted"]);
    assert_eq!(next.last().unwrap(), "turn Completed");
}

#[tokio::test]
async fn a_file_the_agent_asks_the_daemon_to_read_is_refused_and_the_turn_goes_on() {
    let mut running = opened().await;

    running.ask(2, say("read a file")).await;
    let seen = until_turn_ends(&mut running).await;
    running.stopped().await;

    assert!(seen.contains(&"unsupported fs/read_text_file".to_owned()), "{seen:?}");
    assert!(seen.contains(&"said I may not read files here.".to_owned()), "{seen:?}");
    assert_eq!(seen.last().unwrap(), "turn Completed");
}

#[tokio::test]
async fn an_agent_on_another_protocol_version_is_not_opened() {
    let mut running = agent(&["--version-2"]);
    running.next().await;

    running.ask(1, open()).await;
    let refused = named(running.next().await);
    let ended = named(running.stopped().await);

    assert_eq!(refused, "refused 1: -32000");
    assert_eq!(ended, "ended None reaped true");
}

#[tokio::test]
async fn an_agent_that_dies_mid_turn_ends_the_conversation() {
    let mut running = opened().await;

    running.ask(2, say("die")).await;
    let mut last = told(running.next().await);
    while !last.starts_with("ended") {
        last = told(running.next().await);
    }
    running.task.await.unwrap();

    assert_eq!(last, "ended Some(\"The agent's process ended\") reaped true");
}
