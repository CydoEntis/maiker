//! Clone a repository, another machine's folders, specialist agents, another machine's worktrees
//! to tidy, and a branch added as a worktree: what each asks which daemon, and what it draws.
//! `MAITTY_SHOW=1 cargo test screen::repos_tests -- --nocapture` prints the frames.

use super::*;
use crate::client::{Outgoing, WtRow};
use crate::client::ids::Remote;
use crate::client::link::ConnectionState;
use crate::client::reference_fixture::{Stage, world};
use crate::protocol::{ClientMsg, WorktreeEntry, FolderEntry, FolderListing, GitHubAnswer, GitHubRepo, GitHubRepoList, Query, Reply, ServerMsg};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use maitty_shared::specialists::{SpecialistFile, SpecialistList, SpecialistScope, SpecialistTool};
use ratatui::Terminal;
use ratatui::backend::TestBackend;
use tokio::sync::mpsc;

const THERE: MachineId = MachineId(1);

fn two_machines() -> (App, mpsc::UnboundedReceiver<Outgoing>) {
    let mut app = world(Stage::None);
    let (tx, rx) = mpsc::unbounded_channel();
    app.out = tx;
    let there = app.snap.clone();
    app.remotes.insert(THERE, Remote { name: "build".into(), snap: there, state: ConnectionState::Connected, ..Remote::default() });
    app.screen_fresh();
    (app, rx)
}

fn sent(rx: &mut mpsc::UnboundedReceiver<Outgoing>) -> Vec<Outgoing> {
    std::iter::from_fn(|| rx.try_recv().ok()).collect()
}

fn press(app: &mut App, code: KeyCode) {
    app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
}

fn type_in(app: &mut App, text: &str) {
    for c in text.chars() {
        press(app, KeyCode::Char(c));
    }
}

fn frame(app: &mut App) -> String {
    let (w, h) = (140, 40);
    let mut term = Terminal::new(TestBackend::new(w, h)).expect("a test terminal");
    term.draw(|f| crate::client::render::draw(app, f)).expect("a frame");
    let buf = term.backend().buffer().clone();
    let rows: Vec<String> =
        (0..h).map(|y| (0..w).map(|x| buf[(x, y)].symbol()).collect::<String>().trim_end().to_string()).collect();
    if std::env::var(concat!(env!("APP_ENV"), "_SHOW")).is_ok() {
        rows.iter().for_each(|r| println!("{r}"));
    }
    rows.join("\n")
}

fn repo(name: &str, pushed: &str, description: &str) -> GitHubRepo {
    GitHubRepo {
        name: name.into(),
        description: description.into(),
        private: name.ends_with("secret"),
        pushed_at: pushed.into(),
        clone_url: format!("https://github.com/{name}.git"),
    }
}

/// The tag of the last question of this kind sent to `machine`.
fn tag_of(out: &[Outgoing], machine: MachineId, kind: fn(&Query) -> Option<u64>) -> u64 {
    out.iter()
        .filter(|o| o.machine == machine)
        .find_map(|o| match &o.msg {
            ClientMsg::Query(q) => kind(q),
            _ => None,
        })
        .expect("asked")
}

fn repos_tag(q: &Query) -> Option<u64> {
    match q {
        Query::GitHubRepos { tag, .. } => Some(*tag),
        _ => None,
    }
}

