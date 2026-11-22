use super::*;
use serde_json::json;

const TURN: &str = include_str!("../fixtures/turn.jsonl");

fn dialect() -> AcpDialect {
    AcpDialect::new(Settings { arguments: vec!["--acp".into()], cwd: absolute("work") })
}

/// An absolute path on whichever system the test runs on.
fn absolute(name: &str) -> PathBuf {
    std::env::temp_dir().join(name)
}

fn written(steps: &[Step]) -> Vec<Value> {
    steps
        .iter()
        .filter_map(|step| match step {
            Step::Write(line) => Some(serde_json::from_str(line).unwrap()),
            _ => None,
        })
        .collect()
}

fn events(steps: Vec<Step>) -> Vec<ProviderEvent> {
    steps
        .into_iter()
        .filter_map(|step| match step {
            Step::Emit(event) => Some(event),
            _ => None,
        })
        .collect()
}

fn result(id: i64, result: Value) -> String {
    json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string()
}

fn initialized(load_session: bool) -> String {
    result(1, json!({"protocolVersion": 1, "agentCapabilities": {"loadSession": load_session}}))
}

/// A dialect whose session `sess-1` is open.
fn opened() -> AcpDialect {
    let mut dialect = dialect();
    dialect.on_command(Command::Open { session: None }).unwrap();
    dialect.on_line(&initialized(false)).unwrap();
    dialect.on_line(&result(2, json!({"sessionId": "sess-1"}))).unwrap();
    dialect
}

fn send(dialect: &mut AcpDialect, text: &str) -> Vec<Step> {
    dialect
        .on_command(Command::Send {
            turn: "turn-1".into(),
            user_item: "user-1".into(),
            text: text.into(),
            choice: Default::default(),
        })
        .unwrap()
}

/// A dialect in the middle of turn `turn-1`, whose prompt is request 3.
fn running() -> AcpDialect {
    let mut dialect = opened();
    send(&mut dialect, "hello");
    dialect
}

fn permission(id: Value, kind: &str) -> String {
    json!({"jsonrpc": "2.0", "id": id, "method": "session/request_permission", "params": {
        "sessionId": "sess-1",
        "toolCall": {"toolCallId": "call-9", "title": "cargo test", "kind": kind},
        "options": [
            {"optionId": "yes", "name": "Allow", "kind": "allow_once"},
            {"optionId": "never", "name": "Never", "kind": "reject_always"},
            {"optionId": "no", "name": "Reject", "kind": "reject_once"},
        ],
    }})
    .to_string()
}

/// An event in a few words.
fn named(event: &ProviderEvent) -> String {
    match event {
        ProviderEvent::Item(item) => match &item.content {
            Content::Message { role, text } => format!("{role:?} {:?} {text:?} [{}]", item.state, item.id),
            Content::Reasoning { text } => format!("thought {:?} {text:?}", item.state),
            Content::Tool { kind, label, output, .. } => format!("tool {kind} {:?} {label:?} {output:?}", item.state),
            other => format!("{other:?}"),
        },
        ProviderEvent::TextDelta { item, text, .. } => format!("delta {text:?} [{item}]"),
        ProviderEvent::TurnCompleted { state, error, .. } => format!("turn {state:?} {error:?}"),
        other => format!("{other:?}"),
    }
}

#[test]
fn opening_offers_the_agent_nothing_and_hands_it_no_servers() {
    let mut dialect = dialect();

    let started = dialect.on_command(Command::Open { session: None }).unwrap();
    let asked = dialect.on_line(&initialized(false)).unwrap();
    let ready = dialect.on_line(&result(2, json!({"sessionId": "sess-1"}))).unwrap();

    let plan = LaunchPlan { arguments: vec!["--acp".into()], ..LaunchPlan::default() };
    assert_eq!(started[0], Step::Spawn(plan));
    let initialize = &written(&started)[0];
    assert_eq!((&initialize["method"], &initialize["params"]["protocolVersion"]), (&json!("initialize"), &json!(1)));
    let offered = &initialize["params"]["clientCapabilities"];
    assert_eq!(offered["fs"]["readTextFile"], false);
    assert_eq!(offered["fs"]["writeTextFile"], false);
    assert_eq!(offered["terminal"], false);
    let new = &written(&asked)[0];
    assert_eq!(new["method"], "session/new");
    assert_eq!(new["params"]["mcpServers"], json!([]));
    assert_eq!(new["params"]["cwd"], json!(absolute("work")));
    assert_eq!(events(ready), [ProviderEvent::Ready { session: "sess-1".into(), model: None, model_provider: None }]);
}

