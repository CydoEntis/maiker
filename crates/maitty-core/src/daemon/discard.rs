//! Discarding one file's uncommitted changes in the checkout a pane is in, when a person's
//! client asks (`Query::DiscardFile`). The rules and the steps are `maitty_shared::discard`, the
//! same the desktop app follows for a checkout on its own computer; this is the git and the
//! disk they run against here. It blocks, so it runs off the event loop.

use super::sync::Git;
use maitty_shared::discard::{Checkout, DISCARD_LIMIT_SECS, OnDisk, discard_file};
use std::path::Path;
use std::time::Duration;

/// This machine's git, stopped at one deadline for the whole discard, and its disk.
struct Here<'a>(Git<'a>);

impl Checkout for Here<'_> {
    fn git(&self, folder: &Path, args: &[&str]) -> Result<String, String> {
        self.0.in_folder(folder).run(args)
    }

    fn on_disk(&self, path: &Path) -> OnDisk {
        // `symlink_metadata` does not follow a link, so a link is seen as one wherever it points.
        match std::fs::symlink_metadata(path) {
            Err(_) => OnDisk::Missing,
            Ok(found) if found.file_type().is_symlink() => OnDisk::Link,
            Ok(found) if found.is_dir() => OnDisk::Folder,
            Ok(_) => OnDisk::File,
        }
    }

    fn remove_file(&self, path: &Path) -> Result<(), String> {
        std::fs::remove_file(path).map_err(|error| format!("could not delete the file: {error}"))
    }
}

/// Discards the changes of `path` in the repository `folder` is in. One line saying what was
/// done, or one line saying why nothing was.
pub(super) fn answer(folder: &Path, path: &str) -> Result<String, String> {
    discard_within(folder, path, Duration::from_secs(DISCARD_LIMIT_SECS))
}

