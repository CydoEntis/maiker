//! A Claude chat session through the daemon (ADR 0003), with the scripted fake `claude`: it is
//! created, owned by the daemon, takes a message, and shows the reply in its history.

use super::*;
use crate::protocol::{ClientMsg, Command, Query, Reply};

#[tokio::test]
async fn a_claude_chat_is_created_sent_a_message_and_read_back_through_the_daemon() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let root = session.fixture.directory.path().to_path_buf();
        let (executable, config_root) = tokio::task::spawn_blocking(move || {
            (fake_claude_executable(&root), std::fs::canonicalize(&root).unwrap())
        })
        .await
        .unwrap();
        let claude = crate::conversation::LaunchSettings {
            agent: None,
            provider: crate::conversation::Provider::Claude,
            executable,
            config_root,
            cwd: session.fixture.record.binding.cwd.clone(),
            model: None,
            model_provider: None,
            // What the window always asks for.
            approval_policy: crate::conversation::ApprovalPolicy::OnRequest,
            sandbox: crate::conversation::Sandbox::WorkspaceWrite,
        };
        let started = exchange(
            &mut session,
            420,
            ClientMsg::Command(Command::ConversationStart {
                target: crate::conversation::StartTarget::Create(claude),
                branch: None,
            }),
            None,
        )
        .await;
        let ServerMsg::Reply(Reply::ConversationStarted { id, generation }) = started else {
            panic!("{started:?}");
        };
        let summaries = session.daemon.conversation_summaries();
        let summary = summaries.iter().find(|summary| summary.id == id).unwrap();
        assert_eq!(summary.provider, crate::conversation::Provider::Claude);
        assert_eq!(summary.execution, crate::conversation::ExecutionKind::Structured);
        assert_eq!(summary.native_term, None);
        let capabilities = summary.capabilities.as_ref().expect("a chat reports what its provider can do");
        assert!(capabilities.resume && !capabilities.steer);

        let sent = exchange(
            &mut session,
            421,
            ClientMsg::Command(Command::ConversationSend {
                id,
                generation,
                operation: 1,
                text: "hello fake Claude".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(sent, ServerMsg::Reply(Reply::ConversationSent(_))), "{sent:?}");

        // A send for a generation that is not current changes nothing (ADR 0006).
        let stale = exchange(
            &mut session,
            422,
            ClientMsg::Command(Command::ConversationSend {
                id,
                generation: generation + 1,
                operation: 2,
                text: "hello fake Claude".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(stale, ServerMsg::Error(ref e) if e.contains("Stale")), "{stale:?}");

        let mut texts = Vec::new();
        for attempt in 0..40_u64 {
            let read = exchange(
                &mut session,
                430 + attempt,
                ClientMsg::Query(Query::ConversationRead { id, cursor: None, limit: 128 }),
                None,
            )
            .await;
            let ServerMsg::Reply(Reply::ConversationRead(read)) = read else {
                panic!("{read:?}");
            };
            texts = read
                .history
                .entries
                .iter()
                .filter_map(|entry| match &entry.content {
                    super::history::Content::Message { text, .. } => Some(text.clone()),
                    _ => None,
                })
                .collect();
            if texts.iter().any(|text| text == "fake reply") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(texts.iter().any(|text| text == "fake reply"), "{texts:?}");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_picked_model_and_effort_start_the_next_claude_message_and_a_bad_pick_is_refused() {
    let mut session = conversation_fixture("conversation-choice").await;
    let outcome = AssertUnwindSafe(async {
        let root = session.fixture.directory.path().to_path_buf();
        let (executable, config_root) = tokio::task::spawn_blocking(move || {
            (fake_claude_executable(&root), std::fs::canonicalize(&root).unwrap())
        })
        .await
        .unwrap();
        let arguments_file = executable.with_extension("args");
        let claude = crate::conversation::LaunchSettings {
            agent: None,
            provider: crate::conversation::Provider::Claude,
            executable,
            config_root,
            cwd: session.fixture.record.binding.cwd.clone(),
            model: None,
            model_provider: None,
            approval_policy: crate::conversation::ApprovalPolicy::OnRequest,
            sandbox: crate::conversation::Sandbox::WorkspaceWrite,
        };
        let started = exchange(
            &mut session,
            520,
            ClientMsg::Command(Command::ConversationStart {
                target: crate::conversation::StartTarget::Create(claude),
                branch: None,
            }),
            None,
        )
        .await;
        let ServerMsg::Reply(Reply::ConversationStarted { id, generation }) = started else {
            panic!("{started:?}");
        };
        let send = |operation: u64, choice: crate::conversation::TurnChoice| {
            ClientMsg::Command(Command::ConversationSend {
                id,
                generation,
                operation,
                text: "hello fake Claude".into(),
                choice: Some(choice),
            })
        };

        // An option-shaped model never reaches a command line.
        let refused = exchange(
            &mut session,
            521,
            send(1, crate::conversation::TurnChoice { model: Some("--add-dir".into()), effort: None }),
            None,
        )
        .await;
        assert!(matches!(refused, ServerMsg::Error(ref e) if e.contains("model name")), "{refused:?}");

        let sent = exchange(
            &mut session,
            522,
            send(1, crate::conversation::TurnChoice { model: Some("opus".into()), effort: Some("max".into()) }),
            None,
        )
        .await;
        assert!(matches!(sent, ServerMsg::Reply(Reply::ConversationSent(_))), "{sent:?}");
        let arguments = std::fs::read_to_string(&arguments_file).unwrap();
        let arguments: Vec<&str> = arguments.lines().collect();
        assert!(arguments.windows(2).any(|pair| pair == ["--model", "opus"]), "{arguments:?}");
        assert!(arguments.windows(2).any(|pair| pair == ["--effort", "max"]), "{arguments:?}");
        assert!(arguments.windows(2).any(|pair| pair == ["--permission-mode", "default"]), "{arguments:?}");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// A fake Claude, the folders it runs in, and a session saved there as Claude Code itself would
/// have: the recorded transcript, under the name the daemon looks for.
async fn saved_claude_session(session: &mut TestSession) -> (crate::conversation::LaunchSettings, String) {
    const SAVED: &str = "00000000-0000-4000-8000-000000000001";
    let root = session.fixture.directory.path().to_path_buf();
    let cwd = session.fixture.record.binding.cwd.clone();
    let folder = cwd.clone();
    let (executable, config_root, cwd) = tokio::task::spawn_blocking(move || {
        let config_root = std::fs::canonicalize(&root).unwrap();
        // Claude names the folder from the real path it runs in, and the client may send another
        // name for it: Windows hands out short names (`RUNNER~1`), and a link does the same here.
        let folder = crate::daemon::clean_path(std::fs::canonicalize(&folder).unwrap());
        #[cfg(unix)]
        let cwd = {
            let link = root.join("project-link");
            std::os::unix::fs::symlink(&folder, &link).unwrap();
            link
        };
        let transcripts = config_root.join("projects").join(super::saved::claude_folder_name(&folder));
        std::fs::create_dir_all(&transcripts).unwrap();
        std::fs::write(
            transcripts.join(format!("{SAVED}.jsonl")),
            include_str!("../fixtures/claude_transcript.jsonl"),
        )
        .unwrap();
        (fake_claude_executable(&root), config_root, cwd)
    })
    .await
    .unwrap();
    // The transcript is under the test's folder, which stands in for the home it must be inside.
    session.daemon.followed_home = Some(config_root.clone());
    let settings = crate::conversation::LaunchSettings {
        agent: None,
        provider: crate::conversation::Provider::Claude,
        executable,
        config_root,
        cwd,
        model: None,
        model_provider: None,
        approval_policy: crate::conversation::ApprovalPolicy::OnRequest,
        sandbox: crate::conversation::Sandbox::WorkspaceWrite,
    };
    (settings, SAVED.to_owned())
}

#[tokio::test]
async fn a_saved_claude_session_opens_as_a_chat_with_its_history_and_takes_a_message() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (settings, thread_id) = saved_claude_session(&mut session).await;

        let started = exchange(
            &mut session,
            460,
            ClientMsg::Command(Command::ConversationStart {
                target: crate::conversation::StartTarget::Session { settings, thread_id },
                branch: None,
            }),
            None,
        )
        .await;

        let ServerMsg::Reply(Reply::ConversationStarted { id, generation }) = started else {
            panic!("{started:?}");
        };
        let read = exchange(
            &mut session,
            461,
            ClientMsg::Query(Query::ConversationRead { id, cursor: None, limit: 128 }),
            None,
        )
        .await;
        let ServerMsg::Reply(Reply::ConversationRead(read)) = read else {
            panic!("{read:?}");
        };
        assert!(
            read.history.entries.iter().any(|entry| matches!(
                &entry.content,
                super::history::Content::Message { text, .. } if text == "add a greeting function to the demo project"
            )),
            "{:?}",
            read.history.entries
        );
        assert_eq!(read.history.completeness, super::history::Completeness::Complete);
        let sent = exchange(
            &mut session,
            462,
            ClientMsg::Command(Command::ConversationSend {
                id,
                generation,
                operation: 1,
                // The fake echoes these words, which is how the daemon knows a send arrived.
                text: "hello fake Claude".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(sent, ServerMsg::Reply(Reply::ConversationSent(_))), "{sent:?}");
        let executable = session.daemon.conversations[0].binding.executable.clone();
        let arguments = tokio::task::spawn_blocking(move || std::fs::read_to_string(executable.with_extension("args")))
            .await
            .unwrap()
            .unwrap();
        assert!(arguments.contains("--resume=00000000-0000-4000-8000-000000000001"), "{arguments}");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_claude_session_with_no_transcript_is_refused_in_words_and_can_be_asked_for_again() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (settings, _) = saved_claude_session(&mut session).await;
        let target = crate::conversation::StartTarget::Session { settings, thread_id: "not-a-saved-session".into() };

        let refused = exchange(
            &mut session,
            470,
            ClientMsg::Command(Command::ConversationStart { target, branch: None }),
            None,
        )
        .await;

        assert!(
            matches!(refused, ServerMsg::Error(ref why) if why.contains("no saved conversation `not-a-saved-session`")),
            "{refused:?}"
        );
        assert!(session.daemon.conversations.is_empty());
        assert!(session.daemon.pending_starts.is_empty(), "nothing is left to refuse the next try");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
