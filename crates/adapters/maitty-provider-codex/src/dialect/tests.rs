use super::*;
use maitty_shared::conversation::history::{Content, Role};
use maitty_shared::conversation::{ApprovalDecision, ApprovalPolicy, Provider, Sandbox, TurnChoice};
use std::path::PathBuf;

const THREAD: &str = "exact-thread";
/// The handshake used identities 1 and 2, so the dialect's first request is 3.
const HANDSHAKE_REQUESTS: i64 = 2;

fn settings() -> LaunchSettings {
    LaunchSettings {
        agent: None,
        provider: Provider::Codex,
        executable: PathBuf::from("codex"),
        config_root: PathBuf::from("/synthetic/home"),
        cwd: PathBuf::from("/synthetic/project"),
        model: None,
        model_provider: None,
        approval_policy: ApprovalPolicy::OnRequest,
        sandbox: Sandbox::ReadOnly,
    }
}

fn dialect() -> CodexDialect {
    CodexDialect::new(settings(), Map::new(), true, HANDSHAKE_REQUESTS)
}

fn written(steps: Vec<Step>) -> Value {
    let [Step::Write(line)] = &steps[..] else {
        panic!("{steps:?}");
    };
    serde_json::from_str(line).unwrap()
}

fn events(steps: Vec<Step>) -> Vec<ProviderEvent> {
    steps
        .into_iter()
        .map(|step| match step {
            Step::Emit(event) => event,
            other => panic!("{other:?}"),
        })
        .collect()
}

fn line(dialect: &mut CodexDialect, value: Value) -> Vec<ProviderEvent> {
    events(dialect.on_line(&value.to_string()).unwrap())
}

fn thread_reply(id: i64) -> Value {
    json!({"id": id, "result": {"thread": {"id": THREAD}, "cwd": "/synthetic/project",
        "model": "synthetic-model", "modelProvider": "synthetic-provider",
        "approvalPolicy": "on-request", "approvalsReviewer": "user",
        "sandbox": {"type": "readOnly", "networkAccess": false}}})
}

fn opened() -> CodexDialect {
    let mut dialect = dialect();
    dialect.on_command(Command::Open { session: None }).unwrap();
    line(&mut dialect, thread_reply(3));
    dialect
}

fn send(dialect: &mut CodexDialect) -> Value {
    written(
        dialect
            .on_command(Command::Send {
                turn: "ours".into(),
                user_item: "message-1".into(),
                text: "Synthetic prompt".into(),
                choice: TurnChoice::default(),
            })
            .unwrap(),
    )
}

fn notification(method: &str, params: Value) -> Value {
    json!({"method": method, "params": params})
}

#[test]
fn opening_asks_for_a_thread_and_reports_the_one_codex_names() {
    let mut dialect = dialect();

    let request = written(dialect.on_command(Command::Open { session: None }).unwrap());
    let answered = line(&mut dialect, thread_reply(3));

    assert_eq!((request["id"].as_i64(), request["method"].as_str()), (Some(3), Some("thread/start")));
    assert_eq!(request["params"]["sandbox"], "read-only");
    assert_eq!(
        answered,
        [ProviderEvent::Ready {
            session: THREAD.into(),
            model: Some("synthetic-model".into()),
            model_provider: Some("synthetic-provider".into()),
        }]
    );
}

#[test]
fn resuming_names_the_thread_and_refuses_a_different_one() {
    let mut dialect = dialect();

    let request = written(dialect.on_command(Command::Open { session: Some("another-thread".into()) }).unwrap());
    let answered = line(&mut dialect, thread_reply(3));

    assert_eq!(request["method"], "thread/resume");
    assert_eq!((&request["params"]["threadId"], &request["params"]["excludeTurns"]), (&json!("another-thread"), &json!(true)));
    assert!(matches!(&answered[..], [ProviderEvent::Invalid { asked: Asked::Open, .. }]), "{answered:?}");
}

#[test]
fn a_thread_opened_with_a_wider_sandbox_is_not_accepted() {
    let mut dialect = dialect();
    dialect.on_command(Command::Open { session: None }).unwrap();
    let mut reply = thread_reply(3);
    reply["result"]["sandbox"] = json!({"type": "dangerFullAccess"});

    let answered = line(&mut dialect, reply);

    assert!(matches!(&answered[..], [ProviderEvent::Invalid { asked: Asked::Open, .. }]), "{answered:?}");
    assert!(dialect.on_command(Command::Interrupt { turn: "turn-1".into() }).is_err());
}

