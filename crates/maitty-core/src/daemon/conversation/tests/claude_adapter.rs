//! The Claude adapter driven directly: handshake, a streamed turn, approvals and interrupts.

use super::*;
use crate::conversation::{ApprovalDecision, ApprovalRequestKind, FileChangePreview, ProviderRequestId};
use maitty_provider::ProviderEvent;

/// What an event says in a word or two, for a test that checks the order of a turn's events.
fn named(event: &ProviderEvent) -> &'static str {
    use super::super::history::ItemState;
    match event {
        ProviderEvent::TurnStarted { .. } => "turn started",
        ProviderEvent::Item(item) if item.state == ItemState::Running => "item started",
        ProviderEvent::Item(_) => "item completed",
        ProviderEvent::TextDelta { .. } => "text",
        ProviderEvent::TurnCompleted { .. } => "turn completed",
        other => panic!("unexpected Claude event {other:?}"),
    }
}

fn turn_ended(event: &ProviderEvent, expected: super::super::history::ItemState) -> bool {
    matches!(event, ProviderEvent::TurnCompleted { state, .. } if *state == expected)
}

#[tokio::test]
async fn claude_adapter_initializes_streams_a_turn_and_reads_empty_turns() {
    let directory = crate::daemon::persist::scratch_dir();
    let (launch, owner) = claude_launch(directory.path(), None);
    let (events, mut received) = mpsc::channel(8);
    let (stop, stopped) = mpsc::channel(1);
    let (requests, incoming) = mpsc::channel(2);
    let task = tokio::spawn(super::claude::run(launch, owner, super::runtime::test_identity_of(owner), events, stopped, incoming));

    let ready = tokio::time::timeout(Duration::from_secs(5), received.recv())
        .await
        .expect("Claude adapter should become ready")
        .expect("Claude adapter should emit Ready");
    assert!(
        matches!(ready, Ev::Conversation(event) if event.owner == owner && matches!(event.payload, Payload::Ready))
    );

    requests
        .send(super::runtime::Command {
            token: 1,
            request: claude_open(),
        })
        .await
        .unwrap();
    let started = tokio::time::timeout(Duration::from_secs(5), received.recv())
        .await
        .expect("Claude Start should respond")
        .expect("Claude adapter should emit the Start response");
    assert!(
        matches!(started, Ev::Conversation(event) if event.owner == owner && matches!(event.payload, Payload::Response { token: 1, result: Ok(ref value) } if value == &json!({"thread":{"id":"fixture-session"}})))
    );

    requests
        .send(super::runtime::Command {
            token: 2,
            request: super::super::runtime::Rpc::ReadHistory { session: "fixture-session".into(), cursor: None, limit: 8 },
        })
        .await
        .unwrap();
    let turns = tokio::time::timeout(Duration::from_secs(5), received.recv())
        .await
        .expect("Claude empty Turns should respond")
        .expect("Claude adapter should emit the Turns response");
    assert!(
        matches!(turns, Ev::Conversation(event) if event.owner == owner && matches!(event.payload, Payload::Response { token: 2, result: Ok(ref value) } if value == &json!({"data":[],"nextCursor":null})))
    );

    requests
        .send(super::runtime::Command {
            token: 3,
            request: claude_message(Default::default()),
        })
        .await
        .unwrap();
    let mut notifications = Vec::new();
    let mut acknowledged = false;
    for _ in 0..8 {
        let event = tokio::time::timeout(Duration::from_secs(5), received.recv())
            .await
            .expect("Claude stream event should arrive")
            .expect("Claude adapter should remain connected during the turn");
        let Ev::Conversation(event) = event else {
            panic!("expected a Claude conversation event");
        };
        assert_eq!(event.owner, owner);
        match event.payload {
            Payload::Event(event) => {
                if let ProviderEvent::TextDelta { text, .. } = &event {
                    assert_eq!(text, "fake reply");
                }
                notifications.push(named(&event));
            }
            Payload::Response {
                token: 3,
                result: Ok(result),
            } => {
                assert_eq!(result["turn"]["status"], "inProgress");
                acknowledged = true;
            }
            _ => panic!("unexpected Claude stream event payload"),
        }
    }
    assert!(
        acknowledged,
        "the submitted user message should be acknowledged"
    );
    assert_eq!(
        notifications,
        [
            "turn started",
            "item started",
            "item completed",
            "item started",
            "text",
            "item completed",
            "turn completed",
        ]
    );

    stop.send(()).await.unwrap();
    let terminated = tokio::time::timeout(Duration::from_secs(5), received.recv())
        .await
        .expect("Claude adapter should stop")
        .expect("Claude adapter should emit Terminated");
    assert!(
        matches!(terminated, Ev::Conversation(event) if event.owner == owner && matches!(event.payload, Payload::Terminated { failure: None, reaped: true }))
    );
    task.await.unwrap();
    drop(directory);
}

