//! Starting a conversation: what is created, what is refused, and the pane's helper policy.

use super::*;

#[tokio::test]
async fn new_empty_thread_starts_without_requesting_unmaterialized_history() {
    let mut session = conversation_fixture("conversation-empty-thread").await;
    session.daemon.cfg.restore.output = false;
    session
        .daemon
        .initialize_conversation_cache()
        .await
        .unwrap();
    let outcome = AssertUnwindSafe(async {
        let (id, _) = create(&mut session).await;
        let state = &session.daemon.conversation_states[&id];
        assert!(state.history_ready);
        assert_eq!(state.status, crate::protocol::Status::Idle);
        assert!(!session.daemon.conversation_histories.contains_key(&id));

        let reply = exchange(
            &mut session,
            101,
            crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationRead {
                id,
                cursor: None,
                limit: 128,
            }),
            None,
        )
        .await;
        assert!(matches!(
            reply,
            ServerMsg::Reply(crate::protocol::Reply::ConversationRead(ref read))
                if read.history.entries.is_empty()
                    && read.history.completeness == crate::conversation::history::Completeness::Complete
        ));
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn uncertain_first_submission_is_not_treated_as_empty_history() {
    let mut session = conversation_fixture("conversation-empty-thread").await;
    session.daemon.cfg.restore.output = false;
    session
        .daemon
        .initialize_conversation_cache()
        .await
        .unwrap();
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut session).await;
        session.daemon.conversation_operations.push(crate::conversation::Operation {
            receipt: crate::conversation::Receipt {
                conversation: id,
                generation,
                operation: 1,
                delivery: crate::conversation::Delivery::SubmissionUncertain,
            },
            digest: "synthetic-digest".into(),
        });

        let reply = exchange(
            &mut session,
            102,
            crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationRead {
                id,
                cursor: None,
                limit: 128,
            }),
            None,
        )
        .await;
        assert!(matches!(reply, ServerMsg::Error(ref error) if error.contains("Codex rejected thread/turns/list")));
        assert!(!session.daemon.conversation_states[&id].history_ready);
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn structured_start_honors_authenticated_pane_never_helper_policy() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let from = authenticated_pane(&mut s);
        s.daemon.cfg.sessions.helpers = "never".into();
        let target = crate::conversation::StartTarget::Create(settings(&s));
        let reply = exchange(
            &mut s,
            200,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationStart {
                target,
                branch: None,
            }),
            Some(from),
        )
        .await;
        assert!(matches!(reply,ServerMsg::Error(ref e) if e.contains("helpers off")));
        assert!(s.daemon.pending_starts.is_empty());
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn structured_start_honors_authenticated_pane_ask_and_no_helper_answer() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let from = authenticated_pane(&mut s);
        s.daemon.cfg.sessions.helpers = "ask".into();
        let target = crate::conversation::StartTarget::Create(settings(&s));
        let reply = exchange(
            &mut s,
            201,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationStart {
                target: target.clone(),
                branch: None,
            }),
            Some(from.clone()),
        )
        .await;
        assert!(matches!(reply,ServerMsg::Error(ref e) if e.contains("user's OK")));
        assert!(!s.daemon.terms[&from.0].helpers.asked.is_empty());
        s.daemon
            .answer_helpers(crate::daemon::helpers::Starter::Pane(from.0), crate::protocol::HelperChoice::No)
            .unwrap();
        let reply = exchange(
            &mut s,
            202,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationStart {
                target,
                branch: None,
            }),
            Some(from),
        )
        .await;
        assert!(matches!(reply,ServerMsg::Error(ref e) if e.contains("said no helpers")));
        assert!(s.daemon.pending_starts.is_empty());
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn structured_helpers_count_against_authenticated_pane_concurrency_limit() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let from = authenticated_pane(&mut s);
        s.daemon.cfg.sessions.helpers = "always".into();
        s.daemon.cfg.sessions.helpers_at_once = "1".into();
        let target = crate::conversation::StartTarget::Create(settings(&s));
        let reply = exchange(
            &mut s,
            203,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationStart {
                target: target.clone(),
                branch: None,
            }),
            Some(from.clone()),
        )
        .await;
        let id = match reply {
            ServerMsg::Reply(crate::protocol::Reply::ConversationStarted { id, .. }) => id,
            other => panic!("{other:?}"),
        };
        assert_eq!(s.daemon.conversation_states[&id].started_by, Some(from.0));
        let reply = exchange(
            &mut s,
            204,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationStart {
                target,
                branch: None,
            }),
            Some(from),
        )
        .await;
        assert!(matches!(reply,ServerMsg::Error(ref e) if e.contains("at once is the limit")));
        assert_eq!(s.daemon.conversations.len(), 1);
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn structured_chat_refuses_native_conversations_until_history_is_reconciled() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let id = crate::conversation::ConversationId(48);
        let generation = 5;
        let mut conversation = session.fixture.record.clone();
        conversation.id = id;
        conversation.generation = generation;
        conversation.execution = crate::conversation::ExecutionKind::Native;
        conversation.state = crate::conversation::RecoveryState::RecoveryRequired;
        session.daemon.conversations.push(conversation);
        let (client, _) = mpsc::channel(8);
        session.daemon.handle(Ev::Connected(326, client, false, crate::protocol::Surface::Terminal, true));

        let result = session.daemon.conversation_start(
            326,
            crate::conversation::StartTarget::Conversation { id, generation },
        );
        assert!(matches!(result, Err(ref error) if error.to_string().contains("history must be reconciled")));
        assert!(!session.daemon.conversation_runtimes.owns(id));
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn structured_creation_never_launches_when_restore_is_disabled_during_barrier() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (client, _) = mpsc::channel(8);
        s.daemon.handle(Ev::Connected(140, client, false, crate::protocol::Surface::Terminal, true));
        let target = crate::conversation::StartTarget::Create(settings(&s));
        s.daemon.conversation_start(140, target).unwrap();
        let event = loop {
            let event = tokio::time::timeout(Duration::from_secs(10), s.events.recv())
                .await
                .unwrap()
                .unwrap();
            if matches!(event, Ev::SessionSaved { .. }) {
                break event;
            }
            s.daemon.handle(event);
        };
        assert!(matches!(event, Ev::SessionSaved { .. }));
        s.daemon.cfg.restore.enabled = false;
        s.daemon.handle(event);
        assert!(
            !s.daemon
                .conversation_runtimes
                .owns(crate::conversation::ConversationId(1))
        );
        let path = s.fixture.directory.path().join("pids");
        assert!(
            !tokio::task::spawn_blocking(move || path.exists())
                .await
                .unwrap()
        );
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn unsupported_bindings_refuse_before_provider_start() {
    let f = Fixture::new().await;
    let mut launch = f.launch("normal");
    if let super::super::transport::LaunchIdentity::Existing(c) = &mut launch.identity {
        c.binding.profile = Some("native-overlay".into());
    }
    assert!(
        launch
            .validate()
            .await
            .err()
            .unwrap()
            .to_string()
            .contains("profile-v2")
    );
    let mut launch = f.launch("normal");
    launch.environment.push((
        "CODEX_HOME".into(),
        f.directory.path().join("different").into_os_string(),
    ));
    assert!(
        launch
            .validate()
            .await
            .err()
            .unwrap()
            .to_string()
            .contains("disagrees")
    );
    assert!(!f.directory.path().join("pids").exists());
    f.cleanup().await;
}
