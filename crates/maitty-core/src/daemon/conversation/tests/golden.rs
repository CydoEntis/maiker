//! Whole turns against the fake providers, compared with a saved record of what a person would
//! see: the history, the open and answered requests, and the status. The records in `golden/`
//! are the contract the provider adapters must keep while the code behind them moves.
//!
//! A record that should change is rewritten with `GOLDEN_UPDATE=1 cargo test -p maitty-core golden`;
//! read the diff before committing it.

use super::*;
use crate::conversation::{ApprovalDecision, ConversationId};
use crate::protocol::{ClientMsg, Command, Query, Reply, Status};
use serde_json::Map;

const UPDATE_ENV: &str = "GOLDEN_UPDATE";
/// Stands in for a value that differs between runs: a clock reading or a made-up identity.
const TIME: &str = "<time>";
const DIRECTORY: &str = "<fixture>";

/// The steps of one scripted turn, each a picture of the conversation at a named moment.
struct Record {
    name: &'static str,
    steps: Vec<Value>,
    /// Identities the daemon makes up, in the order they were first seen.
    identities: Vec<String>,
    directory: String,
    client: u64,
}

impl Record {
    fn new(name: &'static str, session: &TestSession) -> Self {
        let directory = std::fs::canonicalize(session.fixture.directory.path()).unwrap();
        Self {
            name,
            steps: Vec::new(),
            identities: Vec::new(),
            directory: directory.to_string_lossy().into_owned(),
            client: 9_000,
        }
    }

    fn next_client(&mut self) -> u64 {
        self.client += 1;
        self.client
    }

    /// Adds what the conversation looks like now, under `moment`.
    async fn step(&mut self, session: &mut TestSession, id: ConversationId, moment: &str) {
        let client = self.next_client();
        let read = exchange(
            session,
            client,
            ClientMsg::Query(Query::ConversationRead { id, cursor: None, limit: 128 }),
            None,
        )
        .await;
        let ServerMsg::Reply(Reply::ConversationRead(read)) = read else {
            panic!("{read:?}");
        };
        let state = &session.daemon.conversation_states[&id];
        let record = session.daemon.conversations.iter().find(|c| c.id == id).unwrap();
        let mut step = json!({
            "moment": moment,
            "status": format!("{:?}", state.status),
            "recovery": format!("{:?}", record.state),
            "error": state.error,
            "open_requests": state.approvals.values().collect::<Vec<_>>(),
            "answered_requests": state.answered_approvals,
            "history_complete": format!("{:?}", read.history.completeness),
            "history": read.history.entries,
        });
        self.steady(&mut step);
        self.steps.push(step);
    }

    /// Replaces what differs between runs, keeping which identity is which.
    fn steady(&mut self, value: &mut Value) {
        match value {
            Value::Object(fields) => {
                for (key, field) in fields.iter_mut() {
                    if key.ends_with("_at_ms") && field.is_number() {
                        *field = TIME.into();
                    } else {
                        self.steady(field);
                    }
                }
            }
            Value::Array(items) => items.iter_mut().for_each(|item| self.steady(item)),
            Value::String(text) => *text = self.steady_text(text),
            _ => {}
        }
    }

    fn steady_text(&mut self, text: &str) -> String {
        let made_up = regex::Regex::new(
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}",
        )
        .unwrap();
        let text = text.replace(&self.directory, DIRECTORY);
        made_up
            .replace_all(&text, |found: &regex::Captures<'_>| {
                let identity = found[0].to_owned();
                let position = self.identities.iter().position(|known| *known == identity).unwrap_or_else(|| {
                    self.identities.push(identity);
                    self.identities.len() - 1
                });
                format!("<id {}>", position + 1)
            })
            .into_owned()
    }

    /// Compares the steps with the saved record, or saves them when asked to.
    fn check(self) {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/daemon/conversation/tests/golden")
            .join(format!("{}.json", self.name));
        let mut steps = Map::new();
        steps.insert("steps".into(), Value::Array(self.steps));
        let actual = format!("{}\n", serde_json::to_string_pretty(&Value::Object(steps)).unwrap());
        if std::env::var_os(UPDATE_ENV).is_some() {
            std::fs::write(&path, &actual).unwrap();
            return;
        }
        let saved = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("{}: {error}; run with {UPDATE_ENV}=1 to save it", path.display()));
        // A Windows checkout may hold the record with CRLF line ends.
        assert_eq!(actual, saved.replace("\r\n", "\n"), "{} no longer matches", self.name);
    }
}

async fn send(session: &mut TestSession, record: &mut Record, id: ConversationId, generation: u64, text: &str) {
    let client = record.next_client();
    let message = ClientMsg::Command(Command::ConversationSend {
        id,
        generation,
        operation: 1,
        text: text.into(),
        choice: None,
    });
    let sent = exchange(session, client, message, None).await;
    assert!(matches!(sent, ServerMsg::Reply(Reply::ConversationSent(_))), "{sent:?}");
}

/// Waits for the provider to ask a person something.
async fn asked(session: &mut TestSession, id: ConversationId) -> crate::conversation::ProviderRequestId {
    handle_until(session, "the provider asks for an approval", |daemon| {
        !daemon.conversation_states[&id].approvals.is_empty()
    })
    .await;
    session.daemon.conversation_states[&id].approvals.keys().next().unwrap().clone()
}

