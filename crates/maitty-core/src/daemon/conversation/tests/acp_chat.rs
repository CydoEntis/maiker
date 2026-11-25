//! A chat with an agent run over ACP, through the daemon, with a made-up agent: the daemon
//! picks the program from its own config, owns the process, and keeps the history itself.

use super::*;
use crate::conversation::{ConversationId, Provider, StartTarget};
use crate::protocol::{ClientMsg, Command, Query, Reply};

const AGENT: &str = "fake";

/// A session whose config names the made-up agent, started with `arguments`.
async fn acp_session(arguments: &[&str]) -> TestSession {
    static BUILT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    let mut session = conversation_fixture("conversation").await;
    let root = session.fixture.directory.path().to_path_buf();
    let executable = tokio::task::spawn_blocking(move || placed(compiled(&BUILT, "fake_acp_agent.rs"), &root, "fake-acp"))
        .await
        .unwrap();
    session.daemon.cfg.agents.push(crate::config::AgentDef {
        name: AGENT.into(),
        acp: true,
        command: Some(executable.to_string_lossy().into_owned()),
        args: arguments.iter().map(|argument| (*argument).to_owned()).collect(),
        ..Default::default()
    });
    session
}

fn start(target: StartTarget) -> ClientMsg {
    ClientMsg::Command(Command::ConversationStart { target, branch: None })
}

fn by_name(session: &TestSession) -> StartTarget {
    StartTarget::Acp { agent: AGENT.into(), cwd: session.fixture.record.binding.cwd.clone() }
}

async fn started(session: &mut TestSession, client: u64, target: StartTarget) -> (ConversationId, u64) {
    match exchange(session, client, start(target), None).await {
        ServerMsg::Reply(Reply::ConversationStarted { id, generation }) => (id, generation),
        other => panic!("{other:?}"),
    }
}

