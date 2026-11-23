//! Helpers past the limit wait for a free slot (`helper_queue.rs`), driven through a real
//! daemon with real panes (plain shells).

use super::logic_tests::{close, daemon, from_pane};
use super::*;
use std::time::Duration;

/// The client a starter's own starts come from.
const STARTER: ClientId = 1;

/// A daemon with one session that starts helpers, at most `limit` working at once, and what
/// that session is told.
fn lead(limit: &str) -> (Daemon, TermId, mpsc::Receiver<ServerMsg>) {
    let (mut d, _events) = daemon();
    d.cfg.sessions.helpers_at_once = limit.into();
    d.command(
        0,
        Command::NewWorkspace {
            cwd: Some(std::env::temp_dir()),
            name: None,
            cmd: None,
        },
    )
    .unwrap();
    let starter = d.workspaces[0].tabs[0].focus;
    let token = d.terms[&starter].token.clone();
    let told = from_pane(&mut d, STARTER, starter, &token);
    (d, starter, told)
}

/// The starter starts a helper; its id when a pane was made for it.
fn start(d: &mut Daemon, cmd: Option<&str>) -> Option<TermId> {
    let before: Vec<TermId> = d.terms.keys().copied().collect();
    d.handle(Ev::Msg(
        STARTER,
        ClientMsg::Command(Command::NewWorkspace {
            cwd: Some(std::env::temp_dir()),
            name: None,
            cmd: cmd.map(str::to_string),
        }),
    ));
    d.terms.keys().copied().find(|t| !before.contains(t))
}

fn refusal(told: &mut mpsc::Receiver<ServerMsg>) -> Option<String> {
    std::iter::from_fn(|| told.try_recv().ok()).find_map(|m| match m {
        ServerMsg::Error(e) => Some(e),
        _ => None,
    })
}

fn waits(d: &Daemon, term: TermId) -> bool {
    d.snapshot().terms[&term].waiting_for_slot
}

/// As if `term` had been up a while: a helper past its first seconds, a held shell at its prompt.
fn age(d: &mut Daemon, term: TermId) {
    d.terms.get_mut(&term).unwrap().born =
        Instant::now() - super::HELPER_SETTLES - Duration::from_secs(1);
}

fn finish(d: &mut Daemon, term: TermId) {
    age(d, term);
    d.terms.get_mut(&term).unwrap().status = Status::Done;
}

fn close_all(d: &mut Daemon) {
    let all: Vec<TermId> = d.terms.keys().copied().collect();
    close(d, &all);
}

#[test]
fn a_helper_past_the_limit_waits_as_a_working_row_and_starts_in_order_as_slots_free() {
    let (mut d, _starter, mut told) = lead("2");
    let helpers: Vec<TermId> = (0..4)
        .map(|_| start(&mut d, None).expect("a row at once"))
        .collect();
    assert!(
        refusal(&mut told).is_none(),
        "past the limit a start is not refused"
    );
    for running in &helpers[..2] {
        assert!(!waits(&d, *running));
    }
    for (place, waiting) in helpers[2..].iter().enumerate() {
        let row = &d.snapshot().terms[waiting];
        assert!(row.waiting_for_slot);
        assert_eq!(row.status, Status::Working, "the daemon reports it working");
        assert!(
            row.status_why
                .contains(&format!("{} of 2 in line", place + 1)),
            "{}",
            row.status_why
        );
        assert_eq!(
            row.summary, row.status_why,
            "its starter reads the same line in its list"
        );
    }
    // Both slots are taken: nothing starts, however long the waiting ones have been up.
    age(&mut d, helpers[2]);
    age(&mut d, helpers[3]);
    d.start_waiting_helpers();
    assert!(waits(&d, helpers[2]) && waits(&d, helpers[3]));
    // One finishes: the one that waited longest starts, and the other moves up.
    finish(&mut d, helpers[0]);
    d.start_waiting_helpers();
    assert!(
        !waits(&d, helpers[2]),
        "the oldest waiting helper has the free slot"
    );
    assert_ne!(
        d.terms[&helpers[2]].status,
        Status::Working,
        "its agent has not reported yet"
    );
    assert!(waits(&d, helpers[3]), "one slot, one start");
    assert!(d.terms[&helpers[3]].status_why.contains("1 of 1 in line"));
    // It counts as working from the moment it starts, so the next still waits for the other.
    d.start_waiting_helpers();
    assert!(waits(&d, helpers[3]));
    finish(&mut d, helpers[1]);
    d.start_waiting_helpers();
    assert!(!waits(&d, helpers[3]));
    assert_eq!(
        d.terms.len(),
        5,
        "every helper kept the session it was given"
    );
    close_all(&mut d);
}

