//! A request for a pane goes to the machine that has the pane, over that machine's line, and the
//! answer it brings is taken only because the request was made. Each command, against a real
//! daemon behind the fake `ssh` shim.

use super::*;
use crate::terminal_stream::Wire;
use maitty_desktop_client::PaneCommand;
use maitty_shared::protocol::{ClientMsg, Command, Reply, TermId, TermInfo};

const BOX: MachineId = MachineId(1);

impl Watch {
    /// The newest copy of a pane the machine has told of, from a snapshot or a delta.
    fn pane(&self, machine: MachineId, term: TermId) -> Option<TermInfo> {
        let mut found = None;
        for (m, msg) in &self.msgs {
            if *m != machine {
                continue;
            }
            match msg {
                ServerMsg::State(snapshot) => found = snapshot.terms.get(&term).cloned(),
                ServerMsg::TermsChanged { changed, removed, .. } => {
                    if let Some(pane) = changed.iter().find(|pane| pane.id == term) {
                        found = Some(pane.clone());
                    }
                    if removed.contains(&term) {
                        found = None;
                    }
                }
                _ => {}
            }
        }
        found
    }

    fn any_pane(&self, machine: MachineId) -> Option<TermId> {
        self.msgs.iter().find_map(|(m, msg)| match msg {
            ServerMsg::State(s) if *m == machine => s.terms.keys().next().copied(),
            ServerMsg::TermsChanged { changed, .. } if *m == machine => {
                changed.first().map(|pane| pane.id)
            }
            _ => None,
        })
    }

    fn replies(&self, machine: MachineId) -> usize {
        self.msgs
            .iter()
            .filter(|(m, msg)| *m == machine && matches!(msg, ServerMsg::Reply(Reply::Ok)))
            .count()
    }

    fn printed(&self, machine: MachineId, term: TermId) -> String {
        let mut text = String::new();
        for (m, msg) in &self.msgs {
            if let ServerMsg::Output { term: t, data } = msg
                && *m == machine
                && *t == term
            {
                text.push_str(&String::from_utf8_lossy(data));
            }
        }
        text
    }
}

/// A machine that is up, with a pane started on it through the wire, like the window does.
async fn with_a_pane(sandbox: &Sandbox) -> (Watch, Wire, TermId) {
    let mut watch = Watch::new(&[machine("box", sandbox, "proxy")], sandbox, quick(WAIT));
    let wire = Wire::reaching(watch.hub.handle());
    watch
        .until("connected and a snapshot", |w| {
            w.is(BOX, "connected") && w.snapshots(BOX) > 0
        })
        .await;
    let handle = watch.hub.handle();
    handle
        .send(Outgoing {
            machine: BOX,
            msg: ClientMsg::Command(Command::NewWorkspace {
                cwd: None,
                name: None,
                cmd: None,
            }),
        })
        .expect("the line is up");
    watch
        .until("a pane on the machine", |w| w.any_pane(BOX).is_some())
        .await;
    let term = watch.any_pane(BOX).unwrap();
    (watch, wire, term)
}

#[tokio::test]
async fn typing_goes_to_the_pane_of_that_machine() {
    let mut sandbox = Sandbox::new();
    sandbox.start_daemon();
    let (mut watch, wire, term) = with_a_pane(&sandbox).await;
    let token = "TYPED_ON_THE_OTHER_MACHINE_77";
    wire.command(
        Some(1),
        term,
        PaneCommand::Input(format!("echo {token}\r").into_bytes()),
    )
    .expect("the machine takes typing");
    watch
        .until("the shell to print it", |w| {
            w.printed(BOX, term).matches(token).count() >= 2
        })
        .await;
}

#[tokio::test]
async fn a_replay_is_asked_for_over_the_line_and_comes_back_as_that_panes() {
    let mut sandbox = Sandbox::new();
    sandbox.start_daemon();
    let (mut watch, wire, term) = with_a_pane(&sandbox).await;
    wire.command(Some(1), term, PaneCommand::WantReplay)
        .expect("the line is up");
    watch
        .until("the replay", |w| {
            w.msgs.iter().any(|(m, msg)| {
                *m == BOX && matches!(msg, ServerMsg::Replay { term: t, .. } if *t == term)
            })
        })
        .await;
}