async fn exercise_claude_approval(scenario: &str, decision: ApprovalDecision) {
    let directory = crate::daemon::persist::scratch_dir();
    let (launch, owner) = claude_launch(directory.path(), Some(scenario));
    let (task, stop, requests, mut received) = start_claude_adapter(launch, owner).await;
    start_claude_thread(&requests, &mut received, owner).await;
    requests
        .send(super::runtime::Command {
            token: 3,
            request: claude_message(Default::default()),
        })
        .await
        .unwrap();

    let mut acknowledged = false;
    let mut approval = None;
    let mut turn_id = None;
    for _ in 0..6 {
        match receive_claude_payload(&mut received, owner).await {
            Payload::Event(ProviderEvent::TurnStarted { turn, .. }) => turn_id = Some(turn),
            Payload::Event(ProviderEvent::Item(_)) => {}
            Payload::Response {
                token: 3,
                result: Ok(value),
            } => {
                assert_eq!(value["turn"]["status"], "inProgress");
                acknowledged = true;
            }
            Payload::Event(ProviderEvent::ApprovalRequested { request, command_hash }) => {
                approval = Some((request, command_hash));
                break;
            }
            _ => panic!("unexpected Claude approval payload"),
        }
    }
    assert!(
        acknowledged,
        "the user prompt should be acknowledged before approval"
    );
    let turn_id = turn_id.expect("the turn start should include its exact ID");
    let (request, command_hash) = approval.expect("Claude should request tool approval");
    assert_eq!(request.request_id, ProviderRequestId::Text("tool-request".into()));
    assert_eq!(request.kind, ApprovalRequestKind::Command);
    assert_eq!(request.turn_id, Some(turn_id));
    assert_eq!(request.item_id.as_deref(), Some("tool-request"));
    assert_eq!(request.command.as_deref(), Some("echo hello"));
    assert_eq!(request.choices, [ApprovalDecision::Accept, ApprovalDecision::Decline]);
    assert!(command_hash.is_some() && request.can_remember);
    let id = RequestId::from(request.request_id);

    requests
        .send(super::runtime::Command {
            token: 4,
            request: super::super::runtime::Rpc::Answer { request: id.into(), decision, permissions: None },
        })
        .await
        .unwrap();
    assert!(matches!(
        receive_claude_payload(&mut received, owner).await,
        Payload::Event(event) if turn_ended(&event, super::super::history::ItemState::Completed)
    ));
    stop_claude_adapter(task, stop, &mut received, owner).await;
    drop(directory);
}

#[tokio::test]
async fn claude_adapter_allows_a_host_approved_tool() {
    exercise_claude_approval("approval", ApprovalDecision::Accept).await;
}

