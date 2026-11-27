//! Live checks against the real Claude Code and Codex installed on this machine, through the
//! daemon exactly as the desktop app's Chat view drives them: start, a reply, a command that
//! needs approval, and a daemon restart that resumes the same conversation.
//!
//! Every other chat test runs a fake agent, so they pass while a new Claude Code or Codex
//! release breaks every real chat. These are the ones that notice. They are `#[ignore]`d: each
//! needs that agent installed and signed in, and spends a little of its plan. Run them with
//! `scripts/live-check.sh` (see docs/TESTING.md).

use super::*;
use crate::conversation::{ApprovalDecision, ApprovalPolicy, Provider, Sandbox, StartTarget};
use crate::protocol::{ClientMsg, Command, Query, Reply, Status};

/// The longest one real turn may take: a cold start, a slow model, a busy plan.
const LIVE_TURN: Duration = Duration::from_secs(300);
/// What the agent is asked to reply with, so a reply can be told from anything else it says.
const PONG: &str = "MAIKER-PONG";
/// What the approved change writes, and to which file.
const ECHOED: &str = "maiker-live-check";
const WRITTEN: &str = "maiker-live.txt";

fn live_session_root(session: &TestSession) -> PathBuf {
    session.fixture.record.binding.cwd.clone()
}

