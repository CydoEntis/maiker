//! The daemon resuming conversations by itself after a restart.

use super::*;

#[tokio::test]
async fn the_daemon_resumes_a_stopped_conversation_on_the_same_id_and_the_next_generation() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let id = crate::conversation::ConversationId(77);
        let mut record = s.fixture.record.clone();
        record.id = id;
        record.generation = 4;
        record.execution = crate::conversation::ExecutionKind::Structured;
        record.state = crate::conversation::RecoveryState::RecoveryRequired;
        record.settings = Some(settings(&s));
        s.daemon.conversations.push(record);
        s.daemon.cfg.restore.enabled = true;

        s.daemon
            .conversation_start(
                super::super::commands::DAEMON_REQUESTER,
                crate::conversation::StartTarget::Conversation { id, generation: 4 },
            )
            .unwrap();
        loop {
            let event = tokio::time::timeout(Duration::from_secs(10), s.events.recv())
                .await
                .unwrap()
                .unwrap();
            s.daemon.handle(event);
            if s.daemon.conversation_runtimes.owns(id) {
                break;
            }
        }
        let resumed = s.daemon.conversations.iter().find(|c| c.id == id).unwrap();
        assert_eq!(resumed.generation, 5, "one generation on, same conversation");
        assert_eq!(s.daemon.conversations.len(), 1, "no new conversation appeared");
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn the_daemon_may_resume_but_never_create_or_adopt_a_conversation() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        s.daemon.cfg.restore.enabled = true;
        let create = crate::conversation::StartTarget::Create(settings(&s));
        let error = s
            .daemon
            .conversation_start(super::commands::DAEMON_REQUESTER, create)
            .unwrap_err();
        assert!(error.to_string().contains("only resume"), "{error}");
        let adopt = crate::conversation::StartTarget::Session {
            settings: settings(&s),
            thread_id: "thread".into(),
        };
        assert!(s
            .daemon
            .conversation_start(super::commands::DAEMON_REQUESTER, adopt)
            .is_err());
        assert!(s.daemon.conversations.is_empty());
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_restart_resumes_the_conversation_that_was_running_and_only_once() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let id = crate::conversation::ConversationId(61);
        s.daemon.cfg.restore.enabled = true;
        let record = running_record(&s, 61);
        assert!(s.daemon.restore(crate::daemon::persist::Saved {
            conversations: vec![record],
            ..Default::default()
        }));
        assert_eq!(
            s.daemon.conversations[0].state,
            crate::conversation::RecoveryState::RecoveryRequired
        );

        s.daemon.resume_conversations();
        assert!(s.daemon.resumable_conversations.is_empty(), "the list is spent");
        loop {
            let event = tokio::time::timeout(Duration::from_secs(10), s.events.recv())
                .await
                .unwrap()
                .unwrap();
            s.daemon.handle(event);
            if s.daemon.conversation_runtimes.owns(id) {
                break;
            }
        }
        assert_eq!(s.daemon.conversations.len(), 1);
        assert_eq!(s.daemon.conversations[0].generation, 5, "fenced once, resumed once");
        s.daemon.resume_conversations();
        assert_eq!(s.daemon.conversations[0].generation, 5, "a second call does nothing");
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn with_the_setting_off_a_running_conversation_waits_for_a_person() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        s.daemon.cfg.restore.enabled = true;
        s.daemon.cfg.restore.conversations = false;
        let record = running_record(&s, 62);
        assert!(s.daemon.restore(crate::daemon::persist::Saved {
            conversations: vec![record],
            ..Default::default()
        }));
        s.daemon.resume_conversations();
        assert!(!s.daemon.conversation_runtimes.owns(crate::conversation::ConversationId(62)));
        assert_eq!(
            s.daemon.conversations[0].state,
            crate::conversation::RecoveryState::RecoveryRequired
        );
        assert_eq!(s.daemon.conversations[0].generation, 4, "fenced, not resumed");
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_resume_that_fails_is_reported_and_not_tried_again() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let id = crate::conversation::ConversationId(63);
        s.daemon.cfg.restore.enabled = true;
        let mut record = running_record(&s, 63);
        let broken = s.fixture.directory.path().join("not-a-provider");
        std::fs::write(&broken, "not a program").unwrap();
        record.binding.executable = broken.clone();
        record.settings.as_mut().unwrap().executable = broken;
        assert!(s.daemon.restore(crate::daemon::persist::Saved {
            conversations: vec![record],
            ..Default::default()
        }));
        s.daemon.resume_conversations();
        loop {
            let event = tokio::time::timeout(Duration::from_secs(10), s.events.recv())
                .await
                .unwrap()
                .unwrap();
            s.daemon.handle(event);
            if s.daemon.conversation_states.get(&id).is_some_and(|state| state.error.is_some()) {
                break;
            }
        }
        assert!(!s.daemon.conversation_runtimes.owns(id));
        let generation = s.daemon.conversations[0].generation;
        s.daemon.resume_conversations();
        assert_eq!(s.daemon.conversations[0].generation, generation, "no second attempt");
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_running_claude_conversation_is_taken_up_for_resume_too() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        s.daemon.cfg.restore.enabled = true;
        let mut record = running_record(&s, 64);
        record.binding.provider = crate::conversation::Provider::Claude;
        record.settings.as_mut().unwrap().provider = crate::conversation::Provider::Claude;
        assert!(s.daemon.restore(crate::daemon::persist::Saved {
            conversations: vec![record],
            ..Default::default()
        }));
        assert_eq!(s.daemon.resumable_conversations.len(), 1);
        s.daemon.resume_conversations();
        assert_eq!(
            s.daemon.conversations[0].generation, 5,
            "the start was admitted for the same conversation, one generation on"
        );
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