#[test]
fn only_the_most_recent_answered_approvals_are_kept() {
    use crate::conversation::{
        ApprovalDecision, ApprovalRequest, ApprovalRequestKind, ProviderRequestId,
    };
    let request = |n: i64| ApprovalRequest {
        request_id: ProviderRequestId::Integer(n),
        kind: ApprovalRequestKind::Command,
        item_id: None,
        turn_id: None,
        command: Some("ls".into()),
        reason: None,
        cwd: None,
        changes: Vec::new(),
        questions: Vec::new(),
        permissions: None,
        choices: vec![ApprovalDecision::Accept, ApprovalDecision::Decline],
        can_remember: false,
        choice_labels: Vec::new(),
    };
    let mut state = super::super::State::default();
    for n in 0..70 {
        state.record_answer(request(n), ApprovalDecision::Decline);
    }
    assert_eq!(state.answered_approvals.len(), 64);
    assert_eq!(
        state.answered_approvals[0].request.request_id,
        ProviderRequestId::Integer(6)
    );
    assert_eq!(
        state.answered_approvals[63].request.request_id,
        ProviderRequestId::Integer(69)
    );
}

/// A Claude `Edit` call reaches the history with its input and times, and its approval names
/// the file, carries the diff and points at the tool's own step.
#[tokio::test]
async fn claude_edit_call_and_approval_carry_input_diff_and_a_link_to_the_tool_step() {
    use super::super::history::{Attachments, Content, ItemState};
    use crate::conversation::ConversationId;

    let directory = crate::daemon::persist::scratch_dir();
    let (launch, owner) = claude_launch(directory.path(), Some("tool-edit"));
    let (task, stop, requests, mut received) = start_claude_adapter(launch, owner).await;
    start_claude_thread(&requests, &mut received, owner).await;
    requests
        .send(super::runtime::Command {
            token: 3,
            request: claude_message(Default::default()),
        })
        .await
        .unwrap();

    let mut histories = Attachments::default();
    histories.attach(1, ConversationId(1));
    let mut approval = None;
    loop {
        match receive_claude_payload(&mut received, owner).await {
            Payload::Event(ProviderEvent::ApprovalRequested { request, .. }) => {
                let id = RequestId::from(request.request_id.clone());
                approval = Some(request);
                requests
                    .send(super::runtime::Command {
                        token: 4,
                        request: super::super::runtime::Rpc::Answer {
                            request: id.into(),
                            decision: ApprovalDecision::Accept,
                            permissions: None,
                        },
                    })
                    .await
                    .unwrap();
            }
            Payload::Event(event) => {
                let ended = matches!(event, ProviderEvent::TurnCompleted { .. });
                let update = super::super::history_provider::provider_event(ConversationId(1), event);
                histories.apply(ConversationId(1), &update).unwrap();
                if ended {
                    break;
                }
            }
            Payload::Response { .. } => {}
            _ => panic!("unexpected Claude edit payload"),
        }
    }

    let request = approval.expect("the edit asks for approval");
    assert_eq!(request.kind, ApprovalRequestKind::FileChange);
    assert_eq!(request.item_id.as_deref(), Some("toolu_edit"));
    assert_eq!(request.command.as_deref(), Some("Edit: src/a.rs"));
    assert_eq!(
        request.changes,
        [FileChangePreview { path: "src/a.rs".into(), kind: "update".into(), diff: "-old\n+new".into() }]
    );

    let history = histories.get(1).unwrap();
    let tool = history
        .entries
        .iter()
        .find(|entry| entry.source.item == "toolu_edit")
        .expect("the edit step is in the history under the id the approval names");
    assert_eq!(tool.state, ItemState::Completed);
    let Content::Tool { label, output, input, .. } = &tool.content else {
        panic!("an edit is a tool row");
    };
    assert_eq!(label, "Edit ");
    assert_eq!(output, "edited");
    assert_eq!(
        input,
        &Some(json!({"file_path":"src/a.rs","old_string":"old","new_string":"new"}))
    );
    let (started, completed) = (tool.started_at_ms.unwrap(), tool.completed_at_ms.unwrap());
    assert!(completed >= started);
    let turn = history
        .entries
        .iter()
        .find(|entry| entry.content == Content::TurnStatus)
        .expect("the turn has a row");
    assert!(turn.started_at_ms.is_some() && turn.completed_at_ms.is_some());

    stop_claude_adapter(task, stop, &mut received, owner).await;
    drop(directory);
}