/// Handle the daemon's events until `done`, for up to `limit`.
async fn handle_within(session: &mut TestSession, what: &str, limit: Duration, done: impl Fn(&Daemon) -> bool) {
    tokio::time::timeout(limit, async {
        while !done(&session.daemon) {
            let event = session.events.recv().await.expect("the daemon's events stay open");
            session.daemon.handle(event);
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {what}"));
}

async fn start_live(session: &mut TestSession, client: u64, provider: Provider) -> (crate::conversation::ConversationId, u64) {
    let target = StartTarget::Agent {
        provider,
        cwd: live_session_root(session),
        sandbox: Sandbox::WorkspaceWrite,
        approval_policy: ApprovalPolicy::OnRequest,
    };
    let started = exchange(session, client, ClientMsg::Command(Command::ConversationStart { target, branch: None }), None).await;
    let ServerMsg::Reply(Reply::ConversationStarted { id, generation }) = started else {
        panic!("the {provider:?} chat did not start: {started:?}");
    };
    (id, generation)
}

async fn read_page(session: &mut TestSession, client: u64, id: crate::conversation::ConversationId) -> crate::conversation::ReadResult {
    let read = exchange(session, client, ClientMsg::Query(Query::ConversationRead { id, cursor: None, limit: 128 }), None).await;
    let ServerMsg::Reply(Reply::ConversationRead(page)) = read else {
        panic!("{read:?}");
    };
    page
}

fn assistant_texts(page: &crate::conversation::ReadResult) -> Vec<String> {
    page.history
        .entries
        .iter()
        .filter_map(|entry| match &entry.content {
            super::history::Content::Message { role: super::history::Role::Assistant, text } => Some(text.clone()),
            _ => None,
        })
        .collect()
}

/// Send `text` and wait for the turn it starts to end, approving every request on the way.
/// Returns how many requests were approved.
async fn turn(session: &mut TestSession, client: u64, id: crate::conversation::ConversationId, generation: u64, operation: u64, text: &str) -> usize {
    let before = session.daemon.conversation_states.get(&id).map_or(0, |state| state.completed_turns.len());
    let sent = exchange(session, client, ClientMsg::Command(Command::ConversationSend { id, generation, operation, text: text.into(), choice: None }), None).await;
    assert!(matches!(sent, ServerMsg::Reply(Reply::ConversationSent(_))), "the message was not taken: {sent:?}");
    let mut approved = 0;
    let deadline = tokio::time::Instant::now() + LIVE_TURN;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        handle_within(session, "the turn to end or ask", remaining, |daemon| {
            daemon.conversation_states.get(&id).is_some_and(|state| {
                !state.approvals.is_empty() || state.completed_turns.len() > before || state.shown_error().is_some()
            })
        })
        .await;
        let state = &session.daemon.conversation_states[&id];
        if let Some(error) = state.shown_error() {
            panic!("the turn failed: {error}");
        }
        if state.completed_turns.len() > before {
            return approved;
        }
        let request = state.approvals.keys().next().cloned().expect("a pending request");
        let answered = exchange(session, client + 1 + approved as u64, ClientMsg::Command(Command::ConversationApprove { id, generation, request_id: request, decision: ApprovalDecision::Accept }), None).await;
        assert!(matches!(answered, ServerMsg::Reply(Reply::Ok)), "the approval was refused: {answered:?}");
        approved += 1;
    }
}

/// Stop the daemon's runtime for `id`, as a daemon that exits does, so a new daemon can take it.
async fn stop_chat(session: &mut TestSession, id: crate::conversation::ConversationId) {
    tokio::time::timeout(Duration::from_secs(40), async {
        loop {
            match session.daemon.conversation_runtimes.test_cleanup_state(id) {
                None | Some(TestCleanupState::Finished) => break,
                Some(TestCleanupState::Active) => session.daemon.dispose_conversation(id).unwrap(),
                Some(TestCleanupState::Requested) => {}
            }
            while let Ok(event) = session.events.try_recv() {
                session.daemon.handle(event);
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the chat's agent stopped");
}

/// Replace the session's daemon with a fresh one that restores what the old one saved, as an
/// update or a `kill-server` does.
fn restart_daemon(session: &mut TestSession) {
    let saved = session.daemon.saved();
    let (tx, events) = mpsc::channel(128);
    let mut config = session.daemon.cfg.clone();
    config.restore.enabled = true;
    let mut daemon = Daemon::new(config, tx, || {});
    daemon.session_path = session.daemon.session_path.clone();
    daemon.check_dir = session.daemon.check_dir.clone();
    daemon.approvals_file = session.daemon.approvals_file.clone();
    assert!(daemon.restore(saved), "the new daemon restored the saved chat");
    daemon.resume_conversations();
    session.daemon = daemon;
    session.events = events;
}

async fn the_whole_chat_works(provider: Provider) {
    let mut session = conversation_fixture("live").await;
    let outcome = AssertUnwindSafe(async {
        // 1. Start, and a plain reply.
        let (id, generation) = start_live(&mut session, 900, provider).await;
        turn(&mut session, 901, id, generation, 1, &format!("Reply with exactly {PONG} and nothing else. Do not use any tools.")).await;
        // A turn's end runs the project's checks; Done waits for them.
        handle_within(&mut session, "the turn's checks", Duration::from_secs(60), |daemon| {
            daemon.conversation_states[&id].effective_status() == Status::Done
        })
        .await;
        let page = read_page(&mut session, 910, id).await;
        assert_eq!(page.error, None);
        assert!(assistant_texts(&page).iter().any(|text| text.contains(PONG)), "no {PONG} in {:?}", assistant_texts(&page));
        assert_eq!(page.status, Status::Done, "a finished turn is Done");

        // 2. A file change, approved through the daemon wherever the agent asks for one.
        let approved = turn(&mut session, 920, id, generation, 2, &format!("Create a file named {WRITTEN} in the current folder containing exactly the text {ECHOED}, then reply DONE.")).await;
        let page = read_page(&mut session, 940, id).await;
        assert_eq!(page.error, None);
        let written = live_session_root(&session).join(WRITTEN);
        let contents = tokio::task::spawn_blocking(move || std::fs::read_to_string(written)).await.unwrap().unwrap_or_default();
        assert_eq!(contents.trim(), ECHOED, "the agent's file change did not land");
        // Claude Code asks before it edits a file in its default mode, so its run must have gone
        // through an approval; Codex writes inside its workspace sandbox without asking.
        if provider == Provider::Claude {
            assert!(approved >= 1, "Claude's file change was never put to the person");
        }
        eprintln!("{provider:?}: {approved} request(s) approved through the daemon");

        // 3. The daemon restarts; the same conversation comes back and remembers.
        stop_chat(&mut session, id).await;
        restart_daemon(&mut session);
        session.daemon.wake_conversation(id);
        handle_within(&mut session, "the chat to resume", Duration::from_secs(60), |daemon| daemon.conversation_runtimes.owns(id)).await;
        let generation = session.daemon.conversations.iter().find(|c| c.id == id).expect("the chat is still listed").generation;
        // A read while the start is under way says loading, not failed.
        let loading = read_page(&mut session, 945, id).await;
        assert_eq!(loading.error, None, "a read during the resume does not fail the chat");
        handle_within(&mut session, "the resumed chat's past to be read back", Duration::from_secs(60), |daemon| {
            daemon.conversation_states.get(&id).is_some_and(|state| state.history_ready || state.shown_error().is_some())
        })
        .await;
        let page = read_page(&mut session, 950, id).await;
        assert!(assistant_texts(&page).iter().any(|text| text.contains(PONG)), "the history did not survive the restart");
        turn(&mut session, 960, id, generation, 3, "What exact word did you reply with to my first message? Reply with that word only.").await;
        let page = read_page(&mut session, 980, id).await;
        assert_eq!(page.error, None);
        let last = assistant_texts(&page).last().cloned().unwrap_or_default();
        assert!(last.contains(PONG), "the resumed chat lost its context: {last:?}");
        stop_chat(&mut session, id).await;
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
#[ignore = "needs Claude Code installed and signed in; run scripts/live-check.sh"]
async fn live_claude_chat_starts_replies_approves_and_survives_a_restart() {
    the_whole_chat_works(Provider::Claude).await;
}

#[tokio::test]
#[ignore = "needs Codex installed and signed in; run scripts/live-check.sh"]
async fn live_codex_chat_starts_replies_approves_and_survives_a_restart() {
    the_whole_chat_works(Provider::Codex).await;
}