#[tokio::test]
async fn a_resize_reaches_the_pane_and_its_answer_is_taken_once() {
    let mut sandbox = Sandbox::new();
    sandbox.start_daemon();
    let (mut watch, wire, term) = with_a_pane(&sandbox).await;
    let before = watch.replies(BOX);
    wire.command(
        Some(1),
        term,
        PaneCommand::Resize {
            cols: 101,
            rows: 31,
        },
    )
    .expect("the line is up");
    watch
        .until("the pane to be that size", |w| {
            w.pane(BOX, term)
                .is_some_and(|pane| (pane.cols, pane.rows) == (101, 31))
        })
        .await;
    watch.until("the answer", |w| w.replies(BOX) > before).await;
}

#[tokio::test]
async fn a_rename_a_pin_and_an_archive_reach_the_pane() {
    let mut sandbox = Sandbox::new();
    sandbox.start_daemon();
    let (mut watch, wire, term) = with_a_pane(&sandbox).await;
    wire.command(Some(1), term, PaneCommand::Rename("nightly".into()))
        .expect("the line is up");
    wire.command(Some(1), term, PaneCommand::Pin(true))
        .expect("the line is up");
    watch
        .until("renamed and pinned", |w| {
            w.pane(BOX, term)
                .is_some_and(|pane| pane.label == "nightly" && pane.pinned)
        })
        .await;
    wire.command(Some(1), term, PaneCommand::Pin(false))
        .expect("the line is up");
    wire.command(Some(1), term, PaneCommand::Archive(true))
        .expect("the line is up");
    watch
        .until("unpinned and archived", |w| {
            w.pane(BOX, term)
                .is_some_and(|pane| !pane.pinned && pane.archived)
        })
        .await;
}

#[tokio::test]
async fn looking_at_a_pane_is_answered_and_the_answer_is_taken_only_once_asked() {
    let mut sandbox = Sandbox::new();
    sandbox.start_daemon();
    let (mut watch, wire, term) = with_a_pane(&sandbox).await;
    let before = watch.replies(BOX);
    wire.command(Some(1), term, PaneCommand::Seen)
        .expect("the line is up");
    watch.until("the answer", |w| w.replies(BOX) > before).await;
    // Nothing is out now, so a second answer from the machine would be ignored.
    let mut hub = watch.hub;
    let asked = lock(&hub.handle.shared.allowance)
        .entry(BOX)
        .or_default()
        .awaiting(Instant::now());
    assert!(!asked, "every request that was made has been answered");
    assert!(
        hub.admit(BOX, ServerMsg::Reply(Reply::Ok)).is_none(),
        "an answer nobody asked for"
    );
}

#[tokio::test]
async fn closing_a_pane_ends_the_one_on_that_machine() {
    let mut sandbox = Sandbox::new();
    sandbox.start_daemon();
    let (mut watch, wire, term) = with_a_pane(&sandbox).await;
    wire.command(Some(1), term, PaneCommand::Close)
        .expect("the line is up");
    watch
        .until("the pane to go", |w| w.pane(BOX, term).is_none())
        .await;
}

#[tokio::test]
async fn typing_to_a_machine_that_is_down_is_refused_naming_it_and_counted() {
    let sandbox = Sandbox::new();
    let mut watch = Watch::new(
        &[machine("box", &sandbox, "auth-fail")],
        &sandbox,
        quick(WAIT),
    );
    let wire = Wire::reaching(watch.hub.handle());
    watch
        .until("needs-login", |w| w.is(BOX, "needs-login"))
        .await;

    for _ in 0..3 {
        let refused = wire
            .command(Some(1), 1, PaneCommand::Input(b"x".to_vec()))
            .expect_err("a machine with no line takes nothing");
        assert_eq!(refused, "box is not connected");
    }
    let refused = wire
        .command(Some(1), 1, PaneCommand::Pin(true))
        .expect_err("nor does it take a command");
    assert_eq!(refused, "box is not connected");
    let handle = watch.hub.handle();
    assert_eq!(handle.take_unsent(BOX), 3, "only the typing is counted");
    assert_eq!(handle.take_unsent(BOX), 0, "and counted once");
}