#[test]
fn a_whole_turn_is_reported_in_order() {
    let mut dialect = opened();

    let request = send(&mut dialect);
    let delivered = line(&mut dialect, json!({"id": 4, "result": {"turn": {"id": "turn-1", "items": [], "status": "inProgress"}}}));
    let started = line(&mut dialect, notification("turn/started", json!({"threadId": THREAD, "turn": {"id": "turn-1", "status": "inProgress"}})));
    let delta = line(&mut dialect, notification("item/agentMessage/delta", json!({"threadId": THREAD, "turnId": "turn-1", "itemId": "answer", "delta": "Synthetic"})));
    let item = line(&mut dialect, notification("item/completed", json!({"threadId": THREAD, "turnId": "turn-1", "item": {"id": "answer", "type": "agentMessage", "text": "Synthetic stream complete"}})));
    let completed = line(&mut dialect, notification("turn/completed", json!({"threadId": THREAD, "turn": {"id": "turn-1", "status": "completed"}})));

    assert_eq!(request["method"], "turn/start");
    assert_eq!((&request["params"]["threadId"], &request["params"]["clientUserMessageId"]), (&json!(THREAD), &json!("message-1")));
    assert_eq!(delivered, [ProviderEvent::Delivered { turn: "turn-1".into() }]);
    assert_eq!(started, [ProviderEvent::TurnStarted { turn: "turn-1".into(), started_at_ms: None }]);
    assert_eq!(delta, [ProviderEvent::TextDelta { turn: "turn-1".into(), item: "answer".into(), text: "Synthetic".into() }]);
    assert!(matches!(
        &item[..],
        [ProviderEvent::Item(Item { content: Content::Message { role: Role::Assistant, text }, state: ItemState::Completed, .. })]
            if text == "Synthetic stream complete"
    ), "{item:?}");
    assert!(matches!(
        &completed[..],
        [ProviderEvent::TurnCompleted { turn, state: ItemState::Completed, error: None, .. }] if turn == "turn-1"
    ), "{completed:?}");
}

#[test]
fn a_turn_reply_without_its_items_is_fatal_so_delivery_is_never_guessed() {
    let mut dialect = opened();
    send(&mut dialect);

    let answered = dialect.on_line(&json!({"id": 4, "result": {"turn": {"id": "turn-1"}}}).to_string());

    assert!(answered.is_err());
}

#[test]
fn a_command_approval_is_shown_and_its_answer_goes_to_the_same_request() {
    let mut dialect = opened();
    let asked = line(&mut dialect, json!({"id": "approval-private", "method": "item/commandExecution/requestApproval",
        "params": {"threadId": THREAD, "turnId": "turn-1", "itemId": "cmd-1", "command": "echo synthetic",
            "reason": "Synthetic approval", "availableDecisions": ["accept", "decline"]}}));
    let [ProviderEvent::ApprovalRequested { request, command_hash }] = &asked[..] else {
        panic!("{asked:?}");
    };

    let answer = written(
        dialect
            .on_command(Command::Answer { request: request.request_id.clone(), decision: ApprovalDecision::Accept })
            .unwrap(),
    );
    let again = dialect.on_command(Command::Answer { request: request.request_id.clone(), decision: ApprovalDecision::Accept });

    assert_eq!(request.command.as_deref(), Some("echo synthetic"));
    assert!(command_hash.is_some() && request.can_remember);
    assert_eq!(answer, json!({"id": "approval-private", "result": {"decision": "accept"}}));
    assert!(again.is_err());
}

#[test]
fn a_file_change_approval_carries_the_patch_codex_sent_before_it() {
    let mut dialect = opened();
    let patch = line(&mut dialect, notification("item/fileChange/patchUpdated", json!({"threadId": THREAD, "turnId": "turn-1",
        "itemId": "file-change-1", "changes": [{"path": "src/synthetic.rs", "kind": "update", "diff": "@@ -1 +1 @@\n-old\n+new\n"}]})));

    let asked = line(&mut dialect, json!({"id": "file-approval-private", "method": "item/fileChange/requestApproval",
        "params": {"threadId": THREAD, "turnId": "turn-1", "itemId": "file-change-1", "reason": "Synthetic file change"}}));

    assert!(matches!(&patch[..], [ProviderEvent::FileChanges { changes: Some(changes), .. }] if changes.len() == 1), "{patch:?}");
    let [ProviderEvent::ApprovalRequested { request, command_hash: None }] = &asked[..] else {
        panic!("{asked:?}");
    };
    assert_eq!(request.changes.len(), 1);
    assert!(!request.choices.is_empty());
}

