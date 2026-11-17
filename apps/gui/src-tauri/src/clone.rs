//! Cloning a GitHub repository for a new chat (the Where popover's Clone from GitHub).
//!
//! The text a person pastes is never handed to git: it is read as a GitHub owner and repository, and the address
//! git is given is built again from those two names. So no other host, no `file://` or `ext::` transport and no
//! option can reach the command line, and the folder made is the repository's checked name inside a folder that
//! already exists.

use crate::new_chat::run_program;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// A clone is a download: it may take minutes on a large repository, but not forever.
const CLONE_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// GitHub's own limits on an owner's and a repository's name.
const MOST_NAME_CHARS: usize = 100;
const HTTPS_PREFIXES: &[&str] = &["https://github.com/", "https://www.github.com/", "github.com/"];
const SSH_PREFIX: &str = "git@github.com:";

/// A repository on GitHub, as checked: both names are safe as a path part and as part of an address.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct GitHubRepo {
    owner: String,
    name: String,
    /// It was given as an SSH address, so it is cloned over SSH with the person's own keys.
    ssh: bool,
}

impl GitHubRepo {
    fn address(&self) -> String {
        if self.ssh {
            format!("{SSH_PREFIX}{}/{}.git", self.owner, self.name)
        } else {
            format!("https://github.com/{}/{}.git", self.owner, self.name)
        }
    }
}

/// A name GitHub allows and a file system takes as one folder: letters, digits, `-`, `_` and `.`, not starting
/// with `-` or `.` (so never an option, `.` or `..`).
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MOST_NAME_CHARS
        && !name.starts_with(['-', '.'])
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Reads a GitHub repository from what was pasted: `owner/repo`, its web page (any page under it, as a link copied
/// from the browser often is) or its HTTPS or SSH clone address.
pub(crate) fn parse_github(input: &str) -> Result<GitHubRepo, String> {
    let text = input.trim();
    let (rest, ssh) = if let Some(rest) = text.strip_prefix(SSH_PREFIX) {
        (rest, true)
    } else if let Some(rest) = HTTPS_PREFIXES.iter().find_map(|prefix| text.strip_prefix(prefix)) {
        (rest, false)
    } else if text.contains("://") || text.contains('@') || text.contains(':') {
        return Err("Only GitHub repositories can be cloned here: paste a github.com link or owner/repo.".into());
    } else {
        (text, false)
    };
    let path = rest.split(['?', '#']).next().unwrap_or_default();
    let mut parts = path.split('/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    let name = name.strip_suffix(".git").unwrap_or(name);
    // An SSH address names the repository and nothing under it.
    if ssh && parts.any(|part| !part.is_empty()) {
        return Err("That is not a repository address.".into());
    }
    if !safe_name(owner) || !safe_name(name) {
        return Err("That is not a GitHub repository: it needs an owner and a name, like owner/repo.".into());
    }
    Ok(GitHubRepo { owner: owner.into(), name: name.into(), ssh })
}

/// Where the clone goes: a folder named after the repository inside `parent`, which has to be a folder already
/// there. One that exists is never written into.
fn destination(parent: &Path, repo: &GitHubRepo) -> Result<PathBuf, String> {
    if !parent.is_absolute() || !parent.is_dir() {
        return Err("Pick a folder to clone into.".into());
    }
    let target = parent.join(&repo.name);
    if target.exists() {
        return Err(format!("{} already has a {} folder. Pick another folder, or open that one.", parent.display(), repo.name));
    }
    Ok(target)
}

fn clone_into(input: &str, parent: &Path) -> Result<PathBuf, String> {
    let repo = parse_github(input)?;
    let target = destination(parent, &repo)?;
    let target_text = target.to_str().ok_or("That folder's name cannot be used.")?;
    // `--` ends the options, though the address and the folder are already built from checked names.
    run_program("git", parent, &["clone", "--quiet", "--", &repo.address(), target_text], CLONE_TIMEOUT)
        .map_err(|error| format!("Could not clone {}/{}: {}", repo.owner, repo.name, error.trim()))?;
    Ok(target)
}

/// Clones a GitHub repository into a new folder inside `parent`, off the UI thread, and gives back that folder.
/// Git asks for no password here; a private repository clones with the credentials git already has.
#[tauri::command]
pub async fn git_clone(link: String, parent: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || clone_into(&link, Path::new(&parent)))
        .await
        .map_err(|error| error.to_string())?
        .map(|target| target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(owner: &str, name: &str, ssh: bool) -> GitHubRepo {
        GitHubRepo { owner: owner.into(), name: name.into(), ssh }
    }

    #[test]
    fn a_repository_is_read_from_each_way_it_is_pasted() {
        assert_eq!(parse_github("CydoEntis/maiker"), Ok(repo("CydoEntis", "maiker", false)));
        assert_eq!(parse_github("  https://github.com/CydoEntis/maiker  "), Ok(repo("CydoEntis", "maiker", false)));
        assert_eq!(parse_github("https://github.com/CydoEntis/maiker.git"), Ok(repo("CydoEntis", "maiker", false)));
        assert_eq!(parse_github("https://github.com/CydoEntis/maiker/tree/dev/docs?tab=readme#top"), Ok(repo("CydoEntis", "maiker", false)));
        assert_eq!(parse_github("github.com/a-b/c_d.e"), Ok(repo("a-b", "c_d.e", false)));
        assert_eq!(parse_github("git@github.com:CydoEntis/maiker.git"), Ok(repo("CydoEntis", "maiker", true)));
    }

    #[test]
    fn the_address_given_to_git_is_built_again_from_the_checked_names() {
        assert_eq!(parse_github("https://github.com/o/r/pulls").map(|r| r.address()), Ok("https://github.com/o/r.git".into()));
        assert_eq!(parse_github("git@github.com:o/r").map(|r| r.address()), Ok("git@github.com:o/r.git".into()));
    }

    #[test]
    fn anything_but_a_github_repository_is_refused() {
        for input in [
            "",
            "maiker",
            "https://gitlab.com/o/r",
            "https://evil.example/github.com/o/r",
            "file:///etc/passwd",
            "ext::sh -c touch% /tmp/x",
            "git@gitlab.com:o/r.git",
            "https://user:token@github.com/o/r",
            "-uhelp/x",
            "o/--upload-pack=touch",
            "o/..",
            "../r",
            "o/.hidden",
            "o/r;rm -rf",
            "o/r r",
            "git@github.com:o/r/extra",
        ] {
            assert!(parse_github(input).is_err(), "{input} was taken");
        }
    }

    #[test]
    fn a_clone_goes_only_into_a_new_folder_inside_one_that_exists() {
        let dir = std::env::temp_dir().join(format!("maitty-clone-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wanted = repo("o", "r", false);
        assert_eq!(destination(&dir, &wanted), Ok(dir.join("r")));
        std::fs::create_dir(dir.join("r")).unwrap();
        assert!(destination(&dir, &wanted).unwrap_err().contains("already has a r folder"));
        assert!(destination(&dir.join("missing"), &wanted).is_err());
        assert!(destination(Path::new("relative"), &wanted).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
