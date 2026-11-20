//! Where a new worktree's folder goes (ADR 0015). The default template puts every worktree under
//! one folder in the home directory, grouped by project: `<home>/.<command>/worktrees/<project>/<name>`.
//! `{project}` is the repository's folder name; when a different repository already uses that
//! name there, a short hash of this repository's path is added, so two repos never share a folder.

use std::path::{Path, PathBuf};

/// Left in a project's folder so a second repository with the same folder name can tell the
/// folder is taken. Holds the owning repository's path.
const OWNER_FILE: &str = ".repo";
/// Windows limits a whole path to 260 characters by default, and a worktree holds deep trees of
/// its own (`node_modules`), so each name is cut well short.
const PROJECT_CHARS: usize = 40;
const NAME_CHARS: usize = 64;
const HASH_CHARS: usize = 6;
/// Device names Windows refuses as a file name, with or without an extension.
const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// A worktree's folder, and the project folder holding it when the template names one.
pub(super) struct Placed {
    pub path: PathBuf,
    pub project_dir: Option<PathBuf>,
}

/// One path segment from free text: letters, digits and `-_.` stay, anything else (a `/` in a
/// branch name, a character Windows refuses) becomes `-`. Never empty, never `..`, never ends
/// in a dot or space (Windows drops those), never a device name, and at most `limit` characters;
/// a name that had to be cut keeps a hash of the whole so two long names stay apart.
pub(super) fn segment(text: &str, limit: usize) -> String {
    let mapped: String = text
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '-' })
        .collect();
    let mut name = if mapped.chars().count() > limit {
        let kept: String = mapped.chars().take(limit - HASH_CHARS - 1).collect();
        format!("{kept}-{}", short_hash(text))
    } else {
        mapped
    };
    name.truncate(name.trim_end_matches(['.', ' ']).len());
    let stem = name.split('.').next().unwrap_or_default().to_ascii_lowercase();
    if name.is_empty() {
        "worktree".into()
    } else if RESERVED.contains(&stem.as_str()) {
        format!("_{name}")
    } else {
        name
    }
}

/// What to compare two spellings of one path by: forward slashes, no trailing one, and no case on
/// Windows, where the file system has none.
fn key(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let text = text.trim_end_matches('/');
    if cfg!(windows) { text.to_lowercase() } else { text.to_string() }
}

/// Six hex digits of FNV-1a, which (unlike `DefaultHasher`) gives the same answer in every release,
/// so a repository's suffix never changes under it.
fn short_hash(text: &str) -> String {
    let hash = text.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    });
    format!("{hash:016x}")[..HASH_CHARS].to_string()
}

/// The folder name for `root`'s worktrees inside `parent`: its own folder name, or that with a
/// hash of its path when another repository already owns the name there.
pub(super) fn project_name(parent: &Path, root: &Path) -> String {
    let own = root.file_name().map_or_else(|| "repo".into(), |n| n.to_string_lossy().into_owned());
    let name = segment(&own, PROJECT_CHARS);
    let taken_by_another = std::fs::read_to_string(parent.join(&name).join(OWNER_FILE))
        .is_ok_and(|owner| key(Path::new(owner.trim())) != key(root));
    if taken_by_another { format!("{name}-{}", short_hash(&key(root))) } else { name }
}

fn fill(template: &str, root: &Path, home: Option<&Path>, project: &str, branch: &str) -> PathBuf {
    let repo = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "repo".into());
    let parent = root.parent().unwrap_or(root);
    let home = home.map(|h| h.to_string_lossy().into_owned()).unwrap_or_default();
    PathBuf::from(
        template
            .replace("{home}", &home)
            .replace("{repo_parent}", &parent.to_string_lossy())
            .replace("{repo}", &repo)
            .replace("{project}", project)
            .replace("{branch}", branch)
            .replace('/', std::path::MAIN_SEPARATOR_STR),
    )
}

/// The folder for `branch`'s worktree of the repository at `root`, from `template`.
/// `{home}`, `{repo_parent}`, `{repo}`, `{project}` and `{branch}` are substituted.
pub(super) fn place(template: &str, root: &Path, home: Option<&Path>, branch: &str) -> anyhow::Result<Placed> {
    if template.contains("{home}") && home.is_none() {
        anyhow::bail!("Could not find your home folder to put the worktree in. Set `[worktree] dir` to a folder.");
    }
    let name = segment(branch, NAME_CHARS);
    let Some((before, _)) = template.split_once("{project}") else {
        return Ok(Placed { path: fill(template, root, home, "", &name), project_dir: None });
    };
    let parent = fill(before, root, home, "", &name);
    let project = project_name(&parent, root);
    Ok(Placed { path: fill(template, root, home, &project, &name), project_dir: Some(parent.join(project)) })
}

/// Makes the project folder and records which repository owns it.
pub(super) fn claim(project_dir: &Path, root: &Path) -> anyhow::Result<()> {
    use anyhow::Context;
    std::fs::create_dir_all(project_dir).with_context(|| format!("making {}", project_dir.display()))?;
    let owner = project_dir.join(OWNER_FILE);
    if !owner.exists() {
        std::fs::write(&owner, root.to_string_lossy().as_bytes()).with_context(|| format!("writing {}", owner.display()))?;
    }
    Ok(())
}