#[test]
fn clone_lists_the_machines_repositories_and_clones_the_one_picked_into_the_folder_typed() {
    let (mut app, mut rx) = two_machines();
    sent(&mut rx);
    app.act(Action::CloneRepo);
    let out = sent(&mut rx);
    assert!(out.iter().any(|o| matches!(o.msg, ClientMsg::Query(Query::GitHubOwners { .. }))), "{out:?}");
    let tag = tag_of(&out, MachineId::LOCAL, repos_tag);
    assert!(frame(&mut app).contains("Loading your repositories…"));
    app.on_machine_server(
        MachineId::LOCAL,
        ServerMsg::Reply(Reply::GitHubRepos {
            tag,
            answer: GitHubAnswer::Listed(GitHubRepoList {
                repos: vec![
                    repo("me/old-tool", "2024-02-01T00:00:00Z", "an \u{1b}[31mold\u{1b}[0m one"),
                    repo("me/shop-api", "2026-11-01T00:00:00Z", "the shop's API"),
                    repo("me/secret", "2025-06-01T00:00:00Z", ""),
                ],
                more: false,
            }),
        }),
    );
    let shown = frame(&mut app);
    assert!(shown.contains("Clone a repository to this computer"), "{shown}");
    let newest = shown.find("me/shop-api").expect("the newest is listed");
    assert!(newest < shown.find("me/secret").expect("listed") && shown.contains("· private"), "{shown}");
    assert!(shown.contains("an [31mold[0m one") && !shown.contains('\u{1b}'), "a description is drawn as plain text");

    // The address has the keys first; the list is the next line. Enter there picks the
    // repository, the folder is next, and Enter in it clones.
    press(&mut app, KeyCode::Tab);
    press(&mut app, KeyCode::Enter);
    let Mode::Clone(v) = &app.mode else { panic!("still the dialog") };
    assert_eq!(v.address, "https://github.com/me/shop-api.git");
    assert_eq!(v.field, CloneField::Parent);
    for _ in 0..v.parent.chars().count() {
        press(&mut app, KeyCode::Backspace);
    }
    type_in(&mut app, "~/code");
    press(&mut app, KeyCode::Enter);
    let out = sent(&mut rx);
    let (tag, address, parent) = out
        .iter()
        .find_map(|o| match &o.msg {
            ClientMsg::Query(Query::CloneRepo { address, parent, tag }) if o.machine == MachineId::LOCAL => {
                Some((*tag, address.clone(), parent.clone()))
            }
            _ => None,
        })
        .expect("the clone is asked of this computer's daemon");
    assert_eq!((address.as_str(), parent.as_str()), ("https://github.com/me/shop-api.git", "~/code"));
    assert!(frame(&mut app).contains("Cloning… A large repository can take a few minutes."));

    // What the machine says when it will not clone is shown as it said it, in the dialog.
    app.on_machine_server(
        MachineId::LOCAL,
        ServerMsg::Reply(Reply::Cloned { tag, outcome: Err("~/code/shop-api is already there".into()) }),
    );
    let shown = frame(&mut app);
    assert!(shown.contains("~/code/shop-api is already there"), "{shown}");
    press(&mut app, KeyCode::Esc);
    assert!(matches!(app.mode, Mode::Normal));
}

#[test]
fn a_machine_not_signed_in_to_github_still_takes_a_pasted_address() {
    let (mut app, mut rx) = two_machines();
    sent(&mut rx);
    app.open_clone_repo_on(THERE);
    let out = sent(&mut rx);
    assert!(out.iter().all(|o| o.machine == THERE), "every question goes to the machine the clone is for: {out:?}");
    let tag = tag_of(&out, THERE, repos_tag);
    // An answer from another machine with the same tag is not this one's.
    app.on_machine_server(MachineId::LOCAL, ServerMsg::Reply(Reply::GitHubRepos { tag, answer: GitHubAnswer::NotInstalled }));
    app.on_machine_server(THERE, ServerMsg::Reply(Reply::GitHubRepos { tag, answer: GitHubAnswer::NotSignedIn }));
    let shown = frame(&mut app);
    assert!(shown.contains("Clone a repository to build"), "{shown}");
    assert!(shown.contains("Sign in to GitHub on build to pick from your repositories: gh auth login"), "{shown}");
    app.on_paste("git@github.com:me/tool.git\nrm -rf /".into());
    press(&mut app, KeyCode::Tab);
    let Mode::Clone(v) = &app.mode else { panic!("still the dialog") };
    assert_eq!(v.address, "git@github.com:me/tool.git", "one line of a paste");
    assert_eq!(v.parent, "~", "another machine's clone starts in its home");
}

#[test]
fn a_clone_whose_dialog_was_closed_still_says_how_it_ended() {
    let (mut app, mut rx) = two_machines();
    app.open_clone_repo_on(MachineId::LOCAL);
    app.on_paste("https://github.com/me/x.git".into());
    // Enter in the address clones too: the folder already says where.
    press(&mut app, KeyCode::Enter);
    let tag = tag_of(&sent(&mut rx), MachineId::LOCAL, |q| match q {
        Query::CloneRepo { tag, .. } => Some(*tag),
        _ => None,
    });
    press(&mut app, KeyCode::Esc);
    assert!(matches!(app.mode, Mode::Normal));
    app.on_machine_server(MachineId::LOCAL, ServerMsg::Reply(Reply::Cloned { tag, outcome: Ok("/home/me/x".into()) }));
    let (text, _, error) = app.notice.clone().expect("a toast");
    assert!(text.contains("Cloned into /home/me/x") && !error, "{text}");
}

