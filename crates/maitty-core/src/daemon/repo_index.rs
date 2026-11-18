//! The git repositories on this machine (`Query::Repositories`), for a window's folder picker.
//!
//! A search walks the home folder on a blocking thread, never the event loop, and is bounded in
//! depth, in folders visited and in time. It reads files only (`.git`, its `HEAD`, the time of
//! its log) and runs no git. The list is kept in memory for the daemon's life: each search
//! replaces it, and a question is answered from it, with the repositories sessions are running in
//! added and their use counted.

use super::ClientId;
use crate::gitfs;
use maitty_shared::repositories::{IndexedRepository, REPOSITORIES_MAX, REPOSITORY_SEARCH_LIMIT_SECS, RepositoryIndex};
use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// How many folders below the home folder a search looks in: `~/code/work/app` is three.
pub(super) const SCAN_DEPTH_MAX: usize = 5;

/// How long a search may run before it stops with what it has.
pub(super) const SCAN_TIME_LIMIT: Duration = Duration::from_secs(REPOSITORY_SEARCH_LIMIT_SECS);

/// The most folders a search opens before it stops with what it has.
const SCAN_FOLDERS_MAX: usize = 100_000;

/// Folders that hold other programs' files, not a person's projects, in any case. A folder whose
/// name starts with `.` is skipped as well (a repository's own `.git` is looked for, not entered).
const SKIPPED_FOLDERS: [&str; 17] = [
    "node_modules",
    "target",
    "dist",
    "build",
    "vendor",
    "venv",
    "__pycache__",
    "site-packages",
    "Library",
    "Applications",
    "AppData",
    "Pictures",
    "Music",
    "Movies",
    "Videos",
    "snap",
    "Trash",
];

/// Filesystem types that are another computer's disk: walking them is slow and can hang.
#[cfg(target_os = "linux")]
const NETWORK_FILESYSTEMS: [&str; 9] =
    ["nfs", "nfs4", "cifs", "smb3", "smbfs", "afs", "ncpfs", "9p", "fuse.sshfs"];

/// What a search found.
#[derive(Default)]
pub(crate) struct Found {
    repos: Vec<IndexedRepository>,
    /// It stopped at a limit before it had looked everywhere.
    cut: bool,
}

/// What to do with a question.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Ask {
    /// Answer from the list now.
    Answer,
    /// Wait for the search that is running.
    Wait,
    /// Start a search and wait for it.
    Search,
}

/// The list, and who is waiting for a search to end.
#[derive(Default)]
pub(super) struct Index {
    repos: Vec<IndexedRepository>,
    /// Unix seconds when the last search ended; zero when none has.
    indexed_at: u64,
    cut: bool,
    searching: bool,
    waiting: Vec<(ClientId, u64)>,
}

impl Index {
    /// Notes a question from `client` and says what to do. A client that must wait is told when
    /// the search ends (`finished`).
    pub(super) fn ask(&mut self, client: ClientId, tag: u64, rescan: bool) -> Ask {
        let never_searched = self.indexed_at == 0;
        if !(rescan || never_searched) {
            return Ask::Answer;
        }
        self.waiting.push((client, tag));
        if self.searching {
            return Ask::Wait;
        }
        self.searching = true;
        Ask::Search
    }

    /// Keeps what a search found, at `now`, and returns who was waiting for it.
    pub(super) fn finished(&mut self, found: Found, now: u64) -> Vec<(ClientId, u64)> {
        self.repos = found.repos;
        self.cut = found.cut;
        self.indexed_at = now;
        self.searching = false;
        std::mem::take(&mut self.waiting)
    }

    /// The list as a window is told it: the repositories sessions run in counted in, newest use
    /// first, no more than `REPOSITORIES_MAX`.
    pub(super) fn view(&self, running: &[Running]) -> RepositoryIndex {
        let mut by_path: BTreeMap<String, IndexedRepository> =
            self.repos.iter().map(|repo| (repo.path.clone(), repo.clone())).collect();
        for session in running {
            // A name that is not valid UTF-8 would be listed as a path that does not exist.
            if session.root.to_str().is_none() {
                continue;
            }
            let path = shown(&session.root);
            by_path
                .entry(path.clone())
                .and_modify(|repo| repo.last_used = repo.last_used.max(session.last_active))
                .or_insert_with(|| IndexedRepository {
                    branch: gitfs::main_branch(&session.root),
                    path,
                    last_used: session.last_active,
                });
        }
        // Folder and branch names are the disk's to choose, so a local list is cleaned the way another machine's is.
        let mut repos: Vec<IndexedRepository> = by_path.values().filter_map(IndexedRepository::cleaned).collect();
        repos.sort_by(|a, b| b.last_used.cmp(&a.last_used).then_with(|| a.path.cmp(&b.path)));
        let more = self.cut || repos.len() > REPOSITORIES_MAX;
        repos.truncate(REPOSITORIES_MAX);
        RepositoryIndex { repos, indexed_at: self.indexed_at, more }
    }
}

