//! The provider process: handshake, ownership, disposal and what a dying daemon leaves.

use super::*;

#[tokio::test]
async fn disconnect_preserves_daemon_owned_child_and_disposal_kills_startup_descendant() {
    with_fixture(move |session| {
        Box::pin(async move {
            let TestSession {
                fixture: f,
                daemon: d,
                events: rx,
            } = session;
            let (client, mut messages) = mpsc::channel::<ServerMsg>(8);
            d.handle(Ev::Connected(11, client, false, crate::protocol::Surface::Terminal, true));
            d.start_conversation(f.launch("normal")).unwrap();
            let ready = next(rx).await;
            assert!(matches!(ready.payload, Payload::Ready));
            let owner = ready.owner;
            d.handle(Ev::Conversation(ready));
            d.handle(Ev::Disconnected(11));
            assert!(messages.recv().await.is_none());
            let notification = next(rx).await;
            assert_eq!(notification.owner, owner);
            match &notification.payload {
                Payload::Notification { method, params } => {
                    assert_eq!(method, "test/ready");
                    assert_eq!(params["accountEnv"], "selected-account-effective-env");
                }
                _ => panic!("expected post-disconnect child event"),
            }
            d.handle(Ev::Conversation(notification));
            assert_eq!(d.conversations[0].state, RecoveryState::Running);
            let pids = f.pids().await;
            assert_eq!(pids.len(), 2);
            let observed = pids.clone();
            tokio::task::spawn_blocking(move || {
                let mut system = sysinfo::System::new();
                system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
                for pid in observed {
                    assert!(system.process(sysinfo::Pid::from_u32(pid)).is_some());
                }
            })
            .await
            .unwrap();
            d.dispose_conversation(f.record.id).unwrap();
            let terminated = next(rx).await;
            assert!(matches!(
                terminated.payload,
                Payload::Terminated {
                    failure: None,
                    reaped: true
                }
            ));
            d.handle(Ev::Conversation(terminated));
            assert_eq!(d.conversations[0].state, RecoveryState::Stopped);
            stopped(pids).await;
        })
    })
    .await;
}

#[tokio::test]
async fn failed_handshakes_are_visible_and_dispose_the_process_tree() {
    for (mode, expected) in [
        ("malformed", "Malformed Codex JSON frame"),
        ("oversize", "exceeds size limit"),
        ("closed", "Codex stdout closed"),
        ("timeout", "initialize timed out"),
        ("wrong-id", "does not match pending request"),
        ("wrong-home", "different configuration root"),
    ] {
        with_fixture(move |session| {
            Box::pin(async move {
                let TestSession {
                    fixture: f,
                    daemon: d,
                    events: rx,
                } = session;
                let (client, mut messages) = mpsc::channel(8);
                let (unrelated, mut unrelated_messages) = mpsc::channel(8);
                d.handle(Ev::Connected(2, unrelated, false, crate::protocol::Surface::Terminal, true));
                d.handle(Ev::Connected(1, client, true, crate::protocol::Surface::Terminal, true));
                d.start_conversation(f.launch(mode)).unwrap();
                let event = next(rx).await;
                match &event.payload {
                    Payload::Terminated {
                        failure: Some(failure),
                        reaped: true,
                    } => {
                        assert!(failure.contains(expected), "{mode}: {failure}");
                        assert!(!failure.contains("PRIVATE_SENTINEL"));
                    }
                    _ => panic!("{mode}: expected a cleaned-up failure"),
                }
                d.handle(Ev::Conversation(event));
                assert_eq!(d.conversations[0].state, RecoveryState::RecoveryRequired);
                tokio::time::timeout(Duration::from_secs(10), async {
                    while let Some(message) = messages.recv().await {
                        if matches!(message, ServerMsg::Error(_)) {
                            return;
                        }
                    }
                    panic!("attached startup observer disconnected before error");
                })
                .await
                .expect("failed startup is visible");
                assert!(
                    unrelated_messages.try_recv().is_err(),
                    "startup failure cannot abort an unrelated one-shot request"
                );
                stopped(f.pids().await).await;
            })
        })
        .await;
    }
}

