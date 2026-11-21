//! Answering a provider's requests: commands, file changes, permissions and user input.

use super::*;

#[tokio::test]
async fn command_approval_is_human_only_generation_bound_and_uses_exact_provider_id() {
    let mut session = conversation_fixture("conversation-approval").await;
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut session).await;
        let sent = exchange(
            &mut session,
            300,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation,
                operation: 1,
                text: "Synthetic approval prompt".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(sent, ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))));

        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].approvals.is_empty() {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("Codex approval request reached the daemon");

        let request_id = crate::conversation::ProviderRequestId::Text("approval-private".into());
        let approval = session.daemon.conversation_states[&id].approvals[&request_id].clone();
        assert_eq!(approval.command.as_deref(), Some("echo synthetic\\u{200b}"));
        assert_eq!(
            approval.choices,
            [
                crate::conversation::ApprovalDecision::Accept,
                crate::conversation::ApprovalDecision::Decline,
            ]
        );
        assert_eq!(serde_json::to_value(&approval.request_id).unwrap(), "approval-private");
        let read = exchange(
            &mut session,
            305,
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
                if result.approvals == [approval.clone()]
        ));

        let unauthorized_from = authenticated_pane(&mut session);
        let unauthorized = exchange(
            &mut session,
            301,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationApprove {
                    id,
                    generation,
                    request_id: request_id.clone(),
                    decision: crate::conversation::ApprovalDecision::Accept,
                },
            ),
            Some(unauthorized_from),
        )
        .await;
        assert!(matches!(unauthorized, ServerMsg::Error(ref message) if message.contains("Only a human")));

        let unavailable = exchange(
            &mut session,
            302,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationApprove {
                    id,
                    generation,
                    request_id: request_id.clone(),
                    decision: crate::conversation::ApprovalDecision::AcceptForSession,
                },
            ),
            None,
        )
        .await;
        assert!(matches!(unavailable, ServerMsg::Error(ref message) if message.contains("not available")));

        let wrong_request_id = exchange(
            &mut session,
            306,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationApprove {
                    id,
                    generation,
                    request_id: crate::conversation::ProviderRequestId::Text("another-request".into()),
                    decision: crate::conversation::ApprovalDecision::Accept,
                },
            ),
            None,
        )
        .await;
        assert!(matches!(wrong_request_id, ServerMsg::Error(ref message) if message.contains("already answered")));

        let stale = exchange(
            &mut session,
            303,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationApprove {
                    id,
                    generation: generation + 1,
                    request_id: request_id.clone(),
                    decision: crate::conversation::ApprovalDecision::Accept,
                },
            ),
            None,
        )
        .await;
        assert!(matches!(stale, ServerMsg::Error(ref message) if message.contains("stale or stopped")));

        let resolved = exchange(
            &mut session,
            304,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationApprove {
                    id,
                    generation,
                    request_id: request_id.clone(),
                    decision: crate::conversation::ApprovalDecision::Accept,
                },
            ),
            None,
        )
        .await;
        assert!(matches!(resolved, ServerMsg::Reply(crate::protocol::Reply::Ok)));

        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].status != crate::protocol::Status::Done {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("provider completed after its approval response");

        let response = tokio::fs::read_to_string(session.fixture.directory.path().join("responses"))
            .await
            .unwrap();
        let response: Value = serde_json::from_str(response.trim()).unwrap();
        assert_eq!(response["id"], "approval-private");
        assert_eq!(response["result"]["decision"], "accept");
        assert!(session.daemon.conversation_states[&id].approvals.is_empty());

        // The answer outlives the request: a viewer that restarts still reads what was decided.
        let reread = exchange(
            &mut session,
            307,
            crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationRead {
                id,
                cursor: None,
                limit: 128,
            }),
            None,
        )
        .await;
        let ServerMsg::Reply(crate::protocol::Reply::ConversationRead(result)) = reread else {
            panic!("expected a conversation read");
        };
        assert!(result.approvals.is_empty());
        let [answered] = result.answered_approvals.as_slice() else {
            panic!("exactly one answered approval is kept");
        };
        assert_eq!(answered.request, approval);
        assert_eq!(answered.decision, crate::conversation::ApprovalDecision::Accept);
        assert!(answered.answered_at_ms.is_some());
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn an_approved_command_is_remembered_for_the_project_and_nothing_else_is() {
    use crate::conversation::ProviderRequestId;
    let mut session = conversation_fixture("conversation-approval").await;
    let outcome = AssertUnwindSafe(async {
        // Never the real data folder.
        let file = session.fixture.directory.path().join("chat-allowed-commands.json");
        session.daemon.chat_allowed_file = file.clone();
        let (id, generation) = create(&mut session).await;
        let send = |operation: u64| crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
            id,
            generation,
            operation,
            text: "Synthetic approval prompt".into(),
            choice: None,
        });
        assert!(matches!(exchange(&mut session, 400, send(1), None).await, ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))));
        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].approvals.is_empty() {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("the request reached the daemon");
        let request_id = ProviderRequestId::Text("approval-private".into());
        assert!(session.daemon.conversation_states[&id].approvals[&request_id].can_remember);
        let always = |request_id: &ProviderRequestId| crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationAllowAlways {
            id,
            generation,
            request_id: request_id.clone(),
        });

        // An agent cannot approve for itself, and nothing is remembered by the try.
        let from = authenticated_pane(&mut session);
        let refused = exchange(&mut session, 401, always(&request_id), Some(from)).await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("Only a human")), "{refused:?}");
        assert!(session.daemon.chat_allowed.rules.is_empty());
        assert!(!session.daemon.conversation_states[&id].approvals.is_empty());

        // A request that is not there is not remembered either.
        let stale = exchange(&mut session, 402, always(&ProviderRequestId::Text("another".into())), None).await;
        assert!(matches!(stale, ServerMsg::Error(ref message) if message.contains("already answered")), "{stale:?}");

        let done = exchange(&mut session, 403, always(&request_id), None).await;
        assert!(matches!(done, ServerMsg::Reply(crate::protocol::Reply::Ok)), "{done:?}");
        let [rule] = session.daemon.chat_allowed.rules.as_slice() else {
            panic!("one rule is kept");
        };
        assert!(rule.command.starts_with("echo synthetic"));
        assert_eq!(rule.command_sha256, crate::protocol::command_hash("echo synthetic\u{200b}"));
        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].status != crate::protocol::Status::Done {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("the first turn finished");
        let response = tokio::fs::read_to_string(session.fixture.directory.path().join("responses")).await.unwrap();
        let response: Value = serde_json::from_str(response.lines().next().unwrap()).unwrap();
        assert_eq!(response["result"]["decision"], "accept", "remembered, but this one is a plain accept");

        // The same command in the same project is answered without asking.
        assert!(matches!(exchange(&mut session, 404, send(2), None).await, ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))));
        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].answered_approvals.len() < 2 {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("the second request was answered by the daemon");
        assert!(session.daemon.conversation_states[&id].approvals.is_empty());
        assert!(session.daemon.conversation_states[&id].command_hashes.is_empty());

        // A rule for another project does not apply here.
        session.daemon.chat_allowed.rules[0].project = std::path::PathBuf::from("/somewhere/else");
        assert!(!session.daemon.chat_allowed.allows_hash(
            &session.daemon.conversation_project(id).unwrap(),
            &session.daemon.chat_allowed.rules[0].command_sha256.clone(),
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
async fn approved_commands_are_listed_and_taken_back_by_a_person_only() {
    let mut session = conversation_fixture("conversation-approval").await;
    let outcome = AssertUnwindSafe(async {
        let file = session.fixture.directory.path().join("chat-allowed-commands.json");
        session.daemon.chat_allowed_file = file.clone();
        let rule = super::super::allowed::Rule {
            project: std::path::PathBuf::from("/code/app"),
            command_sha256: crate::protocol::command_hash("cargo test"),
            command: "cargo test".into(),
            at: 5,
        };
        // Another daemon wrote it: the list reads the file as it is now.
        super::super::allowed::remember(&file, rule.clone()).unwrap();
        let list = crate::protocol::ClientMsg::Query(crate::protocol::Query::AllowedCommands);
        let from = authenticated_pane(&mut session);
        let refused = exchange(&mut session, 430, list.clone(), Some(from)).await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("Only a human")), "{refused:?}");
        let ServerMsg::Reply(crate::protocol::Reply::AllowedCommands(listed)) = exchange(&mut session, 431, list.clone(), None).await else {
            panic!("expected the approved commands");
        };
        assert_eq!(listed.len(), 1);
        assert_eq!((listed[0].command.as_str(), listed[0].at), ("cargo test", 5));

        let forget = crate::protocol::ClientMsg::Command(crate::protocol::Command::ForgetAllowedCommand {
            project: rule.project.clone(),
            command_sha256: rule.command_sha256.clone(),
        });
        let from = authenticated_pane(&mut session);
        let refused = exchange(&mut session, 432, forget.clone(), Some(from)).await;
        assert!(matches!(refused, ServerMsg::Error(_)), "{refused:?}");
        assert_eq!(session.daemon.chat_allowed.rules.len(), 1, "a pane cannot take it back either");
        let done = exchange(&mut session, 433, forget, None).await;
        assert!(matches!(done, ServerMsg::Reply(crate::protocol::Reply::Ok)), "{done:?}");
        assert!(session.daemon.chat_allowed.rules.is_empty(), "asks again from now on");
        // The file follows, off the loop.
        tokio::time::timeout(Duration::from_secs(5), async {
            while !super::super::allowed::Allowed::load(&file).unwrap().rules.is_empty() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("the file forgot it too");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_file_change_request_cannot_be_remembered() {
    let mut session = conversation_fixture("conversation-file-approval").await;
    let outcome = AssertUnwindSafe(async {
        session.daemon.chat_allowed_file = session.fixture.directory.path().join("chat-allowed-commands.json");
        let (id, generation) = create(&mut session).await;
        let sent = exchange(
            &mut session,
            410,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend { id, generation, operation: 1, text: "Synthetic file change request".into(), choice: None }),
            None,
        )
        .await;
        assert!(matches!(sent, ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))));
        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].approvals.is_empty() {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("the request reached the daemon");
        let request_id = crate::conversation::ProviderRequestId::Text("file-approval-private".into());
        assert!(!session.daemon.conversation_states[&id].approvals[&request_id].can_remember);
        let refused = exchange(
            &mut session,
            411,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationAllowAlways { id, generation, request_id }),
            None,
        )
        .await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("Only a command request")), "{refused:?}");
        assert!(session.daemon.chat_allowed.rules.is_empty());
        assert!(!session.daemon.conversation_states[&id].approvals.is_empty(), "left for the person to answer");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn file_change_approval_is_human_only_and_uses_exact_provider_id() {
    let mut session = conversation_fixture("conversation-file-approval").await;
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut session).await;
        let sent = exchange(
            &mut session,
            310,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation,
                operation: 1,
                text: "Synthetic file change request".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(
            sent,
            ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))
        ));

        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].approvals.is_empty() {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("Codex file-change request reached the daemon");

        let request_id =
            crate::conversation::ProviderRequestId::Text("file-approval-private".into());
        let approval = session.daemon.conversation_states[&id].approvals[&request_id].clone();
        assert_eq!(
            approval.kind,
            crate::conversation::ApprovalRequestKind::FileChange
        );
        assert_eq!(approval.reason.as_deref(), Some("Synthetic file change"));
        assert_eq!(approval.changes.len(), 1);
        assert_eq!(approval.changes[0].path, "src/synthetic.rs");
        assert_eq!(approval.changes[0].diff, "@@ -1 +1 @@\n-old\n+new\n");
        assert_eq!(
            approval.cwd.as_deref(),
            Some(std::path::Path::new("C:/synthetic/project"))
        );
        assert_eq!(
            approval.choices,
            [
                crate::conversation::ApprovalDecision::Accept,
                crate::conversation::ApprovalDecision::Decline,
            ]
        );

        let response = exchange(
            &mut session,
            311,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationApprove {
                id,
                generation,
                request_id,
                decision: crate::conversation::ApprovalDecision::Accept,
            }),
            None,
        )
        .await;
        assert!(matches!(
            response,
            ServerMsg::Reply(crate::protocol::Reply::Ok)
        ));

        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].status != crate::protocol::Status::Done {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("Codex completed after receiving the file-change decision");

        let response =
            tokio::fs::read_to_string(session.fixture.directory.path().join("responses"))
                .await
                .unwrap();
        let response: Value = serde_json::from_str(response.trim()).unwrap();
        assert_eq!(response["id"], "file-approval-private");
        assert_eq!(response["result"]["decision"], "accept");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_file_change_approval_for_a_secret_file_keeps_the_path_and_omits_the_diff() {
    let mut session = conversation_fixture("conversation-file-approval-secret").await;
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut session).await;
        let sent = exchange(
            &mut session,
            320,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation,
                operation: 1,
                text: "Synthetic secret file request".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(
            sent,
            ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))
        ));
        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].approvals.is_empty() {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("the file-change request reached the daemon");

        let request_id =
            crate::conversation::ProviderRequestId::Text("file-approval-private".into());
        let approval = session.daemon.conversation_states[&id].approvals[&request_id].clone();
        assert_eq!(approval.changes.len(), 1);
        assert_eq!(approval.changes[0].path, "app/.env");
        assert_eq!(approval.changes[0].kind, "add");
        assert_eq!(approval.changes[0].diff, super::super::redact::OMITTED);
        assert_eq!(
            approval.reason.as_deref(),
            Some("Write the token [redacted] to .env")
        );
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn file_change_approval_is_disabled_until_the_exact_diff_arrives() {
    let mut session = conversation_fixture("conversation-file-approval-no-patch").await;
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut session).await;
        let sent = exchange(
            &mut session,
            312,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation,
                operation: 1,
                text: "Synthetic file change without patch".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(sent, ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))));
        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].approvals.is_empty() {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("file-change request reached the daemon");

        let request_id = crate::conversation::ProviderRequestId::Text("file-approval-private".into());
        let approval = &session.daemon.conversation_states[&id].approvals[&request_id];
        assert!(approval.changes.is_empty());
        assert!(approval.choices.is_empty());
        let unavailable = exchange(
            &mut session,
            313,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationApprove {
                    id,
                    generation,
                    request_id,
                    decision: crate::conversation::ApprovalDecision::Accept,
                },
            ),
            None,
        )
        .await;
        assert!(matches!(unavailable, ServerMsg::Error(ref message) if message.contains("not available")));
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_partial_malformed_file_diff_never_enables_approval() {
    let mut session = conversation_fixture("conversation-file-approval-malformed").await;
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut session).await;
        let sent = exchange(
            &mut session,
            320,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation,
                operation: 1,
                text: "Synthetic malformed file diff".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(
            sent,
            ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))
        ));
        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].approvals.is_empty() {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("file-change request reached the daemon");

        let approval = session.daemon.conversation_states[&id]
            .approvals
            .values()
            .next()
            .unwrap();
        assert!(approval.changes.is_empty());
        assert!(approval.choices.is_empty());
        assert!(
            session.daemon.conversation_states[&id]
                .error
                .as_deref()
                .is_some_and(|error| error.contains("incomplete file-change diff"))
        );
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn permission_approval_grants_only_the_requested_profile_for_the_turn() {
    let mut session = conversation_fixture("conversation-permission-approval").await;
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut session).await;
        let sent = exchange(
            &mut session,
            318,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation,
                operation: 1,
                text: "Synthetic permission request".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(sent, ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))));

        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].approvals.is_empty() {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("Codex permission request reached the daemon");

        let request_id = crate::conversation::ProviderRequestId::Text(
            "permission-approval-private".into(),
        );
        let approval = session.daemon.conversation_states[&id].approvals[&request_id].clone();
        let requested = json!({
            "network": {"enabled": true},
            "fileSystem": {"write": ["C:/synthetic/project/output"]},
        });
        assert_eq!(approval.kind, crate::conversation::ApprovalRequestKind::Permission);
        assert_eq!(approval.permissions, Some(requested.clone()));
        assert_eq!(approval.cwd.as_deref(), Some(Path::new("C:/synthetic/project")));
        assert_eq!(
            approval.choices,
            [
                crate::conversation::ApprovalDecision::Decline,
                crate::conversation::ApprovalDecision::Accept,
            ]
        );

        let pane = authenticated_pane(&mut session);
        let unauthorized = exchange(
            &mut session,
            319,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationApprove {
                id,
                generation,
                request_id: request_id.clone(),
                decision: crate::conversation::ApprovalDecision::Accept,
            }),
            Some(pane),
        )
        .await;
        assert!(matches!(unauthorized, ServerMsg::Error(ref message) if message.contains("Only a human")));

        let session_scope = exchange(
            &mut session,
            320,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationApprove {
                id,
                generation,
                request_id: request_id.clone(),
                decision: crate::conversation::ApprovalDecision::AcceptForSession,
            }),
            None,
        )
        .await;
        assert!(matches!(session_scope, ServerMsg::Error(ref message) if message.contains("not available")));

        let accepted = exchange(
            &mut session,
            321,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationApprove {
                id,
                generation,
                request_id,
                decision: crate::conversation::ApprovalDecision::Accept,
            }),
            None,
        )
        .await;
        assert!(matches!(accepted, ServerMsg::Reply(crate::protocol::Reply::Ok)));
        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].status != crate::protocol::Status::Done {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("provider completed after its permission response");

        let response = tokio::fs::read_to_string(session.fixture.directory.path().join("responses"))
            .await
            .unwrap();
        let response: Value = serde_json::from_str(response.trim()).unwrap();
        assert_eq!(response["id"], "permission-approval-private");
        assert_eq!(response["result"]["permissions"], requested);
        assert_eq!(response["result"]["scope"], "turn");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn user_input_requests_use_exact_ids_and_validated_ephemeral_answers() {
    let mut session = conversation_fixture("conversation-user-input").await;
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut session).await;
        let sent = exchange(
            &mut session,
            314,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation,
                operation: 1,
                text: "Synthetic input request".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(sent, ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))));
        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].approvals.is_empty() {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("Codex input request reached the daemon");

        let request_id = crate::conversation::ProviderRequestId::Text("user-input-private".into());
        let approval = &session.daemon.conversation_states[&id].approvals[&request_id];
        assert_eq!(approval.kind, crate::conversation::ApprovalRequestKind::UserInput);
        assert_eq!(approval.questions.len(), 2);
        assert!(approval.questions[0].is_other);
        assert!(approval.questions[1].is_secret);
        assert_eq!(approval.questions[0].options[0].label, "A");

        let answers = std::collections::BTreeMap::from([
            ("choice".to_owned(), vec!["A".to_owned(), "user_note: details".to_owned()]),
            ("secret".to_owned(), vec!["private answer".to_owned()]),
        ]);
        let pane = authenticated_pane(&mut session);
        let unauthorized = exchange(
            &mut session,
            315,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationAnswerInput {
                    id,
                    generation,
                    request_id: request_id.clone(),
                    answers: answers.clone(),
                },
            ),
            Some(pane),
        )
        .await;
        assert!(matches!(unauthorized, ServerMsg::Error(ref message) if message.contains("Only a human")));

        let incomplete = exchange(
            &mut session,
            316,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationAnswerInput {
                    id,
                    generation,
                    request_id: request_id.clone(),
                    answers: std::collections::BTreeMap::new(),
                },
            ),
            None,
        )
        .await;
        assert!(matches!(incomplete, ServerMsg::Error(ref message) if message.contains("Answer every")));

        let invalid_option = std::collections::BTreeMap::from([
            ("choice".to_owned(), vec!["not-offered".to_owned()]),
            ("secret".to_owned(), vec!["private answer".to_owned()]),
        ]);
        let invalid = exchange(
            &mut session,
            317,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationAnswerInput {
                    id,
                    generation,
                    request_id: request_id.clone(),
                    answers: invalid_option,
                },
            ),
            None,
        )
        .await;
        assert!(matches!(invalid, ServerMsg::Error(ref message) if message.contains("available choices")));

        let hidden = std::collections::BTreeMap::from([
            ("choice".to_owned(), vec!["A".to_owned()]),
            ("secret".to_owned(), vec!["hidden\u{200b}text".to_owned()]),
        ]);
        let refused = exchange(
            &mut session,
            318,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationAnswerInput {
                    id,
                    generation,
                    request_id: request_id.clone(),
                    answers: hidden,
                },
            ),
            None,
        )
        .await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("hidden characters")));

        let answered = exchange(
            &mut session,
            319,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationAnswerInput {
                    id,
                    generation,
                    request_id,
                    answers,
                },
            ),
            None,
        )
        .await;
        assert!(matches!(answered, ServerMsg::Reply(crate::protocol::Reply::Ok)));
        tokio::time::timeout(Duration::from_secs(10), async {
            while session.daemon.conversation_states[&id].status != crate::protocol::Status::Done {
                session.daemon.handle(session.events.recv().await.unwrap());
            }
        })
        .await
        .expect("Codex completed after receiving its user answers");

        let response = tokio::fs::read_to_string(session.fixture.directory.path().join("responses"))
            .await
            .unwrap();
        let response: Value = serde_json::from_str(response.trim()).unwrap();
        assert_eq!(response["id"], "user-input-private");
        assert_eq!(response["result"]["answers"]["choice"]["answers"][0], "A");
        assert_eq!(response["result"]["answers"]["choice"]["answers"][1], "user_note: details");
        assert_eq!(response["result"]["answers"]["secret"]["answers"][0], "private answer");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn structured_unknown_provider_request_remains_blocked_and_unanswered() {
    let mut s = conversation_fixture("conversation-blocked").await;
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut s).await;
        let sent = exchange(
            &mut s,
            130,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation,
                operation: 1,
                text: "Synthetic question".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(
            sent,
            ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))
        ));
        while !s
            .daemon
            .conversation_states
            .get(&id)
            .is_some_and(|s| s.blocked)
        {
            let event = tokio::time::timeout(Duration::from_secs(10), s.events.recv())
                .await
                .unwrap()
                .unwrap();
            s.daemon.handle(event);
        }
        assert_eq!(
            s.daemon.conversation_summaries()[0].status,
            crate::protocol::Status::Blocked
        );
        let next = exchange(
            &mut s,
            131,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation,
                operation: 2,
                text: "Synthetic blocked followup".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(next,ServerMsg::Error(ref e) if e.contains("blocked")));
        assert!(s.daemon.conversation_runtimes.owns(id));
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
