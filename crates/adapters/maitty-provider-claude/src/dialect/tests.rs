use super::*;
use maitty_provider::Item;
use maitty_shared::conversation::history::Content;
use maitty_shared::conversation::{ApprovalPolicy, ApprovalRequestKind, Provider, Sandbox};
use std::path::PathBuf;

const INITIALIZED: &str =
    r#"{"type":"control_response","response":{"request_id":"claude-initialize","subtype":"success"}}"#;
const RESULT: &str = r#"{"type":"result","session_id":"session-1","is_error":false}"#;

fn dialect() -> ClaudeDialect {
    let settings = LaunchSettings {
        agent: None,
        provider: Provider::Claude,
        executable: PathBuf::from("claude"),
        config_root: PathBuf::from("config"),
        cwd: PathBuf::from("workspace"),
        model: None,
        model_provider: None,
        approval_policy: ApprovalPolicy::OnRequest,
        sandbox: Sandbox::WorkspaceWrite,
    };
    ClaudeDialect::new("session-1".into(), settings, true)
}

fn send(turn: &str, text: &str, model: Option<&str>) -> Command {
    Command::Send {
        turn: turn.into(),
        user_item: format!("user-{turn}"),
        text: text.into(),
        choice: TurnChoice { model: model.map(str::to_owned), effort: None },
    }
}

fn replay(text: &str) -> String {
    json!({"type":"user","isReplay":true,"message":{"content":[{"type":"text","text":text}]}}).to_string()
}

/// Sends a message and plays Claude's side until the turn has started.
fn start_turn(dialect: &mut ClaudeDialect, turn: &str, text: &str) {
    dialect.on_command(send(turn, text, None)).unwrap();
    dialect.on_line(INITIALIZED).unwrap();
    dialect.on_line(&replay(text)).unwrap();
}

fn arguments(steps: &[Step]) -> Vec<String> {
    let [Step::Spawn(plan)] = steps else {
        panic!("one process start, got {steps:?}");
    };
    plan.arguments.iter().map(|argument| argument.to_string_lossy().into_owned()).collect()
}

fn written(steps: &[Step]) -> Value {
    let [Step::Write(line)] = steps else {
        panic!("one written line, got {steps:?}");
    };
    serde_json::from_str(line).unwrap()
}

/// What the steps report, with the clock readings left out.
fn reported(steps: &[Step]) -> Vec<String> {
    steps
        .iter()
        .map(|step| match step {
            Step::Emit(ProviderEvent::Item(Item { id, content: Content::Message { role, text }, state, .. })) => {
                format!("{role:?} message {id} {state:?}: {text}")
            }
            Step::Emit(ProviderEvent::TurnStarted { turn, .. }) => format!("turn {turn} started"),
            Step::Emit(ProviderEvent::TurnCompleted { turn, state, error: None, .. }) => {
                format!("turn {turn} {state:?}")
            }
            Step::Emit(ProviderEvent::TextDelta { item, text, .. }) => format!("delta {item}: {text}"),
            Step::Emit(ProviderEvent::Delivered { turn }) => format!("delivered {turn}"),
            Step::CloseInput => "close input".into(),
            other => panic!("{other:?}"),
        })
        .collect()
}

#[test]
fn opening_a_conversation_starts_no_process_and_opening_another_session_is_refused() {
    let steps = dialect().on_command(Command::Open { session: None }).unwrap();

    assert_eq!(
        steps,
        [Step::Emit(ProviderEvent::Ready { session: "session-1".into(), model: None, model_provider: None })]
    );
    assert!(dialect().on_command(Command::Open { session: Some("session-2".into()) }).is_err());
}