fn specialist(scope: SpecialistScope, tool: SpecialistTool, name: &str, text: &str) -> SpecialistFile {
    SpecialistFile {
        tool,
        scope,
        name: name.into(),
        description: Some(format!("does {name} things")),
        path: format!("/code/app/.claude/agents/{name}.md"),
        text: text.into(),
        text_cut: false,
    }
}

#[test]
fn specialist_agents_list_by_where_they_live_and_open_as_plain_text() {
    let (mut app, mut rx) = two_machines();
    sent(&mut rx);
    app.act(Action::Specialists);
    let out = sent(&mut rx);
    let (machine, term) = out
        .iter()
        .find_map(|o| match o.msg {
            ClientMsg::Query(Query::Specialists { term }) => Some((o.machine, term)),
            _ => None,
        })
        .expect("asked the pane's daemon");
    assert!(frame(&mut app).contains("Looking for agent files…"));
    app.on_machine_server(
        machine,
        ServerMsg::Reply(Reply::Specialists(SpecialistList {
            term,
            project: "/code/app".into(),
            files: vec![
                specialist(SpecialistScope::Home, SpecialistTool::Codex, "mine", "x"),
                specialist(SpecialistScope::Project, SpecialistTool::Claude, "reviewer", "---\nname: reviewer\n---\n\u{1b}]52;c;aGk=\u{7}Review the diff."),
            ],
            truncated: false,
        })),
    );
    let shown = frame(&mut app);
    let (project, home) = (shown.find("THIS PROJECT").expect("a group"), shown.find("YOUR HOME FOLDER").expect("a group"));
    assert!(project < home && shown.contains("reviewer") && shown.contains("Codex"), "{shown}");
    press(&mut app, KeyCode::Enter);
    let shown = frame(&mut app);
    assert!(shown.contains("Claude Code · /code/app/.claude/agents/reviewer.md"), "{shown}");
    assert!(shown.contains("]52;c;aGk=Review the diff.") && !shown.contains('\u{1b}'), "{shown}");
    press(&mut app, KeyCode::Esc);
    assert!(matches!(app.mode, Mode::Specialists(_)), "Esc goes back to the list first");
    press(&mut app, KeyCode::Esc);
    assert!(matches!(app.mode, Mode::Normal));
}

#[test]
fn an_error_while_specialists_are_listed_shows_in_the_list() {
    let (mut app, mut rx) = two_machines();
    app.act(Action::Specialists);
    let machine = sent(&mut rx).iter().find(|o| matches!(o.msg, ClientMsg::Query(Query::Specialists { .. }))).expect("asked").machine;
    app.on_machine_server(machine, ServerMsg::Error("no such pane".into()));
    assert!(frame(&mut app).contains("Could not list the agent files: no such pane"));
}

fn listing(path: &str, names: &[(&str, bool)]) -> FolderListing {
    FolderListing {
        path: path.into(),
        exists: true,
        entries: names
            .iter()
            .map(|(name, git)| FolderEntry { name: (*name).into(), git: git.then(|| "main".to_string()), has_children: true })
            .collect(),
        truncated: false,
    }
}

fn asked_listing(rx: &mut mpsc::UnboundedReceiver<Outgoing>) -> (MachineId, String, u64) {
    sent(rx)
        .iter()
        .find_map(|o| match &o.msg {
            ClientMsg::Query(Query::ListFolders { path, tag }) => Some((o.machine, path.clone(), *tag)),
            _ => None,
        })
        .expect("a listing asked for")
}

