//! Cloning a git repository into a new folder, for a person bringing a project onto this machine
//! (`Query::CloneRepo`). The address comes from a client, so it is checked before git sees it, and
//! git is given no way to ask a question: a clone that needs a password it cannot find fails.

use super::folders;
use crate::protocol::ClonePhase;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// How often a running clone is looked at for its end and its limit.
const POLL: Duration = Duration::from_millis(50);
/// The most of one line of git's that is kept, in bytes; the rest is dropped.
const LINE_MAX_BYTES: usize = 4096;
/// How many of git's last non-progress lines are kept to name a failure.
const SAID_MAX_LINES: usize = 50;

/// The longest address worth cloning; a longer one is a mistake or an attack.
pub(super) const ADDRESS_MAX_BYTES: usize = 2048;
/// How long one clone may take before it is stopped.
pub(super) const CLONE_LIMIT: Duration = Duration::from_secs(crate::protocol::CLONE_LIMIT_SECS);
/// The address forms git fetches over a network. Anything else (a local path, `file://`, `ext::`)
/// would read this machine's own disk or run a program, and is refused.
const SCHEMES: [&str; 3] = ["https://", "ssh://", "git://"];
/// The folder under the home folder that a clone makes when it is not there yet: the default destination clients offer.
pub(super) const DEFAULT_PROJECTS_DIR: &str = "Projects";
/// Characters no folder name may hold on at least one of the systems this runs on.
const NOT_IN_A_NAME: [char; 9] = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// The address as git should get it, or why it is refused.
pub(super) fn check_address(address: &str) -> Result<&str, String> {
    let address = address.trim();
    if address.is_empty() {
        return Err("Give the address of the repository to clone".into());
    }
    if address.len() > ADDRESS_MAX_BYTES {
        return Err("That address is too long to clone".into());
    }
    if address.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("A repository address has no spaces or line breaks in it".into());
    }
    // git would read one that starts with a dash as an option.
    if address.starts_with('-') {
        return Err("A repository address does not start with a dash".into());
    }
    let named = SCHEMES
        .iter()
        .any(|scheme| address.strip_prefix(scheme).is_some_and(|rest| !rest.is_empty()));
    if named || is_scp_form(address) {
        Ok(address)
    } else {
        Err("Use an https://, ssh:// or git:// address, or the git@host:owner/name form".into())
    }
}

/// `user@host:path`, the short form of an ssh address. A Windows path (`C:\x`) has no `@` before
/// its colon, so it is not one.
fn is_scp_form(address: &str) -> bool {
    let Some((who, path)) = address.split_once(':') else {
        return false;
    };
    let Some((user, host)) = who.split_once('@') else {
        return false;
    };
    !user.is_empty() && !host.is_empty() && !who.contains('/') && !path.is_empty()
}

/// The folder git would name the clone: the last part of the address, without `.git`.
pub(super) fn folder_name(address: &str) -> Option<String> {
    let last = address.trim_end_matches('/').rsplit(['/', ':']).next()?;
    let name = last.strip_suffix(".git").unwrap_or(last);
    let usable = !name.is_empty()
        && name != "."
        && name != ".."
        && !name.chars().any(|c| c.is_control() || NOT_IN_A_NAME.contains(&c));
    usable.then(|| name.to_owned())
}

/// Clones `address` into a new folder inside `parent` (a path as a client types it) and gives the
/// new folder's path with `/` separators. Blocks until git ends or `limit` passes; a clone that
/// fails or is stopped leaves no folder behind. `report` hears each step of the clone's progress.
pub(super) fn clone(address: &str, parent: &str, home: Option<&Path>, limit: Duration, report: impl FnMut(ClonePhase, u8)) -> Result<String, String> {
    let address = check_address(address)?;
    let name = folder_name(address).ok_or("That address does not end in a repository name")?;
    let parent = folders::resolve(parent, home).ok_or("Choose the folder to clone into by its full path")?;
    if !parent.is_dir() {
        // Only the default `~/Projects` is made for the person; any other missing folder is a typo worth saying.
        let default = home.map(|home| home.join(DEFAULT_PROJECTS_DIR));
        if default.as_deref() != Some(parent.as_path()) || parent.symlink_metadata().is_ok() {
            return Err(format!("There is no folder {}", shown(&parent)));
        }
        std::fs::create_dir_all(&parent).map_err(|error| format!("Could not make {}: {error}", shown(&parent)))?;
    }
    let target = parent.join(&name);
    // Also true for a link that points nowhere, which git would refuse to clone over.
    if target.symlink_metadata().is_ok() {
        return Err(format!("{} is already there", shown(&target)));
    }
    let mut command = Command::new("git");
    command
        // `--progress` makes git print its progress lines although no terminal reads them.
        .args(["clone", "--progress", "--"])
        .arg(address)
        .arg(&target)
        // Its messages are read below: keep them in English whatever the person's locale.
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0");
    match run(&mut command, limit, report) {
        Ok(()) => Ok(shown(&target)),
        Err(why) => {
            // The folder was not there before this clone, so what is there now is only its remains.
            if target.symlink_metadata().is_ok()
                && let Err(error) = std::fs::remove_dir_all(&target)
            {
                tracing::warn!("couldn't remove what a failed clone left in {}: {error}", target.display());
            }
            Err(why)
        }
    }
}

