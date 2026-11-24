//! A turn cut short (ADR 0003). A provider killed mid-turn leaves the chat blocked with the
//! reason, never done, until a person resumes it. A daemon that restarts mid-turn starts no chat by
//! itself: one cut mid-turn waits for a person, and one between turns starts when it is first
//! opened. In every case the prompt the provider already took is not sent again.
//!
//! A Claude chat is taken up again from its own transcript; a turn the transcript ends in the middle
//! of reads as stopped.

use super::continue_turn::turns_started;
use super::*;
use crate::conversation::{ConversationId, Delivery, RecoveryState, StartTarget};
use crate::protocol::{ClientMsg, Command, Query, Reply, Status};

async fn send(session: &mut TestSession, client: u64, id: ConversationId, generation: u64, text: &str) -> ServerMsg {
    let message = ClientMsg::Command(Command::ConversationSend {
        id,
        generation,
        operation: 1,
        text: text.into(),
        choice: None,
    });
    exchange(session, client, message, None).await
}

fn generation(session: &TestSession, id: ConversationId) -> u64 {
    session.daemon.conversations.iter().find(|c| c.id == id).unwrap().generation
}

fn prompt_delivered(operations: &[crate::conversation::Operation], id: ConversationId) -> bool {
    operations.iter().any(|operation| {
        operation.receipt.conversation == id
            && matches!(operation.receipt.delivery, Delivery::Acknowledged { .. })
    })
}

/// Kills the processes as something outside the daemon would, with no word to the daemon.
///
/// A provider's descendant can already be going away by the time its turn comes: the daemon
/// stops what a provider started once it notices the provider died. Windows then refuses the
/// kill (access denied on a process already terminating) and the process list may no longer show
/// it. Either way it is gone, which is all this needs, so a refusal is waited out and only a
/// process that stays alive fails. The first pid (the provider itself) must be found running:
/// nothing else may have stopped it.
async fn kill(pids: Vec<u32>) {
    tokio::task::spawn_blocking(move || {
        let mut system = sysinfo::System::new();
        for (position, pid) in pids.into_iter().enumerate() {
            let target = sysinfo::Pid::from_u32(pid);
            system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[target]), true);
            let Some(process) = system.process(target) else {
                assert!(position > 0, "the provider (pid {pid}) was not running before the kill");
                continue;
            };
            let killed = process.kill();
            let until = std::time::Instant::now() + Duration::from_secs(10);
            while system.process(target).is_some() {
                assert!(
                    std::time::Instant::now() < until,
                    "pid {pid} (position {position}) is still running 10s after kill() = {killed}"
                );
                std::thread::sleep(Duration::from_millis(50));
                system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[target]), true);
            }
        }
    })
    .await
    .unwrap();
}

/// What a person is left with after the provider died mid-turn.
fn assert_blocked_with_the_prompt_delivered(session: &TestSession, id: ConversationId) {
    let state = &session.daemon.conversation_states[&id];
    assert_eq!(state.status, Status::Blocked, "a turn that never finished is not done");
    assert!(state.error.is_some(), "the reason is kept for the chat to show");
    let record = session.daemon.conversations.iter().find(|c| c.id == id).unwrap();
    assert_eq!(record.state, RecoveryState::RecoveryRequired);
    assert!(
        prompt_delivered(&session.daemon.conversation_operations, id),
        "the provider took the prompt before it died"
    );
}

/// Handles events until the daemon has started the chat again and read its past back, or said why
/// not.
async fn resume_decided(session: &mut TestSession, id: ConversationId) {
    handle_until(session, "the resume is decided", |daemon| {
        let decided = daemon
            .conversation_states
            .get(&id)
            .is_some_and(|state| state.history_ready || state.error.is_some());
        let in_flight = daemon.conversation_requests.values().any(|pending| pending.conversation() == id);
        daemon.conversation_runtimes.owns(id) && decided && !in_flight
    })
    .await;
}