#[test]
fn a_new_helper_goes_behind_the_ones_already_waiting() {
    let (mut d, _starter, _told) = lead("2");
    let helpers: Vec<TermId> = (0..3).map(|_| start(&mut d, None).unwrap()).collect();
    // A slot frees before the tick has started the one waiting: a newcomer does not take it.
    finish(&mut d, helpers[0]);
    let late = start(&mut d, None).unwrap();
    assert!(waits(&d, late), "it waits its turn");
    age(&mut d, helpers[2]);
    age(&mut d, late);
    d.start_waiting_helpers();
    assert!(!waits(&d, helpers[2]) && waits(&d, late));
    close_all(&mut d);
}

#[test]
fn what_you_start_yourself_never_waits_and_never_counts() {
    let (mut d, _starter, _told) = lead("2");
    for _ in 0..3 {
        start(&mut d, None).unwrap();
    }
    d.command(
        0,
        Command::NewWorkspace {
            cwd: Some(std::env::temp_dir()),
            name: None,
            cmd: None,
        },
    )
    .unwrap();
    let yours = *d.terms.keys().max().unwrap();
    assert!(!waits(&d, yours));
    assert_eq!(d.terms[&yours].started_by, None);
    close_all(&mut d);
}

#[test]
fn raising_the_limit_starts_the_waiting_and_lowering_it_stops_nothing() {
    let (mut d, _starter, _told) = lead("2");
    let helpers: Vec<TermId> = (0..4).map(|_| start(&mut d, None).unwrap()).collect();
    age(&mut d, helpers[2]);
    age(&mut d, helpers[3]);
    d.cfg.sessions.helpers_at_once = "4".into();
    d.start_waiting_helpers();
    assert!(
        helpers.iter().all(|t| !waits(&d, *t)),
        "room for all four now"
    );
    // Four work; the limit drops to two. None is stopped, and the next start waits.
    for helper in &helpers {
        d.terms.get_mut(helper).unwrap().status = Status::Working;
    }
    d.cfg.sessions.helpers_at_once = "2".into();
    d.start_waiting_helpers();
    assert_eq!(d.terms.len(), 5);
    assert!(
        helpers
            .iter()
            .all(|t| d.terms[t].status == Status::Working && !waits(&d, *t))
    );
    let next = start(&mut d, None).unwrap();
    assert!(waits(&d, next));
    close_all(&mut d);
}

#[test]
fn when_the_starter_closes_its_waiting_helpers_go_and_its_running_ones_stay() {
    let (mut d, starter, _told) = lead("2");
    let helpers: Vec<TermId> = (0..4).map(|_| start(&mut d, None).unwrap()).collect();
    d.close_term(starter);
    d.start_waiting_helpers();
    assert!(d.terms.contains_key(&helpers[0]) && d.terms.contains_key(&helpers[1]));
    assert!(!d.terms.contains_key(&helpers[2]) && !d.terms.contains_key(&helpers[3]));
    assert!(
        d.workspaces
            .iter()
            .all(|w| w.tabs.iter().all(|t| !t.layout.contains(helpers[2]))),
        "its row is gone with it"
    );
    close_all(&mut d);
}

#[test]
fn closing_a_waiting_helper_takes_it_out_of_the_line() {
    let (mut d, _starter, _told) = lead("2");
    let helpers: Vec<TermId> = (0..4).map(|_| start(&mut d, None).unwrap()).collect();
    d.close_term(helpers[2]);
    age(&mut d, helpers[3]);
    d.start_waiting_helpers();
    assert!(d.terms[&helpers[3]].status_why.contains("1 of 1 in line"));
    finish(&mut d, helpers[0]);
    d.start_waiting_helpers();
    assert!(
        !waits(&d, helpers[3]),
        "the next in line has the slot the closed one would have had"
    );
    close_all(&mut d);
}