#[test]
fn a_first_message_starts_its_own_process_and_goes_out_once_claude_initialized() {
    let mut dialect = dialect();

    let started = dialect.on_command(send("turn-1", "show status", None)).unwrap();
    let early_init = dialect
        .on_line(r#"{"type":"system","subtype":"init","session_id":"session-1"}"#)
        .unwrap();
    let initialized = dialect.on_line(INITIALIZED).unwrap();

    let [Step::Spawn(plan)] = started.as_slice() else {
        panic!("one process start, got {started:?}");
    };
    let preamble: Value = serde_json::from_str(&plan.preamble[0]).unwrap();
    assert_eq!(preamble["request_id"], INITIALIZE_REQUEST_ID);
    assert!(arguments(&started).windows(2).any(|pair| pair == ["--session-id", "session-1"]));
    assert!(early_init.is_empty());
    assert_eq!(
        written(&initialized)["message"]["content"],
        json!([{"type":"text","text":"show status"}])
    );
}

#[test]
fn a_process_that_names_another_session_is_not_trusted() {
    let mut dialect = dialect();
    dialect.on_command(send("turn-1", "show status", None)).unwrap();

    let named = dialect.on_line(r#"{"type":"system","subtype":"init","session_id":"session-2"}"#);

    assert!(named.is_err());
}

#[test]
fn a_turn_streams_text_and_ends_by_closing_its_process() {
    let mut dialect = dialect();
    dialect.on_command(send("turn-1", "show status", None)).unwrap();
    dialect.on_line(INITIALIZED).unwrap();

    let started = dialect.on_line(&replay("show status")).unwrap();
    dialect
        .on_line(r#"{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg-1","model":"claude-sonnet"}}}"#)
        .unwrap();
    let streamed = dialect
        .on_line(r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"clean"}}}"#)
        .unwrap();
    let finished = dialect.on_line(RESULT).unwrap();

    assert_eq!(
        reported(&started),
        [
            "turn turn-1 started",
            "User message user-turn-1 Running: show status",
            "User message user-turn-1 Completed: show status",
            "delivered turn-1",
        ]
    );
    assert_eq!(reported(&streamed), ["Assistant message msg-1 Running: ", "delta msg-1: clean"]);
    assert_eq!(
        reported(&finished),
        ["Assistant message msg-1 Completed: clean", "turn turn-1 Completed", "close input"]
    );
}

#[test]
fn an_approval_is_answered_with_the_tool_input_claude_sent() {
    let mut dialect = dialect();
    start_turn(&mut dialect, "turn-1", "list files");
    let request = ProviderRequestId::Text("request-1".into());
    let accept = || Command::Answer { request: ProviderRequestId::Text("request-1".into()), decision: ApprovalDecision::Accept };

    let asked = dialect
        .on_line(r#"{"type":"control_request","request_id":"request-1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"ls"}}}"#)
        .unwrap();
    let answered = dialect.on_command(accept()).unwrap();
    let again = dialect.on_command(accept());

    let [Step::Emit(ProviderEvent::ApprovalRequested { request: shown, command_hash })] = &asked[..] else {
        panic!("{asked:?}");
    };
    assert_eq!((&shown.request_id, shown.kind, shown.command.as_deref()), (&request, ApprovalRequestKind::Command, Some("ls")));
    assert_eq!(shown.turn_id.as_deref(), Some("turn-1"));
    assert!(command_hash.is_some());
    assert_eq!(
        written(&answered)["response"],
        json!({"subtype":"success","request_id":"request-1","response":{"behavior":"allow","updatedInput":{"command":"ls"}}})
    );
    assert!(again.is_err(), "an approval is answered once");
}

#[test]
fn a_declined_approval_tells_claude_so_and_an_unsupported_answer_leaves_it_open() {
    let mut dialect = dialect();
    start_turn(&mut dialect, "turn-1", "list files");
    dialect
        .on_line(r#"{"type":"control_request","request_id":"request-1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"ls"}}}"#)
        .unwrap();
    let answer = |decision| Command::Answer { request: ProviderRequestId::Text("request-1".into()), decision };

    let unsupported = dialect.on_command(answer(ApprovalDecision::AcceptForSession));
    let declined = dialect.on_command(answer(ApprovalDecision::Decline)).unwrap();

    assert!(unsupported.is_err());
    assert_eq!(
        written(&declined)["response"]["response"],
        json!({"behavior":"deny","updatedInput":{"command":"ls"},"message":"The user declined this action."})
    );
}

#[test]
fn a_question_for_the_person_is_turned_back_to_the_answer_text() {
    let mut dialect = dialect();
    start_turn(&mut dialect, "turn-1", "ask me");

    let asked = dialect
        .on_line(r#"{"type":"control_request","request_id":"request-1","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{}}}"#)
        .unwrap();

    assert_eq!(written(&asked)["response"]["response"]["behavior"], "deny");
}

#[test]
fn the_next_message_resumes_the_session_in_a_new_process() {
    let mut dialect = dialect();
    assert_eq!(dialect.next_launch(), None, "nothing is started ahead of the first message");
    start_turn(&mut dialect, "turn-1", "show status");
    assert_eq!(dialect.next_launch(), None, "nothing is started ahead while a turn runs");
    dialect.on_line(RESULT).unwrap();

    let ahead = dialect.next_launch().expect("a process for the next message");
    let same_choice = dialect.on_command(send("turn-2", "and now?", None)).unwrap();

    assert_eq!(same_choice, [Step::Spawn(ahead)], "the process started ahead fits the message");
    let arguments = arguments(&same_choice);
    assert!(arguments.iter().any(|argument| argument == "--resume=session-1"));
    assert!(!arguments.iter().any(|argument| argument == "--session-id"));
}

#[test]
fn a_message_with_another_model_does_not_fit_the_process_started_ahead() {
    let mut dialect = dialect();
    start_turn(&mut dialect, "turn-1", "show status");
    dialect.on_line(RESULT).unwrap();
    let ahead = dialect.next_launch().expect("a process for the next message");

    let picked = dialect.on_command(send("turn-2", "and now?", Some("opus"))).unwrap();

    assert_ne!(picked, [Step::Spawn(ahead)]);
    assert!(arguments(&picked).windows(2).any(|pair| pair == ["--model", "opus"]));
}

#[test]
fn an_acknowledged_interrupt_ends_the_turn_as_interrupted() {
    let mut dialect = dialect();
    start_turn(&mut dialect, "turn-1", "run forever");

    let stale = dialect.on_command(Command::Interrupt { turn: "turn-0".into() });
    let asked = dialect.on_command(Command::Interrupt { turn: "turn-1".into() }).unwrap();
    let acknowledged = dialect
        .on_line(r#"{"type":"control_response","response":{"request_id":"interrupt-turn-1","subtype":"success"}}"#)
        .unwrap();
    let finished = dialect
        .on_line(r#"{"type":"result","session_id":"session-1","is_error":true,"subtype":"error_during_execution"}"#)
        .unwrap();

    assert!(stale.is_err());
    assert_eq!(written(&asked)["request"], json!({"subtype":"interrupt"}));
    assert_eq!(acknowledged, [Step::Emit(ProviderEvent::InterruptAcknowledged { turn: "turn-1".into() })]);
    assert_eq!(reported(&finished), ["turn turn-1 Interrupted", "close input"]);
}

#[test]
fn a_message_sent_during_a_turn_is_refused_and_the_turn_goes_on() {
    let mut dialect = dialect();
    start_turn(&mut dialect, "turn-1", "show status");

    let second = dialect.on_command(send("turn-2", "hurry", None));
    let finished = dialect.on_line(RESULT).unwrap();

    assert!(second.is_err());
    assert_eq!(reported(&finished), ["turn turn-1 Completed", "close input"]);
}

#[test]
fn what_claude_cannot_do_is_refused_and_not_advertised() {
    let mut dialect = dialect();
    start_turn(&mut dialect, "turn-1", "show status");

    let steered = dialect.on_command(Command::Steer { turn: "turn-1".into(), text: "hurry".into() });
    let history = dialect.on_command(Command::ReadHistory { cursor: None, limit: 8 });

    assert!(steered.is_err() && history.is_err());
    assert!(!dialect.capabilities().steer && !dialect.capabilities().history_replay);
    assert!(dialect.capabilities().resume);
}

#[test]
fn a_result_before_the_message_is_echoed_is_an_error() {
    let mut dialect = dialect();
    dialect.on_command(send("turn-1", "show status", None)).unwrap();
    dialect.on_line(INITIALIZED).unwrap();

    assert!(dialect.on_line(RESULT).is_err(), "delivery is uncertain");
}

#[test]
fn a_process_that_exits_mid_turn_is_reported_and_one_that_exits_after_is_not() {
    let mut dialect = dialect();
    start_turn(&mut dialect, "turn-1", "show status");

    let mid_turn = dialect.on_exit();
    start_turn(&mut dialect, "turn-2", "again");
    dialect.on_line(RESULT).unwrap();
    let after_turn = dialect.on_exit();

    assert!(matches!(&mid_turn[..], [Step::Emit(ProviderEvent::Terminated { .. })]), "{mid_turn:?}");
    assert!(after_turn.is_empty());
}
