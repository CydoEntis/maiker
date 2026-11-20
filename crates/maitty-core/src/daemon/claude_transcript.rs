//! Where Claude keeps a conversation, so a resume is only built for one that exists.

use std::path::{Path, PathBuf};

/// Claude files conversations under `<config folder>/projects/<folder slug>/<session>.jsonl`, the
/// slug being the working folder with every non-alphanumeric character as `-`
/// (`C:\dev\x-y` is `C--dev-x-y`).
pub(super) fn folder_slug(folder: &Path) -> String {
    folder
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// The file `claude --resume <session>` reads for a pane in `folder`.
pub(super) fn claude_transcript_path(config_dir: &Path, folder: &Path, session: &str) -> PathBuf {
    config_dir
        .join("projects")
        .join(folder_slug(folder))
        .join(format!("{session}.jsonl"))
}

/// Whether the saved session has a conversation to resume. Only a sure "no" says false: with no
/// known config folder or pane folder, no `projects` folder to look in, or an id that is not a
/// plain file name, it is assumed present and the resume is kept.
pub(super) fn has_conversation(config_dir: Option<&Path>, folder: Option<&Path>, session: &str) -> bool {
    let (Some(config_dir), Some(folder)) = (config_dir, folder) else {
        return true;
    };
    let plain = !session.is_empty()
        && session
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    let projects = config_dir.join("projects");
    if !plain || !projects.is_dir() {
        return true;
    }
    if claude_transcript_path(config_dir, folder, session).is_file() {
        return true;
    }
    // The folder as Claude saw it can differ from ours (a link, a `\\?\` prefix), so a miss in
    // its own project folder is only final when no project folder holds the session either.
    let file = format!("{session}.jsonl");
    match std::fs::read_dir(&projects) {
        Ok(entries) => entries.flatten().any(|e| e.path().join(&file).is_file()),
        Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::persist::scratch_dir;

    fn keep(config: &Path, folder: &Path, session: &str) {
        let path = claude_transcript_path(config, folder, session);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "{}\n").unwrap();
    }

    #[test]
    fn the_slug_replaces_every_non_alphanumeric_character() {
        assert_eq!(folder_slug(Path::new(r"C:\dev\x-y")), "C--dev-x-y");
        assert_eq!(folder_slug(Path::new("/home/me/my.app")), "-home-me-my-app");
    }

    #[test]
    fn the_path_is_in_the_projects_folder_of_the_config_dir() {
        let path = claude_transcript_path(Path::new("/cfg"), Path::new("/home/me/app"), "abc");
        assert_eq!(path, Path::new("/cfg").join("projects").join("-home-me-app").join("abc.jsonl"));
    }

    #[test]
    fn a_saved_transcript_keeps_the_resume() {
        let dir = scratch_dir();
        let folder = Path::new("/work/app");
        keep(dir.path(), folder, "abc-1");
        assert!(has_conversation(Some(dir.path()), Some(folder), "abc-1"));
    }

    #[test]
    fn a_session_with_no_transcript_has_no_conversation() {
        let dir = scratch_dir();
        let folder = Path::new("/work/app");
        keep(dir.path(), folder, "other");
        assert!(!has_conversation(Some(dir.path()), Some(folder), "abc-1"));
    }

    #[test]
    fn a_transcript_filed_under_another_spelling_of_the_folder_still_counts() {
        let dir = scratch_dir();
        keep(dir.path(), Path::new("/private/work/app"), "abc-1");
        assert!(has_conversation(Some(dir.path()), Some(Path::new("/work/app")), "abc-1"));
    }

    #[test]
    fn what_cannot_be_checked_keeps_the_resume() {
        let dir = scratch_dir();
        let folder = Path::new("/work/app");
        assert!(has_conversation(None, Some(folder), "abc"), "no config folder");
        assert!(has_conversation(Some(dir.path()), None, "abc"), "no pane folder");
        assert!(has_conversation(Some(dir.path()), Some(folder), "abc"), "no projects folder");
        keep(dir.path(), folder, "other");
        assert!(has_conversation(Some(dir.path()), Some(folder), "../abc"), "not a plain id");
    }
}
