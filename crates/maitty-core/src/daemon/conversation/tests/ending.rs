//! Stopping work: ending an agent, closing a chat and cancelling a turn.

use super::*;

#[tokio::test]
async fn ending_a_chat_stops_its_agent_and_leaves_it_stopped_not_failed() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut session).await;
        assert!(session.daemon.conversation_runtimes.owns(id));

        let (client, _replies) = mpsc::channel(8);
        session.daemon.handle(Ev::Connected(340, client, false, crate::protocol::Surface::Terminal, true));
        session.daemon.conversation_end(340, id, generation).unwrap();
        tokio::time::timeout(Duration::from_secs(20), async {
            while session.daemon.conversation_runtimes.owns(id) {
                let event = session.events.recv().await.unwrap();
                session.daemon.handle(event);
            }
        })
        .await
        .expect("the agent stops");

        let record = session
            .daemon
            .conversations
            .iter()
            .find(|conversation| conversation.id == id)
            .unwrap();
        assert_eq!(record.state, crate::conversation::RecoveryState::Stopped);
        let state = &session.daemon.conversation_states[&id];
        assert_eq!(state.status, crate::protocol::Status::Idle);
        assert!(state.error.is_none(), "stopping on purpose is not an error");
        assert!(!session.daemon.conversation_ending.contains(&id));

        // A stale generation is refused.
        let stale = session
            .daemon
            .conversation_end(340, id, generation + 1)
            .unwrap_err();
        assert!(stale.to_string().contains("stale"));
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_closed_chat_is_hidden_at_once_comes_back_with_undo_and_ends_when_the_window_passes() {
    let mut session = conversation_fixture("conversation-approval").await;
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut session).await;
        let archived = |s: &TestSession| s.daemon.conversations.iter().find(|c| c.id == id).unwrap().archived;
        let close = crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationClose { id, generation });
        let undo = crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationUndoClose { id });

        // An agent cannot close a person's chat.
        let from = authenticated_pane(&mut session);
        let refused = exchange(&mut session, 420, close.clone(), Some(from)).await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("Only a human")), "{refused:?}");
        assert!(!archived(&session));

        let closed = exchange(&mut session, 421, close.clone(), None).await;
        assert!(matches!(closed, ServerMsg::Reply(crate::protocol::Reply::Ok)), "{closed:?}");
        assert!(archived(&session), "hidden at once");
        assert!(session.daemon.conversation_runtimes.owns(id), "still running inside the window");

        let back = exchange(&mut session, 422, undo.clone(), None).await;
        assert!(matches!(back, ServerMsg::Reply(crate::protocol::Reply::Ok)), "{back:?}");
        assert!(!archived(&session), "brought back");
        assert!(session.daemon.conversation_closing.is_empty());
        assert!(session.daemon.closed_sessions.list().is_empty(), "an undo leaves no record");
        let late = exchange(&mut session, 423, undo.clone(), None).await;
        assert!(matches!(late, ServerMsg::Error(ref message) if message.contains("window has passed")), "{late:?}");

        // Closed again and left alone: the window passing ends it, and it stays hidden.
        assert!(matches!(exchange(&mut session, 424, close, None).await, ServerMsg::Reply(crate::protocol::Reply::Ok)));
        session.daemon.finish_chat_closes();
        assert!(session.daemon.conversation_runtimes.owns(id), "not before the window passes");
        assert!(session.daemon.closed_sessions.list().is_empty(), "no record before the window passes");
        *session.daemon.conversation_closing.get_mut(&id).unwrap() = std::time::Instant::now() - crate::daemon::UNDO_WINDOW;
        session.daemon.finish_chat_closes();
        assert!(session.daemon.conversation_closing.is_empty());
        assert!(archived(&session));
        let binding = session.daemon.conversations.iter().find(|c| c.id == id).unwrap().binding.clone();
        let [kept] = session.daemon.closed_sessions.list() else {
            panic!("one record once the window passed: {:?}", session.daemon.closed_sessions.list());
        };
        assert_eq!((kept.session.as_str(), &kept.cwd), (binding.session_id.as_str(), binding.worktree.as_ref().unwrap_or(&binding.cwd)));
        let late = exchange(&mut session, 425, undo, None).await;
        assert!(matches!(late, ServerMsg::Error(ref message) if message.contains("window has passed")), "{late:?}");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn turn_cancellation_uses_only_the_acknowledged_active_turn_id() {
    let mut session = conversation_fixture("conversation-cancel").await;
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut session).await;
        let sent = exchange(
            &mut session,
            320,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation,
                operation: 1,
                text: "Synthetic long turn".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(sent, ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))));

        let stale = exchange(
            &mut session,
            321,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationCancel {
                id,
                generation: generation + 1,
            }),
            None,
        )
        .await;
        assert!(matches!(stale, ServerMsg::Error(ref message) if message.contains("stale or stopped")));

        let from = authenticated_pane(&mut session);
        let unauthorized = exchange(
            &mut session,
            322,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationCancel {
                id,
                generation,
            }),
            Some(from),
        )
        .await;
        assert!(matches!(unauthorized, ServerMsg::Error(ref message) if message.contains("Only a human")));

        let cancelled = exchange(
            &mut session,
            323,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationCancel {
                id,
                generation,
            }),
            None,
        )
        .await;
        assert!(matches!(cancelled, ServerMsg::Reply(crate::protocol::Reply::Ok)));

        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].cancelling.is_some() {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("Codex completed the exact interrupted turn");

        let request = tokio::fs::read_to_string(session.fixture.directory.path().join("interrupts"))
            .await
            .unwrap();
        let requests: Vec<Value> = request.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0]["method"], "turn/interrupt");
        assert_eq!(requests[0]["params"]["threadId"], "exact-thread");
        assert_eq!(requests[0]["params"]["turnId"], "turn-1");
        assert_eq!(session.daemon.conversation_states[&id].status, crate::protocol::Status::Idle);
        assert_eq!(session.daemon.conversation_states[&id].error, None);

        let read = exchange(
            &mut session,
            324,
            crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationRead {
                id,
                cursor: None,
                limit: 128,
            }),
            None,
        )
        .await;
        assert!(matches!(
            read,
            ServerMsg::Reply(crate::protocol::Reply::ConversationRead(ref result))
                if !result.cancelling
                    && result.history.entries.iter().any(|entry| {
                        entry.content == crate::conversation::history::Content::TurnStatus
                            && entry.state == crate::conversation::history::ItemState::Interrupted
                    })
        ));

        let continued = exchange(
            &mut session,
            325,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation,
                operation: 2,
                text: "Continue after stopping the previous turn".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(continued, ServerMsg::Reply(crate::protocol::Reply::ConversationSent(ref receipt)) if receipt.operation == 2));
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

