//! The branches of a folder on this computer, read and changed for a client that has no pane in it
//! (`Query::FolderGit`): the new-chat page of a window listing a project's branches, switching to
//! one, making one, or checking out one that so far only exists on the remote. It serves this
//! computer and a machine alike, because every machine's own daemon answers for its own folders.
//!
//! The folder and every branch name come from a client, so a folder must be an absolute path (or
//! start with `~`) and a branch name is checked before git sees it. Git runs as a program with its
//! arguments, never through a shell, and is stopped at its limit.

use super::folders;
use crate::proc::{RunError, run_within};
use crate::protocol::{
    FOLDER_BRANCHES_MAX, FOLDER_GIT_LIMIT_SECS, FOLDER_WORKTREES_MAX, FolderBranch, FolderBranches, FolderGitAnswer, FolderGitRequest,
    FolderWorktree,
};
use maitty_shared::hidden::sanitize;
use maitty_shared::repo::is_branch_name;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

const LIMIT: Duration = Duration::from_secs(FOLDER_GIT_LIMIT_SECS);
const LOCAL_PREFIX: &str = "refs/heads/";
const REMOTE_PREFIX: &str = "refs/remotes/";
/// What git says when a folder is not in a repository; no other failure may be mistaken for it.
const NOT_A_REPOSITORY: &str = "not a git repository";

/// Do `request` in `folder` (a path as a client types it). Blocks while git runs.
pub(super) fn answer(folder: &str, request: &FolderGitRequest, home: Option<&Path>) -> Result<FolderGitAnswer, String> {
    answer_within(folder, request, home, LIMIT)
}

fn answer_within(folder: &str, request: &FolderGitRequest, home: Option<&Path>, limit: Duration) -> Result<FolderGitAnswer, String> {
    let resolved = (folder.len() <= folders::PATH_MAX_BYTES).then(|| folders::resolve(folder, home)).flatten();
    let folder = resolved.ok_or("Choose the folder by its full path")?;
    if !folder.is_dir() {
        return Err(format!("There is no folder {}", folder.to_string_lossy().replace('\\', "/")));
    }
    match request {
        FolderGitRequest::Branches => match git(&folder, &["rev-parse", "--is-inside-work-tree"], limit) {
            Err(why) if why.contains(NOT_A_REPOSITORY) => Ok(FolderGitAnswer::NotARepo),
            Err(why) => Err(why),
            Ok(_) => listing(&folder, limit).map(FolderGitAnswer::Branches),
        },
        FolderGitRequest::Switch { branch } => {
            check_name(branch)?;
            git(&folder, &["switch", branch], limit)?;
            Ok(FolderGitAnswer::Switched { branch: branch.clone() })
        }
        FolderGitRequest::Create { branch } => {
            check_name(branch)?;
            git(&folder, &["switch", "-c", branch], limit)?;
            Ok(FolderGitAnswer::Switched { branch: branch.clone() })
        }
        FolderGitRequest::CheckoutRemote { remote_branch } => {
            check_name(remote_branch)?;
            let local = remote_branch.split_once('/').map(|(_, local)| local).filter(|local| is_branch_name(local)).ok_or("That is not a remote branch")?;
            // Only a branch git has fetched: a name that merely looks like one could name any commit.
            git(&folder, &["rev-parse", "--verify", "--quiet", &format!("{REMOTE_PREFIX}{remote_branch}")], limit)
                .map_err(|_| format!("There is no remote branch {remote_branch}"))?;
            git(&folder, &["switch", "--track", "-c", local, remote_branch], limit)?;
            Ok(FolderGitAnswer::Switched { branch: local.to_owned() })
        }
    }
}

fn check_name(name: &str) -> Result<(), String> {
    if is_branch_name(name) { Ok(()) } else { Err("That is not a branch name".into()) }
}

/// Runs git in `folder` and answers what it printed, or the one line of what it complained about.
fn git(folder: &Path, args: &[&str], limit: Duration) -> Result<String, String> {
    let mut command = Command::new("git");
    // Its messages are matched here: keep them in English whatever the person's locale.
    command.arg("-C").arg(folder).args(args).env("LC_ALL", "C").env("GIT_TERMINAL_PROMPT", "0");
    let ran = run_within(&mut command, limit).map_err(|error| match error {
        RunError::Missing => "git is not installed on this machine".to_owned(),
        RunError::Start(why) => format!("couldn't run git: {why}"),
        RunError::TimedOut => format!("git did not answer within {} seconds", limit.as_secs()),
    })?;
    if ran.success {
        return Ok(ran.stdout);
    }
    Err(complaint(&ran.stderr))
}

/// The line of git's complaint that says what went wrong: its `fatal:` or `error:` line when it
/// has one (what follows it is advice), else the last line.
fn complaint(said: &str) -> String {
    let lines = || said.lines().map(str::trim).filter(|line| !line.is_empty());
    let line = lines().find(|line| line.starts_with("fatal:") || line.starts_with("error:")).or_else(|| lines().next_back()).unwrap_or("git failed");
    sanitize(line, false)
}

