//! Discarding one file's uncommitted changes (`Query::DiscardFile`): the rules a path must pass
//! before anything is touched, what git says about the file read into a kind of change, and the
//! steps for that kind. The daemon runs it for a session on its machine and the desktop app for
//! one on this computer, so both refuse and act alike. Nothing here runs a program or touches a
//! disk itself: the caller's `Checkout` does, and git only ever gets arguments, never a shell line.
//!
//! What was discarded cannot be brought back, so the kind is always git's own answer for the
//! path, never one a client names, and one request never removes more than one file.

use std::fmt;
use std::path::{Path, PathBuf};

/// The longest path taken, in bytes.
pub const DISCARD_PATH_MAX_BYTES: usize = 4096;
/// How long one discard may take, all its git runs together, in seconds. Nothing here talks to
/// a remote or runs a commit hook.
pub const DISCARD_LIMIT_SECS: u64 = 15;

/// How git marks a submodule's entry in the index.
const SUBMODULE_MODE: &str = "160000";
/// What separates the parts of a path in a request, on every system.
const SEPARATOR: char = '/';

/// What is at a path of the checkout, without following a link.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnDisk {
    Missing,
    /// A file, or anything else that is neither a folder nor a link.
    File,
    Folder,
    /// A symbolic link (on Windows a junction too), whatever it points at.
    Link,
}

/// The machine a checkout is on, as the discard needs it.
pub trait Checkout {
    /// Runs git in `folder` with `args` as its arguments. What it printed, or one line saying
    /// why it failed.
    fn git(&self, folder: &Path, args: &[&str]) -> Result<String, String>;
    /// What is at `path`, not following a link.
    fn on_disk(&self, path: &Path) -> OnDisk;
    /// Removes the one file (or link) at `path`, never a folder. One line saying why not.
    fn remove_file(&self, path: &Path) -> Result<(), String>;
}

/// What a discard did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Discarded {
    /// A changed or deleted file is as the last commit has it again.
    Restored { path: String },
    /// A file the last commit does not have was removed.
    Deleted { path: String },
    /// A staged rename was undone: the file is back under its old name.
    RenameUndone { path: String, old: String },
}

impl fmt::Display for Discarded {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Discarded::Restored { path } => write!(f, "Discarded the changes to {path}"),
            Discarded::Deleted { path } => write!(f, "Deleted {path}"),
            Discarded::RenameUndone { path, old } => write!(f, "Discarded the rename of {old} to {path}"),
        }
    }
}

/// Why nothing was discarded. Each reads as one plain sentence (`Display`), which is what
/// travels to the window. A path is only ever said back cleaned and cut (`shown`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiscardError {
    /// Not the name of a file inside the checkout: empty, absolute, with `..`, an option, …
    NotInProject(String),
    /// A `\` or `:` in the name. Windows reads them as a folder, a drive or a second stream of
    /// a file, so no machine takes them.
    WindowsOnlyCharacters(String),
    /// Something of git's own (`.git`, or a name Windows reads as it).
    GitsOwn(String),
    /// A folder on the way to the file is a link, so the file may be outside the checkout.
    ThroughLink(String),
    Folder(String),
    Submodule(String),
    Conflicted(String),
    /// git reports no change for it (it is unchanged, ignored, or not there).
    Unchanged(String),
    /// git reports a kind of change this does not undo.
    NotUndone(String),
    /// Undoing a rename needs the old name free, and something is there.
    OldNameTaken { path: String, old: String },
    /// git, or removing the file, failed: its own line.
    Failed(String),
}

impl fmt::Display for DiscardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DiscardError::NotInProject(path) => write!(f, "`{path}` is not a file of this checkout"),
            DiscardError::WindowsOnlyCharacters(path) => {
                write!(f, "`{path}` has a \\ or : in its name, which cannot be discarded from here: use git in a terminal")
            }
            DiscardError::GitsOwn(path) => write!(f, "`{path}` belongs to git, not to the project"),
            DiscardError::ThroughLink(path) => {
                write!(f, "`{path}` is reached through a linked folder, so it may be outside this checkout")
            }
            DiscardError::Folder(path) => write!(f, "`{path}` is a folder: discard its files one at a time"),
            DiscardError::Submodule(path) => write!(f, "`{path}` is a submodule: discard its changes inside it"),
            DiscardError::Conflicted(path) => {
                write!(f, "`{path}` has a merge conflict: resolve it or stop the merge first")
            }
            DiscardError::Unchanged(path) => write!(f, "`{path}` has no changes to discard"),
            DiscardError::NotUndone(path) => {
                write!(f, "`{path}` changed in a way that cannot be discarded from here: use git in a terminal")
            }
            DiscardError::OldNameTaken { path, old } => {
                write!(f, "`{path}` was renamed from `{old}`, and something else is at `{old}` now: move it away first")
            }
            DiscardError::Failed(why) => f.write_str(why),
        }
    }
}