#[tokio::test]
async fn unknown_response_fails_without_retrying_or_mutating_a_session() {
    with_fixture(move |session| Box::pin(async move {
    let TestSession { fixture: f, daemon: d, events: rx } = session;
    d.start_conversation(f.launch("unexpected-response"))
        .unwrap();
    d.handle(Ev::Conversation(next(rx).await));
    let event = next(rx).await;
    assert!(
        matches!(&event.payload, Payload::Terminated { failure: Some(f), reaped: true } if f.contains("no pending request"))
    );
    d.handle(Ev::Conversation(event));
    stopped(f.pids().await).await;
    })).await;
}

#[tokio::test]
async fn replaced_connection_and_generation_cannot_change_daemon_state() {
    with_fixture(move |session| {
        Box::pin(async move {
            let TestSession {
                fixture: f,
                daemon: d,
                events: rx,
            } = session;
            d.start_conversation(f.launch("normal")).unwrap();
            let ready = next(rx).await;
            let old = ready.owner;
            d.handle(Ev::Conversation(ready));
            let pending = next(rx).await;
            d.dispose_conversation(f.record.id).unwrap();
            assert!(d.start_conversation(f.launch("normal")).is_err());
            d.handle(Ev::Conversation(pending));
            d.handle(Ev::Conversation(next(rx).await));
            let mut replacement = f.launch("normal");
            if let super::super::transport::LaunchIdentity::Existing(record) = &mut replacement.identity {
                record.generation += 1;
                d.conversations[0] = (**record).clone();
            }
            d.start_conversation(replacement).unwrap();
            d.handle(Ev::Conversation(Event {
                owner: old,
                payload: Payload::Ready,
            }));
            assert_eq!(d.conversations[0].state, RecoveryState::Stopped);
            let ready = next(rx).await;
            let current = ready.owner;
            d.handle(Ev::Conversation(ready));
            let mut stale_generation = current;
            stale_generation.generation -= 1;
            let mut obsolete_connection = old;
            obsolete_connection.generation = current.generation;
            for owner in [old, stale_generation, obsolete_connection] {
                d.handle(Ev::Conversation(Event {
                    owner,
                    payload: Payload::Terminated {
                        failure: Some("stale".into()),
                        reaped: true,
                    },
                }));
                assert_eq!(d.conversations[0].state, RecoveryState::Running);
            }
            d.handle(Ev::Conversation(next(rx).await));
            d.dispose_conversation(f.record.id).unwrap();
            d.handle(Ev::Conversation(next(rx).await));
            stopped(f.pids().await).await;
        })
    })
    .await;
}

#[tokio::test]
async fn failed_startup_cleanup_keeps_ownership_until_explicit_disposal_succeeds() {
    with_fixture(move |session| Box::pin(async move {
    let TestSession { fixture: f, daemon: d, events: rx } = session;
    let mut launch = f.launch("normal");
    launch.failure_point = Some(super::transport::FailurePoint::PreflightDisposal);
    d.start_conversation(launch).unwrap();
    let failure = next(rx).await;
    assert!(
        matches!(&failure.payload, Payload::Terminated { failure: Some(error), reaped: false }
        if error.contains("injected provider disposal failure"))
    );
    d.handle(Ev::Conversation(failure));
    d.conversations[0].state = RecoveryState::Stopped;
    assert!(d.start_conversation(f.launch("normal")).is_err());
    d.dispose_conversation(f.record.id).unwrap();
    let disposed = next(rx).await;
    assert!(matches!(
        disposed.payload,
        Payload::Terminated {
            failure: None,
            reaped: true
        }
    ));
    d.handle(Ev::Conversation(disposed));
    d.start_conversation(f.launch("normal")).unwrap();
    d.handle(Ev::Conversation(next(rx).await));
    d.handle(Ev::Conversation(next(rx).await));
    d.dispose_conversation(f.record.id).unwrap();
    d.handle(Ev::Conversation(next(rx).await));
    stopped(f.pids().await).await;
    })).await;
}