/// A repository a session runs in, and when that session last did anything.
pub(super) struct Running {
    pub(super) root: PathBuf,
    pub(super) last_active: u64,
}

/// A path as clients are shown it: absolute, with `/` on every system.
fn shown(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Unix seconds of `time`; zero before the epoch.
fn unix(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map_or(0, |since| since.as_secs())
}

/// When git last did something in the repository whose `.git` is `dot_git`: the time of its
/// reflog for HEAD (a commit, checkout or pull writes it), else of HEAD itself, else of `.git`.
fn git_activity(dot_git: &Path) -> u64 {
    let modified = |path: PathBuf| std::fs::metadata(path).and_then(|meta| meta.modified()).ok().map(unix);
    modified(dot_git.join("logs").join("HEAD"))
        .or_else(|| modified(dot_git.join("HEAD")))
        .or_else(|| modified(dot_git.to_path_buf()))
        .unwrap_or(0)
}

/// The repository whose top is `folder`, or none: a folder without `.git`, and a linked worktree
/// (it is a checkout of a repository already listed by its main checkout), are not one.
fn repository_at(folder: &Path) -> Option<IndexedRepository> {
    let dot_git = folder.join(".git");
    std::fs::symlink_metadata(&dot_git).ok()?;
    folder.to_str()?;
    let head = gitfs::head(folder)?;
    if head.linked || head.top != folder {
        return None;
    }
    Some(IndexedRepository {
        path: shown(folder),
        branch: Some(head.branch),
        last_used: git_activity(&dot_git),
    })
}

/// Where another computer's disks are mounted, which a search does not enter.
fn network_mounts() -> Vec<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        let Ok(mounts) = std::fs::read_to_string("/proc/self/mounts") else {
            return Vec::new();
        };
        mounts
            .lines()
            .filter_map(|line| {
                let mut fields = line.split_whitespace();
                let (_, point, kind) = (fields.next()?, fields.next()?, fields.next()?);
                NETWORK_FILESYSTEMS.contains(&kind).then(|| PathBuf::from(point.replace("\\040", " ")))
            })
            .collect()
    }
    #[cfg(not(target_os = "linux"))]
    {
        Vec::new()
    }
}

/// Whether a search goes into the folder called `name`.
fn worth_entering(name: &str) -> bool {
    !name.starts_with('.') && !SKIPPED_FOLDERS.contains(&name)
}

/// Looks for repositories below `root`, breadth first so the ones near the top come before the
/// limits are reached. A folder that cannot be read is passed over; a link is not followed, so a
/// loop cannot trap it; a repository is listed and not entered (a repository inside another is
/// found by opening the outer one).
pub(super) fn search(root: &Path, limit: Duration, avoid: &[PathBuf]) -> Found {
    let started = Instant::now();
    let mut repos = Vec::new();
    let mut opened = 0usize;
    let mut cut = false;
    let mut queue = VecDeque::from([(root.to_path_buf(), 0usize)]);
    while let Some((folder, depth)) = queue.pop_front() {
        if opened >= SCAN_FOLDERS_MAX || started.elapsed() >= limit {
            cut = true;
            break;
        }
        opened += 1;
        if let Some(repo) = repository_at(&folder) {
            repos.push(repo);
            continue;
        }
        if depth >= SCAN_DEPTH_MAX {
            continue;
        }
        let Ok(read) = std::fs::read_dir(&folder) else {
            continue;
        };
        for entry in read.filter_map(Result::ok) {
            if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                continue;
            }
            if !worth_entering(&entry.file_name().to_string_lossy()) {
                continue;
            }
            let path = entry.path();
            if avoid.contains(&path) {
                continue;
            }
            queue.push_back((path, depth + 1));
        }
    }
    Found { repos, cut }
}