fn pending(session: &TestSession, id: u64) -> crate::conversation::PendingStart {
    crate::conversation::PendingStart {
        id: crate::conversation::ConversationId(id),
        generation: 1,
        settings: settings(session),
        thread_id: None,
    }
}

/// A launch that fails before the chat has an identity leaves nothing behind, and the person who
/// started it still gets the error.
#[tokio::test]
async fn a_launch_that_fails_before_it_has_an_identity_leaves_no_row() {
    use crate::daemon::conversation::commands::Pending;
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (real, _) = create(&mut session).await;
        let (client, mut replies) = mpsc::channel(8);
        session.daemon.handle(Ev::Connected(440, client, false, crate::protocol::Surface::Terminal, true));
        let id = crate::conversation::ConversationId(900);
        let start = pending(&session, 900);
        session.daemon.pending_starts.push(start.clone());
        session.daemon.conversation_fail(
            Pending::Opening { client: 440, id, generation: 1, settings: start.settings, expected: None },
            "launch failed".into(),
        );

        let mut told = false;
        while let Ok(message) = replies.try_recv() {
            told |= matches!(message, ServerMsg::Error(ref text) if text == "launch failed");
        }
        assert!(told, "the new-chat page still gets the error");
        assert!(session.daemon.pending_starts.is_empty());
        assert!(!session.daemon.conversation_states.contains_key(&id));
        assert!(session.daemon.saved().pending_starts.is_empty());
        let listed: Vec<_> = session.daemon.conversation_summaries().iter().map(|s| s.id).collect();
        assert_eq!(listed, vec![real], "only the real chat is listed");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// A restart brings back no pending start: nothing resumes one, and the earlier failed ones that
/// were saved go with it.
#[tokio::test]
async fn a_restart_does_not_bring_back_a_pending_start() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (real, _) = create(&mut session).await;
        session.daemon.pending_starts.push(pending(&session, 900));
        let saved = session.daemon.saved();
        assert_eq!(saved.pending_starts.len(), 1, "the file holds the ghost");

        let (tx, _events) = mpsc::channel(8);
        let mut restored = Daemon::new(Config::default(), tx, || {});
        assert!(restored.restore(saved));
        assert!(restored.pending_starts.is_empty());
        let kept: Vec<_> = restored.conversations.iter().map(|c| c.id).collect();
        assert_eq!(kept, vec![real]);
        assert!(restored.saved().pending_starts.is_empty());
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// A start still in flight (or cut off) is listed as a chat; ending or closing it drops it, and
/// nothing next to it.
#[tokio::test]
async fn a_pending_start_left_by_a_failed_launch_can_be_ended_and_closed() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (real, _) = create(&mut session).await;
        for close in [false, true] {
            let id = crate::conversation::ConversationId(900);
            session.daemon.pending_starts.push(crate::conversation::PendingStart {
                id,
                generation: 1,
                settings: settings(&session),
                thread_id: None,
            });
            let state = session.daemon.conversation_states.entry(id).or_default();
            state.status = crate::protocol::Status::Blocked;
            state.error = Some("launch failed".into());
            session.daemon.note_conversation_status_times();
            assert!(session.daemon.conversation_summaries().iter().any(|s| s.id == id));

            let command = if close {
                crate::protocol::Command::ConversationClose { id, generation: 1 }
            } else {
                crate::protocol::Command::ConversationEnd { id, generation: 1 }
            };
            let reply = exchange(&mut session, 430 + u64::from(close), crate::protocol::ClientMsg::Command(command), None).await;
            assert!(matches!(reply, ServerMsg::Reply(crate::protocol::Reply::Ok)), "close={close}: {reply:?}");

            assert!(!session.daemon.conversation_summaries().iter().any(|s| s.id == id), "gone from the list");
            assert!(!session.daemon.conversation_states.contains_key(&id));
            session.daemon.note_conversation_status_times();
            assert!(!session.daemon.conversation_since.contains_key(&id));
            assert!(session.daemon.saved().pending_starts.is_empty(), "gone from the saved file");
            assert!(session.daemon.conversation_runtimes.owns(real), "the real chat keeps running");
            assert!(session.daemon.conversations.iter().any(|c| c.id == real && !c.archived));
        }

        let saved = session.daemon.saved();
        let (tx, _events) = mpsc::channel(8);
        let mut restored = Daemon::new(Config::default(), tx, || {});
        assert!(restored.restore(saved));
        assert!(restored.pending_starts.is_empty());
        assert_eq!(restored.conversations.len(), 1);
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