fn shown(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Runs git to its end or to `limit`, whichever is first, handing each new step of its progress
/// to `report`. On failure, the line of what it said that names the problem.
fn run(command: &mut Command, limit: Duration, mut report: impl FnMut(ClonePhase, u8)) -> Result<(), String> {
    let mut child = crate::proc::quiet(command)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => "git is not installed on this machine".to_owned(),
            _ => format!("couldn't run git: {error}"),
        })?;
    let mut stderr = child.stderr.take().ok_or("git gave no output")?;
    let (chunks, arrived) = mpsc::channel::<Vec<u8>>();
    // A thread of its own, so a clone that goes quiet cannot hold this one past `limit`. It is not
    // joined after a kill: a helper git started may still hold the pipe, and the thread ends with it.
    std::thread::spawn(move || {
        let mut buffer = [0u8; 1024];
        // A pipe that fails to read ends the same as one that closed: nothing more to hear.
        while let Ok(read) = stderr.read(&mut buffer) {
            if read == 0 || chunks.send(buffer[..read].to_vec()).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + limit;
    let stopped = |child: &mut std::process::Child| {
        // Both fail only when git has just ended by itself, which is what is wanted.
        let _ = child.kill();
        let _ = child.wait();
        Err(format!("The clone was stopped after {} seconds", limit.as_secs()))
    };
    let (mut lines, mut said, mut last) = (Lines::default(), Vec::<String>::new(), None);
    let mut take = |line: String| match progress_of(&line) {
        Some(step) if last != Some(step) => {
            last = Some(step);
            report(step.0, step.1);
        }
        Some(_) => {}
        None => {
            if said.len() == SAID_MAX_LINES {
                said.remove(0);
            }
            said.push(line);
        }
    };
    loop {
        if Instant::now() >= deadline {
            return stopped(&mut child);
        }
        match arrived.recv_timeout(POLL) {
            Ok(chunk) => lines.push(&chunk).into_iter().for_each(&mut take),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    lines.rest().into_iter().for_each(&mut take);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => return stopped(&mut child),
            Ok(None) => std::thread::sleep(POLL),
            Err(error) => return Err(format!("couldn't wait for git: {error}")),
        }
    };
    if status.success() {
        return Ok(());
    }
    // git says "warning: …" before the "fatal:" line that matters.
    let line = said
        .iter()
        .find(|line| line.starts_with("fatal") || line.starts_with("error"))
        .or_else(|| said.iter().rev().find(|line| !line.trim().is_empty()))
        .map_or("git could not clone it", |line| line.trim());
    Err(line.to_owned())
}

/// git's stderr cut into the lines it means: it ends a progress line with a carriage return, so
/// one percentage rewrites the last, and anything else with a line feed.
#[derive(Default)]
struct Lines(Vec<u8>);

impl Lines {
    fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        let mut done = Vec::new();
        for &byte in chunk {
            if byte == b'\r' || byte == b'\n' {
                if !self.0.is_empty() {
                    done.push(String::from_utf8_lossy(&self.0).into_owned());
                    self.0.clear();
                }
            } else if self.0.len() < LINE_MAX_BYTES {
                self.0.push(byte);
            }
        }
        done
    }

    /// What was said after the last line ending.
    fn rest(self) -> Option<String> {
        (!self.0.is_empty()).then(|| String::from_utf8_lossy(&self.0).into_owned())
    }
}

/// The step a git progress line reports (`Receiving objects:  45% (9/20), 1.2 MiB | 2.0 MiB/s`,
/// with `remote: ` in front of what the other side counts), or `None` for any other line.
fn progress_of(line: &str) -> Option<(ClonePhase, u8)> {
    let line = line.trim();
    let line = line.strip_prefix("remote:").map_or(line, str::trim_start);
    let (name, rest) = line.split_once(':')?;
    let phase = match name {
        "Counting objects" => ClonePhase::Counting,
        "Compressing objects" => ClonePhase::Compressing,
        "Receiving objects" => ClonePhase::Receiving,
        "Resolving deltas" => ClonePhase::Resolving,
        "Updating files" | "Checking out files" => ClonePhase::CheckingOut,
        _ => return None,
    };
    let (number, _) = rest.trim_start().split_once('%')?;
    let percent = number.trim().parse::<u8>().ok().filter(|percent| *percent <= 100)?;
    Some((phase, percent))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(status.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&status.stderr));
    }

    /// A repository with one commit, to clone from.
    fn source(root: &Path) -> std::path::PathBuf {
        let repo = root.join("origin").join("widgets.git");
        std::fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-q"]);
        std::fs::write(repo.join("README.md"), "hello").unwrap();
        git(&repo, &["add", "README.md"]);
        git(&repo, &["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "first"]);
        repo
    }

    #[test]
    fn network_addresses_are_accepted_as_written() {
        for address in ["https://github.com/o/r.git", "ssh://git@github.com/o/r", "git://host/r", "git@github.com:o/r.git", "  https://h/r  "] {
            assert_eq!(check_address(address), Ok(address.trim()), "{address}");
        }
    }

    #[test]
    fn an_address_git_could_misread_or_that_reads_this_disk_is_refused() {
        let long = format!("https://h/{}", "a".repeat(ADDRESS_MAX_BYTES));
        for address in ["", "   ", "--upload-pack=touch x", "-u", "https://h/a b", "https://h/a\nb", "https://", "http://h/r", "file:///etc", "ext::sh -c x", "/home/me/r", "C:\\code\\r", "../r", "host:path", "@host:path", "git@:path", "git@host:", long.as_str()] {
            assert!(check_address(address).is_err(), "{address:?} was accepted");
        }
    }

    #[test]
    fn the_new_folder_is_named_after_the_repository() {
        assert_eq!(folder_name("https://github.com/o/widgets.git").as_deref(), Some("widgets"));
        assert_eq!(folder_name("git@github.com:o/widgets").as_deref(), Some("widgets"));
        assert_eq!(folder_name("git@github.com:widgets.git/").as_deref(), Some("widgets"));
        assert_eq!(folder_name("https://h/.."), None);
        assert_eq!(folder_name("https://h/.git"), None);
        assert_eq!(folder_name("https://h/a?b"), None);
    }

    /// The checks an address must pass are the caller's; this runs the clone itself on a local one.
    fn clone_local(source: &Path, parent: &Path, limit: Duration) -> Result<(), String> {
        let target = parent.join("widgets");
        let mut command = Command::new("git");
        command.args(["clone", "--quiet", "--"]).arg(source).arg(&target);
        run(&mut command, limit, |_, _| {})
    }

    #[test]
    fn gits_progress_lines_are_read_as_a_phase_and_a_percentage() {
        let step = |line| progress_of(line);
        assert_eq!(step("Receiving objects:  45% (9/20), 1.2 MiB | 2.0 MiB/s"), Some((ClonePhase::Receiving, 45)));
        assert_eq!(step("remote: Counting objects: 100% (20/20), done."), Some((ClonePhase::Counting, 100)));
        assert_eq!(step("remote: Compressing objects:   7% (1/14)"), Some((ClonePhase::Compressing, 7)));
        assert_eq!(step("Resolving deltas:   0% (0/5)"), Some((ClonePhase::Resolving, 0)));
        assert_eq!(step("Updating files: 100% (3/3), done."), Some((ClonePhase::CheckingOut, 100)));
        for not in ["Cloning into 'widgets'...", "remote: Enumerating objects: 20, done.", "fatal: repository not found", "Receiving objects: 101% (1/1)", "Receiving objects: x% (1/1)", "Unknown step: 50%", ""] {
            assert_eq!(step(not), None, "{not:?}");
        }
    }

    #[test]
    fn a_progress_line_rewritten_in_place_is_read_line_by_line() {
        let mut lines = Lines::default();
        let mut got = lines.push(b"Receiving objects:  10% (1/10)\rReceiving objects:  50% (5/");
        got.extend(lines.push(b"10)\rReceiving objects: 100% (10/10), done.\nfatal: x"));
        assert_eq!(got, ["Receiving objects:  10% (1/10)", "Receiving objects:  50% (5/10)", "Receiving objects: 100% (10/10), done."]);
        assert_eq!(lines.rest().as_deref(), Some("fatal: x"));
    }

    #[test]
    fn a_clone_over_a_transport_reports_how_far_it_has_got_and_leaves_the_repository() {
        let root = crate::daemon::persist::scratch_dir();
        std::fs::create_dir_all(root.path()).unwrap();
        let origin = source(root.path());
        let target = root.path().join("widgets");
        // `--no-local` makes git fetch objects as it does from a server, which is what reports progress.
        let mut command = Command::new("git");
        command.args(["clone", "--progress", "--no-local", "--"]).arg(&origin).arg(&target).env("LC_ALL", "C");
        let mut steps = Vec::new();

        run(&mut command, CLONE_LIMIT, |phase, percent| steps.push((phase, percent))).unwrap();

        assert!(steps.contains(&(ClonePhase::Receiving, 100)), "{steps:?}");
        assert!(steps.iter().all(|(_, percent)| *percent <= 100));
        assert_eq!(std::fs::read_to_string(target.join("README.md")).unwrap(), "hello");
    }

    #[test]
    fn a_clone_that_fails_says_gits_own_reason() {
        let root = crate::daemon::persist::scratch_dir();
        std::fs::create_dir_all(root.path()).unwrap();

        let why = clone_local(&root.path().join("nothing-here"), root.path(), CLONE_LIMIT).unwrap_err();

        assert!(why.starts_with("fatal"), "{why}");
    }

    #[test]
    fn a_clone_that_takes_too_long_is_stopped() {
        let root = crate::daemon::persist::scratch_dir();
        std::fs::create_dir_all(root.path()).unwrap();

        let why = clone_local(&source(root.path()), root.path(), Duration::ZERO).unwrap_err();

        assert_eq!(why, "The clone was stopped after 0 seconds");
    }

    #[test]
    fn nothing_is_cloned_over_what_is_already_there_or_into_a_folder_that_is_not() {
        let root = crate::daemon::persist::scratch_dir();
        std::fs::create_dir_all(root.path()).unwrap();
        let parent = root.path().to_string_lossy().into_owned();
        std::fs::create_dir(root.path().join("widgets")).unwrap();

        let taken = clone("https://example.invalid/o/widgets.git", &parent, None, CLONE_LIMIT, |_, _| {}).unwrap_err();
        let missing = clone("https://example.invalid/o/widgets.git", &format!("{parent}/none"), None, CLONE_LIMIT, |_, _| {}).unwrap_err();
        let relative = clone("https://example.invalid/o/widgets.git", "code", None, CLONE_LIMIT, |_, _| {}).unwrap_err();

        assert!(taken.ends_with("/widgets is already there"), "{taken}");
        assert!(missing.starts_with("There is no folder "), "{missing}");
        assert_eq!(relative, "Choose the folder to clone into by its full path");
        assert_eq!(std::fs::read_dir(root.path().join("widgets")).unwrap().count(), 0);
    }

    #[test]
    fn the_default_projects_folder_is_made_on_first_use_and_no_other() {
        let root = crate::daemon::persist::scratch_dir();
        std::fs::create_dir_all(root.path()).unwrap();
        let home = root.path();
        let projects = home.join(DEFAULT_PROJECTS_DIR);
        let _ = clone("https://example.invalid/o/widgets.git", &projects.to_string_lossy(), Some(home), CLONE_LIMIT, |_, _| {});
        assert!(projects.is_dir(), "~/Projects is made for the first clone");
        let other = home.join("elsewhere");
        let refused = clone("https://example.invalid/o/widgets.git", &other.to_string_lossy(), Some(home), CLONE_LIMIT, |_, _| {}).unwrap_err();
        assert!(refused.starts_with("There is no folder "), "{refused}");
        assert!(!other.exists());
    }

    #[test]
    fn a_clone_that_fails_leaves_no_folder_behind() {
        let root = crate::daemon::persist::scratch_dir();
        std::fs::create_dir_all(root.path()).unwrap();
        let parent = root.path().to_string_lossy().into_owned();

        // `.invalid` never resolves (RFC 2606), so this fails without reaching any server.
        let why = clone("https://example.invalid/o/widgets.git", &parent, None, CLONE_LIMIT, |_, _| {}).unwrap_err();

        assert!(!why.is_empty());
        assert!(!root.path().join("widgets").exists());
    }
}
