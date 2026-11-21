//! Reading a conversation: history, its cache and what a failed turn reads as.

use super::*;

#[tokio::test]
async fn structured_read_preserves_failed_and_approval_checkpoint_context() {
    let mut s = conversation_fixture("conversation").await;
    let outcome=AssertUnwindSafe(async {
        let (id,_)=create(&mut s).await;
        for (offset,state) in [crate::protocol::CheckState::Failed,crate::protocol::CheckState::NeedsApproval].into_iter().enumerate() {
            let info=crate::protocol::CheckInfo {name:"verify".into(),command:"synthetic check".into(),state,first_failing_line:"Synthetic check context".into(),..Default::default()};
            let live=s.daemon.conversation_states.get_mut(&id).unwrap();live.status=crate::protocol::Status::Done;
            live.checks.points=vec![crate::daemon::check::CheckRecord::new(info.clone(),"").into()];
            let reply=exchange(&mut s,210+offset as u64,crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationRead {id,cursor:None,limit:128}),None).await;
            assert!(matches!(reply,ServerMsg::Reply(crate::protocol::Reply::ConversationRead(ref r)) if r.status==crate::protocol::Status::Blocked && r.checks==[info]));
            assert_eq!(s.daemon.conversation_summaries()[0].status,crate::protocol::Status::Blocked);
        }
    }).catch_unwind().await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn structured_provider_errors_and_failed_turns_never_read_as_done() {
    for (mode, message) in [
        ("conversation-error", "Synthetic provider failure"),
        ("conversation-failed", "Synthetic failed turn"),
        ("conversation-interrupted", "Synthetic interrupted turn"),
    ] {
        let mut s = conversation_fixture(mode).await;
        let outcome=AssertUnwindSafe(async {
            let (id,generation)=create(&mut s).await;
            let reply=exchange(&mut s,220,crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {id,generation,operation:1,text:"Synthetic failure request".into(),choice:None }),None).await;
            assert!(matches!(reply,ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))));
            while s.daemon.conversation_states[&id].error.is_none() {let event=tokio::time::timeout(Duration::from_secs(10),s.events.recv()).await.unwrap().unwrap();s.daemon.handle(event);}
            let reply=exchange(&mut s,221,crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationRead {id,cursor:None,limit:128}),None).await;
            assert!(matches!(reply,ServerMsg::Reply(crate::protocol::Reply::ConversationRead(ref r)) if r.status==crate::protocol::Status::Blocked && r.error.as_deref()==Some(message)),"{reply:?}");
            assert_eq!(s.daemon.conversation_summaries()[0].status,crate::protocol::Status::Blocked);
        }).catch_unwind().await;
        s.cleanup().await;
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }
}

#[tokio::test]
async fn structured_read_acknowledgement_waits_for_durable_receipt_barrier() {
    for fail in [false, true] {
        let mut s = conversation_fixture("conversation").await;
        let outcome=AssertUnwindSafe(async {
            let (id,generation)=create(&mut s).await;
            let (client,mut replies)=mpsc::channel(8);s.daemon.handle(Ev::Connected(250,client,false, crate::protocol::Surface::Terminal, true));
            s.daemon.conversation_send(250,id,generation,1,"Synthetic delayed ack".into(), Default::default()).unwrap();
            loop {
                let event=tokio::time::timeout(Duration::from_secs(20),s.events.recv()).await.unwrap().unwrap();
                let submitted=matches!(&event,Ev::Conversation(Event {payload:Payload::Response {token,..},..}) if matches!(s.daemon.conversation_requests.get(token),Some(super::commands::Pending::Sending {..})));
                if submitted {
                    if fail {let temporary=s.daemon.session_path.with_extension("json.tmp");tokio::task::spawn_blocking(move||std::fs::create_dir(temporary).unwrap()).await.unwrap();}
                    s.daemon.handle(event);break;
                }
                s.daemon.handle(event);
            }
            let mut deferred=Vec::new();
            let read=exchange_claim(&mut s,251,crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationRead {id,cursor:None,limit:128}),None,None,Some(&mut deferred)).await;
            assert!(matches!(read,ServerMsg::Reply(crate::protocol::Reply::ConversationRead(ref read)) if read.receipt.as_ref().is_some_and(|receipt|receipt.delivery==crate::conversation::Delivery::SubmissionUncertain)));
            for event in deferred {s.daemon.handle(event);}
            let result=drive_reply(&mut s,&mut replies).await;
            assert_eq!(matches!(result,ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))),!fail);
            let read=exchange(&mut s,252,crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationRead {id,cursor:None,limit:128}),None).await;
            assert!(matches!(read,ServerMsg::Reply(crate::protocol::Reply::ConversationRead(ref read)) if read.receipt.as_ref().is_some_and(|receipt|matches!(receipt.delivery,crate::conversation::Delivery::Acknowledged {..})!=fail)));
        }).catch_unwind().await;
        s.cleanup().await;
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }
}