/// A search of the home folder, for a blocking thread. With no home folder it finds nothing.
pub(super) fn search_home() -> Found {
    let Some(home) = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf()) else {
        return Found { repos: Vec::new(), cut: false };
    };
    search(&home, SCAN_TIME_LIMIT, &network_mounts())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("{}-repo-index-{label}-{}", env!("APP_COMMAND"), std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }

    fn repo_in(folder: &Path, branch: &str) {
        std::fs::create_dir_all(folder.join(".git")).unwrap();
        std::fs::write(folder.join(".git/HEAD"), format!("ref: refs/heads/{branch}\n")).unwrap();
    }

    fn paths(found: &Found) -> Vec<String> {
        let mut paths: Vec<String> = found.repos.iter().map(|repo| repo.path.clone()).collect();
        paths.sort();
        paths
    }

    #[test]
    fn finds_repositories_with_their_branch_and_skips_what_is_not_a_project() {
        let root = scratch("find");
        repo_in(&root.join("code/app"), "fixes/one");
        repo_in(&root.join("work"), "main");
        repo_in(&root.join("code/app/node_modules/dep"), "main");
        repo_in(&root.join("node_modules/other"), "main");
        repo_in(&root.join(".cache/hidden"), "main");
        std::fs::create_dir_all(root.join("docs")).unwrap();

        let found = search(&root, SCAN_TIME_LIMIT, &[]);

        assert_eq!(paths(&found), [shown(&root.join("code/app")), shown(&root.join("work"))]);
        let app = found.repos.iter().find(|repo| repo.path.ends_with("code/app")).unwrap();
        assert_eq!(app.branch.as_deref(), Some("fixes/one"));
        assert!(!found.cut);
    }

    #[test]
    fn a_repository_inside_another_is_not_listed_and_depth_is_bounded() {
        let root = scratch("depth");
        repo_in(&root.join("outer"), "main");
        repo_in(&root.join("outer/inner"), "main");
        let mut deep = root.join("a");
        for level in 0..=SCAN_DEPTH_MAX {
            deep = deep.join(format!("d{level}"));
        }
        repo_in(&deep, "main");
        repo_in(&root.join("a/b/c"), "main");

        let found = search(&root, SCAN_TIME_LIMIT, &[]);

        assert_eq!(paths(&found), [shown(&root.join("a/b/c")), shown(&root.join("outer"))]);
    }

    #[test]
    fn a_linked_worktree_and_an_avoided_folder_are_left_out() {
        let root = scratch("worktree");
        repo_in(&root.join("main-checkout"), "main");
        std::fs::create_dir_all(root.join("main-checkout/.git/worktrees/wt")).unwrap();
        std::fs::create_dir_all(root.join("wt")).unwrap();
        let pointer = root.join("main-checkout/.git/worktrees/wt");
        std::fs::write(root.join("wt/.git"), format!("gitdir: {}\n", pointer.to_string_lossy())).unwrap();
        repo_in(&root.join("mounted/app"), "main");

        let found = search(&root, SCAN_TIME_LIMIT, &[root.join("mounted")]);

        assert_eq!(paths(&found), [shown(&root.join("main-checkout"))]);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_a_folder_is_not_followed() {
        let root = scratch("link");
        repo_in(&root.join("real"), "main");
        std::os::unix::fs::symlink(root.join("real"), root.join("alias")).unwrap();
        std::os::unix::fs::symlink(&root, root.join("loop")).unwrap();

        let found = search(&root, SCAN_TIME_LIMIT, &[]);

        assert_eq!(paths(&found), [shown(&root.join("real"))]);
    }

    #[test]
    fn a_search_out_of_time_stops_with_what_it_has_and_says_so() {
        let root = scratch("limit");
        repo_in(&root.join("one"), "main");

        let found = search(&root, Duration::ZERO, &[]);

        assert!(found.cut);
        assert!(found.repos.is_empty());
    }

    #[test]
    fn a_question_waits_for_the_first_search_and_is_answered_from_the_list_after() {
        let mut index = Index::default();
        assert_eq!(index.ask(1, 10, false), Ask::Search);
        assert_eq!(index.ask(2, 11, false), Ask::Wait, "a search is under way: join it");
        let told = index.finished(Found { repos: Vec::new(), cut: false }, 100);
        assert_eq!(told, [(1, 10), (2, 11)]);
        assert_eq!(index.ask(1, 12, false), Ask::Answer);
        assert_eq!(index.ask(1, 13, true), Ask::Search, "a rescan searches again");
    }

    #[test]
    fn what_sessions_run_in_is_listed_and_counted_as_use() {
        let mut index = Index::default();
        index.ask(1, 1, false);
        let found = Found {
            repos: vec![
                IndexedRepository { path: "/h/old".into(), branch: Some("main".into()), last_used: 10 },
                IndexedRepository { path: "/h/busy".into(), branch: Some("dev".into()), last_used: 20 },
            ],
            cut: false,
        };
        index.finished(found, 50);

        let view = index.view(&[
            Running { root: PathBuf::from("/h/old"), last_active: 90 },
            Running { root: PathBuf::from("/elsewhere/new"), last_active: 70 },
        ]);

        let order: Vec<&str> = view.repos.iter().map(|repo| repo.path.as_str()).collect();
        assert_eq!(order, ["/h/old", "/elsewhere/new", "/h/busy"]);
        assert_eq!(view.repos[0].last_used, 90);
        assert_eq!(view.indexed_at, 50);
    }

    #[test]
    fn the_list_is_capped_and_says_there_is_more() {
        let mut index = Index::default();
        index.ask(1, 1, false);
        let repos = (0..REPOSITORIES_MAX + 5)
            .map(|n| IndexedRepository { path: format!("/r/{n:04}"), branch: None, last_used: n as u64 })
            .collect();
        index.finished(Found { repos, cut: false }, 5);

        let view = index.view(&[]);

        assert_eq!(view.repos.len(), REPOSITORIES_MAX);
        assert!(view.more);
        assert_eq!(view.repos[0].last_used, (REPOSITORIES_MAX + 4) as u64, "the newest are kept");
    }
}
