//! Whether a prompt was delivered: receipts, uncertainty and the durable-save barrier.

use super::*;

#[tokio::test]
async fn structured_delivery_stays_uncertain_after_provider_disconnect_and_restart() {
    let mut s = conversation_fixture("conversation-disconnect").await;
    let outcome = AssertUnwindSafe(async {
        let (id, generation) = create(&mut s).await;
        let reply = exchange(
            &mut s,
            120,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation,
                operation: 1,
                text: "Synthetic uncertain prompt".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(reply, ServerMsg::Error(_)));
        let retry = exchange(
            &mut s,
            121,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation,
                operation: 1,
                text: "Synthetic uncertain prompt".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(retry,ServerMsg::Error(ref e) if e.contains("uncertain")));
        let path = s.daemon.session_path.clone();
        let saved: crate::daemon::persist::Saved = tokio::task::spawn_blocking(move || {
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
        })
        .await
        .unwrap();
        assert_eq!(
            saved.conversation_operations[0].receipt.delivery,
            crate::conversation::Delivery::SubmissionUncertain
        );
        s.daemon.restore(saved);
        let recovered = s.daemon.conversations[0].generation;
        assert!(recovered > generation);
        let next = exchange(
            &mut s,
            122,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {
                id,
                generation: recovered,
                operation: 2,
                text: "Synthetic next prompt".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(next,ServerMsg::Error(ref e) if e.contains("uncertain")));
        let path = s.fixture.directory.path().join("requests");
        let count = tokio::task::spawn_blocking(move || {
            std::fs::read_to_string(path).unwrap().lines().count()
        })
        .await
        .unwrap();
        assert_eq!(count, 1);
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn structured_failed_ack_persistence_never_returns_an_acknowledged_retry() {
    let mut s = conversation_fixture("conversation").await;
    let outcome=AssertUnwindSafe(async {
        let (id,generation)=create(&mut s).await;
        let (client,mut replies)=mpsc::channel(8);s.daemon.handle(Ev::Connected(170,client,false, crate::protocol::Surface::Terminal, true));
        s.daemon.conversation_send(170,id,generation,1,"Synthetic ack fault".into(), Default::default()).unwrap();
        loop {
            let event=tokio::time::timeout(Duration::from_secs(20),s.events.recv()).await.unwrap().unwrap();
            let submission=matches!(&event,Ev::Conversation(Event {payload:Payload::Response {token,..},..}) if matches!(s.daemon.conversation_requests.get(token),Some(super::commands::Pending::Sending {..})));
            if submission {
                let temporary=s.daemon.session_path.with_extension("json.tmp");
                tokio::task::spawn_blocking(move||std::fs::create_dir(temporary).unwrap()).await.unwrap();
                s.daemon.handle(event);break;
            }
            s.daemon.handle(event);
        }
        assert!(matches!(drive_reply(&mut s,&mut replies).await,ServerMsg::Error(_)));
        assert_eq!(s.daemon.conversation_operations[0].receipt.delivery,crate::conversation::Delivery::SubmissionUncertain);
        let retry=exchange(&mut s,171,crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {id,generation,operation:1,text:"Synthetic ack fault".into(),choice:None }),None).await;
        assert!(matches!(retry,ServerMsg::Error(ref e) if e.contains("uncertain")));
    }).catch_unwind().await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn structured_newer_full_commit_releases_two_matching_conversation_barriers() {
    let mut s = conversation_fixture("conversation").await;
    let second = Fixture::new().await;
    let root = second.directory.path().to_path_buf();
    tokio::task::spawn_blocking(move || std::fs::write(root.join("mode"), "conversation").unwrap())
        .await
        .unwrap();
    let outcome = AssertUnwindSafe(async {
        let (first, generation) = create(&mut s).await;
        let b = &second.record.binding;
        let target =
            crate::conversation::StartTarget::Create(crate::conversation::LaunchSettings {
                agent: None,
                provider: crate::conversation::Provider::Codex,
                executable: b.executable.clone(),
                config_root: b.config_root.clone(),
                cwd: b.cwd.clone(),
                model: None,
                model_provider: None,
                approval_policy: crate::conversation::ApprovalPolicy::OnRequest,
                sandbox: crate::conversation::Sandbox::ReadOnly,
            });
        let second_id = match exchange(
            &mut s,
            190,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationStart {
                target,
                branch: None,
            }),
            None,
        )
        .await
        {
            ServerMsg::Reply(crate::protocol::Reply::ConversationStarted { id, .. }) => id,
            other => panic!("{other:?}"),
        };
        let (first_client, mut first_replies) = mpsc::channel(8);
        s.daemon.handle(Ev::Connected(191, first_client, false, crate::protocol::Surface::Terminal, true));
        let (second_client, mut second_replies) = mpsc::channel(8);
        s.daemon.handle(Ev::Connected(192, second_client, false, crate::protocol::Surface::Terminal, true));
        s.daemon
            .conversation_send(191, first, generation, 1, "Synthetic first".into(), Default::default())
            .unwrap();
        s.daemon
            .conversation_send(192, second_id, 1, 1, "Synthetic second".into(), Default::default())
            .unwrap();
        let mut saves = Vec::new();
        while saves.len() < 2 {
            let event = tokio::time::timeout(Duration::from_secs(20), s.events.recv())
                .await
                .unwrap()
                .unwrap();
            if matches!(event, Ev::SessionSaved { .. }) {
                saves.push(event);
            } else {
                s.daemon.handle(event);
            }
        }
        saves.sort_by_key(|event| match event {
            Ev::SessionSaved { ticket, .. } => std::cmp::Reverse(*ticket),
            _ => unreachable!(),
        });
        for event in saves {
            s.daemon.handle(event);
        }
        assert!(matches!(
            drive_reply(&mut s, &mut first_replies).await,
            ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))
        ));
        assert!(matches!(
            drive_reply(&mut s, &mut second_replies).await,
            ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))
        ));
        assert_eq!(s.daemon.conversation_operations.len(), 2);
        s.daemon.dispose_conversation(second_id).unwrap();
        while s.daemon.conversation_runtimes.owns(second_id) {
            let event = tokio::time::timeout(Duration::from_secs(20), s.events.recv())
                .await
                .unwrap()
                .unwrap();
            s.daemon.handle(event);
        }
    })
    .catch_unwind()
    .await;
    // Drop any second provider guard before deleting its executable after a failed assertion.
    let second_id = crate::conversation::ConversationId(2);
    if s.daemon.conversation_runtimes.owns(second_id)
        && s.daemon.dispose_conversation(second_id).is_ok()
    {
        while s.daemon.conversation_runtimes.owns(second_id) {
            let event = tokio::time::timeout(Duration::from_secs(20), s.events.recv())
                .await
                .unwrap()
                .unwrap();
            s.daemon.handle(event);
        }
    }
    let pidfile = second.directory.path().join("pids");
    if tokio::task::spawn_blocking(move || pidfile.exists())
        .await
        .unwrap()
    {
        stopped(second.pids().await).await;
    }
    s.settle_background().await;
    second.cleanup().await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