#[test]
fn only_so_many_helpers_wait_and_a_start_past_that_is_refused() {
    let (mut d, _starter, mut told) = lead("2");
    for _ in 0..2 + super::helper_queue::MOST_WAITING {
        start(&mut d, None).expect("room to work or to wait");
    }
    assert!(refusal(&mut told).is_none());
    assert!(start(&mut d, None).is_none(), "no pane is made for it");
    let why = refusal(&mut told).expect("told why");
    assert!(
        why.contains("already waiting for a free slot") && why.contains("Wait for some to finish"),
        "{why}"
    );
    close_all(&mut d);
}

#[test]
fn a_held_start_survives_a_restart_and_starts_once() {
    let (mut d, _starter, _told) = lead("2");
    start(&mut d, None).unwrap();
    start(&mut d, None).unwrap();
    let held = start(&mut d, Some("echo held")).unwrap();
    assert!(
        d.terms[&held].cmd.is_none(),
        "only a shell runs in it while it waits"
    );
    let saved = d.saved();

    let (mut d2, _events) = daemon();
    d2.cfg.sessions.helpers_at_once = "2".into();
    assert!(d2.restore(saved));
    let waiting: Vec<TermId> = d2
        .terms
        .keys()
        .copied()
        .filter(|t| waits(&d2, *t))
        .collect();
    assert_eq!(waiting.len(), 1, "still waiting, and nothing else is");
    let back = waiting[0];
    assert_eq!(d2.terms[&back].status, Status::Working);
    assert!(
        d2.terms[&back].interrupted.is_none(),
        "no turn was cut: none had begun"
    );
    let starter = d2.terms[&back]
        .started_by
        .expect("its starter came back with it");
    let running: Vec<TermId> = d2
        .terms
        .values()
        .filter(|t| t.started_by == Some(starter) && t.id != back)
        .map(|t| t.id)
        .collect();
    assert_eq!(running.len(), 2);
    // Its starter's other helpers still hold the slots.
    age(&mut d2, back);
    d2.start_waiting_helpers();
    assert!(waits(&d2, back));
    finish(&mut d2, running[0]);
    d2.start_waiting_helpers();
    assert!(!waits(&d2, back));
    assert_eq!(
        d2.terms[&back].cmd.as_deref(),
        Some("echo held"),
        "started with what was held"
    );
    // The hold is gone from what is saved next, so another restart cannot start it again.
    let again = d2.saved();
    assert!(again.workspaces.iter().all(|w| {
        w.tabs
            .iter()
            .all(|t| t.panes.values().all(|p| p.waiting.is_none()))
    }));
    close_all(&mut d);
    close_all(&mut d2);
}