/// Writes what Claude Code keeps of the chat, as its own transcript, under the name the daemon looks
/// for. `cut`: the transcript stops before the turn's answer and its end, as when the agent went away
/// mid-turn.
async fn write_transcript(session: &mut TestSession, cut: bool) {
    let binding = session.daemon.conversations[0].binding.clone();
    let path = super::super::claude::transcript_path(&binding.config_root, &binding.cwd, &binding.session_id).unwrap();
    session.daemon.followed_home = Some(binding.config_root.clone());
    tokio::task::spawn_blocking(move || {
        let whole = include_str!("../fixtures/claude_transcript.jsonl")
            .replace("00000000-0000-4000-8000-000000000001", &binding.session_id);
        let lines: Vec<&str> = whole.lines().collect();
        let kept = if cut { &lines[..lines.len() - 2] } else { &lines[..] };
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, kept.join("\n") + "\n").unwrap();
    })
    .await
    .unwrap();
}

/// The chat's past as the daemon read it back: nothing in it still running, and its last turn
/// stopped.
fn assert_cut_turn_stopped(session: &TestSession, id: ConversationId) {
    use crate::daemon::conversation::history::{Content, ItemState};
    let history = &session.daemon.conversation_histories[&id];
    assert!(
        history.entries.iter().all(|entry| entry.state != ItemState::Running),
        "a turn cut by a restart is not shown as still going"
    );
    let last = &history.entries.last().unwrap().source.turn;
    assert!(
        history.entries.iter().any(|entry| &entry.source.turn == last
            && entry.content == Content::TurnStatus
            && entry.state == ItemState::Interrupted),
        "the cut turn reads as stopped"
    );
}

fn listed(session: &TestSession, id: ConversationId) -> crate::protocol::ConversationSummary {
    session.daemon.conversation_summaries().into_iter().find(|summary| summary.id == id).unwrap()
}

/// A person asks for the conversation back, as the chat's Restart does.
async fn resume_by_hand(session: &mut TestSession, client: u64, id: ConversationId) -> u64 {
    let target = StartTarget::Conversation { id, generation: generation(session, id) };
    let reply = exchange(
        session,
        client,
        ClientMsg::Command(Command::ConversationStart { target, branch: None }),
        None,
    )
    .await;
    let ServerMsg::Reply(Reply::ConversationStarted { id: resumed, generation }) = reply else {
        panic!("{reply:?}");
    };
    assert_eq!(resumed, id, "the same conversation, not a new one");
    generation
}

/// Restarts the daemon mid-turn: the provider is stopped as a daemon going away stops it, and a
/// new daemon starts from what the old one had saved, in the order a real start does.
async fn restart_daemon(session: &mut TestSession, id: ConversationId) {
    let saved = session.daemon.saved();
    assert_eq!(saved.conversations[0].state, RecoveryState::Running);
    assert!(prompt_delivered(&saved.conversation_operations, id), "the prompt was delivered before the restart");
    session.daemon.dispose_conversation(id).unwrap();
    handle_until(session, "the provider stops", |daemon| !daemon.conversation_runtimes.owns(id)).await;
    session.settle_background().await;

    let (tx, events) = mpsc::channel(128);
    let mut config = Config::default();
    config.worktree.dir = crate::daemon::worktree_path::SIBLING_TEMPLATE.into();
    config.restore.enabled = true;
    let mut daemon = Daemon::new(config, tx, || {});
    daemon.session_path = session.daemon.session_path.clone();
    daemon.check_dir = session.daemon.check_dir.clone();
    daemon.approvals_file = session.daemon.approvals_file.clone();
    daemon.followed_home = session.daemon.followed_home.clone();
    session.daemon = daemon;
    session.events = events;
    assert!(session.daemon.restore(saved));
    session.daemon.initialize_conversation_cache().await.unwrap();
    session.daemon.resume_conversations();
    assert!(!session.daemon.conversation_runtimes.owns(id), "a restart starts no chat by itself");
}