#[tokio::test]
async fn claude_write_of_a_secret_file_and_an_echoed_token_are_masked_in_history() {
    use super::super::history::{Attachments, Content};
    use crate::conversation::ConversationId;

    let directory = crate::daemon::persist::scratch_dir();
    let (launch, owner) = claude_launch(directory.path(), Some("tool-secret"));
    let (task, stop, requests, mut received) = start_claude_adapter(launch, owner).await;
    start_claude_thread(&requests, &mut received, owner).await;
    requests
        .send(super::runtime::Command {
            token: 3,
            request: claude_message(Default::default()),
        })
        .await
        .unwrap();

    let mut histories = Attachments::default();
    histories.attach(1, ConversationId(1));
    let mut approval = None;
    loop {
        match receive_claude_payload(&mut received, owner).await {
            Payload::Event(ProviderEvent::ApprovalRequested { request, .. }) => {
                let id = RequestId::from(request.request_id.clone());
                approval = Some(request);
                requests
                    .send(super::runtime::Command {
                        token: 4,
                        request: super::super::runtime::Rpc::Answer {
                            request: id.into(),
                            decision: ApprovalDecision::Accept,
                            permissions: None,
                        },
                    })
                    .await
                    .unwrap();
            }
            Payload::Event(event) => {
                let ended = matches!(event, ProviderEvent::TurnCompleted { .. });
                let update = super::super::history_provider::provider_event(ConversationId(1), event);
                histories.apply(ConversationId(1), &update).unwrap();
                if ended {
                    break;
                }
            }
            Payload::Response { .. } => {}
            _ => panic!("unexpected Claude payload"),
        }
    }

    // The fixture asserts the agent was answered with its own, unmasked input.
    let request = approval.expect("the write asks for approval");
    assert_eq!(request.kind, ApprovalRequestKind::FileChange);

    let history = histories.get(1).unwrap();
    let find = |item: &str| {
        history
            .entries
            .iter()
            .find(|entry| entry.source.item == item)
            .unwrap_or_else(|| panic!("{item} is in the history"))
    };
    let Content::Tool { input, .. } = &find("toolu_write").content else {
        panic!("a write is a tool row");
    };
    let input = input.as_ref().expect("the write keeps its input");
    assert_eq!(input["file_path"], "app/.env");
    assert_eq!(input["content"], super::super::redact::OMITTED);
    let Content::Tool { output, .. } = &find("toolu_echo").content else {
        panic!("a command is a tool row");
    };
    assert_eq!(output, "token is [redacted]");

    stop_claude_adapter(task, stop, &mut received, owner).await;
    drop(directory);
}

#[tokio::test]
async fn claude_adapter_denies_a_host_declined_tool() {
    exercise_claude_approval("approval-decline", ApprovalDecision::Decline).await;
}

#[tokio::test]
async fn a_late_claude_init_naming_another_session_ends_the_turn() {
    let directory = crate::daemon::persist::scratch_dir();
    let (launch, owner) = claude_launch(directory.path(), Some("late-init-other"));
    let (task, _stop, requests, mut received) = start_claude_adapter(launch, owner).await;
    start_claude_thread(&requests, &mut received, owner).await;
    requests
        .send(super::runtime::Command {
            token: 3,
            request: claude_message(Default::default()),
        })
        .await
        .unwrap();
    assert!(matches!(
        receive_claude_payload(&mut received, owner).await,
        Payload::Response { token: 3, result: Err(_) }
    ));
    assert!(matches!(
        receive_claude_payload(&mut received, owner).await,
        Payload::Terminated { failure: Some(ref failure), .. } if failure.contains("different session")
    ));
    task.await.unwrap();
    drop(directory);
}

