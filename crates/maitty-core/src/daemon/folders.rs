//! Listing the folders inside a folder, for a client that is choosing where to start a session
//! (the TUI's New Session popup, the desktop app's folder dialog). Only folder names, never file
//! names or contents.

use crate::protocol::{FolderCreated, FolderEntry, FolderListing, FOLDERS_MAX};
use maitty_shared::folder_name;
use std::io::ErrorKind;
use std::path::Component;
use std::path::{Path, PathBuf};

/// The longest path worth listing; a longer one is a mistake or an attack, and is refused.
pub(super) const PATH_MAX_BYTES: usize = 4096;

/// A path as a client types it: `~` and `~/x` mean the daemon's home folder, anything else must
/// be absolute. None for a relative path, which means nothing to a daemon whose working folder is
/// not the client's.
pub(super) fn resolve(typed: &str, home: Option<&Path>) -> Option<PathBuf> {
    let typed = typed.trim();
    let expanded = match typed.strip_prefix('~') {
        Some("") => home?.to_path_buf(),
        Some(rest) if rest.starts_with(['/', '\\']) => {
            home?.join(rest.trim_start_matches(['/', '\\']))
        }
        Some(_) => return None,
        None => PathBuf::from(typed),
    };
    expanded.is_absolute().then_some(expanded)
}

/// The folders directly inside `typed`, sorted by name without regard to case. A folder that is
/// not there, or cannot be read, is a listing that says so, not an error: the client is typing a
/// path and most of what it types does not exist yet.
pub(super) fn list(typed: &str, home: Option<&Path>) -> FolderListing {
    let Some(folder) = resolve(typed, home) else {
        return FolderListing::missing(typed);
    };
    let shown = folder.to_string_lossy().replace('\\', "/");
    let Ok(read) = std::fs::read_dir(&folder) else {
        return FolderListing::missing(&shown);
    };
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in read.filter_map(Result::ok) {
        let path = entry.path();
        // A link to a folder counts as a folder; a link to a file does not.
        if !std::fs::metadata(&path).is_ok_and(|meta| meta.is_dir()) {
            continue;
        }
        if entries.len() >= FOLDERS_MAX {
            truncated = true;
            break;
        }
        entries.push(FolderEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            git: branch_of(&path),
            has_children: has_subfolder(&path),
        });
    }
    entries.sort_by_cached_key(|entry| entry.name.to_lowercase());
    FolderListing {
        path: shown,
        exists: true,
        entries,
        truncated,
        can_create: true,
    }
}

/// Makes the one folder `name` directly inside `parent`. The name is checked again here whatever
/// the client checked, and must be a single plain component, so it cannot name another place; the
/// parent must already be a folder, and nothing above it is made. `create_dir` fails when anything
/// is already called that (a link included, which is never followed), so a name cannot be used to
/// reach through a link into somewhere else.
pub(super) fn create(parent: &str, name: &str, home: Option<&Path>) -> FolderCreated {
    if let Some(problem) = folder_name::problem(name) {
        return FolderCreated::NotAllowed { reason: problem };
    }
    // Defence in depth: the rules above already refuse a separator, but what is made is decided by the path's own parse.
    if !matches!(Path::new(name).components().collect::<Vec<_>>().as_slice(), [Component::Normal(_)]) {
        return FolderCreated::NotAllowed { reason: "That is not a plain folder name.".into() };
    }
    let Some(parent) = resolve(parent, home) else {
        return FolderCreated::NotAllowed { reason: "Choose the folder to make it in by its full path.".into() };
    };
    match std::fs::metadata(&parent) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return FolderCreated::NotAllowed { reason: "That is a file, not a folder.".into() },
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return FolderCreated::NotAllowed { reason: "The folder to make it in is not there any more.".into() };
        }
        Err(error) => return FolderCreated::Failed { reason: describe(&error) },
    }
    let child = parent.join(name);
    match std::fs::create_dir(&child) {
        Ok(()) => FolderCreated::Created { path: child.to_string_lossy().replace('\\', "/") },
        Err(error) if error.kind() == ErrorKind::AlreadyExists => FolderCreated::Exists,
        Err(error) => FolderCreated::Failed { reason: describe(&error) },
    }
}