/// The send is acknowledged before the provider's streamed items reach the
/// daemon, so a read right after the ack can legitimately miss them. Read until
/// the message is in the history, bounded by a deadline.
async fn wait_for_history_message(
    session: &mut TestSession,
    id: crate::conversation::ConversationId,
    wanted: &str,
) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    for client in 1000u64.. {
        let read = exchange(
            session,
            client,
            crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationRead {
                id,
                cursor: None,
                limit: 128,
            }),
            None,
        )
        .await;
        let found = matches!(read, ServerMsg::Reply(crate::protocol::Reply::ConversationRead(ref r))
            if r.history.entries.iter().any(|e| matches!(&e.content, super::super::history::Content::Message { text, .. } if text == wanted)));
        if found {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "history never contained {wanted:?}"
        );
        tokio::task::yield_now().await;
    }
}

#[tokio::test]
async fn structured_local_ipc_create_send_read_reconnect_and_exact_identity() {
    let mut s = conversation_fixture("conversation").await;
    let outcome=AssertUnwindSafe(async {
        s.daemon.initialize_conversation_cache().await.unwrap();
        let (id,generation)=create(&mut s).await;
        assert_eq!(s.daemon.conversations[0].binding.session_id,"exact-thread");
        let sent=exchange(&mut s,101,crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend { id,generation,operation:1,text:"Synthetic prompt".into(),choice:None }),None).await;
        assert!(matches!(sent,ServerMsg::Reply(crate::protocol::Reply::ConversationSent(crate::conversation::Receipt { delivery:crate::conversation::Delivery::Acknowledged {..},.. }))));
        wait_for_history_message(&mut s,id,"Synthetic stream complete").await;
        let retry=exchange(&mut s,103,crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend { id,generation,operation:1,text:"Synthetic prompt".into(),choice:None }),None).await;
        assert!(matches!(retry,ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))));
        let root=s.fixture.directory.path().to_owned();
        let (log,saved)=tokio::task::spawn_blocking(move||(std::fs::read_to_string(root.join("requests")).unwrap(),std::fs::read_to_string(root.join("data/session.json")).unwrap())).await.unwrap();
        assert_eq!(log.lines().count(),1);
        assert!(!saved.contains("Synthetic prompt"));
        assert!(saved.contains("turn-1"));
        let stale=exchange(&mut s,104,crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend { id,generation:generation+1,operation:2,text:"Synthetic stale".into(),choice:None }),None).await;
        assert!(matches!(stale,ServerMsg::Error(ref e) if e.contains("Stale")));
    }).catch_unwind().await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn startup_survives_an_unreadable_history_cache_and_keeps_its_files() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        s.daemon.initialize_conversation_cache().await.unwrap();
        let record = s.fixture.record.clone();
        let root = s.daemon.session_path.with_extension("history");
        let dir = root.join(record.id.0.to_string());
        let written = dir.clone();
        tokio::task::spawn_blocking(move || {
            std::fs::create_dir_all(&written).unwrap();
            std::fs::write(written.join("manifest.json"), b"{ not a manifest").unwrap();
        })
        .await
        .unwrap();
        s.daemon.conversations.push(record.clone());
        s.daemon.initialize_conversation_cache().await.unwrap();
        assert!(!s.daemon.conversation_histories.contains_key(&record.id));
        let aside = root.join(format!("{}.bad-1", record.id.0));
        assert!(aside.join("manifest.json").exists());
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn structured_local_ipc_missing_exact_thread_never_creates_fallback() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let target = crate::conversation::StartTarget::Session {
            settings: settings(&s),
            thread_id: "missing-thread".into(),
        };
        let reply = exchange(
            &mut s,
            110,
            crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationStart {
                target,
                branch: None,
            }),
            None,
        )
        .await;
        assert!(matches!(reply, ServerMsg::Error(_)));
        assert!(s.daemon.conversations.is_empty());
        assert_eq!(s.daemon.pending_starts.len(), 1);
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn structured_output_false_reads_native_memory_without_a_detached_cache() {
    let mut s = conversation_fixture("conversation").await;
    let outcome=AssertUnwindSafe(async {
        s.daemon.cfg.restore.output=false;
        s.daemon.initialize_conversation_cache().await.unwrap();
        let (id,generation)=create(&mut s).await;
        let sent=exchange(&mut s,180,crate::protocol::ClientMsg::Command(crate::protocol::Command::ConversationSend {id,generation,operation:1,text:"Synthetic private prompt".into(),choice:None }),None).await;
        assert!(matches!(sent,ServerMsg::Reply(crate::protocol::Reply::ConversationSent(_))));
        let read=exchange(&mut s,181,crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationRead {id,cursor:None,limit:128}),None).await;
        assert!(matches!(read,ServerMsg::Reply(crate::protocol::Reply::ConversationRead(ref r)) if !r.history.entries.is_empty()));
        assert!(s.daemon.conversation_histories.is_empty());
        assert!(s.daemon.conversation_history.get(181).is_none());
        let path=s.daemon.session_path.with_extension("history");
        assert!(!tokio::task::spawn_blocking(move||path.exists()).await.unwrap());
    }).catch_unwind().await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn history_projection_accepts_only_current_owned_events_and_drops_disconnected_content() {
    with_fixture(move |session| {
        Box::pin(async move {
            let TestSession { fixture: f, daemon: d, events: rx } = session;
            d.start_conversation(f.launch("normal")).unwrap();
            let ready = next(rx).await;
            let owner = ready.owner;
            d.handle(Ev::Conversation(ready));
            d.handle(Ev::Conversation(next(rx).await));
            d.conversation_history.attach(901, f.record.id);
            let params = json!({"threadId":f.record.binding.session_id,"turnId":"synthetic-turn","item":{"id":"synthetic-item","type":"agentMessage","text":"synthetic response"}});
            let mut stale = owner; stale.generation -= 1;
            d.handle(Ev::Conversation(Event { owner: stale, payload: Payload::Notification { method: "item/completed".into(), params: params.clone() } }));
            assert!(d.conversation_history.get(901).unwrap().entries.is_empty());
            for _ in 0..2 {
                d.handle(Ev::Conversation(Event { owner, payload: Payload::Notification { method: "item/completed".into(), params: params.clone() } }));
            }
            assert_eq!(d.conversation_history.get(901).unwrap().entries.len(), 1);
            d.handle(Ev::Disconnected(901));
            assert!(d.conversation_history.get(901).is_none());
            d.dispose_conversation(f.record.id).unwrap();
            d.handle(Ev::Conversation(next(rx).await));
            stopped(f.pids().await).await;
        })
    }).await;
}