#[test]
fn a_message_is_sent_as_a_prompt_and_recorded_before_the_agent_answers() {
    let mut dialect = opened();

    let sent = send(&mut dialect, "hello");

    let prompt = &written(&sent)[0];
    assert_eq!(prompt["method"], "session/prompt");
    assert_eq!(prompt["params"], json!({"sessionId": "sess-1", "prompt": [{"type": "text", "text": "hello"}]}));
    let reported: Vec<String> = events(sent).iter().map(named).collect();
    assert_eq!(
        reported,
        [
            r#"User Completed "hello" [user-1]"#,
            r#"Delivered { turn: "turn-1" }"#,
            r#"TurnStarted { turn: "turn-1", started_at_ms: None }"#,
        ]
    );
}

#[test]
fn a_whole_turn_becomes_the_items_a_person_sees_in_the_order_they_came() {
    let mut dialect = running();
    let mut seen = Vec::new();

    for line in TURN.lines() {
        seen.extend(events(dialect.on_line(line).unwrap()).iter().map(named));
    }
    seen.extend(events(dialect.on_line(&result(3, json!({"stopReason": "end_turn"}))).unwrap()).iter().map(named));

    assert_eq!(
        seen,
        [
            r#"thought Running "Look at the file first.""#,
            r#"thought Completed "Look at the file first.""#,
            r#"delta "I will read " [turn-1-text-2]"#,
            r#"delta "the file." [turn-1-text-2]"#,
            r#"Assistant Completed "I will read the file." [turn-1-text-2]"#,
            r#"tool read Running "Read src/main.rs" """#,
            r#"tool read Completed "Read src/main.rs" "fn main() {}""#,
            r#"tool plan Running "Plan" "[x] Read the file\n[~] Explain it""#,
            r#"delta "It is an empty program." [turn-1-text-3]"#,
            r#"Assistant Completed "It is an empty program." [turn-1-text-3]"#,
            "turn Completed None",
        ]
    );
}

/// The turn's state is what the stop reason says, and only a failure carries a reason.
#[test]
fn a_turn_ends_as_its_stop_reason_says() {
    let ended = |reason: &str| {
        let mut dialect = running();
        match &events(dialect.on_line(&result(3, json!({"stopReason": reason}))).unwrap())[..] {
            [ProviderEvent::TurnCompleted { state, error, .. }] => (state.clone(), error.is_some()),
            other => panic!("{other:?}"),
        }
    };

    assert_eq!(ended("end_turn"), (ItemState::Completed, false));
    assert_eq!(ended("cancelled"), (ItemState::Interrupted, false));
    assert_eq!(ended("refusal"), (ItemState::Failed, true));
    assert_eq!(ended("max_tokens"), (ItemState::Failed, true));
}