#[tokio::test]
async fn a_machine_that_is_not_ours_is_refused_and_not_counted() {
    let sandbox = Sandbox::new();
    let watch = Watch::new(&[], &sandbox, quick(WAIT));
    let wire = Wire::reaching(watch.hub.handle());
    let refused = wire
        .command(Some(9), 1, PaneCommand::Input(b"x".to_vec()))
        .expect_err("not one of ours");
    assert_eq!(refused, "Machine 9 is not one of this computer's machines");
    assert_eq!(watch.hub.handle().take_unsent(MachineId(9)), 0);
}

#[tokio::test]
async fn this_computers_own_refusal_is_the_words_it_always_had() {
    let sandbox = Sandbox::new();
    let watch = Watch::new(&[], &sandbox, quick(WAIT));
    let wire = Wire::reaching(watch.hub.handle());
    for machine in [None, Some(0)] {
        let refused = wire
            .command(machine, 1, PaneCommand::Input(b"x".to_vec()))
            .expect_err("no local line in this test");
        assert_eq!(refused, "The terminal is not connected to the daemon");
    }
    assert_eq!(watch.hub.handle().take_unsent(MachineId::LOCAL), 0);
}

#[tokio::test]
async fn a_session_started_on_a_machine_is_a_pane_of_that_machine() {
    let mut sandbox = Sandbox::new();
    sandbox.start_daemon();
    let mut watch = Watch::new(&[machine("box", &sandbox, "proxy")], &sandbox, quick(WAIT));
    let wire = Wire::reaching(watch.hub.handle());
    watch
        .until("connected and a snapshot", |w| {
            w.is(BOX, "connected") && w.snapshots(BOX) > 0
        })
        .await;
    assert!(watch.any_pane(BOX).is_none());
    // A folder that is not there opens in the machine's home folder, so `~` works as a default.
    wire.new_session(1, "~").expect("the machine takes it");
    watch
        .until("a pane on the machine", |w| w.any_pane(BOX).is_some())
        .await;
    assert_eq!(watch.replies(BOX), 1, "its answer was taken once");
}

#[tokio::test]
async fn the_changes_of_a_pane_on_a_machine_are_read_from_that_machines_daemon_and_nothing_else_is() {
    use maitty_shared::repo::RepoRequest;
    let mut sandbox = Sandbox::new();
    sandbox.start_daemon();
    let repository = sandbox.dir.join("checkout");
    std::fs::create_dir_all(&repository).unwrap();
    let init = std::process::Command::new("git").arg("-C").arg(&repository).args(["init", "--quiet"]).status().unwrap();
    assert!(init.success(), "git init");
    std::fs::write(repository.join("new.txt"), "one\n").unwrap();

    let mut watch = Watch::new(&[machine("box", &sandbox, "proxy")], &sandbox, quick(WAIT));
    let wire = Wire::reaching(watch.hub.handle());
    watch
        .until("connected and a snapshot", |w| w.is(BOX, "connected") && w.snapshots(BOX) > 0)
        .await;
    let start = ClientMsg::Command(Command::NewWorkspace {
        cwd: Some(repository.clone()),
        name: None,
        cmd: None,
    });
    watch.hub.handle().send(Outgoing { machine: BOX, msg: start }).expect("the line is up");
    watch.until("a pane on the machine", |w| w.any_pane(BOX).is_some()).await;
    let term = watch.any_pane(BOX).unwrap();

    let not_here = || Err("this computer's daemon is not asked".to_string());
    let daemon = wire.repo_daemon(Some(BOX.0), &RepoRequest::Status, not_here).expect("a connected machine is asked");
    let status = maitty_desktop_client::repo_query(term, RepoRequest::Status, daemon).await.expect("the machine's daemon answers");
    let paths: Vec<&str> = status["Status"]["files"].as_array().unwrap().iter().filter_map(|file| file["path"].as_str()).collect();
    assert_eq!(paths, ["new.txt"]);

    for question in [RepoRequest::File { path: "new.txt".into() }, RepoRequest::FileStamped { path: "new.txt".into() }, RepoRequest::Branches] {
        let refused = wire.repo_daemon(Some(BOX.0), &question, not_here).err().expect("only the changes, listings and markdown are asked of a machine");
        assert_eq!(refused, "Inspect is local-only in v1: the files are on box, not on this computer.", "{question:?}");
    }
    assert!(matches!(
        wire.repo_daemon(None, &RepoRequest::Branches, || Ok(std::path::PathBuf::from("maiker"))),
        Ok(maitty_desktop_client::Daemon::Local(_))
    ));
}