#[tokio::test]
async fn claude_adapter_acknowledges_interrupts_for_the_active_turn() {
    let directory = crate::daemon::persist::scratch_dir();
    let (launch, owner) = claude_launch(directory.path(), Some("interrupt"));
    let (task, stop, requests, mut received) = start_claude_adapter(launch, owner).await;
    start_claude_thread(&requests, &mut received, owner).await;
    requests
        .send(super::runtime::Command {
            token: 3,
            request: claude_message(Default::default()),
        })
        .await
        .unwrap();

    let mut turn_id = None;
    let mut acknowledged = false;
    for _ in 0..4 {
        match receive_claude_payload(&mut received, owner).await {
            Payload::Event(ProviderEvent::TurnStarted { turn, .. }) => turn_id = Some(turn),
            Payload::Event(ProviderEvent::Item(_)) => {}
            Payload::Response {
                token: 3,
                result: Ok(value),
            } => {
                assert_eq!(value["turn"]["status"], "inProgress");
                acknowledged = true;
            }
            _ => panic!("unexpected Claude interrupt setup payload"),
        }
    }
    assert!(acknowledged, "the submitted prompt should be acknowledged");
    let turn_id = turn_id.expect("the turn start should include its exact ID");

    requests
        .send(super::runtime::Command {
            token: 4,
            request: super::super::runtime::Rpc::Interrupt { session: "fixture-session".into(), turn: turn_id },
        })
        .await
        .unwrap();
    assert!(matches!(
        receive_claude_payload(&mut received, owner).await,
        Payload::Response {
            token: 4,
            result: Ok(ref value)
        } if value == &json!({})
    ));
    // Claude ends a stopped turn with an error result; the person asked for it, so it is interrupted.
    assert!(matches!(
        receive_claude_payload(&mut received, owner).await,
        Payload::Event(event) if turn_ended(&event, super::super::history::ItemState::Interrupted)
    ));
    stop_claude_adapter(task, stop, &mut received, owner).await;
    drop(directory);
}

#[tokio::test]
async fn a_claude_chats_process_is_told_it_is_this_chat_and_nothing_else() {
    let directory = crate::daemon::persist::scratch_dir();
    let (mut launch, owner) = claude_launch(directory.path(), None);
    // What the daemon's own environment may hold: a pane it was started from, and an older chat.
    for (key, value) in [("TERM_ID", "7"), ("PANE_TOKEN", "a-pane"), ("CONVERSATION_AUTH", "an-older-chat")] {
        for name in maitty_shared::brand::env_names(key) {
            launch.environment.push((name.into(), value.into()));
        }
    }
    let executable = launch.paths().1.to_owned();
    let (task, stop, requests, mut received) = start_claude_adapter(launch, owner).await;
    start_claude_thread(&requests, &mut received, owner).await;
    requests
        .send(super::runtime::Command {
            token: 3,
            request: claude_message(Default::default()),
        })
        .await
        .unwrap();
    loop {
        if let Payload::Event(ProviderEvent::TurnCompleted { .. }) = receive_claude_payload(&mut received, owner).await {
            break;
        }
    }

    let told = std::fs::read_to_string(executable.with_extension("identity")).unwrap();
    let identity = super::runtime::test_identity_of(owner);
    let mut expected: Vec<String> = crate::ipc::STRUCTURED_KEYS
        .into_iter()
        .zip([
            identity.conversation.0.to_string(),
            identity.generation.to_string(),
            identity.connection.to_string(),
            identity.token,
        ])
        .flat_map(|(key, value)| {
            maitty_shared::brand::env_names(key).into_iter().map(move |name| format!("{name}={value}"))
        })
        .collect();
    expected.sort();
    assert_eq!(told.lines().collect::<Vec<_>>(), expected);

    stop_claude_adapter(task, stop, &mut received, owner).await;
    drop(directory);
}