#[tokio::test]
async fn a_codex_killed_mid_turn_blocks_the_chat_until_a_person_resumes_it_without_a_second_send() {
    // This mode starts the turn and leaves it running.
    let mut session = conversation_fixture("conversation-cancel").await;
    let outcome = AssertUnwindSafe(async {
        let (id, started) = create(&mut session).await;
        let sent = send(&mut session, 610, id, started, "Synthetic prompt").await;
        assert!(matches!(sent, ServerMsg::Reply(Reply::ConversationSent(_))), "{sent:?}");

        // Only the provider itself: stopping what it started is the daemon's job once it notices.
        let provider = session.fixture.pids().await[0];
        kill(vec![provider]).await;
        handle_until(&mut session, "the provider's exit is noticed", |daemon| {
            !daemon.conversation_runtimes.owns(id)
        })
        .await;

        assert_blocked_with_the_prompt_delivered(&session, id);
        assert_eq!(turns_started(&session).await, 1);

        let resumed = resume_by_hand(&mut session, 611, id).await;

        assert!(resumed > started, "the resume fenced the dead provider's generation");
        assert_eq!(session.daemon.conversations.len(), 1, "no second conversation appeared");
        assert_eq!(turns_started(&session).await, 1, "the prompt was not sent again");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_daemon_restart_mid_turn_leaves_a_codex_chat_for_a_person_to_resume_without_a_second_send() {
    let mut session = conversation_fixture("conversation-cancel").await;
    let outcome = AssertUnwindSafe(async {
        let (id, started) = create(&mut session).await;
        let sent = send(&mut session, 630, id, started, "Synthetic prompt").await;
        assert!(matches!(sent, ServerMsg::Reply(Reply::ConversationSent(_))), "{sent:?}");

        restart_daemon(&mut session, id).await;
        assert!(listed(&session, id).interrupted, "listed for the person to take up");
        // Codex keeps no copy here to answer from while its runtime is down, so the read is refused.
        exchange(&mut session, 631, ClientMsg::Query(Query::ConversationRead { id, cursor: None, limit: 128 }), None).await;
        assert!(!session.daemon.conversation_runtimes.owns(id), "opening a cut chat does not start it");

        resume_by_hand(&mut session, 632, id).await;
        resume_decided(&mut session, id).await;

        assert!(!listed(&session, id).interrupted, "taken up, it is no longer listed");
        let state = &session.daemon.conversation_states[&id];
        assert_eq!(state.status, Status::Idle, "the cut turn is neither working nor done");
        assert!(state.history_ready && state.error.is_none(), "{:?}", state.error);
        let resumed = generation(&session, id);
        assert!(resumed > started, "the restart fenced the old generation");
        assert_eq!(session.daemon.conversations.len(), 1, "no second conversation appeared");
        assert_eq!(turns_started(&session).await, 1, "the prompt was not sent again");
        session.daemon.wake_conversation(id);
        assert_eq!(generation(&session, id), resumed, "a later read starts nothing more");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// The process of the fake `claude` beside `executable` that was handed a message last.
async fn claude_pid(executable: &Path) -> u32 {
    let log = tokio::fs::read_to_string(executable.with_extension("log")).await.unwrap();
    let line = log.lines().rev().find(|line| line.starts_with("message ")).expect("a message was taken");
    line["message ".len()..].parse().unwrap()
}

/// How many messages the fake `claude` beside `executable` was handed, over all its processes.
async fn claude_messages(executable: &Path) -> usize {
    tokio::fs::read_to_string(executable.with_extension("log"))
        .await
        .map_or(0, |log| log.lines().filter(|line| line.starts_with("message ")).count())
}

#[tokio::test]
async fn a_claude_killed_mid_turn_blocks_the_chat_until_a_person_resumes_it_with_the_turn_stopped() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        // This scenario holds its first turn open until it is interrupted.
        let (executable, id, started) = start_claude_chat(&mut session, 620, "interrupt-any").await;
        let sent = send(&mut session, 621, id, started, "hello fake Claude").await;
        assert!(matches!(sent, ServerMsg::Reply(Reply::ConversationSent(_))), "{sent:?}");

        kill(vec![claude_pid(&executable).await]).await;
        handle_until(&mut session, "the provider's exit is noticed", |daemon| {
            !daemon.conversation_runtimes.owns(id)
        })
        .await;

        assert_blocked_with_the_prompt_delivered(&session, id);
        assert_eq!(claude_messages(&executable).await, 1);
        write_transcript(&mut session, true).await;

        let resumed = resume_by_hand(&mut session, 622, id).await;

        let state = &session.daemon.conversation_states[&id];
        assert!(state.history_ready && state.error.is_none(), "{:?}", state.error);
        assert_eq!(state.status, Status::Idle, "neither working nor waiting on the person");
        assert_cut_turn_stopped(&session, id);
        assert!(resumed > started, "the resume fenced the dead provider's generation");
        assert_eq!(session.daemon.conversations.len(), 1, "no second conversation appeared");
        assert_eq!(claude_messages(&executable).await, 1, "the prompt was not sent again");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_daemon_restart_mid_turn_leaves_a_claude_chat_for_a_person_and_takes_it_up_with_the_turn_stopped() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        // This scenario holds its first turn open until it is interrupted.
        let (executable, id, started) = start_claude_chat(&mut session, 640, "interrupt-any").await;
        let sent = send(&mut session, 641, id, started, "hello fake Claude").await;
        assert!(matches!(sent, ServerMsg::Reply(Reply::ConversationSent(_))), "{sent:?}");

        write_transcript(&mut session, true).await;
        restart_daemon(&mut session, id).await;

        assert!(listed(&session, id).interrupted, "listed for the person to take up");
        assert_eq!(listed(&session, id).status, Status::Blocked, "it needs the person");
        let fenced = generation(&session, id);
        assert!(fenced > started, "the restart fenced the old generation");

        let resumed = resume_by_hand(&mut session, 642, id).await;

        assert!(resumed > fenced, "one start, at the next generation");
        let state = &session.daemon.conversation_states[&id];
        assert!(state.history_ready && state.error.is_none(), "{:?}", state.error);
        assert_cut_turn_stopped(&session, id);
        assert!(!listed(&session, id).interrupted, "taken up, it is no longer listed");
        assert_eq!(session.daemon.conversations.len(), 1, "no second conversation appeared");
        assert_eq!(claude_messages(&executable).await, 1, "the prompt was not sent again");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_daemon_restart_between_turns_takes_a_claude_chat_up_again_from_its_transcript_when_opened() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (executable, id, started) = start_claude_chat(&mut session, 650, "reply").await;
        let sent = send(&mut session, 651, id, started, "hello fake Claude").await;
        assert!(matches!(sent, ServerMsg::Reply(Reply::ConversationSent(_))), "{sent:?}");
        handle_until(&mut session, "the turn ends", |daemon| {
            daemon.conversation_states.get(&id).is_some_and(|state| state.status == Status::Done)
        })
        .await;
        write_transcript(&mut session, false).await;

        restart_daemon(&mut session, id).await;
        let asleep = listed(&session, id);
        assert!(!asleep.interrupted, "nothing was cut");
        assert_eq!(asleep.status, Status::Idle, "asleep, it is idle and needs nobody");

        // A client opening it is what starts it again.
        let read = exchange(&mut session, 651, ClientMsg::Query(Query::ConversationRead { id, cursor: None, limit: 128 }), None).await;
        let ServerMsg::Reply(Reply::ConversationRead(page)) = read else {
            panic!("{read:?}");
        };
        assert_eq!(page.status, Status::Idle, "the read is answered at once, as idle, while the chat starts");
        resume_decided(&mut session, id).await;

        let state = &session.daemon.conversation_states[&id];
        assert!(state.history_ready && state.error.is_none(), "{:?}", state.error);
        assert_eq!(state.status, Status::Idle, "nothing runs and nothing waits on the person");
        let resumed = generation(&session, id);
        assert!(resumed > started, "the restart fenced the old generation");
        let next = exchange(
            &mut session,
            652,
            ClientMsg::Command(Command::ConversationSend {
                id,
                generation: resumed,
                operation: 2,
                // The fake echoes these words back, which is how the daemon knows a send arrived.
                text: "hello fake Claude".into(),
                choice: None,
            }),
            None,
        )
        .await;
        assert!(matches!(next, ServerMsg::Reply(Reply::ConversationSent(_))), "{next:?}");
        handle_until(&mut session, "the next turn ends", |daemon| {
            daemon.conversation_states.get(&id).is_some_and(|state| state.status == Status::Done)
        })
        .await;
        assert_eq!(claude_messages(&executable).await, 2, "the chat goes on, and only the new message is sent");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// A Claude chat that finished a turn, whose daemon then restarted with no transcript to read back:
/// asleep, and woken by the first read.
async fn asleep_without_a_transcript(session: &mut TestSession, client: u64) -> (ConversationId, u64) {
    let (_, id, started) = start_claude_chat(session, client, "reply").await;
    let sent = send(session, client + 1, id, started, "hello fake Claude").await;
    assert!(matches!(sent, ServerMsg::Reply(Reply::ConversationSent(_))), "{sent:?}");
    handle_until(session, "the turn ends", |daemon| {
        daemon.conversation_states.get(&id).is_some_and(|state| state.status == Status::Done)
    })
    .await;
    let binding = session.daemon.conversations[0].binding.clone();
    session.daemon.followed_home = Some(binding.config_root.clone());
    // The fake agent wrote its own transcript; the chat's past is gone from where the daemon reads it.
    let path = super::super::claude::transcript_path(&binding.config_root, &binding.cwd, &binding.session_id).unwrap();
    tokio::task::spawn_blocking(move || std::fs::remove_file(path)).await.unwrap().unwrap();
    restart_daemon(session, id).await;
    (id, started)
}

/// Handles events until the saved history of `id` was read and the chat is settled.
async fn read_settled(session: &mut TestSession, id: ConversationId) {
    handle_until(session, "the saved history is read", |daemon| {
        let in_flight = daemon.conversation_requests.values().any(|pending| pending.conversation() == id);
        !daemon.saved_reads.contains(&id)
            && !in_flight
            && daemon.conversation_states.get(&id).is_some_and(|state| state.history_ready || state.error.is_some())
    })
    .await;
}

fn open_chat(session: &mut TestSession, id: ConversationId) {
    session.daemon.wake_conversation(id);
}

#[tokio::test]
async fn a_chat_whose_saved_history_cannot_be_read_is_stopped_with_the_reason_and_reconnects() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (id, started) = asleep_without_a_transcript(&mut session, 660).await;

        open_chat(&mut session, id);
        read_settled(&mut session, id).await;

        let state = &session.daemon.conversation_states[&id];
        assert_eq!(state.status, Status::Blocked);
        assert!(!state.history_ready);
        let reason = state.error.clone().unwrap();
        assert!(reason.contains("saved conversation could not be read"), "the real reason, not the generic one: {reason}");
        assert!(!session.daemon.conversation_runtimes.owns(id), "no half-alive runtime is left");
        let record = &session.daemon.conversations[0];
        assert_eq!(record.state, RecoveryState::Stopped);
        assert!(record.generation > started);

        // The read of the stopped chat wakes it once more; it fails again, and the reason stays.
        exchange(&mut session, 662, ClientMsg::Query(Query::ConversationRead { id, cursor: None, limit: 128 }), None).await;
        read_settled(&mut session, id).await;
        exchange(&mut session, 662, ClientMsg::Query(Query::ConversationRead { id, cursor: None, limit: 128 }), None).await;
        assert_eq!(session.daemon.conversation_states[&id].error.as_deref(), Some(reason.as_str()));

        write_transcript(&mut session, false).await;
        resume_by_hand(&mut session, 663, id).await;
        let state = &session.daemon.conversation_states[&id];
        assert!(state.history_ready && state.error.is_none(), "{:?}", state.error);
        assert!(session.daemon.conversation_runtimes.owns(id));

        let current = generation(&session, id);
        let again = exchange(
            &mut session,
            664,
            ClientMsg::Command(Command::ConversationStart {
                target: StartTarget::Conversation { id, generation: current },
                branch: None,
            }),
            None,
        )
        .await;
        let ServerMsg::Error(refusal) = again else { panic!("{again:?}") };
        assert!(refusal.contains("already owns a runtime"), "a healthy chat is still refused: {refusal}");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_failed_wake_is_tried_once_more_by_the_next_read() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (id, _) = asleep_without_a_transcript(&mut session, 670).await;

        open_chat(&mut session, id);
        read_settled(&mut session, id).await;
        assert!(session.daemon.conversation_states[&id].error.is_some());
        assert!(session.daemon.is_asleep(id), "put back to sleep for another try");

        write_transcript(&mut session, false).await;
        open_chat(&mut session, id);
        handle_until(&mut session, "the second wake reads the chat", |daemon| {
            daemon.conversation_states.get(&id).is_some_and(|state| state.history_ready)
        })
        .await;
        assert!(session.daemon.conversation_runtimes.owns(id));
        assert!(session.daemon.conversation_states[&id].error.is_none());
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_wake_that_fails_twice_is_not_tried_again_by_reads() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (id, _) = asleep_without_a_transcript(&mut session, 680).await;
        for _ in 0..2 {
            open_chat(&mut session, id);
            read_settled(&mut session, id).await;
        }
        assert!(!session.daemon.is_asleep(id), "left for a person to reconnect");
        let before = generation(&session, id);
        open_chat(&mut session, id);
        assert_eq!(generation(&session, id), before, "a third read starts nothing");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_reconnect_while_the_chat_is_still_reading_its_past_is_told_it_is_already_reconnecting() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (id, _) = asleep_without_a_transcript(&mut session, 690).await;
        write_transcript(&mut session, false).await;

        open_chat(&mut session, id);
        handle_until(&mut session, "the saved history read begins", |daemon| daemon.saved_reads.contains(&id)).await;
        let during = session.daemon.conversation_start(
            crate::daemon::conversation::commands::DAEMON_REQUESTER - 1,
            StartTarget::Conversation { id, generation: generation(&session, id) },
        );
        assert!(during.unwrap_err().to_string().contains("already reconnecting"));

        read_settled(&mut session, id).await;
        let state = &session.daemon.conversation_states[&id];
        assert!(state.history_ready && state.error.is_none(), "the read in flight was not disturbed: {:?}", state.error);
        assert!(session.daemon.conversation_runtimes.owns(id));
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_chat_stuck_up_with_its_history_unread_is_recovered_by_reconnect() {
    let mut session = conversation_fixture("conversation").await;
    let outcome = AssertUnwindSafe(async {
        let (_, id, started) = start_claude_chat(&mut session, 700, "reply").await;
        // The state a failed hydration left before: a live runtime and a history that is not ready.
        session.daemon.conversation_states.entry(id).or_default().history_ready = false;
        assert!(session.daemon.conversation_runtimes.owns(id));
        write_transcript(&mut session, false).await;

        let resumed = resume_by_hand(&mut session, 701, id).await;

        assert!(resumed > started);
        let state = &session.daemon.conversation_states[&id];
        assert!(state.history_ready && state.error.is_none(), "{:?}", state.error);
        assert!(session.daemon.conversation_runtimes.owns(id));
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn an_agent_that_ends_with_a_daemon_that_is_stopping_is_no_failure_to_tell_clients() {
    for (stopping, told) in [(true, false), (false, true)] {
        let mut session = conversation_fixture("conversation-cancel").await;
        let outcome = AssertUnwindSafe(async {
            let (id, started) = create(&mut session).await;
            let sent = send(&mut session, 710, id, started, "Synthetic prompt").await;
            assert!(matches!(sent, ServerMsg::Reply(Reply::ConversationSent(_))), "{sent:?}");
            let (tx, mut heard) = mpsc::channel::<ServerMsg>(16);
            session.daemon.clients.insert(
                7_100,
                crate::daemon::Client {
                    tx,
                    attach: true,
                    surface: crate::protocol::Surface::Desktop,
                    from: None,
                    structured: None,
                    rejected: false,
                    behind: std::cell::Cell::new(false),
                },
            );
            session.daemon.stopping = stopping;

            kill(session.fixture.pids().await).await;
            handle_until(&mut session, "the provider's exit is noticed", |daemon| !daemon.conversation_runtimes.owns(id)).await;

            let mut errors = 0;
            while let Ok(message) = heard.try_recv() {
                errors += usize::from(matches!(message, ServerMsg::Error(_)));
            }
            assert_eq!(errors > 0, told, "stopping = {stopping}");
        })
        .catch_unwind()
        .await;
        session.cleanup().await;
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }
}
