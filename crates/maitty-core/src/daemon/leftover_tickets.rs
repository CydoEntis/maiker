//! A one-time clean-up of files the removed in-app Tickets feature left in the data folder (ADR 0013).
//!
//! On a machine with no system keychain the daemon used to keep tickets' keys as plain files in
//! `ticket-keys/` and the per-project links in `ticket-links.json`. Nothing reads them now, so the
//! daemon removes exactly those two names, directly inside its own data folder. Removing is
//! idempotent, so no marker is kept: a second start finds nothing. The system keychain is never
//! touched, and nothing else in the folder is.

use std::io;
use std::path::{Path, PathBuf};

/// The folder of per-provider key files the Tickets feature kept (0700, files 0600).
const KEYS_DIR: &str = "ticket-keys";
/// The file of per-project links the Tickets feature kept.
const LINKS_FILE: &str = "ticket-links.json";

/// What happened to one of the two leftovers.
#[derive(Debug)]
pub(super) enum Outcome {
    /// There was nothing there, which is the normal case.
    Absent,
    /// It was there and is gone.
    Removed,
    /// Something of that name that is not what the feature wrote (a link, or the wrong kind): left alone.
    Refused(&'static str),
    /// It could not be removed; the error says why (a permission, a lock held on Windows).
    Failed(io::Error),
}

/// Remove `ticket-keys/` and `ticket-links.json` from `data`, and say what became of each.
pub(super) fn sweep(data: &Path) -> Vec<(PathBuf, Outcome)> {
    let keys = data.join(KEYS_DIR);
    let links = data.join(LINKS_FILE);
    vec![
        (keys.clone(), remove(&keys, Kind::Directory)),
        (links.clone(), remove(&links, Kind::File)),
    ]
}

#[derive(Clone, Copy)]
enum Kind {
    Directory,
    File,
}

fn remove(path: &Path, kind: Kind) -> Outcome {
    // `symlink_metadata` does not follow a link, so a link that points out of the folder is seen as a link.
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Outcome::Absent,
        Err(error) => return Outcome::Failed(error),
    };
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        return Outcome::Refused("it is a link, and Maitty never follows one out of its data folder");
    }
    let result = match kind {
        Kind::Directory if file_type.is_dir() => std::fs::remove_dir_all(path),
        Kind::File if file_type.is_file() => std::fs::remove_file(path),
        Kind::Directory | Kind::File => return Outcome::Refused("it is not what the Tickets feature wrote"),
    };
    match result {
        Ok(()) => Outcome::Removed,
        // Gone between the look and the removal: the same as never there.
        Err(error) if error.kind() == io::ErrorKind::NotFound => Outcome::Absent,
        Err(error) => Outcome::Failed(error),
    }
}

/// Run the clean-up on the daemon's data folder and log what is worth knowing. Never panics and never
/// stops the daemon; only the path and the error are logged, never a file's contents.
pub(super) fn run_and_log(data: &Path) {
    for (path, outcome) in sweep(data) {
        match outcome {
            Outcome::Absent => {}
            Outcome::Removed => tracing::info!("removed {}, left by the removed Tickets feature", path.display()),
            Outcome::Refused(why) => tracing::warn!("left {} in place: {why}", path.display()),
            Outcome::Failed(error) => tracing::warn!("could not remove {}, left by the removed Tickets feature: {error}", path.display()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::persist::scratch_dir;

    fn seed(data: &Path) {
        std::fs::create_dir_all(data.join(KEYS_DIR).join("nested")).unwrap();
        std::fs::write(data.join(KEYS_DIR).join("plane.json"), "{}").unwrap();
        std::fs::write(data.join(LINKS_FILE), "{}").unwrap();
    }

    fn outcomes(data: &Path) -> Vec<String> {
        sweep(data).into_iter().map(|(_, outcome)| format!("{outcome:?}")).collect()
    }

    #[test]
    fn removes_both_and_a_second_run_finds_nothing() {
        let dir = scratch_dir();
        seed(dir.path());
        assert_eq!(outcomes(dir.path()), ["Removed", "Removed"]);
        assert!(!dir.path().join(KEYS_DIR).exists());
        assert!(!dir.path().join(LINKS_FILE).exists());
        assert_eq!(outcomes(dir.path()), ["Absent", "Absent"]);
    }

    #[test]
    fn a_missing_data_folder_is_not_an_error() {
        let dir = scratch_dir();
        assert_eq!(outcomes(&dir.path().join("never-made")), ["Absent", "Absent"]);
    }

    #[test]
    fn leaves_every_other_file_alone() {
        let dir = scratch_dir();
        seed(dir.path());
        for name in ["session.json", "ticket-keys.json", "ticket-links.json.bak", "other"] {
            std::fs::write(dir.path().join(name), "keep").unwrap();
        }
        std::fs::create_dir_all(dir.path().join("ticket-keys-old")).unwrap();
        sweep(dir.path());
        for name in ["session.json", "ticket-keys.json", "ticket-links.json.bak", "other"] {
            assert_eq!(std::fs::read_to_string(dir.path().join(name)).unwrap(), "keep", "{name}");
        }
        assert!(dir.path().join("ticket-keys-old").is_dir());
    }

    #[test]
    fn something_of_the_wrong_kind_is_refused_not_removed() {
        let dir = scratch_dir();
        std::fs::create_dir_all(dir.path().join(LINKS_FILE)).unwrap();
        std::fs::write(dir.path().join(KEYS_DIR), "a file").unwrap();
        assert_eq!(outcomes(dir.path()).iter().filter(|o| o.starts_with("Refused")).count(), 2);
        assert!(dir.path().join(LINKS_FILE).is_dir());
        assert!(dir.path().join(KEYS_DIR).is_file());
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_folder_is_refused_and_its_target_untouched() {
        let dir = scratch_dir();
        let outside = scratch_dir();
        std::fs::create_dir_all(dir.path()).unwrap();
        std::fs::create_dir_all(outside.path().join("elsewhere")).unwrap();
        std::fs::write(outside.path().join("elsewhere").join("precious"), "keep").unwrap();
        std::fs::write(outside.path().join("links"), "keep").unwrap();
        std::os::unix::fs::symlink(outside.path().join("elsewhere"), dir.path().join(KEYS_DIR)).unwrap();
        std::os::unix::fs::symlink(outside.path().join("links"), dir.path().join(LINKS_FILE)).unwrap();
        assert_eq!(outcomes(dir.path()).iter().filter(|o| o.starts_with("Refused")).count(), 2);
        assert!(outside.path().join("elsewhere").join("precious").is_file());
        assert!(outside.path().join("links").is_file());
        assert!(std::fs::symlink_metadata(dir.path().join(KEYS_DIR)).unwrap().file_type().is_symlink());
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_removal_is_reported_not_hidden() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch_dir();
        seed(dir.path());
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
        let probe = dir.path().join("probe");
        let enforced = std::fs::write(&probe, "x").is_err();
        let results = sweep(dir.path());
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        // A process that may write anywhere (root) cannot show the failure; the rest of the suite still ran.
        if enforced {
            assert!(results.iter().all(|(_, outcome)| matches!(outcome, Outcome::Failed(_))), "{results:?}");
            assert!(dir.path().join(LINKS_FILE).is_file());
        }
    }
}