#[tokio::test]
async fn failed_disposal_keeps_live_process_ownership_for_an_explicit_retry() {
    with_fixture(move |session| Box::pin(async move {
    let TestSession { fixture: f, daemon: d, events: rx } = session;
    let mut launch = f.launch("normal");
    launch.failure_point = Some(super::transport::FailurePoint::RuntimeDisposal);
    d.start_conversation(launch).unwrap();
    d.handle(Ev::Conversation(next(rx).await));
    d.handle(Ev::Conversation(next(rx).await));
    let pids = f.pids().await;
    d.dispose_conversation(f.record.id).unwrap();
    let failure = next(rx).await;
    assert!(
        matches!(&failure.payload, Payload::Terminated { failure: Some(error), reaped: false }
        if error.contains("injected provider disposal failure"))
    );
    let owner = failure.owner;
    d.handle(Ev::Conversation(failure));
    d.handle(Ev::Conversation(Event {
        owner,
        payload: Payload::Ready,
    }));
    assert_eq!(d.conversations[0].state, RecoveryState::RecoveryRequired);
    d.conversations[0].state = RecoveryState::Stopped;
    assert!(d.start_conversation(f.launch("normal")).is_err());
    let observed = pids.clone();
    tokio::task::spawn_blocking(move || {
        let mut system = sysinfo::System::new();
        system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        for pid in observed {
            assert!(system.process(sysinfo::Pid::from_u32(pid)).is_some());
        }
    })
    .await
    .unwrap();
    d.dispose_conversation(f.record.id).unwrap();
    let disposed = next(rx).await;
    assert!(matches!(
        disposed.payload,
        Payload::Terminated {
            failure: None,
            reaped: true
        }
    ));
    d.handle(Ev::Conversation(disposed));
    stopped(pids).await;
    })).await;
}