// The test plants a symlink out of the checkout, which Windows only allows with extra rights.
#[cfg(unix)]
#[tokio::test]
async fn a_markdown_document_on_a_machine_is_read_and_saved_by_that_machines_daemon_inside_its_checkout() {
    use maitty_shared::repo::{RepoReply, RepoRequest};
    let mut sandbox = Sandbox::new();
    sandbox.start_daemon();
    let repository = sandbox.dir.join("checkout");
    std::fs::create_dir_all(repository.join("docs")).unwrap();
    std::fs::write(repository.join("README.md"), "# Title\n- [ ] task\n").unwrap();
    std::fs::write(repository.join("docs/guide.md"), "guide\n").unwrap();
    std::fs::write(repository.join("main.rs"), "fn main() {}\n").unwrap();
    std::fs::write(sandbox.dir.join("outside.md"), "outside\n").unwrap();
    // A link needs no special right to make on Unix only (Windows asks for Developer Mode), so the escape is checked there.
    #[cfg(unix)]
    std::os::unix::fs::symlink(sandbox.dir.join("outside.md"), repository.join("link.md")).unwrap();

    let mut watch = Watch::new(&[machine("box", &sandbox, "proxy")], &sandbox, quick(WAIT));
    let wire = Wire::reaching(watch.hub.handle());
    watch.until("connected and a snapshot", |w| w.is(BOX, "connected") && w.snapshots(BOX) > 0).await;
    let start = ClientMsg::Command(Command::NewWorkspace { cwd: Some(repository.clone()), name: None, cmd: None });
    watch.hub.handle().send(Outgoing { machine: BOX, msg: start }).expect("the line is up");
    watch.until("a pane on the machine", |w| w.any_pane(BOX).is_some()).await;
    let term = watch.any_pane(BOX).unwrap();
    let not_here = || Err("this computer's daemon is not asked".to_string());

    // A folder listing and a document come back from that machine, the document with its version.
    let listing = wire.repo_daemon(Some(BOX.0), &RepoRequest::Tree { path: None }, not_here).expect("a listing may be asked");
    let names = maitty_desktop_client::repo_query(term, RepoRequest::Tree { path: None }, listing).await.expect("the listing comes back");
    assert!(names["Tree"].as_array().unwrap().iter().any(|entry| entry["name"] == "README.md"), "{names}");
    let read = RepoRequest::FileStamped { path: "README.md".into() };
    let daemon = wire.repo_daemon(Some(BOX.0), &read, not_here).expect("a markdown document may be asked");
    let stamped = maitty_desktop_client::repo_query(term, read.clone(), daemon).await.expect("the document comes back");
    assert_eq!(stamped["FileStamped"]["text"], "# Title\n- [ ] task\n");
    let version = stamped["FileStamped"]["version"].as_str().unwrap().to_string();
    assert!(!version.is_empty());

    // Saving with that version writes through that machine's daemon; saving with it again finds the file changed.
    let save = |text: &str, version: Option<String>| {
        let daemon = wire.save_daemon(Some(BOX.0), "README.md", not_here).expect("a markdown document may be saved");
        maitty_desktop_client::save_project_file(term, "README.md".into(), text.into(), version, daemon)
    };
    let saved = save("# Title\n- [x] task\n", Some(version.clone())).await.expect("the save is answered");
    assert!(saved["Saved"]["version"].as_str().is_some_and(|new| new != version), "{saved}");
    assert_eq!(std::fs::read_to_string(repository.join("README.md")).unwrap(), "# Title\n- [x] task\n");
    let changed = save("lost\n", Some(version)).await.expect("the refusal is answered");
    assert_eq!(changed, serde_json::json!("ChangedOnDisk"));
    assert_eq!(std::fs::read_to_string(repository.join("README.md")).unwrap(), "# Title\n- [x] task\n", "a refused save writes nothing");

    // Anything that is not a markdown document is refused here; a link out of the checkout is refused by that machine's daemon.
    let refused = wire.save_daemon(Some(BOX.0), "main.rs", not_here).err().expect("only markdown is saved on a machine");
    assert!(refused.contains("local-only"), "{refused}");
    #[cfg(unix)]
    {
        let escape = RepoRequest::FileStamped { path: "link.md".into() };
        let daemon = wire.repo_daemon(Some(BOX.0), &escape, not_here).unwrap();
        let outside = maitty_desktop_client::repo_query(term, escape, daemon).await;
        assert!(outside.is_err(), "a link out of the checkout is not read: {outside:?}");
        let daemon = wire.save_daemon(Some(BOX.0), "link.md", not_here).unwrap();
        let outside = maitty_desktop_client::save_project_file(term, "link.md".into(), "x".into(), None, daemon).await;
        assert!(outside.is_err(), "a link out of the checkout is not written: {outside:?}");
        assert_eq!(std::fs::read_to_string(sandbox.dir.join("outside.md")).unwrap(), "outside\n");
    }
    let _ = RepoReply::Written;
}