async fn answer(
    session: &mut TestSession,
    record: &mut Record,
    id: ConversationId,
    generation: u64,
    request_id: crate::conversation::ProviderRequestId,
) {
    let client = record.next_client();
    let message = ClientMsg::Command(Command::ConversationApprove {
        id,
        generation,
        request_id,
        decision: ApprovalDecision::Accept,
    });
    let answered = exchange(session, client, message, None).await;
    assert!(matches!(answered, ServerMsg::Reply(Reply::Ok)), "{answered:?}");
}

/// Waits until the turn is over and nothing the daemon asked the provider is still open.
async fn turn_over(session: &mut TestSession, id: ConversationId) {
    handle_until(session, "the turn ends", |daemon| {
        let state = &daemon.conversation_states[&id];
        let in_flight = daemon.conversation_requests.values().any(|pending| pending.conversation() == id);
        state.status != Status::Working && state.cancelling.is_none() && !in_flight
    })
    .await;
    session.settle_background().await;
}

async fn turn_running(session: &mut TestSession, id: ConversationId) {
    handle_until(session, "the turn starts", |daemon| {
        daemon.conversation_states[&id].status == Status::Working
    })
    .await;
}

async fn cancel(session: &mut TestSession, record: &mut Record, id: ConversationId, generation: u64) {
    let client = record.next_client();
    let cancelled = exchange(
        session,
        client,
        ClientMsg::Command(Command::ConversationCancel { id, generation }),
        None,
    )
    .await;
    assert!(matches!(cancelled, ServerMsg::Reply(Reply::Ok)), "{cancelled:?}");
}

/// Runs `turn` on a Codex chat whose fake provider plays `mode`, then checks the record `name`.
async fn codex_turn<F>(name: &'static str, mode: &'static str, turn: F)
where
    F: for<'a> FnOnce(&'a mut TestSession, &'a mut Record, ConversationId, u64) -> FixtureCheck<'a>,
{
    let mut session = conversation_fixture(mode).await;
    let mut record = Record::new(name, &session);
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut session).await;
        record.step(&mut session, id, "created").await;
        send(&mut session, &mut record, id, generation, "Synthetic prompt").await;
        turn(&mut session, &mut record, id, generation).await;
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
    record.check();
}

/// The same for a Claude chat whose fake `claude` plays `scenario`.
async fn claude_turn<F>(name: &'static str, scenario: &'static str, turn: F)
where
    F: for<'a> FnOnce(&'a mut TestSession, &'a mut Record, ConversationId, u64) -> FixtureCheck<'a>,
{
    let mut session = conversation_fixture("conversation").await;
    let mut record = Record::new(name, &session);
    let outcome = AssertUnwindSafe(async {
        let client = record.next_client();
        let (_, id, generation) = start_claude_chat(&mut session, client, scenario).await;
        record.step(&mut session, id, "created").await;
        send(&mut session, &mut record, id, generation, "hello fake Claude").await;
        turn(&mut session, &mut record, id, generation).await;
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
    record.check();
}

/// A turn that only has to finish.
fn to_the_end<'a>(
    session: &'a mut TestSession,
    record: &'a mut Record,
    id: ConversationId,
    _generation: u64,
) -> FixtureCheck<'a> {
    Box::pin(async move {
        turn_over(session, id).await;
        record.step(session, id, "the turn ended").await;
    })
}

/// A turn that stops to ask, is allowed, and finishes.
fn through_an_approval<'a>(
    session: &'a mut TestSession,
    record: &'a mut Record,
    id: ConversationId,
    generation: u64,
) -> FixtureCheck<'a> {
    Box::pin(async move {
        let request = asked(session, id).await;
        record.step(session, id, "the provider asked").await;
        answer(session, record, id, generation, request).await;
        turn_over(session, id).await;
        record.step(session, id, "the turn ended").await;
    })
}

/// A turn that a person stops while it runs.
fn cancelled_while_running<'a>(
    session: &'a mut TestSession,
    record: &'a mut Record,
    id: ConversationId,
    generation: u64,
) -> FixtureCheck<'a> {
    Box::pin(async move {
        turn_running(session, id).await;
        record.step(session, id, "the turn is running").await;
        cancel(session, record, id, generation).await;
        turn_over(session, id).await;
        record.step(session, id, "the turn was cancelled").await;
    })
}

#[tokio::test]
async fn a_codex_message_turn_matches_its_record() {
    codex_turn("codex-message", "conversation", to_the_end).await;
}

#[tokio::test]
async fn a_codex_turn_with_a_command_and_an_edit_matches_its_record() {
    codex_turn("codex-tools", "conversation-tools", to_the_end).await;
}

#[tokio::test]
async fn a_codex_command_approval_matches_its_record() {
    codex_turn("codex-command-approval", "conversation-approval", through_an_approval).await;
}

#[tokio::test]
async fn a_codex_file_change_approval_matches_its_record() {
    codex_turn("codex-file-approval", "conversation-file-approval", through_an_approval).await;
}

#[tokio::test]
async fn a_cancelled_codex_turn_matches_its_record() {
    codex_turn("codex-cancel", "conversation-cancel", cancelled_while_running).await;
}

#[tokio::test]
async fn a_claude_message_turn_matches_its_record() {
    claude_turn("claude-message", "", to_the_end).await;
}

#[tokio::test]
async fn a_claude_command_approval_matches_its_record() {
    claude_turn("claude-command-approval", "approval", through_an_approval).await;
}

#[tokio::test]
async fn a_claude_edit_with_its_approval_matches_its_record() {
    claude_turn("claude-edit", "tool-edit", through_an_approval).await;
}

#[tokio::test]
async fn a_cancelled_claude_turn_matches_its_record() {
    claude_turn("claude-cancel", "interrupt-any", cancelled_while_running).await;
}