/// A path as it may be said back: without control characters, and not all of a very long one.
fn shown(path: &str) -> String {
    const SHOWN_MAX_CHARS: usize = 120;
    path.chars().filter(|c| !c.is_control()).take(SHOWN_MAX_CHARS).collect()
}

/// Whether Windows opens `.git` when asked for `name`: any letter case, trailing dots and
/// spaces (which it drops), and the short name it gives the folder.
fn is_gits_own(name: &str) -> bool {
    let name = name.trim_end_matches(['.', ' ']).to_ascii_lowercase();
    name == ".git" || name.strip_prefix("git~").is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
}

/// A path a discard may name: a file inside the checkout, written with `/`, the same on every
/// system. Never an option, a way out of the checkout, or anything of git's own. This looks at
/// the text only; what is on disk is checked afterwards.
pub fn checked_path(path: &str) -> Result<&str, DiscardError> {
    let not_in_project = || DiscardError::NotInProject(shown(path));
    if path.is_empty() || path.len() > DISCARD_PATH_MAX_BYTES || path.starts_with('-') || path.chars().any(char::is_control) {
        return Err(not_in_project());
    }
    if path.contains(['\\', ':']) {
        return Err(DiscardError::WindowsOnlyCharacters(shown(path)));
    }
    for part in path.split(SEPARATOR) {
        // An empty part is a leading, trailing or doubled `/`.
        if part.is_empty() || part == "." || part == ".." {
            return Err(not_in_project());
        }
        if is_gits_own(part) {
            return Err(DiscardError::GitsOwn(shown(path)));
        }
    }
    Ok(path)
}

/// What git's status says about one path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Change {
    /// The last commit has the file, and the index or the working copy differs from it.
    Tracked,
    /// The file is new in the index (staged, or only promised with `add -N`).
    StagedNew,
    Untracked,
    Conflicted,
    Submodule,
    /// A rename or copy entry, which a status asked without renames does not give.
    Other,
}

/// The entries of `git status --porcelain=v2 -z`: each path with what changed.
fn entries(listed: &str) -> Vec<(&str, Change)> {
    let mut found = Vec::new();
    let mut records = listed.split('\0');
    while let Some(record) = records.next() {
        // The field counts are porcelain v2's: the path is last and may itself hold spaces.
        let (kind, fields) = match record.split_once(' ') {
            Some(("1", rest)) => ('1', rest.splitn(8, ' ').collect::<Vec<_>>()),
            Some(("2", rest)) => {
                // The name it had before follows as a record of its own.
                records.next();
                ('2', rest.splitn(9, ' ').collect())
            }
            Some(("u", rest)) => ('u', rest.splitn(10, ' ').collect()),
            Some(("?", rest)) => {
                found.push((rest, Change::Untracked));
                continue;
            }
            _ => continue,
        };
        let Some(path) = fields.last().copied() else { continue };
        let submodule = fields.get(1).is_some_and(|sub| sub.starts_with('S')) || fields.iter().skip(2).take(3).any(|mode| *mode == SUBMODULE_MODE);
        let change = match (kind, fields.first().copied().unwrap_or_default()) {
            _ if submodule => Change::Submodule,
            ('u', _) => Change::Conflicted,
            ('2', _) => Change::Other,
            (_, state) if state.contains('A') => Change::StagedNew,
            (_, state) if state.chars().all(|c| matches!(c, '.' | 'M' | 'D' | 'T')) => Change::Tracked,
            _ => Change::Other,
        };
        found.push((path, change));
    }
    found
}