#[test]
fn a_prompt_the_agent_fails_ends_the_turn_with_its_message_cleaned() {
    let mut dialect = running();
    let failed = json!({"jsonrpc": "2.0", "id": 3, "error": {"code": -32603, "message": "quota \u{1b}[31mexceeded"}});

    let ended = events(dialect.on_line(&failed.to_string()).unwrap());
    let next = send(&mut dialect, "again");

    assert_eq!(named(&ended[0]), r#"turn Failed Some("quota exceeded")"#);
    assert_eq!(written(&next)[0]["id"], 4, "the conversation goes on");
}

#[test]
fn a_permission_request_offers_only_what_the_agent_offered() {
    let mut dialect = running();

    let asked = events(dialect.on_line(&permission(json!("p1"), "execute")).unwrap());

    let [ProviderEvent::ApprovalRequested { request, command_hash }] = &asked[..] else {
        panic!("{asked:?}");
    };
    assert_eq!(request.kind, ApprovalRequestKind::Command);
    assert_eq!(request.command.as_deref(), Some("cargo test"));
    assert_eq!(request.choices, [ApprovalDecision::Accept, ApprovalDecision::Decline]);
    assert_eq!(request.choice_labels, ["Allow", "Reject"]);
    assert_eq!((request.turn_id.as_deref(), request.item_id.as_deref()), (Some("turn-1"), Some("call-9")));
    assert!(!request.can_remember && command_hash.is_none());
}

#[test]
fn the_agents_names_for_its_options_are_cleaned_and_dropped_when_one_is_empty() {
    let ask = |allow: &str| {
        json!({"jsonrpc": "2.0", "id": 7, "method": "session/request_permission", "params": {
            "sessionId": "sess-1",
            "toolCall": {"toolCallId": "call-9", "title": "cargo test", "kind": "execute"},
            "options": [
                {"optionId": "a", "name": allow, "kind": "allow_once"},
                {"optionId": "b", "name": "Yes, and don't ask again", "kind": "allow_always"},
                {"optionId": "c", "name": "Second allow", "kind": "allow_once"},
            ],
        }})
        .to_string()
    };
    let labels = |allow: &str| {
        let mut dialect = running();
        match &events(dialect.on_line(&ask(allow)).unwrap())[..] {
            [ProviderEvent::ApprovalRequested { request, .. }] => (request.choices.clone(), request.choice_labels.clone()),
            other => panic!("{other:?}"),
        }
    };

    let (choices, named) = labels("Yes\u{1b}[31m\nsecond line");
    let (still_offered, unnamed) = labels("\u{1b}");

    assert_eq!(choices, [ApprovalDecision::Accept, ApprovalDecision::AcceptForSession]);
    assert_eq!(named.len(), 2);
    assert!(named[0].starts_with("Yes") && !named[0].contains(['\u{1b}', '\n']), "{named:?}");
    assert_eq!(named[1], "Yes, and don't ask again");
    assert_eq!(still_offered, choices);
    assert!(unnamed.is_empty());
}

#[test]
fn the_dialect_never_changes_the_agents_mode_itself() {
    let mut dialect = dialect();
    let mut written_lines = Vec::new();
    let mut keep = |steps: &[Step]| written_lines.extend(written(steps));
    keep(&dialect.on_command(Command::Open { session: None }).unwrap());
    keep(&dialect.on_line(&result(1, json!({"protocolVersion": 1}))).unwrap());
    let modes = json!({"currentModeId": "ask", "availableModes": [{"id": "ask", "name": "Ask"}, {"id": "yolo", "name": "Bypass"}]});
    keep(&dialect.on_line(&result(2, json!({"sessionId": "sess-1", "modes": modes}))).unwrap());
    keep(&send(&mut dialect, "hello"));
    let switch = json!({"jsonrpc": "2.0", "id": 9, "method": "session/request_permission", "params": {
        "sessionId": "sess-1",
        "toolCall": {"toolCallId": "call-1", "title": "Switch to Bypass", "kind": "switch_mode"},
        "options": [{"optionId": "y", "name": "Switch", "kind": "allow_always"}, {"optionId": "n", "name": "Stay", "kind": "reject_once"}],
    }});

    let asked = dialect.on_line(&switch.to_string()).unwrap();
    keep(&asked);
    let request = ProviderRequestId::Integer(9);
    keep(&dialect.on_command(Command::Answer { request, decision: ApprovalDecision::AcceptForSession }).unwrap());
    keep(&dialect.on_command(Command::Interrupt { turn: "turn-1".into() }).unwrap());

    // A change of mode is the agent's to ask for and a person's to allow.
    assert!(written(&asked).is_empty(), "the request waits for a person");
    assert!(matches!(&events(asked)[..], [ProviderEvent::ApprovalRequested { request, .. }] if request.choices == [ApprovalDecision::AcceptForSession, ApprovalDecision::Decline]));
    let methods: Vec<_> = written_lines.iter().filter_map(|line| line["method"].as_str()).collect();
    assert_eq!(methods, ["initialize", "session/new", "session/prompt", "session/cancel"]);
}

#[test]
fn an_answer_sends_back_the_agents_own_option_for_that_choice() {
    let mut dialect = running();
    dialect.on_line(&permission(json!(41), "edit")).unwrap();
    let request = ProviderRequestId::Integer(41);

    let declined = dialect.on_command(Command::Answer { request: request.clone(), decision: ApprovalDecision::Decline }).unwrap();
    let again = dialect.on_command(Command::Answer { request, decision: ApprovalDecision::Accept });

    assert_eq!(written(&declined), [json!({"jsonrpc": "2.0", "id": 41, "result": {"outcome": {"outcome": "selected", "optionId": "no"}}})]);
    assert!(again.is_err(), "a request is answered once");
}

#[test]
fn a_choice_the_agent_did_not_offer_is_refused_and_the_request_stays_open() {
    let mut dialect = running();
    dialect.on_line(&permission(json!(41), "edit")).unwrap();
    let request = ProviderRequestId::Integer(41);

    let widened = dialect.on_command(Command::Answer { request: request.clone(), decision: ApprovalDecision::AcceptForSession });
    let cancelled = dialect.on_command(Command::Answer { request: request.clone(), decision: ApprovalDecision::Cancel });
    let allowed = dialect.on_command(Command::Answer { request, decision: ApprovalDecision::Accept }).unwrap();

    assert!(widened.is_err() && cancelled.is_err());
    assert_eq!(written(&allowed)[0]["result"]["outcome"]["optionId"], "yes");
}

#[test]
fn interrupting_cancels_the_turn_and_every_open_request_without_choosing() {
    let mut dialect = running();
    dialect.on_line(&permission(json!("p1"), "execute")).unwrap();

    let stopped = dialect.on_command(Command::Interrupt { turn: "turn-1".into() }).unwrap();
    let late = dialect.on_command(Command::Answer { request: ProviderRequestId::Text("p1".into()), decision: ApprovalDecision::Accept });
    let ended = events(dialect.on_line(&result(3, json!({"stopReason": "cancelled"}))).unwrap());

    assert_eq!(
        written(&stopped),
        [
            json!({"jsonrpc": "2.0", "method": "session/cancel", "params": {"sessionId": "sess-1"}}),
            json!({"jsonrpc": "2.0", "id": "p1", "result": {"outcome": {"outcome": "cancelled"}}}),
        ]
    );
    assert_eq!(events(stopped), [ProviderEvent::InterruptAcknowledged { turn: "turn-1".into() }]);
    assert!(late.is_err());
    assert_eq!(named(&ended[0]), "turn Interrupted None");
}

#[test]
fn a_request_for_something_never_offered_is_refused_and_reported() {
    let mut dialect = running();
    let read = json!({"jsonrpc": "2.0", "id": 5, "method": "fs/read_text_file", "params": {"sessionId": "sess-1", "path": "/etc/passwd"}});

    let steps = dialect.on_line(&read.to_string()).unwrap();

    assert_eq!(written(&steps), [json!({"jsonrpc": "2.0", "id": 5, "error": {"code": -32601, "message": "Method not found"}})]);
    assert_eq!(
        events(steps),
        [ProviderEvent::UnsupportedRequest { request: ProviderRequestId::Integer(5), method: "fs/read_text_file".into() }]
    );
}

#[test]
fn a_permission_asked_outside_a_turn_is_cancelled_and_shown_to_nobody() {
    let mut dialect = opened();

    let steps = dialect.on_line(&permission(json!(8), "execute")).unwrap();

    assert_eq!(written(&steps)[0]["result"]["outcome"]["outcome"], "cancelled");
    assert!(events(steps).is_empty());
}

#[test]
fn an_agent_on_another_protocol_version_is_refused_and_its_exit_is_expected() {
    let mut dialect = dialect();
    dialect.on_command(Command::Open { session: None }).unwrap();

    let steps = dialect.on_line(&result(1, json!({"protocolVersion": 2}))).unwrap();

    assert_eq!(steps.last(), Some(&Step::CloseInput));
    let [ProviderEvent::Invalid { asked: Asked::Open, reason }] = &events(steps)[..] else {
        panic!("an invalid opening");
    };
    assert!(reason.contains("version 2"), "{reason}");
    assert!(dialect.on_exit().is_empty());
}

#[test]
fn an_agent_that_refuses_to_open_is_reported_with_its_code() {
    let mut dialect = dialect();
    dialect.on_command(Command::Open { session: None }).unwrap();
    dialect.on_line(&initialized(false)).unwrap();
    let refused = json!({"jsonrpc": "2.0", "id": 2, "error": {"code": -32000, "message": "Authentication required"}});

    let steps = dialect.on_line(&refused.to_string()).unwrap();

    assert_eq!(events(steps), [ProviderEvent::Refused { asked: Asked::Open, code: -32000 }]);
}

#[test]
fn a_saved_conversation_is_loaded_only_when_the_agent_says_it_can() {
    let mut can = dialect();
    let mut cannot = dialect();
    for dialect in [&mut can, &mut cannot] {
        dialect.on_command(Command::Open { session: Some("sess-7".into()) }).unwrap();
    }

    let loading = can.on_line(&initialized(true)).unwrap();
    let replayed = can.on_line(TURN.lines().next().unwrap().replace("sess-1", "sess-7").as_str()).unwrap();
    let ready = can.on_line(&result(2, Value::Null)).unwrap();
    let refused = cannot.on_line(&initialized(false)).unwrap();

    let load = &written(&loading)[0];
    assert_eq!((&load["method"], &load["params"]["sessionId"]), (&json!("session/load"), &json!("sess-7")));
    assert_eq!(load["params"]["mcpServers"], json!([]));
    assert!(replayed.is_empty(), "a replayed turn is not this conversation's news");
    assert_eq!(events(ready), [ProviderEvent::Ready { session: "sess-7".into(), model: None, model_provider: None }]);
    assert!(matches!(&events(refused)[..], [ProviderEvent::Invalid { asked: Asked::Open, .. }]));
    assert!(can.capabilities().resume && !cannot.capabilities().resume);
}

#[test]
fn what_the_agent_can_do_is_only_what_it_advertised() {
    let mut dialect = dialect();
    dialect.on_command(Command::Open { session: None }).unwrap();
    dialect.on_line(&initialized(false)).unwrap();
    let modes = json!({"currentModeId": "ask", "availableModes": [{"id": "ask", "name": "Ask"}, {"id": "code", "name": "Code"}]});

    dialect.on_line(&result(2, json!({"sessionId": "sess-1", "modes": modes}))).unwrap();

    let can = dialect.capabilities();
    assert_eq!(can.verified, Verified::Advertised);
    assert_eq!(can.modes, [Mode { id: "ask".into(), name: "Ask".into() }, Mode { id: "code".into(), name: "Code".into() }]);
    assert!(!can.steer && !can.resume && !can.history_replay);
}

#[test]
fn output_that_cannot_be_trusted_ends_the_conversation() {
    let other_session = TURN.lines().next().unwrap().replace("sess-1", "sess-2");
    for line in [result(9, json!({})), other_session, "garbage".to_owned(), result(3, json!({"stopReason": 7}))] {
        let mut dialect = running();

        assert!(dialect.on_line(&line).is_err(), "{line}");
    }
}

#[test]
fn commands_acp_has_no_way_to_carry_are_refused() {
    let mut dialect = running();

    let steered = dialect.on_command(Command::Steer { turn: "turn-1".into(), text: "left".into() });
    let read = dialect.on_command(Command::ReadHistory { cursor: None, limit: 10 });
    let second = dialect.on_command(Command::Send { turn: "turn-2".into(), user_item: "user-2".into(), text: "more".into(), choice: Default::default() });
    let wrong = dialect.on_command(Command::Interrupt { turn: "turn-0".into() });

    assert!(steered.is_err() && read.is_err() && second.is_err() && wrong.is_err());
}

#[test]
fn a_process_that_ends_by_itself_is_reported_once() {
    let mut dialect = running();

    let first = events(dialect.on_exit());
    let second = dialect.on_exit();

    assert!(matches!(&first[..], [ProviderEvent::Terminated { .. }]));
    assert!(second.is_empty());
}

#[test]
fn a_folder_that_is_not_absolute_is_refused_before_anything_starts() {
    let mut dialect = AcpDialect::new(Settings { arguments: Vec::new(), cwd: "relative".into() });

    assert!(dialect.on_command(Command::Open { session: None }).is_err());
}
