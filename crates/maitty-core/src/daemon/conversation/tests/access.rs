//! Who may ask for what: a person, a pane, a claimed runtime.

use super::*;

#[tokio::test]
async fn conversation_diff_query_reads_only_the_current_conversation_checkout() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let cwd = session.fixture.record.binding.cwd.clone();
        tokio::task::spawn_blocking(move || {
            let run = |args: &[&str]| {
                let output = std::process::Command::new("git")
                    .arg("-C")
                    .arg(&cwd)
                    .args(args)
                    .output()
                    .unwrap();
                assert!(
                    output.status.success(),
                    "{}",
                    String::from_utf8_lossy(&output.stderr)
                );
            };
            run(&["init", "--quiet"]);
            run(&["config", "user.name", "Test User"]);
            run(&["config", "user.email", "test@example.invalid"]);
            std::fs::write(cwd.join("tracked.rs"), "before\n").unwrap();
            run(&["add", "tracked.rs"]);
            run(&["commit", "--quiet", "-m", "baseline"]);
            std::fs::write(cwd.join("tracked.rs"), "after\n").unwrap();
            std::fs::write(cwd.join("new.rs"), "new\n").unwrap();
        })
        .await
        .unwrap();

        let (id, generation) = create(&mut session).await;
        let result = exchange(
            &mut session,
            322,
            crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationDiff {
                id,
                generation,
            }),
            None,
        )
        .await;
        let ServerMsg::Reply(crate::protocol::Reply::ConversationDiff(diff)) = result else {
            panic!("expected conversation diff, got {result:?}");
        };
        assert_eq!(diff.total_files, 2, "{diff:?}");
        assert!(diff.files.iter().any(|file| file.path == "tracked.rs"));
        assert!(diff.files.iter().any(|file| file.path == "new.rs"));

        let stale = exchange(
            &mut session,
            323,
            crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationDiff {
                id,
                generation: generation + 1,
            }),
            None,
        )
        .await;
        assert!(matches!(stale, ServerMsg::Error(ref message) if message.contains("stale")));
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn native_terminal_access_is_bound_to_the_current_conversation() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let id = crate::conversation::ConversationId(47);
        let generation = 3;
        let mut conversation = session.fixture.record.clone();
        conversation.id = id;
        conversation.generation = generation;
        conversation.execution = crate::conversation::ExecutionKind::Native;
        conversation.state = crate::conversation::RecoveryState::Running;
        session.daemon.conversations.push(conversation);
        let (term, token) = authenticated_pane(&mut session);
        session.daemon.terms.get_mut(&term).unwrap().conversation_id = Some(id);

        let screen = exchange(
            &mut session,
            324,
            crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationTerminalScreen {
                id,
                generation,
            }),
            None,
        )
        .await;
        assert!(matches!(screen, ServerMsg::Reply(crate::protocol::Reply::Text(ref ansi)) if ansi.starts_with("\x1b[0m\x1b[2J\x1b[H")));

        let replay = exchange(
            &mut session,
            332,
            crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationTerminalReplay {
                id,
                generation,
            }),
            None,
        )
        .await;
        assert!(matches!(replay, ServerMsg::Reply(crate::protocol::Reply::TerminalReplay(ref bytes)) if !bytes.is_empty()));

        let input = exchange(
            &mut session,
            325,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationTerminalInput {
                    id,
                    generation,
                    data: b"x".to_vec(),
                },
            ),
            None,
        )
        .await;
        assert!(matches!(
            input,
            ServerMsg::Reply(crate::protocol::Reply::Ok)
        ));

        let resize = exchange(
            &mut session,
            328,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationTerminalResize {
                    id,
                    generation,
                    cols: 96,
                    rows: 32,
                },
            ),
            None,
        )
        .await;
        assert!(matches!(resize, ServerMsg::Reply(crate::protocol::Reply::Ok)));
        assert_eq!((session.daemon.terms[&term].cols, session.daemon.terms[&term].rows), (96, 32));

        let oversized = exchange(
            &mut session,
            329,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationTerminalResize {
                    id,
                    generation,
                    cols: 501,
                    rows: 32,
                },
            ),
            None,
        )
        .await;
        assert!(matches!(oversized, ServerMsg::Error(ref error) if error.contains("terminal size")));

        let stale = exchange(
            &mut session,
            326,
            crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationTerminalScreen {
                id,
                generation: generation + 1,
            }),
            None,
        )
        .await;
        assert!(matches!(stale, ServerMsg::Error(ref error) if error.contains("stale")));

        let pane_input = exchange(
            &mut session,
            330,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationTerminalInput {
                    id,
                    generation,
                    data: b"x".to_vec(),
                },
            ),
            Some((term, token.clone())),
        )
        .await;
        assert!(
            matches!(pane_input, ServerMsg::Error(ref error) if error.contains("human client"))
        );

        let pane_resize = exchange(
            &mut session,
            331,
            crate::protocol::ClientMsg::Command(
                crate::protocol::Command::ConversationTerminalResize {
                    id,
                    generation,
                    cols: 80,
                    rows: 24,
                },
            ),
            Some((term, token.clone())),
        )
        .await;
        assert!(matches!(pane_resize, ServerMsg::Error(ref error) if error.contains("human client")));

        let pane_replay = exchange(
            &mut session,
            333,
            crate::protocol::ClientMsg::Query(crate::protocol::Query::ConversationTerminalReplay {
                id,
                generation,
            }),
            Some((term, token)),
        )
        .await;
        assert!(matches!(pane_replay, ServerMsg::Error(ref error) if error.contains("human client")));
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn saved_conversations_are_listed_for_a_person_only_and_off_the_loop() {
    let mut session = conversation_fixture("conversation-saved-list").await;
    let outcome = AssertUnwindSafe(async {
        let ask = |agent: &str, folder: &str| {
            crate::protocol::ClientMsg::Query(crate::protocol::Query::SavedConversations {
                agent: agent.into(),
                folder: folder.into(),
                tag: 6,
            })
        };
        let from = authenticated_pane(&mut session);
        let refused = exchange(&mut session, 440, ask("gemini", "~"), Some(from)).await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("Only a human")), "{refused:?}");
        let relative = exchange(&mut session, 441, ask("claude", "code/app"), None).await;
        assert!(matches!(relative, ServerMsg::Error(_)), "{relative:?}");
        let answered = exchange(&mut session, 442, ask("gemini", "~"), None).await;
        assert!(
            matches!(
                answered,
                ServerMsg::Reply(crate::protocol::Reply::SavedConversations {
                    tag: 6,
                    found: crate::protocol::SavedConversations::NotSupported,
                })
            ),
            "{answered:?}"
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
async fn a_side_answer_is_for_a_person_and_a_claude_conversation_the_daemon_knows() {
    let mut session = conversation_fixture("conversation-side-answer").await;
    let outcome = AssertUnwindSafe(async {
        use crate::protocol::{Query, Reply, SideAnswer, SideAsk, SideCommand};
        let codex = session.fixture.record.clone();
        let mut unnamed = codex.clone();
        unnamed.id = crate::conversation::ConversationId(codex.id.0 + 1);
        unnamed.binding.provider = crate::conversation::Provider::Claude;
        unnamed.binding.session_id = "not-a-session".into();
        session.daemon.conversations.push(codex.clone());
        session.daemon.conversations.push(unnamed.clone());
        let ask = |id, ask| crate::protocol::ClientMsg::Query(Query::SideAnswer { id, ask, tag: 9 });
        let context = || SideAsk::Command(SideCommand::Context);

        let from = authenticated_pane(&mut session);
        let refused = exchange(&mut session, 450, ask(codex.id, context()), Some(from)).await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("Only a human")), "{refused:?}");

        let missing = exchange(&mut session, 451, ask(crate::conversation::ConversationId(9_999), context()), None).await;
        assert!(matches!(missing, ServerMsg::Reply(Reply::SideAnswer { tag: 9, answer: SideAnswer::Failed { ref reason } }) if reason == "No such conversation"), "{missing:?}");

        let other_agent = exchange(&mut session, 452, ask(codex.id, context()), None).await;
        assert!(matches!(other_agent, ServerMsg::Reply(Reply::SideAnswer { answer: SideAnswer::NotSupported, .. })), "{other_agent:?}");

        // A session id that is not Claude's own shape never reaches an argument list.
        let not_named = exchange(&mut session, 453, ask(unnamed.id, context()), None).await;
        assert!(matches!(not_named, ServerMsg::Reply(Reply::SideAnswer { answer: SideAnswer::Failed { ref reason }, .. }) if reason.contains("not named")), "{not_named:?}");

        let empty = exchange(&mut session, 454, ask(unnamed.id, SideAsk::Question("  ".into())), None).await;
        assert!(matches!(empty, ServerMsg::Reply(Reply::SideAnswer { answer: SideAnswer::Failed { ref reason }, .. }) if reason.contains("empty")), "{empty:?}");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn only_a_person_can_clone_or_ask_about_github_and_an_oversized_clone_is_answered_at_once() {
    let mut session = conversation_fixture("conversation-approval").await;
    let outcome = AssertUnwindSafe(async {
        let clone = |address: String| {
            crate::protocol::ClientMsg::Query(crate::protocol::Query::CloneRepo { address, parent: "~".into(), tag: 9 })
        };
        let from = authenticated_pane(&mut session);
        let refused = exchange(&mut session, 440, clone("https://example.invalid/o/r.git".into()), Some(from)).await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("Only a human")), "{refused:?}");

        use crate::protocol::Query;
        let about_github = [
            Query::GitIdentityRule { change: crate::protocol::GitRuleChange::Remove { folder: "/code".into() }, tag: 9 },
            Query::GitIdentities { tag: 9 },
            Query::GitHubAccounts { tag: 9 },
            Query::GitHubRepos { owner: None, search: None, tag: 9 },
            Query::GitHubOwners { tag: 9 },
            Query::AgentCommands { agent: crate::conversation::Provider::Claude, folder: "/code".into(), tag: 9 },
            Query::AgentSignIn { agent: crate::protocol::SignInAgent::Codex, request: crate::protocol::SignInRequest::Start, tag: 9 },
            Query::AgentSignIn { agent: crate::protocol::SignInAgent::Github, request: crate::protocol::SignInRequest::SignOut, tag: 9 },
            Query::FolderGit { folder: "/code".into(), request: crate::protocol::FolderGitRequest::Branches, tag: 9 },
            Query::MachineFacts { tag: 9 },
        ];
        for (client, query) in (442..).zip(about_github) {
            let from = authenticated_pane(&mut session);
            let refused = exchange(&mut session, client, crate::protocol::ClientMsg::Query(query), Some(from)).await;
            assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("Only a human")), "{refused:?}");
        }

        // A person's client is told plainly that Gemini has no sign-in to run, and nothing is started.
        let gemini = Query::AgentSignIn { agent: crate::protocol::SignInAgent::Gemini, request: crate::protocol::SignInRequest::Start, tag: 4 };
        let told = exchange(&mut session, 470, crate::protocol::ClientMsg::Query(gemini), None).await;
        assert!(
            matches!(told, ServerMsg::Reply(crate::protocol::Reply::AgentSignIn { tag: 4, state: crate::protocol::SignInState::Failed(crate::protocol::SignInFailure::Unsupported), .. })),
            "{told:?}"
        );

        // Installing code is a person's: a pane is refused, and a person's client with no preview token is
        // answered with a refusal and nothing runs.
        let ask = |request| Query::Extensions { request, tag: 9 };
        let from = authenticated_pane(&mut session);
        let add = maitty_shared::extensions::ExtRequest::Add { token: "0".repeat(32) };
        let refused = exchange(&mut session, 463, crate::protocol::ClientMsg::Query(ask(add.clone())), Some(from)).await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("Only a human")), "{refused:?}");
        let untokened = exchange(&mut session, 464, crate::protocol::ClientMsg::Query(ask(add)), None).await;
        assert!(
            matches!(untokened, ServerMsg::Reply(crate::protocol::Reply::Extensions { tag: 9, answer: Err(maitty_shared::extensions::ExtError::NeedsConfirmation) })),
            "{untokened:?}"
        );

        let from = authenticated_pane(&mut session);
        let push = Query::Git { term: from.0, request: crate::protocol::GitRequest::Push, tag: 9 };
        let refused = exchange(&mut session, 450, crate::protocol::ClientMsg::Query(push), Some(from)).await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("Only a human")), "{refused:?}");
        let from = authenticated_pane(&mut session);
        let commit = crate::protocol::GitRequest::Commit { message: "m".into(), paths: None };
        let commit = Query::Git { term: from.0, request: commit, tag: 9 };
        let refused = exchange(&mut session, 452, crate::protocol::ClientMsg::Query(commit), Some(from)).await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("Only a human")), "{refused:?}");
        let from = authenticated_pane(&mut session);
        let open = Query::Git { term: from.0, request: crate::protocol::GitRequest::PullRequest, tag: 9 };
        let refused = exchange(&mut session, 453, crate::protocol::ClientMsg::Query(open), Some(from)).await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("Only a human")), "{refused:?}");
        let from = authenticated_pane(&mut session);
        let discard = Query::DiscardFile { term: from.0, path: "a.txt".into(), tag: 9 };
        let refused = exchange(&mut session, 454, crate::protocol::ClientMsg::Query(discard), Some(from)).await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("Only a human")), "{refused:?}");
        let nowhere = Query::DiscardFile { term: u32::MAX, path: "a.txt".into(), tag: 9 };
        let refused = exchange(&mut session, 455, crate::protocol::ClientMsg::Query(nowhere), None).await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("no pane")), "{refused:?}");
        let nowhere = Query::Git { term: u32::MAX, request: crate::protocol::GitRequest::Fetch, tag: 9 };
        let refused = exchange(&mut session, 451, crate::protocol::ClientMsg::Query(nowhere), None).await;
        assert!(matches!(refused, ServerMsg::Error(ref message) if message.contains("no pane")), "{refused:?}");

        let long = format!("https://example.invalid/{}", "a".repeat(4096));
        let answered = exchange(&mut session, 441, clone(long), None).await;
        assert!(
            matches!(answered, ServerMsg::Reply(crate::protocol::Reply::Cloned { tag: 9, outcome: Err(ref why) }) if why.contains("too long")),
            "{answered:?}"
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
async fn structured_runtime_claims_apply_grants_without_human_or_pane_exemptions() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (id, _) = create(&mut s).await;
        let claim = s.daemon.conversation_runtimes.test_identity(id);
        let pane = authenticated_pane(&mut s).0;
        s.daemon.cfg.mcp.grants = vec!["read".into()];
        let list = exchange_claim(
            &mut s,
            230,
            crate::protocol::ClientMsg::Query(crate::protocol::Query::List),
            None,
            Some(claim.clone()),
            None,
        )
        .await;
        assert!(matches!(
            list,
            ServerMsg::Reply(crate::protocol::Reply::List(_))
        ));
        let write = crate::protocol::ClientMsg::Command(crate::protocol::Command::QueueFollowUp {
            term: pane,
            text: "Synthetic scoped write".into(),
            first: false,
            operation: None,
        });
        let denied =
            exchange_claim(&mut s, 231, write.clone(), None, Some(claim.clone()), None).await;
        assert!(matches!(denied,ServerMsg::Error(ref error) if error.contains("may not")));
        assert!(s.daemon.terms[&pane].queue.is_empty());
        s.daemon.cfg.mcp.grants = vec!["write".into()];
        let accepted = exchange_claim(&mut s, 232, write, None, Some(claim.clone()), None).await;
        assert!(matches!(
            accepted,
            ServerMsg::Reply(crate::protocol::Reply::Ok)
        ));
        assert_eq!(s.daemon.terms[&pane].queue.len(), 1);
        let denied = exchange_claim(
            &mut s,
            233,
            crate::protocol::ClientMsg::Query(crate::protocol::Query::List),
            None,
            Some(claim.clone()),
            None,
        )
        .await;
        assert!(matches!(denied, ServerMsg::Error(_)));
        s.daemon.cfg.mcp.grants = vec!["read".into(), "start".into(), "admin".into()];
        for (client, command) in [
            (
                234,
                crate::protocol::Command::Grant {
                    term: pane,
                    grants: Some(vec!["admin".into()]),
                },
            ),
            (
                235,
                crate::protocol::Command::AnswerHelpers {
                    term: pane,
                    choice: crate::protocol::HelperChoice::Allow,
                },
            ),
            (
                236,
                crate::protocol::Command::NewWorkspace {
                    cwd: None,
                    name: None,
                    cmd: None,
                },
            ),
        ] {
            let denied = exchange_claim(
                &mut s,
                client,
                crate::protocol::ClientMsg::Command(command),
                None,
                Some(claim.clone()),
                None,
            )
            .await;
            assert!(matches!(denied, ServerMsg::Error(_)));
        }
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// A chat's runtime asks to start a helper on `task`. `true` runs and ends, so nothing is left behind.
fn chat_helper(task: &str) -> crate::protocol::ClientMsg {
    crate::protocol::ClientMsg::Command(crate::protocol::Command::NewWorkspace {
        cwd: Some(std::env::temp_dir()),
        name: None,
        cmd: Some(format!("true '{task}'")),
    })
}

fn answer_chat(
    conversation: crate::conversation::ConversationId,
    choice: crate::protocol::HelperChoice,
) -> crate::protocol::ClientMsg {
    crate::protocol::ClientMsg::Command(crate::protocol::Command::AnswerChatHelpers { conversation, choice })
}

fn summary_of(s: &TestSession, id: crate::conversation::ConversationId) -> crate::protocol::ConversationSummary {
    s.daemon
        .conversation_summaries()
        .into_iter()
        .find(|summary| summary.id == id)
        .expect("the chat is listed")
}

#[tokio::test]
async fn a_chat_asks_before_it_starts_helpers_and_only_a_person_answers() {
    use crate::protocol::HelperChoice;
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (id, _) = create(&mut s).await;
        let claim = s.daemon.conversation_runtimes.test_identity(id);
        let pane = authenticated_pane(&mut s);
        s.daemon.cfg.mcp.grants = vec!["start".into()];
        s.daemon.cfg.sessions.helpers = "ask".into();
        let panes = s.daemon.terms.len();
        // Nothing starts; the agent is told the person was asked, and each task is listed once.
        let asked = exchange_claim(&mut s, 300, chat_helper("review the diff"), None, Some(claim.clone()), None).await;
        assert!(
            matches!(asked, ServerMsg::Error(ref e) if e.contains("needs the user's OK") && e.contains("1 helper")),
            "{asked:?}"
        );
        for client in [301, 302] {
            exchange_claim(&mut s, client, chat_helper("write the tests"), None, Some(claim.clone()), None).await;
        }
        assert_eq!(s.daemon.terms.len(), panes, "no session started");
        let summary = summary_of(&s, id);
        assert_eq!(summary.helper_ask, ["review the diff", "write the tests"]);
        assert_eq!(summary.status, crate::protocol::Status::Blocked, "needs you, whatever the provider reports");
        // Neither the chat's own runtime nor a pane answers for the person, and the request stays.
        let own = exchange_claim(&mut s, 303, answer_chat(id, HelperChoice::Allow), None, Some(claim.clone()), None).await;
        let from_pane = exchange(&mut s, 304, answer_chat(id, HelperChoice::Allow), Some(pane)).await;
        for refused in [own, from_pane] {
            assert!(matches!(refused, ServerMsg::Error(ref e) if e.contains("yours to allow")), "{refused:?}");
        }
        assert_eq!(summary_of(&s, id).helper_ask.len(), 2);
        // The person allows: it may start them for as long as it runs.
        let allowed = exchange(&mut s, 305, answer_chat(id, HelperChoice::Allow), None).await;
        assert!(matches!(allowed, ServerMsg::Reply(crate::protocol::Reply::Ok)), "{allowed:?}");
        assert!(summary_of(&s, id).helper_ask.is_empty());
        let started = exchange_claim(&mut s, 306, chat_helper("review the diff"), None, Some(claim.clone()), None).await;
        assert!(!matches!(started, ServerMsg::Error(_)), "{started:?}");
        assert_eq!(s.daemon.terms.len(), panes + 1);
        let helper = s.daemon.terms.values().max_by_key(|term| term.born).expect("the helper");
        assert_eq!((helper.started_by_chat, helper.started_by), (Some(id), None));
        // The tool server that asked is a terminal client, but the chat is the desktop app's.
        let helper = helper.id;
        assert_eq!(s.daemon.terms[&helper].owner, crate::protocol::Surface::Desktop);
        assert!(s.daemon.snapshot_for(crate::protocol::Surface::Desktop).terms.contains_key(&helper), "the app the chat is in lists it");
        // An answer to nothing is an error, not a grant.
        for (client, chat) in [(307, id), (308, crate::conversation::ConversationId(9_999))] {
            let nothing = exchange(&mut s, client, answer_chat(chat, HelperChoice::No), None).await;
            assert!(matches!(nothing, ServerMsg::Error(_)), "{nothing:?}");
        }
        assert!(!s.daemon.conversation_states[&id].helper_consent.refused);
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_chats_helpers_follow_the_setting_the_limit_and_a_no() {
    use crate::protocol::HelperChoice;
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (id, _) = create(&mut s).await;
        let claim = s.daemon.conversation_runtimes.test_identity(id);
        s.daemon.cfg.mcp.grants = vec!["start".into()];
        let panes = s.daemon.terms.len();
        s.daemon.cfg.sessions.helpers = "never".into();
        let never = exchange_claim(&mut s, 310, chat_helper("a"), None, Some(claim.clone()), None).await;
        assert!(matches!(never, ServerMsg::Error(ref e) if e.contains("turned helpers off")), "{never:?}");
        assert!(summary_of(&s, id).helper_ask.is_empty(), "nothing is asked");
        // Always: nothing is asked, and the limit still holds.
        s.daemon.cfg.sessions.helpers = "always".into();
        s.daemon.cfg.sessions.helpers_at_once = "2".into();
        for client in [311, 312] {
            let started = exchange_claim(&mut s, client, chat_helper("b"), None, Some(claim.clone()), None).await;
            assert!(!matches!(started, ServerMsg::Error(_)), "{started:?}");
        }
        // Past the limit a helper is not refused: its row is made, and it waits for a free slot.
        let third = exchange_claim(&mut s, 313, chat_helper("c"), None, Some(claim.clone()), None).await;
        assert!(!matches!(third, ServerMsg::Error(_)), "{third:?}");
        assert_eq!(s.daemon.terms.len(), panes + 3);
        let waiting: Vec<_> = s.daemon.terms.values().filter(|t| t.waiting.is_some()).collect();
        assert_eq!(waiting.len(), 1);
        assert_eq!(waiting[0].started_by_chat, Some(id));
        // No: it does the work alone for the rest of its run.
        s.daemon.cfg.sessions.helpers = "ask".into();
        s.daemon.cfg.sessions.helpers_at_once = "4".into();
        exchange_claim(&mut s, 314, chat_helper("d"), None, Some(claim.clone()), None).await;
        let no = exchange(&mut s, 315, answer_chat(id, HelperChoice::No), None).await;
        assert!(matches!(no, ServerMsg::Reply(crate::protocol::Reply::Ok)), "{no:?}");
        let alone = exchange_claim(&mut s, 316, chat_helper("d"), None, Some(claim.clone()), None).await;
        assert!(matches!(alone, ServerMsg::Error(ref e) if e.contains("Do the work yourself")), "{alone:?}");
        assert!(summary_of(&s, id).helper_ask.is_empty());
        assert_eq!(s.daemon.terms.len(), panes + 3);
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_chat_starts_only_helpers_and_needs_the_start_grant() {
    let mut s = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (id, _) = create(&mut s).await;
        let claim = s.daemon.conversation_runtimes.test_identity(id);
        let pane = authenticated_pane(&mut s).0;
        s.daemon.cfg.sessions.helpers = "always".into();
        let panes = s.daemon.terms.len();
        // Without the start grant, even a helper is refused.
        s.daemon.cfg.mcp.grants = vec!["read".into()];
        let ungranted = exchange_claim(&mut s, 320, chat_helper("a"), None, Some(claim.clone()), None).await;
        assert!(matches!(ungranted, ServerMsg::Error(ref e) if e.contains("may not")), "{ungranted:?}");
        // With it, everything that is not a helper stays refused: a bare shell, a split, another chat.
        s.daemon.cfg.mcp.grants = vec!["start".into()];
        let target = crate::conversation::StartTarget::Create(settings(&s));
        for (client, command) in [
            (321, crate::protocol::Command::NewWorkspace { cwd: None, name: None, cmd: None }),
            (
                322,
                crate::protocol::Command::Split { term: pane, dir: crate::layout::Dir::Right, cmd: Some("true 'x'".into()), cwd: None },
            ),
            (323, crate::protocol::Command::ConversationStart { target, branch: None }),
        ] {
            let refused = exchange_claim(&mut s, client, crate::protocol::ClientMsg::Command(command), None, Some(claim.clone()), None).await;
            assert!(matches!(refused, ServerMsg::Error(ref e) if e.contains("only helpers")), "{refused:?}");
        }
        assert_eq!((s.daemon.terms.len(), s.daemon.conversations.len()), (panes, 1));
    })
    .catch_unwind()
    .await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn structured_invalid_and_revoked_claims_never_fall_back_to_human() {
    let mut s = conversation_fixture("conversation").await;
    let outcome=AssertUnwindSafe(async {
        let (id,generation)=create(&mut s).await;
        let claim=s.daemon.conversation_runtimes.test_identity(id);
        let mut bad=claim.clone();bad.token="wrong-secret".into();
        let denied=exchange_claim(&mut s,240,crate::protocol::ClientMsg::Query(crate::protocol::Query::List),None,Some(bad),None).await;
        assert!(matches!(denied,ServerMsg::Error(_)));
        let (client,mut replies)=mpsc::channel(8);
        s.daemon.handle(Ev::StructuredConnected {id:241,tx:client,attach:false,claim:claim.clone()});
        s.daemon.conversations[0].generation=generation+1;
        s.daemon.message(241,crate::protocol::ClientMsg::Query(crate::protocol::Query::List));
        assert!(matches!(replies.recv().await,Some(ServerMsg::Error(ref error)) if error.contains("stale or revoked")));
        let denied=exchange_claim(&mut s,242,crate::protocol::ClientMsg::Query(crate::protocol::Query::List),None,Some(claim),None).await;
        assert!(matches!(denied,ServerMsg::Error(_)));
        s.daemon.conversations[0].generation=generation;
    }).catch_unwind().await;
    s.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