#[test]
fn another_machines_folders_are_listed_by_its_daemon_and_one_opens_there() {
    let (mut app, mut rx) = two_machines();
    sent(&mut rx);
    app.open_finder_on(THERE);
    app.request_folder_list();
    let (machine, path, tag) = asked_listing(&mut rx);
    assert_eq!((machine, path.as_str()), (THERE, "~"), "its home, for its own daemon to read");
    assert!(frame(&mut app).contains("reading build…"));
    app.on_machine_server(THERE, ServerMsg::Reply(Reply::Folders { tag, listing: listing("/home/dev", &[("shop-api", true), ("docs", false)]) }));
    let shown = frame(&mut app);
    assert!(shown.contains("Open a folder on build") && shown.contains("/home/dev"), "{shown}");
    assert!(shown.contains("shop-api") && shown.contains("docs"), "{shown}");
    assert!(shown.contains("~/c/sa"), "another machine's paths are written with /");

    // A plain folder is gone into, by the path its daemon gave.
    type_in(&mut app, "docs");
    press(&mut app, KeyCode::Enter);
    let Mode::Finder(fd) = &app.mode else { panic!("still browsing") };
    assert_eq!(fd.q, "/home/dev/docs/");
    app.request_folder_list();
    let (machine, path, tag) = asked_listing(&mut rx);
    assert_eq!((machine, path.as_str()), (THERE, "/home/dev/docs"));
    app.on_machine_server(THERE, ServerMsg::Reply(Reply::Folders { tag, listing: listing("/home/dev/docs", &[]) }));

    // Up and into a repository, which opens with a shell on that machine.
    type_in(&mut app, "../");
    app.request_folder_list();
    let (_, path, tag) = asked_listing(&mut rx);
    assert_eq!(path, "/home/dev");
    app.on_machine_server(THERE, ServerMsg::Reply(Reply::Folders { tag, listing: listing("/home/dev", &[("shop-api", true)]) }));
    type_in(&mut app, "shop");
    press(&mut app, KeyCode::Enter);
    let out = sent(&mut rx);
    assert!(
        out.iter().any(|o| o.machine == THERE
            && matches!(&o.msg, ClientMsg::Command(Command::NewWorkspace { cwd, .. }) if cwd.as_deref() == Some(Path::new("/home/dev/shop-api")))),
        "{out:?}"
    );
    assert!(out.iter().all(|o| o.machine == THERE), "nothing goes to this computer: {out:?}");
}

#[test]
fn a_machine_that_is_not_connected_cannot_be_browsed() {
    let (mut app, _rx) = two_machines();
    if let Some(r) = app.remotes.get_mut(&THERE) {
        r.state = ConnectionState::Connecting;
    }
    app.open_finder_on(THERE);
    assert!(matches!(app.mode, Mode::Normal));
    let (text, _, error) = app.notice.clone().expect("a toast");
    assert!(error && text.contains("build is not connected"), "{text}");
}

#[test]
fn open_a_folder_on_a_machine_offers_each_connected_one() {
    let (mut app, _rx) = two_machines();
    app.act(Action::OpenFolderOn);
    let Mode::ScreenMenu(m) = &app.mode else { panic!("a menu of machines") };
    let labels: Vec<&str> = m.items.iter().map(|(l, _)| l.as_str()).collect();
    assert_eq!(labels, ["This computer", "build"]);
}

fn standing(dirty: usize, merged: bool) -> crate::tidy::Standing {
    crate::tidy::Standing { dirty, branch: Some("task".into()), merged, last_commit: "2 days ago".into(), inactive_days: None }
}

fn tidy_row(name: &str) -> TidyRow {
    TidyRow {
        path: PathBuf::from(format!("/srv/app-worktrees/{name}")),
        name: name.into(),
        branch: name.into(),
        sessions: 0,
        standing: crate::tidy::Standing::default(),
        ticked: false,
    }
}