#[test]
fn a_request_this_project_cannot_answer_is_reported_and_left_open() {
    let mut dialect = opened();

    let asked = line(&mut dialect, json!({"id": 7, "method": "item/synthetic/request", "params": {"threadId": THREAD}}));

    assert_eq!(
        asked,
        [ProviderEvent::UnsupportedRequest { request: ProviderRequestId::Integer(7), method: "item/synthetic/request".into() }]
    );
}

#[test]
fn an_interrupt_is_acknowledged_for_the_turn_it_named() {
    let mut dialect = opened();

    let request = written(dialect.on_command(Command::Interrupt { turn: "turn-1".into() }).unwrap());
    let answered = line(&mut dialect, json!({"id": 4, "result": {}}));

    assert_eq!(request["params"], json!({"threadId": THREAD, "turnId": "turn-1"}));
    assert_eq!(answered, [ProviderEvent::InterruptAcknowledged { turn: "turn-1".into() }]);
}

#[test]
fn a_refusal_names_the_command_it_answers() {
    let mut dialect = opened();
    send(&mut dialect);

    let answered = line(&mut dialect, json!({"id": 4, "error": {"code": -32001, "message": "Synthetic refusal"}}));

    assert_eq!(answered, [ProviderEvent::Refused { asked: Asked::Send, code: -32001 }]);
}

#[test]
fn saved_history_is_read_a_page_at_a_time() {
    let mut dialect = opened();

    let request = written(dialect.on_command(Command::ReadHistory { cursor: None, limit: 128 }).unwrap());
    let page = line(&mut dialect, json!({"id": 4, "result": {"data": [{"id": "turn-1", "status": "completed", "itemsView": "full",
        "items": [{"id": "answer", "type": "agentMessage", "text": "Synthetic stream complete"}]}], "nextCursor": "page-2"}}));

    assert_eq!(request["method"], "thread/turns/list");
    let [ProviderEvent::HistoryPage { turns, next }] = &page[..] else {
        panic!("{page:?}");
    };
    assert_eq!((turns.len(), turns[0].items.len(), next.as_deref()), (1, 1, Some("page-2")));
    assert_eq!((turns[0].turn.as_str(), &turns[0].state), ("turn-1", &ItemState::Completed));
}

#[test]
fn a_thread_with_no_message_yet_has_no_history_to_read() {
    let mut dialect = opened();
    dialect.on_command(Command::ReadHistory { cursor: None, limit: 128 }).unwrap();

    let answered = line(&mut dialect, json!({"id": 4, "error": {"code": -32600,
        "message": "thread is not materialized yet; thread/turns/list is unavailable before first user message"}}));

    assert_eq!(answered, [ProviderEvent::NoHistoryYet { code: -32600 }]);
}

#[test]
fn what_another_thread_reports_is_not_this_conversations() {
    let mut dialect = opened();

    let reported = line(&mut dialect, notification("turn/completed", json!({"threadId": "helper-thread", "turn": {"id": "turn-9", "status": "completed"}})));

    assert!(reported.is_empty());
}

#[test]
fn an_answer_nothing_asked_for_is_fatal() {
    let mut dialect = opened();

    assert!(dialect.on_line(&json!({"id": 99, "result": null}).to_string()).is_err());
}

#[test]
fn steering_is_refused_when_this_codex_cannot_take_it() {
    let mut dialect = CodexDialect::new(settings(), Map::new(), false, HANDSHAKE_REQUESTS);
    dialect.on_command(Command::Open { session: None }).unwrap();
    line(&mut dialect, thread_reply(3));

    let refused = dialect.on_command(Command::Steer { turn: "turn-1".into(), text: "more".into() });

    assert!(refused.is_err());
    assert!(!dialect.capabilities().steer);
}