#[tokio::test]
async fn a_checkout_on_a_machine_is_pushed_pulled_and_committed_by_that_machines_daemon() {
    use maitty_shared::protocol::GitRequest;
    let mut sandbox = Sandbox::new();
    sandbox.start_daemon();
    let (repository, remote) = (sandbox.dir.join("checkout"), sandbox.dir.join("remote.git"));
    let git = |folder: &std::path::Path, args: &[&str]| {
        std::fs::create_dir_all(folder).unwrap();
        let identity = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false"];
        let ran = std::process::Command::new("git").arg("-C").arg(folder).args(identity).args(args).output().unwrap();
        assert!(ran.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&ran.stderr));
    };
    git(&remote, &["init", "--quiet", "--bare", "-b", "main"]);
    git(&repository, &["init", "--quiet", "-b", "main"]);
    std::fs::write(repository.join("a.txt"), "one\n").unwrap();
    git(&repository, &["add", "--", "a.txt"]);
    git(&repository, &["commit", "--quiet", "-m", "start"]);
    git(&repository, &["remote", "add", "origin", remote.to_str().unwrap()]);

    let mut watch = Watch::new(&[machine("box", &sandbox, "proxy")], &sandbox, quick(WAIT));
    let wire = Wire::reaching(watch.hub.handle());
    watch
        .until("connected and a snapshot", |w| w.is(BOX, "connected") && w.snapshots(BOX) > 0)
        .await;
    let start = ClientMsg::Command(Command::NewWorkspace {
        cwd: Some(repository.clone()),
        name: None,
        cmd: None,
    });
    watch.hub.handle().send(Outgoing { machine: BOX, msg: start }).expect("the line is up");
    watch.until("a pane on the machine", |w| w.any_pane(BOX).is_some()).await;
    let term = watch.any_pane(BOX).unwrap();

    let ask = |request: GitRequest| {
        let daemon = wire.git_daemon(Some(BOX.0), &request).expect("a connected machine is asked");
        async move { maitty_desktop_client::git_request(term, request, daemon).await.map_err(|error| format!("{error:#}")) }
    };
    assert_eq!(ask(GitRequest::Push).await, Ok("Pushed main".into()));
    assert_eq!(ask(GitRequest::Fetch).await, Ok("Fetched".into()));
    assert_eq!(ask(GitRequest::Pull).await, Ok("Already up to date".into()));

    // A commit of one named file leaves the other change alone and answers the commit's id and subject.
    git(&repository, &["config", "user.name", "Test"]);
    git(&repository, &["config", "user.email", "test@example.invalid"]);
    git(&repository, &["config", "commit.gpgsign", "false"]);
    std::fs::write(repository.join("b.txt"), "two\n").unwrap();
    std::fs::write(repository.join("c.txt"), "three\n").unwrap();
    let committed = ask(GitRequest::Commit { message: "add b".into(), paths: Some(vec!["b.txt".into()]) }).await.expect("the commit");
    let (id, subject) = committed.split_once(' ').expect("an id and a subject");
    assert!(id.len() >= 4 && id.chars().all(|c| c.is_ascii_hexdigit()), "{committed}");
    assert_eq!(subject, "add b");
    assert!(repository.join("c.txt").is_file());
    let outside = GitRequest::Commit { message: "m".into(), paths: Some(vec!["../x".into()]) };
    assert_eq!(ask(outside).await, Err("`../x` is not a file of this checkout".into()));

    git(&repository, &["checkout", "--quiet", "--detach"]);
    assert_eq!(ask(GitRequest::Push).await, Err("this checkout is on no branch, so there is nothing to push".into()));
    assert!(wire.git_daemon(None, &GitRequest::Fetch).is_err(), "this computer's checkouts are not synced through its daemon");
}

