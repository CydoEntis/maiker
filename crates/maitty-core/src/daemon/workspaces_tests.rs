use super::*;

/// A Unix-style test path made absolute on every platform: on Windows a path needs a drive to be
/// absolute, and the store refuses one that is not.
fn abs(path: &str) -> PathBuf {
    PathBuf::from(if cfg!(windows) { format!("C:{path}") } else { path.to_owned() })
}

fn open_session(session: &str, at: u64) -> ClosedSession {
    ClosedSession {
        agent: "claude".into(),
        session: session.into(),
        cwd: abs("/code/api"),
        branch: Some("main".into()),
        title: Some("fix the parser".into()),
        at,
        worktree: None,
        repo: None,
    }
}

fn app() -> PathBuf {
    abs("/code/api")
}

fn ids(sessions: &[ClosedSession]) -> Vec<&str> {
    sessions.iter().map(|s| s.session.as_str()).collect()
}

#[test]
fn a_save_replaces_the_projects_set_and_other_projects_are_left_alone() {
    let mut store = Workspaces::in_memory();
    store.save(app(), vec![open_session("a", 1), open_session("b", 2)]).unwrap();
    store.save(abs("/code/web"), vec![open_session("w", 3)]).unwrap();
    store.save(app(), vec![open_session("c", 4)]).unwrap();
    assert_eq!(ids(&store.get(&app())), ["c"]);
    assert_eq!(ids(&store.get(&abs("/code/web"))), ["w"]);
    assert!(store.get(&abs("/code/none")).is_empty());
}

#[test]
fn saving_an_empty_set_forgets_the_project() {
    let mut store = Workspaces::in_memory();
    store.save(app(), vec![open_session("a", 1)]).unwrap();
    store.save(app(), Vec::new()).unwrap();
    assert!(store.get(&app()).is_empty());
    assert!(store.projects.is_empty());
}

#[test]
fn the_order_saved_is_kept_and_a_conversation_appears_once() {
    let mut store = Workspaces::in_memory();
    store
        .save(app(), vec![open_session("b", 2), open_session("a", 1), open_session("b", 9)])
        .unwrap();
    assert_eq!(ids(&store.get(&app())), ["b", "a"]);
    assert_eq!(store.get(&app())[0].at, 2);
}

#[test]
fn only_the_newest_fifty_sessions_of_a_project_are_kept_in_the_order_sent() {
    let mut store = Workspaces::in_memory();
    let sent: Vec<_> = (0..60).rev().map(|n| open_session(&format!("s{n}"), n)).collect();
    store.save(app(), sent).unwrap();
    let kept = store.get(&app());
    assert_eq!(kept.len(), WORKSPACE_SESSIONS_MAX);
    assert_eq!(kept[0].session, "s59");
    assert_eq!(kept[WORKSPACE_SESSIONS_MAX - 1].session, "s10");
}

#[test]
fn only_the_fifty_projects_saved_last_are_kept() {
    let mut store = Workspaces::in_memory();
    for n in 0..60 {
        store.save(abs(&format!("/code/p{n}")), vec![open_session("a", n)]).unwrap();
    }
    assert_eq!(store.projects.len(), WORKSPACE_PROJECTS_MAX);
    assert_eq!(store.get(&abs("/code/p59")).len(), 1);
    assert!(store.get(&abs("/code/p9")).is_empty());
    assert_eq!(store.get(&abs("/code/p10")).len(), 1);
}

#[test]
fn a_record_is_cleaned_like_a_closed_session_and_a_bad_one_is_dropped() {
    let mut store = Workspaces::in_memory();
    store
        .save(
            app(),
            vec![
                ClosedSession {
                    branch: Some("feat/x\n\u{1b}[31mred".into()),
                    title: Some(format!("  fix\u{7} {}", "y".repeat(500))),
                    agent: format!("claude\u{1b}[2J{}", "z".repeat(200)),
                    ..open_session("a", 1)
                },
                open_session("", 2),
                ClosedSession { cwd: "relative/dir".into(), ..open_session("rel", 3) },
                ClosedSession { cwd: abs("/code/\u{1b}[2Jx"), ..open_session("esc", 4) },
                ClosedSession { cwd: abs(&format!("/{}", "d".repeat(5000))), ..open_session("long", 5) },
            ],
        )
        .unwrap();
    let kept = store.get(&app());
    assert_eq!(ids(&kept), ["a"]);
    assert!(!kept[0].agent.chars().any(char::is_control));
    assert!(kept[0].agent.chars().count() <= 64);
    assert!(!kept[0].branch.as_deref().unwrap().chars().any(char::is_control));
    assert!(kept[0].title.as_deref().unwrap().chars().count() <= crate::conversation::MAX_TITLE_CHARS);
}