fn listing(folder: &Path, limit: Duration) -> Result<FolderBranches, String> {
    let refs = git(
        folder,
        &["for-each-ref", "--sort=-committerdate", "--format=%(HEAD)\t%(refname)\t%(committerdate:unix)", "refs/heads", "refs/remotes"],
        limit,
    )?;
    let (mut local, mut remote) = parse_refs(&refs);
    local.truncate(FOLDER_BRANCHES_MAX);
    remote.truncate(FOLDER_BRANCHES_MAX);
    let mut worktrees = parse_worktrees(&git(folder, &["worktree", "list", "--porcelain"], limit)?, &local);
    worktrees.truncate(FOLDER_WORKTREES_MAX);
    let current = local.iter().find(|branch| branch.current).map(|branch| branch.name.clone());
    local.extend(remote);
    Ok(FolderBranches { current, branches: local, worktrees })
}

/// `for-each-ref` lines (`%(HEAD)`, the full ref name, the commit time) as local and as
/// remote-tracking branches. A remote's own `HEAD` pointer is not a branch.
fn parse_refs(text: &str) -> (Vec<FolderBranch>, Vec<FolderBranch>) {
    let (mut local, mut remote) = (Vec::new(), Vec::new());
    for line in text.lines() {
        let mut parts = line.split('\t');
        let (Some(head), Some(refname)) = (parts.next(), parts.next()) else { continue };
        let when = parts.next().and_then(|seconds| seconds.trim().parse().ok());
        if let Some(name) = refname.strip_prefix(LOCAL_PREFIX) {
            local.push(FolderBranch { name: name.to_owned(), current: head.trim() == "*", when, remote: false });
        } else if let Some(name) = refname.strip_prefix(REMOTE_PREFIX)
            && name.contains('/')
            && !name.ends_with("/HEAD")
        {
            remote.push(FolderBranch { name: name.to_owned(), current: false, when, remote: true });
        }
    }
    (local, remote)
}