#[test]
fn envelope_ids_and_shapes_are_strict_without_exposing_payloads() {
    assert!(matches!(
        decode(r#"{"method":"configWarning","params":{},"emittedAtMs":1234}"#).unwrap(),
        Envelope::Notification { .. }
    ));
    for invalid in [
        r#"{"id":1,"method":"request","params":{},"emittedAtMs":1234}"#,
        r#"{"id":1,"result":{},"emittedAtMs":1234}"#,
        r#"{"method":"notification","params":{},"emittedAtMs":"invalid"}"#,
    ] {
        assert!(decode(invalid).is_err());
    }
    for invalid in [
        "[]",
        "{",
        r#"{"id":null,"result":0}"#,
        r#"{"id":1.5,"result":0}"#,
        r#"{"id":1,"id":2,"result":0}"#,
        r#"{"id":1,"result":0,"error":{}}"#,
        r#"{"id":1,"method":"x","result":0}"#,
        r#"{"method":"x","params":true}"#,
        r#"{"id":1,"error":{"message":"private","code":"invalid"}}"#,
    ] {
        assert!(decode(invalid).is_err(), "accepted {invalid}");
    }
    for (id, expected) in [
        (json!(42), RequestId::Integer(42)),
        (json!("42"), RequestId::Text("42".into())),
    ] {
        match decode(&json!({"id":id,"method":"request/approval","params":{}}).to_string()).unwrap()
        {
            Envelope::Request { id, .. } => assert_eq!(id, expected),
            _ => panic!("expected exact request id"),
        }
    }
}

/// The order Codex 0.166's app-server sent when a turn started one helper (measured live): the
/// parent's `subAgentActivity` items, then the helper's own turn on its own thread. The helper is
/// listed and finishes with its answer; its turn never reaches the conversation's history, error or
/// status.
#[tokio::test]
async fn a_codex_helper_is_listed_and_its_own_turn_never_touches_the_conversation() {
    with_fixture(move |session| {
        Box::pin(async move {
            let TestSession { fixture: f, daemon: d, events: rx } = session;
            d.start_conversation(f.launch("normal")).unwrap();
            let ready = next(rx).await;
            let owner = ready.owner;
            d.handle(Ev::Conversation(ready));
            d.handle(Ev::Conversation(next(rx).await));
            let id = f.record.id;
            let thread = f.record.binding.session_id.clone();
            let before = {
                let state = &d.conversation_states[&id];
                (state.status, state.error.clone(), state.history_ready)
            };
            let started = json!({"type":"subAgentActivity","id":"call_1","kind":"started","agentThreadId":"helper-thread",
                "agentPath":"/root/probe_helper","model":"gpt-a","reasoningEffort":"low","startedAtMs":1_000});
            let finished = json!({"type":"subAgentActivity","id":"subagent-completed-x","kind":"completed",
                "agentThreadId":"helper-thread","agentPath":"/root/probe_helper"});
            let events = [
                ("item/started", json!({"threadId":thread,"turnId":"parent-turn","item":started})),
                ("item/completed", json!({"threadId":thread,"turnId":"parent-turn","item":started})),
                ("turn/started", json!({"threadId":"helper-thread","turn":{"id":"helper-turn","status":"inProgress","items":[]}})),
                ("item/completed", json!({"threadId":"helper-thread","turnId":"helper-turn","item":{"type":"agentMessage","id":"m","text":"pong"}})),
                ("turn/completed", json!({"threadId":"helper-thread","turn":{"id":"helper-turn","status":"completed",
                    "items":[{"type":"agentMessage","id":"m","text":"pong"}]}})),
                ("item/started", json!({"threadId":thread,"turnId":"parent-turn","item":finished})),
            ];
            for (method, params) in events {
                d.handle(Ev::Conversation(Event { owner, payload: Payload::Notification { method: method.into(), params } }));
            }
            let state = &d.conversation_states[&id];
            assert_eq!((state.status, state.error.clone(), state.history_ready), before, "the helper changed nothing of the conversation's");
            let summary = d.conversation_summaries().into_iter().find(|s| s.id == id).unwrap();
            assert_eq!(summary.helpers.len(), 1);
            let helper = &summary.helpers[0];
            assert_eq!((helper.id.as_str(), helper.name.as_str()), ("helper-thread", "probe_helper"));
            assert_eq!((helper.state, helper.result.as_deref()), (crate::protocol::SubagentState::Completed, Some("pong")));
            d.dispose_conversation(id).unwrap();
            d.handle(Ev::Conversation(next(rx).await));
            stopped(f.pids().await).await;
        })
    }).await;
}

/// The stand-in daemon for `kill_server_stops_every_provider_before_the_daemon_exits` is this
/// same test binary run again with this variable set to a scratch folder. `KillServer` ends in
/// `process::exit`, which would end the test runner, so the daemon has to be a process of its own.
#[cfg(unix)]
const STAND_IN_DAEMON_ENV: &str = concat!(env!("APP_ENV"), "_TEST_KILL_SERVER_STAND_IN");

/// Not a test unless the parent started it: a daemon with one live provider that is told to kill
/// the server.
#[cfg(unix)]
#[tokio::test]
async fn kill_server_stand_in_daemon() {
    let Ok(root) = std::env::var(STAND_IN_DAEMON_ENV) else {
        return;
    };
    let root = PathBuf::from(root);
    let fixture = Fixture::new().await;
    let (mut d, mut rx) = daemon(fixture.record.clone());
    let (client, _messages) = mpsc::channel::<ServerMsg>(8);
    d.handle(Ev::Connected(11, client, false, crate::protocol::Surface::Terminal, true));
    d.start_conversation(fixture.launch("normal")).unwrap();
    let ready = next(&mut rx).await;
    assert!(matches!(ready.payload, Payload::Ready));
    d.handle(Ev::Conversation(ready));
    let notification = next(&mut rx).await;
    d.handle(Ev::Conversation(notification));
    let pids = fixture.pids().await;
    assert_eq!(pids.len(), 2, "the provider and the child it started");
    let observed = pids.clone();
    tokio::task::spawn_blocking(move || {
        let mut system = sysinfo::System::new();
        system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        for pid in observed {
            assert!(system.process(sysinfo::Pid::from_u32(pid)).is_some(), "{pid} runs");
        }
    })
    .await
    .unwrap();
    let listed: Vec<String> = pids.iter().map(u32::to_string).collect();
    std::fs::write(root.join("fixture"), fixture.directory.path().as_os_str().as_encoded_bytes()).unwrap();
    std::fs::write(root.join("pids"), listed.join(" ")).unwrap();
    d.handle(Ev::Msg(
        11,
        crate::protocol::ClientMsg::Command(crate::protocol::Command::KillServer { forget: true }),
    ));
    // The daemon ends the process itself; the loop keeps its runtime turning until it does.
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            if let Some(event) = rx.recv().await {
                d.handle(event);
            }
        }
    })
    .await
    .expect_err("the daemon exits after kill-server");
    panic!("kill-server did not end the daemon");
}