/// The name `path` had in the last commit, when the index holds it as a rename.
fn renamed_from(checkout: &impl Checkout, top: &Path, path: &str) -> Result<Option<String>, DiscardError> {
    // With no commit yet there is nothing to have been renamed from.
    if checkout.git(top, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_err() {
        return Ok(None);
    }
    // Asked the way the list of changes is, so a row shown as a rename is undone as one.
    let listed = checkout
        .git(top, &["diff", "--cached", "--name-status", "-z", "--diff-filter=R", "HEAD", "--"])
        .map_err(DiscardError::Failed)?;
    let mut fields = listed.split('\0');
    while let (Some(_score), Some(old), Some(new)) = (fields.next(), fields.next(), fields.next()) {
        if new == path {
            return Ok(Some(old.to_owned()));
        }
    }
    Ok(None)
}

/// What is at `path` under `top`, refused when a folder on the way to it is a link: the file
/// would then be wherever the link points, which may be outside the checkout.
fn on_disk_inside(checkout: &impl Checkout, top: &Path, path: &str) -> Result<OnDisk, DiscardError> {
    let mut at = top.to_path_buf();
    let mut parts = path.split(SEPARATOR).peekable();
    while let Some(part) = parts.next() {
        at.push(part);
        let found = checkout.on_disk(&at);
        if parts.peek().is_none() {
            return Ok(found);
        }
        if found == OnDisk::Link {
            return Err(DiscardError::ThroughLink(shown(path)));
        }
    }
    Ok(OnDisk::Missing)
}

/// Discards the uncommitted changes of the one file `path` (relative to the top of the
/// repository `folder` is in, with `/`):
///
/// - a changed or deleted file the last commit has is put back from it, in the index and the
///   working copy;
/// - a new file that is staged is unstaged and removed;
/// - an untracked file is removed, that one file only;
/// - a staged rename is undone: the new name is removed and the old one put back.
///
/// Everything else is refused before anything changes: a path outside the checkout or through
/// a linked folder, a folder, a submodule, a conflicted file, an ignored or unchanged one.
pub fn discard_file(checkout: &impl Checkout, folder: &Path, path: &str) -> Result<Discarded, DiscardError> {
    let path = checked_path(path)?;
    let top = checkout.git(folder, &["rev-parse", "--show-toplevel"]).map_err(DiscardError::Failed)?;
    let top = PathBuf::from(top.trim());
    let on_disk = on_disk_inside(checkout, &top, path)?;
    // A path is a file's name here, never a pattern or one of git's `:(…)` forms.
    let listed = checkout
        .git(&top, &["--literal-pathspecs", "status", "--porcelain=v2", "-z", "--untracked-files=all", "--no-renames", "--", path])
        .map_err(DiscardError::Failed)?;
    let entries = entries(&listed);
    let change = entries.iter().find(|(entry, _)| *entry == path).map(|(_, change)| *change);
    let said = || shown(path);
    let change = match change {
        Some(Change::Submodule) => return Err(DiscardError::Submodule(said())),
        Some(Change::Conflicted) => return Err(DiscardError::Conflicted(said())),
        Some(Change::Other) => return Err(DiscardError::NotUndone(said())),
        // git lists what is under a folder when asked about the folder.
        _ if on_disk == OnDisk::Folder || entries.iter().any(|(entry, _)| entry.strip_prefix(path).is_some_and(|rest| rest.starts_with(SEPARATOR))) => {
            return Err(DiscardError::Folder(said()));
        }
        None => return Err(DiscardError::Unchanged(said())),
        Some(change) => change,
    };
    let git = |args: &[&str]| checkout.git(&top, args).map(drop).map_err(DiscardError::Failed);
    match change {
        Change::Tracked => {
            git(&["--literal-pathspecs", "checkout", "--quiet", "HEAD", "--", path])?;
            Ok(Discarded::Restored { path: path.to_owned() })
        }
        Change::Untracked => {
            checkout.remove_file(&top.join(path)).map_err(DiscardError::Failed)?;
            Ok(Discarded::Deleted { path: path.to_owned() })
        }
        Change::StagedNew => match renamed_from(checkout, &top, path)? {
            None => {
                git(&["--literal-pathspecs", "rm", "--force", "--quiet", "--", path])?;
                Ok(Discarded::Deleted { path: path.to_owned() })
            }
            Some(old) => {
                // The old name comes from git, and is held to the same rules as one from a client.
                let taken = || DiscardError::OldNameTaken { path: said(), old: shown(&old) };
                checked_path(&old).map_err(|_| DiscardError::NotUndone(said()))?;
                if on_disk_inside(checkout, &top, &old)? != OnDisk::Missing {
                    return Err(taken());
                }
                git(&["--literal-pathspecs", "rm", "--force", "--quiet", "--", path])?;
                git(&["--literal-pathspecs", "checkout", "--quiet", "HEAD", "--", &old])?;
                Ok(Discarded::RenameUndone { path: path.to_owned(), old })
            }
        },
        Change::Submodule | Change::Conflicted | Change::Other => Err(DiscardError::NotUndone(said())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_inside_the_checkout_may_be_named_whatever_else_is_in_its_name() {
        for good in ["a.txt", "src/main.rs", "docs/a file (copy) [1].md", "weird *?{}'\"$`!&;|<>~#%^=+,@ name.txt", "naïve/日本語.txt", ".github/workflows/ci.yml", "gitignore", ".gitignore", "x/.gitkeep", "a/git~x"] {
            assert_eq!(checked_path(good), Ok(good), "{good}");
        }
    }

    #[test]
    fn a_path_out_of_the_checkout_or_read_as_an_option_is_refused() {
        let long = "a/".repeat(DISCARD_PATH_MAX_BYTES);
        for bad in ["", "..", "../x", "a/../../x", "a/..", "/etc/passwd", "//server/share/x", "a//b", "a/", "./a", "a/./b", "-rf", "--", "-", "a\n.txt", "a\0b", "a\u{1b}[31m.txt", long.as_str()] {
            assert!(matches!(checked_path(bad), Err(DiscardError::NotInProject(_))), "{bad:?}");
        }
    }

    #[test]
    fn a_windows_path_is_refused_on_every_system() {
        for bad in ["C:\\Windows\\win.ini", "C:/Windows/win.ini", "C:x", "a\\b", "..\\x", "\\\\server\\share\\x", "a.txt:stream", "a.txt::$DATA", "\\a"] {
            assert!(matches!(checked_path(bad), Err(DiscardError::WindowsOnlyCharacters(_))), "{bad:?}");
        }
    }

    #[test]
    fn nothing_of_gits_own_may_be_named_however_windows_would_spell_it() {
        for bad in [".git", ".git/config", "sub/.git/hooks/pre-commit", ".GIT/config", ".Git/index", ".git./config", ".git /config", ".git. ./x", "GIT~1/config", "git~12/x", "a/.git"] {
            assert!(matches!(checked_path(bad), Err(DiscardError::GitsOwn(_))), "{bad:?}");
        }
    }

    #[test]
    fn a_refused_path_is_said_back_without_its_control_characters_and_cut() {
        let said = checked_path("a\u{1b}[31m\n.txt").unwrap_err().to_string();
        assert!(!said.contains(['\u{1b}', '\n']), "{said:?}");
        let said = checked_path(&"x".repeat(DISCARD_PATH_MAX_BYTES + 1)).unwrap_err().to_string();
        assert!(said.chars().count() < 200, "{said}");
    }

    #[test]
    fn each_kind_of_status_entry_is_read_with_its_whole_path() {
        let listed = [
            "1 .M N... 100644 100644 100644 1111 1111 edited file.txt",
            "1 M. N... 100644 100644 100644 1111 2222 staged.txt",
            "1 .D N... 100644 100644 000000 1111 1111 gone.txt",
            "1 A. N... 000000 100644 100644 0000 1111 new.txt",
            "1 .A N... 000000 000000 100644 0000 0000 promised.txt",
            "1 AD N... 000000 100644 000000 0000 1111 new and gone.txt",
            "1 .T N... 100644 100644 120000 1111 1111 now-a-link",
            "? loose file.txt",
            "u UU N... 100644 100644 100644 100644 1111 2222 3333 both changed.txt",
            "1 .M S.M. 160000 160000 160000 1111 1111 vendor/lib",
            "1 D. N... 160000 000000 000000 1111 0000 vendor/dropped",
            "2 R. N... 100644 100644 100644 1111 1111 R100 new name.txt",
            "old name.txt",
            "! ignored.log",
            "",
        ]
        .join("\0");
        assert_eq!(
            entries(&listed),
            vec![
                ("edited file.txt", Change::Tracked),
                ("staged.txt", Change::Tracked),
                ("gone.txt", Change::Tracked),
                ("new.txt", Change::StagedNew),
                ("promised.txt", Change::StagedNew),
                ("new and gone.txt", Change::StagedNew),
                ("now-a-link", Change::Tracked),
                ("loose file.txt", Change::Untracked),
                ("both changed.txt", Change::Conflicted),
                ("vendor/lib", Change::Submodule),
                ("vendor/dropped", Change::Submodule),
                ("new name.txt", Change::Other),
            ]
        );
    }
}