/// The messages in the conversation, read until one of them is `wanted`.
async fn read_until(session: &mut TestSession, id: ConversationId, wanted: &str) -> Vec<String> {
    let mut texts = Vec::new();
    for attempt in 0..40_u64 {
        let read = exchange(session, 900 + attempt, ClientMsg::Query(Query::ConversationRead { id, cursor: None, limit: 128 }), None).await;
        let ServerMsg::Reply(Reply::ConversationRead(read)) = read else {
            panic!("{read:?}");
        };
        texts = read
            .history
            .entries
            .iter()
            .filter_map(|entry| match &entry.content {
                super::history::Content::Message { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect();
        if texts.iter().any(|text| text == wanted) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    texts
}

async fn say(session: &mut TestSession, client: u64, id: ConversationId, generation: u64, operation: u64, text: &str) {
    let message = ClientMsg::Command(Command::ConversationSend { id, generation, operation, text: text.into(), choice: None });
    let sent = exchange(session, client, message, None).await;
    assert!(matches!(sent, ServerMsg::Reply(Reply::ConversationSent(_))), "{sent:?}");
}

async fn checked(mut session: TestSession, check: impl for<'a> FnOnce(&'a mut TestSession) -> FixtureCheck<'a>) {
    let outcome = AssertUnwindSafe(check(&mut session)).catch_unwind().await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn an_acp_chat_is_started_by_its_agents_name_sent_a_message_and_read_back() {
    let session = acp_session(&[]).await;
    checked(session, |session| {
        Box::pin(async move {
            let target = by_name(session);

            let (id, generation) = started(session, 600, target).await;
            say(session, 601, id, generation, 1, "hello").await;
            let texts = read_until(session, id, "You said: hello").await;

            let summaries = session.daemon.conversation_summaries();
            let summary = summaries.iter().find(|summary| summary.id == id).unwrap();
            assert_eq!((summary.provider, summary.agent.as_deref()), (Provider::Acp, Some(AGENT)));
            assert_eq!(summary.execution, crate::conversation::ExecutionKind::Structured);
            assert!(session.daemon.conversation_runtimes.owns(id));
            assert_eq!(texts, ["hello", "You said: hello"]);
        })
    })
    .await;
}

#[tokio::test]
async fn a_client_names_an_acp_agent_and_never_its_program() {
    let session = acp_session(&[]).await;
    checked(session, |session| {
        Box::pin(async move {
            let cwd = session.fixture.record.binding.cwd.clone();
            let program = crate::conversation::LaunchSettings {
                provider: Provider::Acp,
                agent: Some(AGENT.into()),
                ..settings(session)
            };

            let unknown = exchange(session, 610, start(StartTarget::Acp { agent: "nobody".into(), cwd }), None).await;
            let chosen = exchange(session, 611, start(StartTarget::Create(program)), None).await;

            assert!(matches!(&unknown, ServerMsg::Error(why) if why.contains("No agent named `nobody` runs over ACP here: it is not installed")), "{unknown:?}");
            assert!(matches!(&chosen, ServerMsg::Error(why) if why.contains("started by its name")), "{chosen:?}");
            assert!(session.daemon.conversations.is_empty() && session.daemon.pending_starts.is_empty());
        })
    })
    .await;
}

#[tokio::test]
async fn a_start_that_names_only_a_provider_is_refused_for_one_with_no_chat_of_its_own() {
    let session = acp_session(&[]).await;
    checked(session, |session| {
        Box::pin(async move {
            let cwd = session.fixture.record.binding.cwd.clone();
            let target = StartTarget::Agent {
                provider: Provider::Gemini,
                cwd,
                sandbox: crate::conversation::Sandbox::WorkspaceWrite,
                approval_policy: crate::conversation::ApprovalPolicy::OnRequest,
            };

            let refused = exchange(session, 620, start(target), None).await;

            assert!(matches!(&refused, ServerMsg::Error(why) if why.contains("start it in a terminal")), "{refused:?}");
            assert!(session.daemon.conversations.is_empty() && session.daemon.pending_starts.is_empty());
        })
    })
    .await;
}

#[tokio::test]
async fn a_permission_an_acp_agent_asks_for_waits_for_a_person_and_takes_their_answer() {
    let session = acp_session(&[]).await;
    checked(session, |session| {
        Box::pin(async move {
            let target = by_name(session);
            let (id, generation) = started(session, 640, target).await;
            say(session, 641, id, generation, 1, "ask permission").await;
            handle_until(session, "the agent asks", |daemon| !daemon.conversation_states[&id].approvals.is_empty()).await;
            let waiting = session.daemon.conversation_states[&id].status;
            let request_id = session.daemon.conversation_states[&id].approvals.keys().next().unwrap().clone();

            let decision = crate::conversation::ApprovalDecision::Accept;
            let approve = ClientMsg::Command(Command::ConversationApprove { id, generation, request_id, decision });
            let answered = exchange(session, 642, approve, None).await;
            let texts = read_until(session, id, "You chose allow.").await;

            assert_eq!(waiting, crate::protocol::Status::Blocked);
            assert!(!matches!(answered, ServerMsg::Error(_)), "{answered:?}");
            assert_eq!(texts.last().map(String::as_str), Some("You chose allow."));
            assert!(session.daemon.conversation_states[&id].approvals.is_empty());
        })
    })
    .await;
}

async fn ended(session: &mut TestSession, client: u64, id: ConversationId, generation: u64) {
    let (replies, _kept) = mpsc::channel(8);
    session.daemon.handle(Ev::Connected(client, replies, false, crate::protocol::Surface::Terminal, true));
    session.daemon.conversation_end(client, id, generation).unwrap();
    tokio::time::timeout(Duration::from_secs(20), async {
        while session.daemon.conversation_runtimes.owns(id) {
            let event = session.events.recv().await.unwrap();
            session.daemon.handle(event);
        }
    })
    .await
    .expect("the agent stops");
}

#[tokio::test]
async fn an_ended_acp_chat_is_continued_with_what_the_daemon_kept_when_the_agent_can_load_it() {
    let session = acp_session(&["--loads"]).await;
    checked(session, |session| {
        Box::pin(async move {
            let target = by_name(session);
            let (id, generation) = started(session, 620, target).await;
            say(session, 621, id, generation, 1, "first").await;
            read_until(session, id, "You said: first").await;
            // The checks a finished turn starts belong to this generation and must end in it.
            handle_until(session, "the turn's checks", |daemon| !daemon.conversation_states[&id].checks.running()).await;
            ended(session, 622, id, generation).await;

            let (same, next) = started(session, 623, StartTarget::Conversation { id, generation }).await;
            say(session, 624, same, next, 2, "second").await;
            let texts = read_until(session, id, "You said: second").await;

            assert_eq!((same, next), (id, generation + 1));
            assert_eq!(texts, ["first", "You said: first", "second", "You said: second"]);
        })
    })
    .await;
}

#[tokio::test]
async fn an_acp_chat_whose_agent_cannot_load_it_is_blocked_and_says_why() {
    let session = acp_session(&[]).await;
    checked(session, |session| {
        Box::pin(async move {
            let target = by_name(session);
            let (id, generation) = started(session, 630, target).await;
            ended(session, 631, id, generation).await;

            let again = exchange(session, 632, start(StartTarget::Conversation { id, generation }), None).await;

            assert!(matches!(&again, ServerMsg::Error(why) if why.contains("did not continue the saved conversation")), "{again:?}");
            assert_eq!(session.daemon.conversation_states[&id].status, crate::protocol::Status::Blocked);
        })
    })
    .await;
}

/// The agent's own saved conversation, named by its id, as the workspace panel reopens one.
fn saved(session: &TestSession) -> StartTarget {
    StartTarget::AcpSession { agent: AGENT.into(), cwd: session.fixture.record.binding.cwd.clone(), session: "fake-acp-session".into() }
}

#[tokio::test]
async fn a_saved_acp_conversation_is_loaded_by_its_id_when_the_agent_can_load_one() {
    let session = acp_session(&["--loads"]).await;
    checked(session, |session| {
        Box::pin(async move {
            let target = saved(session);

            let (id, generation) = started(session, 650, target).await;
            say(session, 651, id, generation, 1, "again").await;
            let texts = read_until(session, id, "You said: again").await;

            let summaries = session.daemon.conversation_summaries();
            let summary = summaries.iter().find(|summary| summary.id == id).unwrap();
            assert_eq!((summary.provider, summary.agent.as_deref()), (Provider::Acp, Some(AGENT)));
            assert_eq!(texts.last().map(String::as_str), Some("You said: again"));
        })
    })
    .await;
}

#[tokio::test]
async fn a_saved_acp_conversation_whose_agent_cannot_load_one_is_refused_saying_why() {
    let session = acp_session(&[]).await;
    checked(session, |session| {
        Box::pin(async move {
            let target = saved(session);

            let refused = exchange(session, 660, start(target), None).await;

            assert!(matches!(&refused, ServerMsg::Error(why) if why.contains("did not continue the saved conversation")), "{refused:?}");
            assert!(session.daemon.conversations.is_empty(), "no chat is left behind for the window to show");
        })
    })
    .await;
}