/// `git worktree list --porcelain` output: blocks of `worktree <path>`, `HEAD <sha>` and
/// `branch refs/heads/<name>` (or `detached`). The first block is the main checkout.
fn parse_worktrees(text: &str, branches: &[FolderBranch]) -> Vec<FolderWorktree> {
    text.split("\n\n")
        .filter_map(|block| {
            let (mut path, mut branch) = (None, None);
            for line in block.lines() {
                if let Some(found) = line.strip_prefix("worktree ") {
                    path = Some(found.trim().to_owned());
                } else if let Some(found) = line.strip_prefix("branch ") {
                    branch = Some(found.trim().trim_start_matches(LOCAL_PREFIX).to_owned());
                }
            }
            Some((path?, branch))
        })
        .enumerate()
        .map(|(at, (path, branch))| {
            let when = branch.as_deref().and_then(|name| branches.iter().find(|candidate| candidate.name == name)).and_then(|found| found.when);
            FolderWorktree { path, branch, main: at == 0, when }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn run(dir: &Path, args: &[&str]) {
        let made = Command::new("git").arg("-C").arg(dir).args(["-c", "user.name=t", "-c", "user.email=t@example.com"]).args(args).output().unwrap();
        assert!(made.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&made.stderr));
    }

    /// A repository with one commit on `main`.
    fn repo(path: &Path) -> PathBuf {
        std::fs::create_dir_all(path).unwrap();
        run(path, &["init", "-q", "--initial-branch=main"]);
        std::fs::write(path.join("README.md"), "hello").unwrap();
        run(path, &["add", "README.md"]);
        run(path, &["commit", "-q", "-m", "first"]);
        path.to_path_buf()
    }

    fn ask(folder: &Path, request: FolderGitRequest) -> Result<FolderGitAnswer, String> {
        answer_within(&folder.to_string_lossy(), &request, None, LIMIT)
    }

    fn listed(folder: &Path) -> FolderBranches {
        match ask(folder, FolderGitRequest::Branches).unwrap() {
            FolderGitAnswer::Branches(listing) => listing,
            other => panic!("expected branches, got {other:?}"),
        }
    }

    /// `origin` with a `feature` branch, and a clone of it that has fetched.
    fn clone_with_remote_branch(root: &Path) -> PathBuf {
        let origin = repo(&root.join("origin"));
        run(&origin, &["branch", "feature"]);
        let clone = root.join("clone");
        let made = Command::new("git").arg("clone").arg("-q").arg(&origin).arg(&clone).output().unwrap();
        assert!(made.status.success(), "{}", String::from_utf8_lossy(&made.stderr));
        clone
    }

    #[test]
    fn local_branches_are_listed_with_the_current_one_marked() {
        let root = crate::daemon::persist::scratch_dir();
        let folder = repo(&root.path().join("shop"));
        run(&folder, &["branch", "fix/x"]);

        let listing = listed(&folder);

        let names: Vec<_> = listing.branches.iter().map(|branch| (branch.name.as_str(), branch.current, branch.remote)).collect();
        assert_eq!(listing.current.as_deref(), Some("main"));
        assert!(names.contains(&("main", true, false)) && names.contains(&("fix/x", false, false)), "{names:?}");
        assert_eq!(listing.worktrees.len(), 1);
        assert!(listing.worktrees[0].main);
    }

    #[test]
    fn remote_tracking_branches_come_after_the_local_ones_and_are_marked() {
        let root = crate::daemon::persist::scratch_dir();
        let folder = clone_with_remote_branch(root.path());

        let listing = listed(&folder);

        let remote: Vec<_> = listing.branches.iter().filter(|branch| branch.remote).map(|branch| branch.name.as_str()).collect();
        assert!(remote.contains(&"origin/feature") && remote.contains(&"origin/main"), "{remote:?}");
        assert!(!remote.iter().any(|name| name.ends_with("/HEAD")), "the remote's HEAD pointer is not a branch");
        let first_remote = listing.branches.iter().position(|branch| branch.remote).unwrap();
        assert!(listing.branches[..first_remote].iter().all(|branch| !branch.remote));
    }

    #[test]
    fn checking_out_a_remote_branch_makes_a_local_one_that_follows_it() {
        let root = crate::daemon::persist::scratch_dir();
        let folder = clone_with_remote_branch(root.path());

        let done = ask(&folder, FolderGitRequest::CheckoutRemote { remote_branch: "origin/feature".into() }).unwrap();

        assert_eq!(done, FolderGitAnswer::Switched { branch: "feature".into() });
        assert_eq!(listed(&folder).current.as_deref(), Some("feature"));
        let upstream = Command::new("git").arg("-C").arg(&folder).args(["rev-parse", "--abbrev-ref", "feature@{u}"]).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&upstream.stdout).trim(), "origin/feature");
    }

    #[test]
    fn a_remote_branch_that_was_never_fetched_is_refused() {
        let root = crate::daemon::persist::scratch_dir();
        let folder = clone_with_remote_branch(root.path());

        let why = ask(&folder, FolderGitRequest::CheckoutRemote { remote_branch: "origin/nope".into() }).unwrap_err();

        assert_eq!(why, "There is no remote branch origin/nope");
    }

    #[test]
    fn a_branch_is_switched_to_and_made_with_the_checkout_following() {
        let root = crate::daemon::persist::scratch_dir();
        let folder = repo(&root.path().join("shop"));

        let made = ask(&folder, FolderGitRequest::Create { branch: "topic".into() }).unwrap();
        assert_eq!(made, FolderGitAnswer::Switched { branch: "topic".into() });
        assert_eq!(listed(&folder).current.as_deref(), Some("topic"));

        ask(&folder, FolderGitRequest::Switch { branch: "main".into() }).unwrap();
        assert_eq!(listed(&folder).current.as_deref(), Some("main"));

        let missing = ask(&folder, FolderGitRequest::Switch { branch: "nope".into() }).unwrap_err();
        assert!(!missing.is_empty());
    }

    #[test]
    fn a_name_git_could_read_as_an_option_never_reaches_git() {
        let root = crate::daemon::persist::scratch_dir();
        let folder = repo(&root.path().join("shop"));
        for name in ["--detach", "-c", "", "a b", "a..b"] {
            for request in [
                FolderGitRequest::Switch { branch: name.into() },
                FolderGitRequest::Create { branch: name.into() },
                FolderGitRequest::CheckoutRemote { remote_branch: name.into() },
            ] {
                assert!(ask(&folder, request).is_err(), "{name:?} was accepted");
            }
        }
        assert_eq!(listed(&folder).current.as_deref(), Some("main"));
    }

    #[test]
    fn a_folder_outside_a_repository_says_so_and_a_missing_or_relative_one_is_refused() {
        let root = crate::daemon::persist::scratch_dir();
        std::fs::create_dir_all(root.path()).unwrap();

        assert_eq!(ask(root.path(), FolderGitRequest::Branches), Ok(FolderGitAnswer::NotARepo));
        let gone = ask(&root.path().join("gone"), FolderGitRequest::Branches).unwrap_err();
        assert!(gone.starts_with("There is no folder "), "{gone}");
        let relative = answer_within("code", &FolderGitRequest::Branches, None, LIMIT).unwrap_err();
        assert_eq!(relative, "Choose the folder by its full path");
    }

    #[test]
    fn a_remotes_head_pointer_and_unparsable_lines_are_not_branches() {
        let (local, remote) = parse_refs("*\trefs/heads/main\t30\n \trefs/remotes/origin/HEAD\t20\n \trefs/remotes/origin/dev\t10\n \trefs/remotes/origin\t5\nnot a line\n");
        assert_eq!(local.iter().map(|branch| branch.name.as_str()).collect::<Vec<_>>(), ["main"]);
        assert_eq!(remote.iter().map(|branch| (branch.name.as_str(), branch.when)).collect::<Vec<_>>(), [("origin/dev", Some(10))]);
    }
}