fn discard_within(folder: &Path, path: &str, limit: Duration) -> Result<String, String> {
    discard_file(&Here(Git::new(folder, limit)), folder, path)
        .map(|done| done.to_string())
        .map_err(|why| why.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::sync::fixtures::{LIMIT, git, repository};
    use maitty_shared::discard::{DiscardError, Discarded};
    use std::path::PathBuf;

    fn discard(folder: &Path, path: &str) -> Result<Discarded, DiscardError> {
        discard_file(&Here(Git::new(folder, LIMIT)), folder, path)
    }

    fn write(folder: &Path, file: &str, text: &str) {
        let path = folder.join(file);
        std::fs::create_dir_all(path.parent().expect("a folder")).expect("a folder");
        std::fs::write(path, text).expect("a file");
    }

    fn read(folder: &Path, file: &str) -> String {
        std::fs::read_to_string(folder.join(file)).expect("the file")
    }

    fn status(folder: &Path) -> String {
        git(folder, &["status", "--porcelain", "--untracked-files=all"])
    }

    /// A repository with `a.txt` ("start") and `src/b.txt` committed.
    fn checkout(parent: &Path) -> PathBuf {
        let folder = repository(parent, "repo");
        write(&folder, "src/b.txt", "b\n");
        git(&folder, &["add", "--", "src/b.txt"]);
        git(&folder, &["commit", "-q", "-m", "b"]);
        folder
    }

    #[test]
    fn an_edited_file_is_put_back_and_its_neighbours_are_left_alone() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        write(&folder, "a.txt", "edited\n");
        write(&folder, "src/b.txt", "also edited\n");

        assert_eq!(discard(&folder, "a.txt"), Ok(Discarded::Restored { path: "a.txt".into() }));
        assert_eq!(read(&folder, "a.txt"), "start\n");
        assert_eq!(status(&folder), "M src/b.txt", "only the named file was touched");
    }

    #[test]
    fn a_staged_edit_with_more_edits_on_top_is_put_back_in_the_index_and_on_disk() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        write(&folder, "src/b.txt", "staged\n");
        git(&folder, &["add", "--", "src/b.txt"]);
        write(&folder, "src/b.txt", "staged and edited again\n");

        assert_eq!(discard(&folder, "src/b.txt"), Ok(Discarded::Restored { path: "src/b.txt".into() }));
        assert_eq!(read(&folder, "src/b.txt"), "b\n");
        assert_eq!(status(&folder), "");
    }

    #[test]
    fn a_deleted_file_comes_back_whether_the_deletion_was_staged_or_not() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        std::fs::remove_file(folder.join("a.txt")).expect("removed");
        git(&folder, &["rm", "-q", "--", "src/b.txt"]);
        assert!(!folder.join("src").exists(), "git took the emptied folder away too");

        assert_eq!(discard(&folder, "a.txt"), Ok(Discarded::Restored { path: "a.txt".into() }));
        assert_eq!(discard(&folder, "src/b.txt"), Ok(Discarded::Restored { path: "src/b.txt".into() }));
        assert_eq!((read(&folder, "a.txt"), read(&folder, "src/b.txt")), ("start\n".into(), "b\n".into()));
        assert_eq!(status(&folder), "");
    }

    #[test]
    fn a_staged_new_file_is_unstaged_and_removed() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        write(&folder, "new.txt", "new\n");
        git(&folder, &["add", "--", "new.txt"]);
        write(&folder, "new.txt", "new, and edited since\n");
        write(&folder, "promised.txt", "only promised\n");
        git(&folder, &["add", "-N", "--", "promised.txt"]);

        assert_eq!(discard(&folder, "new.txt"), Ok(Discarded::Deleted { path: "new.txt".into() }));
        assert_eq!(discard(&folder, "promised.txt"), Ok(Discarded::Deleted { path: "promised.txt".into() }));
        assert!(!folder.join("new.txt").exists() && !folder.join("promised.txt").exists());
        assert_eq!(status(&folder), "");
    }

    #[test]
    fn an_untracked_file_is_removed_and_nothing_beside_it() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        write(&folder, "notes/one.txt", "one\n");
        write(&folder, "notes/two.txt", "two\n");
        write(&folder, "notes/deep/three.txt", "three\n");

        assert_eq!(discard(&folder, "notes/one.txt"), Ok(Discarded::Deleted { path: "notes/one.txt".into() }));
        assert!(!folder.join("notes/one.txt").exists());
        assert_eq!(status(&folder), "?? notes/deep/three.txt\n?? notes/two.txt");
    }

    #[test]
    fn a_name_with_spaces_and_pattern_characters_means_that_one_file() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        // As a pattern this one would match `a.txt` too.
        write(&folder, "[ab].txt", "committed\n");
        git(&folder, &["add", "-A"]);
        git(&folder, &["commit", "-q", "-m", "an odd name"]);
        write(&folder, "[ab].txt", "edited\n");
        write(&folder, "a.txt", "edited too\n");
        let loose = ["my notes (draft) #1.txt", "é ñ 日本 'q' $HOME;x.txt"];
        for name in loose {
            write(&folder, name, "odd\n");
        }

        assert_eq!(discard(&folder, "[ab].txt"), Ok(Discarded::Restored { path: "[ab].txt".into() }));
        assert_eq!(read(&folder, "[ab].txt"), "committed\n");
        assert_eq!(read(&folder, "a.txt"), "edited too\n", "the pattern matched no other file");
        for name in loose {
            assert_eq!(discard(&folder, name), Ok(Discarded::Deleted { path: name.into() }));
        }
        assert_eq!(status(&folder), "M a.txt");
    }

    #[test]
    fn a_path_is_read_from_the_top_of_the_repository_wherever_the_pane_is() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        write(&folder, "src/b.txt", "edited\n");

        assert_eq!(discard(&folder.join("src"), "src/b.txt"), Ok(Discarded::Restored { path: "src/b.txt".into() }));
        assert_eq!(read(&folder, "src/b.txt"), "b\n");
    }

    #[test]
    fn a_staged_rename_is_undone_as_one() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        git(&folder, &["mv", "a.txt", "renamed.txt"]);

        assert_eq!(discard(&folder, "renamed.txt"), Ok(Discarded::RenameUndone { path: "renamed.txt".into(), old: "a.txt".into() }));
        assert_eq!(read(&folder, "a.txt"), "start\n");
        assert!(!folder.join("renamed.txt").exists());
        assert_eq!(status(&folder), "");
    }

    #[test]
    fn a_rename_is_left_alone_when_something_new_sits_at_the_old_name() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        git(&folder, &["mv", "a.txt", "renamed.txt"]);
        write(&folder, "a.txt", "something else, never committed\n");
        let before = status(&folder);

        assert_eq!(discard(&folder, "renamed.txt"), Err(DiscardError::OldNameTaken { path: "renamed.txt".into(), old: "a.txt".into() }));
        assert_eq!(status(&folder), before);
        assert_eq!(read(&folder, "a.txt"), "something else, never committed\n");
    }

    #[test]
    fn a_path_outside_the_checkout_of_gits_own_or_read_as_an_option_changes_nothing() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        write(dir.path(), "outside.txt", "outside\n");
        write(&folder, "a.txt", "edited\n");
        write(&folder, "-rf", "a file named like an option\n");
        let outside = dir.path().join("outside.txt");
        let before = status(&folder);

        for bad in ["../outside.txt", "src/../../outside.txt", "/etc/passwd", ".git/config", ".GIT/HEAD", "src/.git/x", "-rf", "--force", "", "a.txt\n", "./a.txt"] {
            assert!(matches!(discard(&folder, bad), Err(DiscardError::NotInProject(_) | DiscardError::GitsOwn(_))), "{bad:?}");
        }
        // Absolute as this system writes it: with a drive letter where there are drives.
        assert!(discard(&folder, outside.to_str().expect("a path")).is_err());
        for windows in ["C:\\Windows\\win.ini", "C:a.txt", "src\\b.txt", "..\\outside.txt", "a.txt:stream", "a.txt::$DATA"] {
            assert!(matches!(discard(&folder, windows), Err(DiscardError::WindowsOnlyCharacters(_))), "{windows:?}");
        }
        assert_eq!(status(&folder), before);
        assert_eq!(read(dir.path(), "outside.txt"), "outside\n");
        assert!(folder.join(".git/config").is_file() && folder.join("-rf").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn a_file_reached_through_a_linked_folder_is_refused_and_stays() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        // Another repository, so git itself would have something to discard there.
        let elsewhere = repository(dir.path(), "elsewhere");
        write(&elsewhere, "a.txt", "edited outside\n");
        write(&elsewhere, "loose.txt", "untracked outside\n");
        std::os::unix::fs::symlink(&elsewhere, folder.join("linked")).expect("a link");
        // A tracked folder swapped for a link out of the checkout.
        std::fs::remove_dir_all(folder.join("src")).expect("removed");
        std::os::unix::fs::symlink(&elsewhere, folder.join("src")).expect("a link");
        write(&elsewhere, "b.txt", "would be overwritten\n");

        for through in ["linked/a.txt", "linked/loose.txt", "src/b.txt", "src/loose.txt"] {
            assert_eq!(discard(&folder, through), Err(DiscardError::ThroughLink(through.into())), "{through}");
        }
        assert_eq!(read(&elsewhere, "a.txt"), "edited outside\n");
        assert_eq!(read(&elsewhere, "loose.txt"), "untracked outside\n");
        assert_eq!(read(&elsewhere, "b.txt"), "would be overwritten\n");
    }

    #[cfg(unix)]
    #[test]
    fn an_untracked_link_is_removed_without_touching_what_it_points_at() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        write(dir.path(), "outside.txt", "outside\n");
        std::os::unix::fs::symlink(dir.path().join("outside.txt"), folder.join("link.txt")).expect("a link");

        assert_eq!(discard(&folder, "link.txt"), Ok(Discarded::Deleted { path: "link.txt".into() }));
        assert!(folder.join("link.txt").symlink_metadata().is_err());
        assert_eq!(read(dir.path(), "outside.txt"), "outside\n");
    }

    #[test]
    fn a_folder_is_refused_changed_untracked_or_deleted() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        write(&folder, "src/b.txt", "edited\n");
        write(&folder, "notes/one.txt", "one\n");
        write(&folder, "gone/c.txt", "c\n");
        git(&folder, &["add", "--", "gone/c.txt"]);
        git(&folder, &["commit", "-q", "-m", "c"]);
        std::fs::remove_dir_all(folder.join("gone")).expect("removed");
        let before = status(&folder);

        for a_folder in ["src", "notes", "gone"] {
            assert_eq!(discard(&folder, a_folder), Err(DiscardError::Folder(a_folder.into())), "{a_folder}");
        }
        assert_eq!(status(&folder), before);
    }

    #[test]
    fn a_submodule_is_refused() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        let library = repository(dir.path(), "library");
        git(&folder, &["-c", "protocol.file.allow=always", "submodule", "--quiet", "add", library.to_str().expect("a path"), "vendor/lib"]);
        git(&folder, &["commit", "-q", "-m", "a submodule"]);
        write(&folder, "vendor/lib/a.txt", "edited inside the submodule\n");

        assert_eq!(discard(&folder, "vendor/lib"), Err(DiscardError::Submodule("vendor/lib".into())));
        assert_eq!(read(&folder, "vendor/lib/a.txt"), "edited inside the submodule\n");
    }

    #[test]
    fn a_conflicted_file_is_refused_and_keeps_its_markers() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        git(&folder, &["checkout", "-q", "-b", "other"]);
        write(&folder, "a.txt", "theirs\n");
        git(&folder, &["commit", "-q", "-am", "theirs"]);
        git(&folder, &["checkout", "-q", "main"]);
        write(&folder, "a.txt", "ours\n");
        git(&folder, &["commit", "-q", "-am", "ours"]);
        Git::new(&folder, LIMIT).run(&["merge", "other"]).expect_err("the merge conflicts");
        let conflicted = read(&folder, "a.txt");

        assert_eq!(discard(&folder, "a.txt"), Err(DiscardError::Conflicted("a.txt".into())));
        assert_eq!(read(&folder, "a.txt"), conflicted);
    }

    #[test]
    fn an_unchanged_an_ignored_and_a_missing_file_have_nothing_to_discard() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        write(&folder, ".gitignore", "*.log\n");
        git(&folder, &["add", "--", ".gitignore"]);
        git(&folder, &["commit", "-q", "-m", "ignore logs"]);
        write(&folder, "build.log", "kept\n");

        for nothing in ["a.txt", "build.log", "no-such-file.txt", "no/such/folder/file.txt"] {
            assert_eq!(discard(&folder, nothing), Err(DiscardError::Unchanged(nothing.into())), "{nothing}");
        }
        assert_eq!(read(&folder, "build.log"), "kept\n");
    }

    #[test]
    fn outside_a_repository_git_says_so_in_one_line() {
        let dir = crate::daemon::persist::scratch_dir();
        std::fs::create_dir_all(dir.path()).expect("a folder");
        write(dir.path(), "a.txt", "not in a repository\n");

        let why = answer(dir.path(), "a.txt").expect_err("there is no repository");
        assert!(why.contains("not a git repository") && !why.contains('\n'), "{why}");
        assert_eq!(read(dir.path(), "a.txt"), "not in a repository\n");
    }

    #[test]
    fn the_answer_is_one_line_either_way() {
        let dir = crate::daemon::persist::scratch_dir();
        let folder = checkout(dir.path());
        write(&folder, "a.txt", "edited\n");

        let done = answer(&folder, "a.txt").expect("discarded");
        let refused = answer(&folder, "../a.txt").expect_err("outside");
        assert!(done.contains("a.txt") && !done.contains('\n'), "{done}");
        assert!(refused.contains("a.txt") && !refused.contains('\n'), "{refused}");
    }
}