#[test]
fn another_machines_worktrees_are_asked_about_one_at_a_time_and_removed_there() {
    let (mut app, mut rx) = two_machines();
    sent(&mut rx);
    let view = TidyView {
        repo: PathBuf::from("/srv/app"),
        name: "app".into(),
        rows: None,
        sel: 0,
        machine: THERE,
        asking: vec![tidy_row("merged-fix"), tidy_row("gone"), tidy_row("wip")],
        answered: Vec::new(),
    };
    app.mode = Mode::Tidy(Box::new(view));
    // Opening the list asks about the first; another machine's answer is taken only when asked.
    app.send(THERE, ClientMsg::Query(Query::WorktreeStanding { repo: "/srv/app".into(), folder: "/srv/app-worktrees/merged-fix".into() }));
    sent(&mut rx);
    app.on_machine_server(THERE, ServerMsg::Reply(Reply::WorktreeStanding(Some(standing(0, true)))));
    let asked: Vec<PathBuf> = sent(&mut rx)
        .iter()
        .filter(|o| o.machine == THERE)
        .filter_map(|o| match &o.msg {
            ClientMsg::Query(Query::WorktreeStanding { repo, folder }) if repo == Path::new("/srv/app") => Some(folder.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(asked, [PathBuf::from("/srv/app-worktrees/gone")], "the next is asked once the first is answered");
    assert!(frame(&mut app).contains("looking at each worktree…"));
    app.on_machine_server(THERE, ServerMsg::Reply(Reply::WorktreeStanding(None)));
    app.on_machine_server(THERE, ServerMsg::Reply(Reply::WorktreeStanding(Some(standing(3, false)))));
    let shown = frame(&mut app);
    assert!(shown.contains("merged-fix") && shown.contains("wip") && !shown.contains("gone"), "{shown}");
    let Mode::Tidy(v) = &app.mode else { panic!("the list") };
    let ticked: Vec<&str> = v.rows.iter().flatten().filter(|r| r.ticked).map(|r| r.name.as_str()).collect();
    assert_eq!(ticked, ["merged-fix"], "only what holds nothing of its own comes ticked");
    press(&mut app, KeyCode::Enter);
    let Mode::Confirm(c) = app.mode.clone() else { panic!("Remove asks first") };
    app.menu_do(c.act);
    let out = sent(&mut rx);
    assert!(
        out.iter().any(|o| o.machine == THERE && matches!(&o.msg, ClientMsg::Command(Command::TidyWorktrees { items }) if items == &[(PathBuf::from("/srv/app-worktrees/merged-fix"), false)])),
        "removed by the machine they are on: {out:?}"
    );
}

fn entry(branch: &str, main: bool) -> WorktreeEntry {
    WorktreeEntry { path: PathBuf::from(format!("/code/app-{branch}")), branch: branch.into(), main, repo: "app".into() }
}

#[test]
fn the_worktree_picker_offers_each_branch_without_a_worktree_and_adds_one_on_it() {
    let (mut app, mut rx) = two_machines();
    let items = vec![entry("main", true), entry("feature", false)];
    let branches = vec!["feature".to_string(), "fix-login".to_string(), "spike".to_string()];
    let rows = app.worktree_rows(Some(&items), Some(&branches), "");
    let names: Vec<String> = rows
        .iter()
        .map(|r| match r {
            WtRow::Existing(w) => format!("wt {}", w.branch),
            WtRow::Branch(b) => format!("branch {b}"),
            WtRow::Create(t) => format!("new {t}"),
        })
        .collect();
    assert_eq!(names, ["wt main", "wt feature", "branch fix-login", "branch spike"]);
    let typed = app.worktree_rows(Some(&items), Some(&branches), "fix-login");
    assert!(matches!(typed.as_slice(), [WtRow::Branch(b)] if b == "fix-login"), "an existing branch is not offered as new too");

    let ws = app.snap.active_ws.expect("a workspace");
    app.mode = Mode::Worktrees { ws, cmd: None, items: Some(items), branches: Some(branches), query: "spike".into(), sel: 0 };
    let shown = frame(&mut app);
    assert!(shown.contains("add a worktree on spike"), "{shown}");
    sent(&mut rx);
    press(&mut app, KeyCode::Enter);
    let out = sent(&mut rx);
    assert!(
        out.iter().any(|o| matches!(&o.msg, ClientMsg::Command(Command::NewWorktree { branch, base: None, .. }) if branch == "spike")),
        "{out:?}"
    );
}

#[test]
fn a_late_listing_for_a_folder_left_behind_is_not_shown() {
    let mut fd = Finder::on(THERE);
    fd.tag = 7;
    assert!(!fd.listed_remote(6, listing("/old", &[("stale", false)])));
    assert!(fd.listed_remote(7, listing("/home/dev", &[("a/b", false), ("ok", false)])));
    let names: Vec<&str> = fd.list.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(names, ["ok"], "a name with a separator in it is not a folder of this one");
}

#[test]
fn another_machines_paths_work_out_dots_in_the_text() {
    assert_eq!(remote_normalize("~/code/../docs/./"), "~/docs");
    assert_eq!(remote_normalize("/../srv"), "/srv");
    assert_eq!(remote_normalize("~/.."), "~");
    assert_eq!(remote_parent("/home/dev"), Some("/home".into()));
    assert_eq!(remote_parent("/home"), Some("/".into()));
    assert_eq!(remote_parent("~"), None);
}