#[tokio::test]
async fn a_session_is_not_started_on_this_computer_or_a_machine_that_is_down_or_in_a_bad_folder() {
    let sandbox = Sandbox::new();
    let watch = Watch::new(&[machine("box", &sandbox, "auth-fail")], &sandbox, quick(WAIT));
    let wire = Wire::reaching(watch.hub.handle());
    assert_eq!(
        wire.new_session(0, "~").unwrap_err(),
        "This computer starts its own sessions"
    );
    assert_eq!(wire.new_session(1, "~").unwrap_err(), "box is not connected");
    assert_eq!(wire.github_sign_in(0).unwrap_err(), "This computer starts its own sessions");
    assert_eq!(wire.github_sign_in(1).unwrap_err(), "box is not connected");
    for (owner, search) in [(Some("a\nb"), None), (None, Some("x\u{7}")), (Some(&*"o".repeat(300)), None)] {
        assert!(wire.github_repos(Some(1), owner, search, 1).is_err(), "{owner:?} {search:?} was sent");
    }
    for folder in ["", "   ", "/a\nb", &"x".repeat(5000)] {
        assert!(wire.new_session(1, folder).unwrap_err().starts_with("Type a folder"), "{folder:?}");
    }
}

#[tokio::test]
async fn the_window_asks_a_machine_for_its_whole_list_but_not_this_computer_or_a_machine_that_is_down() {
    let sandbox = Sandbox::new();
    let watch = Watch::new(&[machine("box", &sandbox, "auth-fail")], &sandbox, quick(WAIT));
    let wire = Wire::reaching(watch.hub.handle());
    assert_eq!(
        wire.ask_machine_list(0).unwrap_err(),
        "This computer's list is read with list_sessions"
    );
    assert_eq!(wire.ask_machine_list(1).unwrap_err(), "box is not connected");

    let handle = watch.hub.handle();
    lock(&handle.shared.up).insert(BOX);
    wire.ask_machine_list(1).expect("a machine whose line is up takes it");
    assert!(
        lock(&handle.shared.list_wanted).contains(&BOX),
        "its answer is let in as the list the host asked for"
    );
}

#[tokio::test]
async fn the_window_asking_a_machine_for_its_list_again_and_again_sends_at_most_one_ask_a_while() {
    let sandbox = Sandbox::new();
    let watch = Watch::new(&[machine("box", &sandbox, "auth-fail")], &sandbox, quick(WAIT));
    let wire = Wire::reaching(watch.hub.handle());
    let handle = watch.hub.handle();
    lock(&handle.shared.up).insert(BOX);
    let asked = |wire: &Wire, at: Instant| {
        lock(&handle.shared.list_wanted).remove(&BOX);
        wire.ask_machine_list_at(1, at).expect("a throttled ask is not an error");
        lock(&handle.shared.list_wanted).contains(&BOX)
    };
    let start = Instant::now();

    assert!(asked(&wire, start), "the first ask goes out");
    assert!(!asked(&wire, start + Duration::from_secs(1)), "one soon after is dropped");
    assert!(
        asked(&wire, start + crate::terminal_stream::WINDOW_LIST_ASK_EVERY),
        "one after the wait goes out again"
    );
}