#[cfg(unix)]
#[tokio::test]
async fn kill_server_stops_every_provider_before_the_daemon_exits() {
    if std::env::var(STAND_IN_DAEMON_ENV).is_ok() {
        return;
    }
    let scratch = crate::daemon::persist::scratch_dir();
    let root = scratch.path().to_owned();
    let data = root.join("data");
    std::fs::create_dir_all(&data).unwrap();
    let mut daemon = std::process::Command::new(crate::test_support::this_test_binary())
        .args([
            "--exact",
            "daemon::conversation::tests::process::kill_server_stand_in_daemon",
            "--nocapture",
        ])
        .env(STAND_IN_DAEMON_ENV, &root)
        .env(concat!(env!("APP_ENV"), "_DATA_DIR"), &data)
        .env(concat!(env!("APP_ENV"), "_CONFIG"), root.join("config.toml"))
        .env(concat!(env!("APP_ENV"), "_SOCKET"), format!("killserver-{}", std::process::id()))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("start the stand-in daemon");
    let status = tokio::task::spawn_blocking(move || {
        let until = std::time::Instant::now() + Duration::from_secs(60);
        loop {
            if let Some(status) = daemon.try_wait().unwrap() {
                return Some(status);
            }
            if std::time::Instant::now() > until {
                let _ = daemon.kill();
                let _ = daemon.wait();
                return None;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    })
    .await
    .unwrap();
    let pids: Vec<u32> = std::fs::read_to_string(root.join("pids"))
        .expect("the stand-in daemon had a live provider before it was told to exit")
        .split_whitespace()
        .map(|pid| pid.parse().unwrap())
        .collect();
    let fixture_dir = std::fs::read_to_string(root.join("fixture")).ok().map(PathBuf::from);
    let outcome = AssertUnwindSafe(stopped(pids.clone())).catch_unwind().await;
    if outcome.is_err() {
        for pid in &pids {
            // SAFETY: stops processes this test started so a failure leaves nothing behind.
            unsafe { libc::kill(*pid as libc::pid_t, libc::SIGKILL) };
        }
    }
    if let Some(dir) = fixture_dir {
        let _ = std::fs::remove_dir_all(dir);
    }
    assert!(
        status.is_some_and(|status| status.success()),
        "the stand-in daemon exits cleanly after kill-server: {status:?}"
    );
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// The stand-in daemon for the provider-group tests: this test binary run again, with this set to
/// a scratch folder. The daemon has to be a process of its own, since the test ends it.
#[cfg(unix)]
const GROUPS_STAND_IN_ENV: &str = concat!(env!("APP_ENV"), "_TEST_PROVIDER_GROUPS_STAND_IN");

/// Not a test unless the parent started it: a daemon that keeps the provider-groups record and has
/// one live provider, which it then either stops cleanly (`mode` says `clean`) or waits to be killed.
#[cfg(unix)]
#[tokio::test]
async fn provider_groups_stand_in_daemon() {
    let Ok(root) = std::env::var(GROUPS_STAND_IN_ENV) else {
        return;
    };
    let root = PathBuf::from(root);
    let record = root.join("providers");
    crate::daemon::provider_groups::enable(record.clone());
    let clean = std::fs::read_to_string(root.join("mode")).is_ok_and(|mode| mode == "clean");
    let fixture = Fixture::new().await;
    let (mut d, mut rx) = daemon(fixture.record.clone());
    d.start_conversation(fixture.launch("normal")).unwrap();
    let ready = next(&mut rx).await;
    assert!(matches!(ready.payload, Payload::Ready));
    d.handle(Ev::Conversation(ready));
    let notification = next(&mut rx).await;
    d.handle(Ev::Conversation(notification));
    let pids = fixture.pids().await;
    assert_eq!(pids.len(), 2, "the provider and the child it started");
    let listed: Vec<String> = pids.iter().map(u32::to_string).collect();
    let while_running = crate::daemon::provider_groups::Groups::at(record.clone()).entries().len();
    std::fs::write(root.join("fixture"), fixture.directory.path().as_os_str().as_encoded_bytes()).unwrap();
    std::fs::write(root.join("entries_while_running"), while_running.to_string()).unwrap();
    std::fs::write(root.join("pids"), listed.join(" ")).unwrap();
    if clean {
        d.dispose_conversation(fixture.record.id).unwrap();
        let terminated = next(&mut rx).await;
        assert!(matches!(terminated.payload, Payload::Terminated { reaped: true, .. }));
        d.handle(Ev::Conversation(terminated));
        stopped(pids).await;
        return;
    }
    // Wait to be killed; the parent ends this process without letting it clean up.
    tokio::time::sleep(Duration::from_secs(120)).await;
    panic!("the stand-in daemon was never killed");
}

/// Runs the stand-in daemon in `root` and waits for its provider to be up.
#[cfg(unix)]
fn start_groups_stand_in(root: &Path, mode: &str) -> (std::process::Child, Vec<u32>) {
    std::fs::create_dir_all(root).unwrap();
    std::fs::write(root.join("mode"), mode).unwrap();
    let child = std::process::Command::new(crate::test_support::this_test_binary())
        .args([
            "--exact",
            "daemon::conversation::tests::process::provider_groups_stand_in_daemon",
            "--nocapture",
        ])
        .env(GROUPS_STAND_IN_ENV, root)
        .env(concat!(env!("APP_ENV"), "_DATA_DIR"), root.join("data"))
        .env(concat!(env!("APP_ENV"), "_CONFIG"), root.join("config.toml"))
        .env(concat!(env!("APP_ENV"), "_SOCKET"), format!("groups-{}-{mode}", std::process::id()))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("start the stand-in daemon");
    let until = std::time::Instant::now() + Duration::from_secs(60);
    while !root.join("pids").exists() && std::time::Instant::now() < until {
        std::thread::sleep(Duration::from_millis(50));
    }
    let pids = std::fs::read_to_string(root.join("pids"))
        .expect("the stand-in daemon had a live provider")
        .split_whitespace()
        .map(|pid| pid.parse().unwrap())
        .collect();
    (child, pids)
}

#[cfg(unix)]
fn running(pids: &[u32]) -> bool {
    let mut system = sysinfo::System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    pids.iter().any(|pid| {
        system
            .process(sysinfo::Pid::from_u32(*pid))
            .is_some_and(|p| p.status() != sysinfo::ProcessStatus::Zombie)
    })
}

#[cfg(unix)]
#[tokio::test]
async fn a_provider_a_killed_daemon_left_is_stopped_by_the_next_start() {
    if std::env::var(GROUPS_STAND_IN_ENV).is_ok() {
        return;
    }
    let scratch = crate::daemon::persist::scratch_dir();
    let root = scratch.path().to_owned();
    let (mut daemon, pids) = start_groups_stand_in(&root, "kill");
    let record = crate::daemon::provider_groups::Groups::at(root.join("providers"));
    let recorded = record.entries().len();
    daemon.kill().unwrap();
    daemon.wait().unwrap();
    // Nothing in the dead daemon stopped them: this is what the sweep is for.
    let left_running = running(&pids);

    let swept = tokio::task::spawn_blocking({
        let root = root.clone();
        move || crate::daemon::provider_groups::Groups::at(root.join("providers")).sweep()
    })
    .await
    .unwrap();

    let outcome = AssertUnwindSafe(stopped(pids.clone())).catch_unwind().await;
    if outcome.is_err() {
        for pid in &pids {
            // SAFETY: stops processes this test started so a failure leaves nothing behind.
            unsafe { libc::kill(*pid as libc::pid_t, libc::SIGKILL) };
        }
    }
    let fixture_dir = std::fs::read_to_string(root.join("fixture")).ok().map(PathBuf::from);
    if let Some(dir) = fixture_dir {
        let _ = std::fs::remove_dir_all(dir);
    }
    assert_eq!(recorded, 1, "the running daemon recorded the provider's group");
    assert!(left_running, "a killed daemon leaves its provider tree running");
    assert!(
        matches!(swept.as_slice(), [crate::daemon::provider_groups::Swept::Killed { processes, .. }] if *processes >= 1),
        "{swept:?}"
    );
    assert!(record.entries().is_empty(), "the record is empty after the sweep");
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[cfg(unix)]
#[tokio::test]
async fn a_provider_stopped_cleanly_leaves_no_entry_in_the_record() {
    if std::env::var(GROUPS_STAND_IN_ENV).is_ok() {
        return;
    }
    let scratch = crate::daemon::persist::scratch_dir();
    let root = scratch.path().to_owned();
    let (mut daemon, pids) = start_groups_stand_in(&root, "clean");
    let status = tokio::task::spawn_blocking(move || daemon.wait().unwrap()).await.unwrap();
    let while_running = std::fs::read_to_string(root.join("entries_while_running")).unwrap();
    let left = crate::daemon::provider_groups::Groups::at(root.join("providers")).entries();
    if let Ok(dir) = std::fs::read_to_string(root.join("fixture")) {
        let _ = std::fs::remove_dir_all(dir);
    }
    assert!(status.success(), "the stand-in daemon stopped its provider and exited: {status:?}");
    assert_eq!(while_running, "1", "the group was recorded while the provider ran");
    assert!(left.is_empty(), "a clean stop strikes the group: {left:?}");
    assert!(!running(&pids));
}