/// Removes a folder that held worktrees once its last one is gone; the owner note does not count
/// as something in it. Best effort: a folder that still holds something stays.
pub(super) fn tidy(folder: &Path) {
    let only_the_note = std::fs::read_dir(folder)
        .is_ok_and(|entries| entries.flatten().all(|entry| entry.file_name() == OWNER_FILE));
    if only_the_note {
        // shortcut: a failure here leaves the folder, which the next removal tries again.
        let _ = std::fs::remove_file(folder.join(OWNER_FILE));
    }
    let _ = std::fs::remove_dir(folder);
}

/// The old default, next to the repository. Tests that must not touch the real home folder use it.
#[cfg(test)]
pub(super) const SIBLING_TEMPLATE: &str = "{repo_parent}/{repo}-worktrees/{branch}";

#[cfg(test)]
mod tests {
    use super::*;

    const DEFAULT: &str = "{home}/.maiker/worktrees/{project}/{branch}";

    fn at(home: &str, root: &str, branch: &str) -> PathBuf {
        place(DEFAULT, Path::new(root), Some(Path::new(home)), branch).unwrap().path
    }

    fn native(path: &str) -> PathBuf {
        PathBuf::from(path.replace('/', std::path::MAIN_SEPARATOR_STR))
    }

    #[test]
    fn worktrees_go_under_one_folder_in_home_grouped_by_project() {
        assert_eq!(at("/home/ada", "/work/shop", "fix-login"), native("/home/ada/.maiker/worktrees/shop/fix-login"));
        assert_eq!(at("/home/ada", "/other/shop-api", "feat/x"), native("/home/ada/.maiker/worktrees/shop-api/feat-x"));
    }

    #[test]
    fn a_windows_style_repository_path_gives_the_same_layout() {
        let placed = place(DEFAULT, Path::new(r"C:\dev\chameleon"), Some(Path::new(r"C:\Users\ada")), "warm-finch").unwrap();
        let tail = placed.path.components().rev().take(3).map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>();
        assert_eq!(tail, ["warm-finch", "chameleon", "worktrees"], "{:?}", placed.path);
    }

    #[test]
    fn the_old_sibling_template_still_places_a_worktree_next_to_the_repository() {
        let placed = place(SIBLING_TEMPLATE, Path::new("/code/shop"), None, "swift-lynx").unwrap();
        assert_eq!(placed.path, native("/code/shop-worktrees/swift-lynx"));
        assert!(placed.project_dir.is_none());
    }

    #[test]
    fn a_template_that_needs_home_says_so_when_there_is_none() {
        let error = place(DEFAULT, Path::new("/code/shop"), None, "x").err().map(|e| e.to_string()).unwrap_or_default();
        assert!(error.contains("home folder"), "{error}");
    }

    #[test]
    fn characters_windows_refuses_become_hyphens() {
        assert_eq!(segment("a<b>c:d\"e|f?g*h\\i/j", 64), "a-b-c-d-e-f-g-h-i-j");
        assert_eq!(segment("trailing..", 64), "trailing");
        assert_eq!(segment("..", 64), "worktree");
        assert_eq!(segment("", 64), "worktree");
        assert_eq!(segment("CON", 64), "_CON");
        assert_eq!(segment("nul.txt", 64), "_nul.txt");
        assert_eq!(segment("console", 64), "console");
    }

    #[test]
    fn a_long_name_is_cut_and_two_long_names_stay_apart() {
        let long = "a".repeat(100);
        let other = format!("{}b", "a".repeat(100));
        let (one, two) = (segment(&long, 40), segment(&other, 40));
        assert_eq!(one.chars().count(), 40);
        assert_ne!(one, two, "the hash tells them apart");
        assert_eq!(segment(&long, 40), one, "and is the same every time");
    }

    #[test]
    fn two_repositories_with_one_folder_name_get_different_project_folders() {
        let home = crate::daemon::persist::scratch_dir();
        let parent = home.path().join("worktrees");
        let (first, second) = (Path::new("/a/shop"), Path::new("/b/shop"));
        assert_eq!(project_name(&parent, first), "shop");
        claim(&parent.join("shop"), first).unwrap();
        assert_eq!(project_name(&parent, first), "shop", "the owner keeps the plain name");
        let other = project_name(&parent, second);
        assert!(other.starts_with("shop-") && other.len() == "shop-".len() + HASH_CHARS, "{other}");
        assert_eq!(project_name(&parent, second), other, "and the suffix is stable");
    }

    #[test]
    fn the_last_removal_tidies_the_project_folder_note_and_all() {
        let home = crate::daemon::persist::scratch_dir();
        let project = home.path().join("shop");
        claim(&project, Path::new("/a/shop")).unwrap();
        std::fs::create_dir_all(project.join("fix")).unwrap();
        tidy(&project);
        assert!(project.join(OWNER_FILE).exists(), "a worktree is still in it");
        std::fs::remove_dir(project.join("fix")).unwrap();
        tidy(&project);
        assert!(!project.exists());
    }
}