#[tokio::test]
async fn a_new_worktree_off_a_pane_of_a_machine_is_made_there_by_that_machines_daemon_and_a_session_opens_in_it() {
    let mut sandbox = Sandbox::new();
    // Beside the repository, inside the sandbox: the default template would put it under the real home folder.
    let config = sandbox.dir.join("config.toml");
    let mut text = std::fs::read_to_string(&config).unwrap_or_default();
    text.push_str("\n[worktree]\ndir = \"{repo_parent}/{repo}-worktrees/{branch}\"\n");
    std::fs::write(&config, text).unwrap();
    sandbox.start_daemon();
    let repository = sandbox.dir.join("checkout");
    let git = |args: &[&str]| {
        let identity = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false"];
        let ran = std::process::Command::new("git").arg("-C").arg(&repository).args(identity).args(args).output().unwrap();
        assert!(ran.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&ran.stderr));
        String::from_utf8_lossy(&ran.stdout).into_owned()
    };
    std::fs::create_dir_all(&repository).unwrap();
    git(&["init", "--quiet", "-b", "main"]);
    std::fs::write(repository.join("a.txt"), "one\n").unwrap();
    git(&["add", "--", "a.txt"]);
    git(&["commit", "--quiet", "-m", "start"]);

    let mut watch = Watch::new(&[machine("box", &sandbox, "proxy")], &sandbox, quick(WAIT));
    let wire = Wire::reaching(watch.hub.handle());
    watch.until("connected and a snapshot", |w| w.is(BOX, "connected") && w.snapshots(BOX) > 0).await;
    let start = ClientMsg::Command(Command::NewWorkspace { cwd: Some(repository.clone()), name: None, cmd: None });
    watch.hub.handle().send(Outgoing { machine: BOX, msg: start }).expect("the line is up");
    watch.until("a pane on the machine", |w| w.any_pane(BOX).is_some()).await;
    let term = watch.any_pane(BOX).unwrap();

    let not_here = || Err("this computer's daemon is not asked".to_string());
    let daemon = wire.new_worktree_daemon(Some(BOX.0), not_here).expect("a connected machine is asked");
    let made = maitty_desktop_client::new_worktree_session(term, "feat-x".into(), None, daemon).await;
    assert_eq!(made.map_err(|error| format!("{error:#}")), Ok(serde_json::Value::Null));
    assert!(git(&["worktree", "list", "--porcelain"]).contains("branch refs/heads/feat-x"), "the worktree is that machine's");
    watch
        .until("a session in the new worktree", |w| {
            w.msgs.iter().any(|(m, msg)| *m == BOX && match msg {
                ServerMsg::State(snapshot) => snapshot.terms.keys().any(|id| *id != term),
                ServerMsg::TermsChanged { changed, .. } => changed.iter().any(|pane| pane.id != term),
                _ => false,
            })
        })
        .await;
}

#[tokio::test]
async fn a_new_worktree_on_a_machine_that_is_down_or_too_old_is_refused_naming_it_and_nothing_is_asked_of_it() {
    let sandbox = Sandbox::new();
    let old = MachineId(2);
    let mut watch = Watch::new(&[machine("box", &sandbox, "auth-fail"), machine("old", &sandbox, "mismatch")], &sandbox, quick(WAIT));
    let wire = Wire::reaching(watch.hub.handle());
    watch
        .until("the older one needs an update", |w| w.kinds(old).last() == Some(&"needs-update"))
        .await;
    let not_here = || Err("this computer's daemon is not asked".to_string());
    for (machine, name) in [(BOX, "box"), (old, "old")] {
        let refused = wire.new_worktree_daemon(Some(machine.0), not_here).err().expect("nothing is asked of it");
        assert_eq!(refused, format!("{name} is not connected"));
    }
    assert!(matches!(
        wire.new_worktree_daemon(None, || Ok(std::path::PathBuf::from("maiker"))),
        Ok(maitty_desktop_client::Daemon::Local(_))
    ), "this computer's goes to its own daemon, as before");
}