#[test]
fn a_session_saved_before_starts_were_held_loads_as_not_waiting() {
    let old: persist::SavedPane =
        serde_json::from_str(r#"{"cwd": null, "cmd": null, "agent": null, "session": null}"#)
            .unwrap();
    assert!(old.waiting.is_none());
    let now = serde_json::to_value(persist::SavedPane::default()).unwrap();
    assert!(
        now.get("waiting").is_none(),
        "a pane that does not wait saves as it always did"
    );
}

#[test]
fn a_waiting_helper_whose_starter_did_not_come_back_is_cancelled() {
    let (mut d, starter, _told) = lead("2");
    let helpers: Vec<TermId> = (0..3).map(|_| start(&mut d, None).unwrap()).collect();
    let mut saved = d.saved();
    // The starter's pane is lost from the saved session.
    for ws in &mut saved.workspaces {
        ws.tabs.retain(|tab| !tab.layout.contains(starter));
    }
    saved.workspaces.retain(|ws| !ws.tabs.is_empty());
    let (mut d2, _events) = daemon();
    assert!(d2.restore(saved));
    assert_eq!(d2.terms.len(), helpers.len());
    d2.start_waiting_helpers();
    assert_eq!(
        d2.terms.len(),
        2,
        "the two that ran are on their own; the one that never started is gone"
    );
    assert!(d2.terms.keys().all(|t| !waits(&d2, *t)));
    close_all(&mut d);
    close_all(&mut d2);
}

#[test]
fn consent_comes_before_any_waiting() {
    let (mut d, starter, mut told) = lead("2");
    d.terms.get_mut(&starter).unwrap().agent = Some("claude".into());
    let panes = d.terms.len();
    d.cfg.sessions.helpers = "never".into();
    assert!(start(&mut d, None).is_none());
    assert!(refusal(&mut told).unwrap().contains("turned helpers off"));
    d.cfg.sessions.helpers = "ask".into();
    assert!(start(&mut d, None).is_none());
    assert!(
        refusal(&mut told)
            .unwrap()
            .contains(crate::protocol::HELPERS_AWAIT_OK)
    );
    assert_eq!(
        d.terms.len(),
        panes,
        "nothing is made, and nothing waits, until you answer"
    );
    assert_eq!(d.terms[&starter].helpers.asked.len(), 1);
    // Allowed: the limit then decides between working and waiting, never refusing.
    d.cfg.sessions.helpers = "always".into();
    let helpers: Vec<TermId> = (0..3).map(|_| start(&mut d, None).unwrap()).collect();
    assert!(!waits(&d, helpers[1]) && waits(&d, helpers[2]));
    close_all(&mut d);
}

#[test]
fn a_waiting_helpers_status_is_the_daemons_alone_until_it_starts() {
    let (mut d, _starter, _told) = lead("2");
    let helpers: Vec<TermId> = (0..3)
        .map(|_| start(&mut d, Some("claude 'tidy the footer'")).unwrap())
        .collect();
    let waiting = helpers[2];
    assert_eq!(
        d.terms[&waiting].agent.as_deref(),
        Some("claude"),
        "the row reads as the agent it will be"
    );
    // Nothing read off the pane moves it: not a report, not its screen, not the process scan.
    d.hook(waiting, "claude".into(), HookStatus::Done, "Stop", &[]);
    d.set_status(waiting, Status::Done, "screen: looks finished");
    d.set_status(waiting, Status::Blocked, "screen: looks like a question");
    d.handle(Ev::Scan(vec![scan::Found {
        term: waiting,
        process: "bash".into(),
        agent: None,
        cwd: None,
        agent_cwd: None,
        agent_pid: None,
        claude_dir: None,
        mem: 0,
        cpu: 0.0,
        remote: None,
    }]));
    d.update_statuses();
    d.settled_alerts();
    let t = &d.terms[&waiting];
    assert_eq!(t.status, Status::Working);
    assert_eq!(t.agent.as_deref(), Some("claude"));
    assert!(
        t.alert_due.is_none() && t.alerted.is_none(),
        "it never rings, and is never said to be done"
    );
    assert!(
        t.quiet_since.is_none(),
        "silent because nothing runs, not because it hangs"
    );
    // Once it starts, its agent's reports decide again.
    finish(&mut d, helpers[0]);
    age(&mut d, waiting);
    d.start_waiting_helpers();
    assert!(!waits(&d, waiting));
    let started = d.terms[&waiting]
        .cmd
        .clone()
        .expect("its command was typed");
    assert!(
        started.starts_with("claude") && started.ends_with("'tidy the footer'"),
        "{started}"
    );
    d.set_status(waiting, Status::Working, "hook: UserPromptSubmit");
    d.set_status(waiting, Status::Done, "hook: Stop");
    assert_eq!(d.terms[&waiting].status, Status::Done);
    close_all(&mut d);
}

#[test]
fn text_an_agent_sends_a_waiting_helper_is_kept_for_its_agent_not_typed_into_the_shell() {
    let (mut d, _starter, mut told) = lead("2");
    d.cfg.mcp.grants = vec!["start".into(), "write".into()];
    let helpers: Vec<TermId> = (0..3).map(|_| start(&mut d, None).unwrap()).collect();
    let waiting = helpers[2];
    let typed_before = d.terms[&waiting].last_input;
    for data in [
        "\x1b[200~also run\nthe tests\x1b[201~",
        "\r",
        "and say when",
    ] {
        d.handle(Ev::Msg(
            STARTER,
            ClientMsg::Input {
                term: waiting,
                data: data.as_bytes().to_vec(),
            },
        ));
    }
    assert!(refusal(&mut told).is_none());
    let t = &d.terms[&waiting];
    assert_eq!(
        t.held_message.as_ref().map(|held| held.text.as_str()),
        Some("also run\nthe tests\nand say when")
    );
    assert_eq!(t.last_input, typed_before, "nothing reached the shell");
    // No more than a bounded amount is kept.
    let much = vec![b'x'; 16 * 1024];
    for _ in 0..8 {
        d.handle(Ev::Msg(
            STARTER,
            ClientMsg::Input {
                term: waiting,
                data: much.clone(),
            },
        ));
    }
    assert!(
        refusal(&mut told)
            .unwrap()
            .contains("as much text as it can keep")
    );
    // A helper that is running is typed into as before.
    d.handle(Ev::Msg(
        STARTER,
        ClientMsg::Input {
            term: helpers[0],
            data: b"x".to_vec(),
        },
    ));
    assert!(d.terms[&helpers[0]].held_message.is_none());
    close_all(&mut d);
}

#[test]
fn a_command_that_would_not_type_as_written_is_not_held() {
    let (mut d, _starter, mut told) = lead("2");
    start(&mut d, None).unwrap();
    start(&mut d, None).unwrap();
    assert!(
        start(&mut d, Some("claude 'a\tb'")).is_none(),
        "a tab would be read as a key"
    );
    let why = refusal(&mut told).unwrap();
    assert!(
        why.contains("at once is the limit") && why.contains("Wait for one to finish"),
        "{why}"
    );
    let lines = start(&mut d, Some("echo 'two\nlines'")).expect("line breaks are text");
    assert!(waits(&d, lines));
    close_all(&mut d);
}

#[test]
fn a_start_whose_worktree_is_already_made_is_never_refused() {
    let (mut d, starter, _told) = lead("2");
    for _ in 0..2 + super::helper_queue::MOST_WAITING {
        start(&mut d, None).unwrap();
    }
    let by = super::helpers::Starter::Pane(starter);
    assert!(
        d.must_wait(by, None).is_err(),
        "asked for now, it is refused"
    );
    // Its worktree was made while there was room in line: refusing now would strand it.
    d.starting_in_made_worktree = true;
    assert!(d.must_wait(by, None).unwrap(), "it waits with the rest");
    assert!(
        !d.must_wait(by, Some("claude 'a\tb'")).unwrap(),
        "one that cannot be held starts"
    );
    d.starting_in_made_worktree = false;
    close_all(&mut d);
}

#[test]
fn a_helper_that_waits_never_takes_an_agent_kept_warm() {
    let (mut d, _starter, _told) = lead("2");
    start(&mut d, None).unwrap();
    start(&mut d, None).unwrap();
    d.command(
        0,
        Command::Prewarm {
            cwd: std::env::temp_dir(),
            cmd: "echo warm".into(),
        },
    )
    .unwrap();
    let spare = d.warm_term().expect("a spare is running");
    let held = start(&mut d, Some("echo warm")).expect("a row of its own");
    assert_ne!(held, spare, "a running agent is not a held start");
    assert!(waits(&d, held));
    assert_eq!(
        d.warm_term(),
        Some(spare),
        "the spare is still kept for whoever asked for it"
    );
    close_all(&mut d);
}

#[test]
fn a_helper_is_named_by_its_task_whether_it_starts_at_once_or_waits_first() {
    let (mut d, _starter, _told) = lead("2");
    // A path nothing is at: the row reads as Claude, and no agent runs.
    let task = |what: &str| format!("/no-such-folder/claude '{what}\nthen run the tests'");
    let now = start(&mut d, Some(&task("Fix the login bug"))).unwrap();
    let row = &d.snapshot().terms[&now];
    assert_eq!(
        row.name, "Fix the login bug",
        "named by the first line of its task"
    );
    assert_eq!(
        row.summary, "Fix the login bug",
        "and that is what it is on"
    );
    start(&mut d, None).unwrap();
    let later = start(&mut d, Some(&task("Port the footer"))).unwrap();
    assert!(waits(&d, later));
    let row = &d.snapshot().terms[&later];
    assert_eq!(
        row.name, "Port the footer",
        "a waiting helper has its name already"
    );
    assert!(row.summary.contains("in line"), "{}", row.summary);
    finish(&mut d, now);
    age(&mut d, later);
    d.start_waiting_helpers();
    assert!(!waits(&d, later));
    let row = &d.snapshot().terms[&later];
    assert_eq!(
        row.name, "Port the footer",
        "it keeps its name once it starts"
    );
    assert_eq!(row.summary, "Port the footer");
    // A session you start yourself is named by what you send it, not here.
    d.command(
        0,
        Command::NewWorkspace {
            cwd: Some(std::env::temp_dir()),
            name: None,
            cmd: Some(task("Not a helper")),
        },
    )
    .unwrap();
    let yours = *d.terms.keys().max().unwrap();
    assert_eq!(d.terms[&yours].started_by, None);
    assert_eq!(d.snapshot().terms[&yours].name, "");
    close_all(&mut d);
}