/// An I/O error as one line for a person.
fn describe(error: &std::io::Error) -> String {
    match error.kind() {
        ErrorKind::PermissionDenied => "You do not have permission to make a folder here.".to_string(),
        ErrorKind::ReadOnlyFilesystem => "This disk is read-only.".to_string(),
        _ => format!("The folder could not be made: {error}"),
    }
}

/// Whether `folder` holds a folder worth opening: hidden ones (`.git`) do not count, so a
/// repository with nothing else in it is a place to start a session, not a place to browse.
fn has_subfolder(folder: &Path) -> bool {
    std::fs::read_dir(folder).is_ok_and(|read| {
        read.filter_map(Result::ok).any(|entry| {
            !entry.file_name().to_string_lossy().starts_with('.')
                && std::fs::metadata(entry.path()).is_ok_and(|meta| meta.is_dir())
        })
    })
}

/// The branch a git checkout is on (a short commit for a detached HEAD), or None for a folder
/// that is not a checkout. Reads two small files; runs no git.
fn branch_of(folder: &Path) -> Option<String> {
    let dot_git = folder.join(".git");
    let git_dir = if dot_git.is_dir() {
        dot_git
    } else {
        // A linked worktree has a file naming its real git folder.
        let pointer = std::fs::read_to_string(&dot_git).ok()?;
        let target = pointer.trim().strip_prefix("gitdir:")?.trim();
        let target = Path::new(target);
        if target.is_absolute() {
            target.to_path_buf()
        } else {
            folder.join(target)
        }
    };
    let head = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let head = head.trim();
    Some(match head.strip_prefix("ref: refs/heads/") {
        Some(branch) => branch.to_string(),
        None => head.chars().take(7).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!(
            "{}-folders-{label}-{}",
            env!("APP_COMMAND"),
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }

    #[test]
    fn a_tilde_is_the_home_folder_and_a_relative_path_is_nothing() {
        // A path with no drive letter is not absolute on Windows, so the fake home needs one there.
        let home = Path::new(if cfg!(windows) { r"C:\Users\me" } else { "/home/me" });
        assert_eq!(resolve("~", Some(home)), Some(home.to_path_buf()));
        assert_eq!(resolve("~/code/x", Some(home)), Some(home.join("code").join("x")));
        assert_eq!(resolve("~other/x", Some(home)), None);
        assert_eq!(resolve("code/x", Some(home)), None);
        assert_eq!(resolve("~/x", None), None);
        #[cfg(unix)]
        assert_eq!(resolve("/srv/x", None), Some(PathBuf::from("/srv/x")));
    }

    #[test]
    fn lists_folders_only_sorted_without_regard_to_case_with_their_branch_and_children() {
        let root = scratch("list");
        std::fs::create_dir_all(root.join("beta/inner")).unwrap();
        std::fs::create_dir_all(root.join("Alpha/.git")).unwrap();
        std::fs::write(root.join("Alpha/.git/HEAD"), "ref: refs/heads/fixes/one\n").unwrap();
        std::fs::write(root.join("a-file.txt"), "x").unwrap();

        let listing = list(&root.to_string_lossy(), None);

        assert!(listing.exists);
        assert!(!listing.truncated);
        let names: Vec<_> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["Alpha", "beta"]);
        let alpha = &listing.entries[0];
        assert_eq!(alpha.git.as_deref(), Some("fixes/one"));
        // Its only subfolder is `.git`, which does not count.
        assert!(!alpha.has_children);
        let beta = &listing.entries[1];
        assert_eq!(beta.git, None);
        assert!(beta.has_children);
    }

    #[test]
    fn a_detached_head_shows_a_short_commit_and_a_worktree_file_is_followed() {
        let root = scratch("head");
        std::fs::create_dir_all(root.join("detached/.git")).unwrap();
        std::fs::write(
            root.join("detached/.git/HEAD"),
            "0123456789abcdef0123456789abcdef01234567\n",
        )
        .unwrap();
        std::fs::create_dir_all(root.join("real-git")).unwrap();
        std::fs::write(root.join("real-git/HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::create_dir_all(root.join("linked")).unwrap();
        std::fs::write(
            root.join("linked/.git"),
            format!("gitdir: {}\n", root.join("real-git").display()),
        )
        .unwrap();

        let listing = list(&root.to_string_lossy(), None);
        let branch = |name: &str| {
            listing
                .entries
                .iter()
                .find(|entry| entry.name == name)
                .and_then(|entry| entry.git.clone())
        };
        assert_eq!(branch("detached").as_deref(), Some("0123456"));
        assert_eq!(branch("linked").as_deref(), Some("main"));
    }

    #[test]
    fn a_folder_that_is_not_there_is_a_listing_that_says_so() {
        let root = scratch("missing");
        let listing = list(&root.join("nope").to_string_lossy(), None);
        assert!(!listing.exists);
        assert!(listing.entries.is_empty());
        let relative = list("code/x", None);
        assert!(!relative.exists);
    }

    #[test]
    fn makes_one_folder_inside_the_parent_and_says_when_it_is_there() {
        let root = scratch("create");
        let made = create(&root.to_string_lossy(), "fresh", None);
        let FolderCreated::Created { path } = made else { panic!("{made:?}") };
        assert!(root.join("fresh").is_dir());
        assert!(path.ends_with("/fresh"), "{path}");
        assert_eq!(create(&root.to_string_lossy(), "fresh", None), FolderCreated::Exists);
        std::fs::write(root.join("a-file"), "x").unwrap();
        assert_eq!(create(&root.to_string_lossy(), "a-file", None), FolderCreated::Exists);
    }

    #[test]
    fn a_name_that_is_not_one_plain_name_makes_nothing() {
        let root = scratch("create-bad");
        let parent = root.join("inside");
        std::fs::create_dir(&parent).unwrap();
        for name in ["", ".", "..", "../escape", "a/b", "a\\b", "nul", "trailing.", " pad"] {
            let outcome = create(&parent.to_string_lossy(), name, None);
            assert!(matches!(outcome, FolderCreated::NotAllowed { .. }), "{name:?}: {outcome:?}");
        }
        assert!(!root.join("escape").exists());
        assert_eq!(std::fs::read_dir(&parent).unwrap().count(), 0);
    }

    #[test]
    fn the_parent_must_be_an_existing_folder_and_nothing_above_it_is_made() {
        let root = scratch("create-parent");
        let missing = create(&root.join("nope/deeper").to_string_lossy(), "x", None);
        assert!(matches!(missing, FolderCreated::NotAllowed { .. }), "{missing:?}");
        assert!(!root.join("nope").exists());
        std::fs::write(root.join("file"), "x").unwrap();
        let file = create(&root.join("file").to_string_lossy(), "x", None);
        assert!(matches!(file, FolderCreated::NotAllowed { .. }), "{file:?}");
        let relative = create("code/x", "y", None);
        assert!(matches!(relative, FolderCreated::NotAllowed { .. }), "{relative:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_link_with_the_name_is_never_followed_or_replaced() {
        let root = scratch("create-link");
        let outside = root.join("outside");
        std::fs::create_dir(&outside).unwrap();
        let parent = root.join("parent");
        std::fs::create_dir(&parent).unwrap();
        std::os::unix::fs::symlink(&outside, parent.join("shortcut")).unwrap();
        std::os::unix::fs::symlink(root.join("gone"), parent.join("dangling")).unwrap();
        assert_eq!(create(&parent.to_string_lossy(), "shortcut", None), FolderCreated::Exists);
        assert_eq!(create(&parent.to_string_lossy(), "dangling", None), FolderCreated::Exists);
        assert!(!root.join("gone").exists());
        assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_cannot_be_written_is_reported_not_hidden() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch("create-denied");
        let locked = root.join("locked");
        std::fs::create_dir(&locked).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();
        let outcome = create(&locked.to_string_lossy(), "x", None);
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        // A superuser is not stopped by the mode, and then the folder is simply made.
        if let FolderCreated::Created { .. } = outcome {
            return;
        }
        assert!(matches!(outcome, FolderCreated::Failed { ref reason } if reason.contains("permission")), "{outcome:?}");
    }

    #[test]
    fn a_tilde_parent_is_the_home_folder() {
        let home = scratch("create-home");
        assert!(matches!(create("~", "made", Some(&home)), FolderCreated::Created { .. }));
        assert!(home.join("made").is_dir());
    }

    #[test]
    fn a_huge_folder_is_cut_and_says_so() {
        let root = scratch("many");
        for number in 0..=FOLDERS_MAX {
            std::fs::create_dir(root.join(format!("d{number:05}"))).unwrap();
        }
        let listing = list(&root.to_string_lossy(), None);
        assert_eq!(listing.entries.len(), FOLDERS_MAX);
        assert!(listing.truncated);
    }
}