#[test]
fn a_worktree_is_kept_only_as_a_pair_that_holds_together() {
    let root = std::env::temp_dir();
    let top = root.join("repo-worktrees").join("feat");
    let mut store = Workspaces::in_memory();
    store
        .save(
            root.join("repo"),
            vec![
                ClosedSession {
                    cwd: top.join("src"),
                    worktree: Some(top.clone()),
                    repo: Some(root.join("repo")),
                    ..open_session("pair", 1)
                },
                ClosedSession {
                    worktree: Some("relative".into()),
                    repo: Some(root.join("repo")),
                    ..open_session("loose", 2)
                },
            ],
        )
        .unwrap();
    let kept = store.get(&root.join("repo"));
    assert_eq!(kept[0].worktree.as_deref(), Some(top.as_path()));
    assert_eq!((kept[1].worktree.clone(), kept[1].repo.clone()), (None, None));
}

#[test]
fn a_project_that_is_not_an_absolute_clean_path_is_refused() {
    let mut store = Workspaces::in_memory();
    for project in [PathBuf::from("relative"), PathBuf::new(), abs("/code/\u{7}x")] {
        assert!(store.save(project.clone(), vec![open_session("a", 1)]).is_err(), "{project:?}");
    }
    assert!(store.projects.is_empty());
}

#[test]
fn the_sets_survive_a_restart() {
    let dir = persist::scratch_dir();
    let file = dir.path().join("workspaces.json");
    let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
    let _in_rt = rt.enter();
    let mut store = Workspaces::open(file.clone());
    store.save(app(), vec![open_session("a", 1), open_session("b", 2)]).unwrap();
    store.save(abs("/code/web"), vec![open_session("w", 3)]).unwrap();
    store.save_now();

    let reopened = Workspaces::open(file);
    assert_eq!(reopened.get(&app()), store.get(&app()));
    assert_eq!(ids(&reopened.get(&abs("/code/web"))), ["w"]);
    assert_eq!(reopened.projects[0].path, abs("/code/web"), "the project saved last stays first");
}

#[test]
fn a_stored_file_is_checked_when_read() {
    let dir = persist::scratch_dir();
    std::fs::create_dir_all(dir.path()).unwrap();
    let file = dir.path().join("workspaces.json");
    let path = |p: &str| abs(p).to_string_lossy().into_owned();
    let entry = |session: &str, cwd: &str| {
        serde_json::json!({
            "agent": "codex", "session": session, "cwd": cwd, "branch": null,
            "title": null, "at": 1, "added_later": true,
        })
    };
    let stored = serde_json::json!({
        "version": 1,
        "projects": [
            {"path": path("/code/api"), "sessions": [entry("ok", &path("/code/api")), entry("", &path("/code")), entry("rel", "x")]},
            {"path": "not-absolute", "sessions": [entry("lost", &path("/code"))]},
        ],
    });
    std::fs::write(&file, stored.to_string()).unwrap();

    let store = Workspaces::open(file);
    assert_eq!(ids(&store.get(&app())), ["ok"]);
    assert_eq!(store.projects.len(), 1);
}

#[test]
fn a_file_that_cannot_be_read_is_kept_aside_and_the_store_starts_empty() {
    let dir = persist::scratch_dir();
    std::fs::create_dir_all(dir.path()).unwrap();
    let file = dir.path().join("workspaces.json");
    std::fs::write(&file, "{not json").unwrap();

    let store = Workspaces::open(file.clone());
    assert!(store.projects.is_empty());
    assert!(!file.exists());
    assert!(dir.path().join("workspaces.json.bak").exists());
}

#[test]
fn a_file_from_a_newer_build_is_kept_aside_untouched() {
    let dir = persist::scratch_dir();
    std::fs::create_dir_all(dir.path()).unwrap();
    let file = dir.path().join("workspaces.json");
    let newer = format!("{{\"version\": {}, \"projects\": []}}", FORMAT_VERSION + 1);
    std::fs::write(&file, &newer).unwrap();

    let store = Workspaces::open(file.clone());
    assert!(store.projects.is_empty());
    assert_eq!(std::fs::read_to_string(dir.path().join("workspaces.json.bak")).unwrap(), newer);
}
