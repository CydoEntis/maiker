//! The git repositories a daemon found on its machine (`Query::Repositories`), for the window's
//! folder picker. A path and a branch name are another machine's words when the answer comes from
//! one, so both are cleaned here by the daemon that read them and again by the window.

use crate::hidden::sanitize;
use serde::{Deserialize, Serialize};

/// The most repositories one `Reply::Repositories` carries; the least recently used go first.
pub const REPOSITORIES_MAX: usize = 300;

/// How long a daemon searches for repositories before it stops with what it has, in seconds. A
/// window waits this long and the time the answer takes to cross for a search it asked for.
pub const REPOSITORY_SEARCH_LIMIT_SECS: u64 = 15;

/// The longest path kept, in bytes; a longer one is no folder worth opening.
pub const REPOSITORY_PATH_MAX_BYTES: usize = 1024;

/// The longest branch name kept, in characters.
pub const REPOSITORY_BRANCH_MAX_CHARS: usize = 200;

/// A repository on the daemon's machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexedRepository {
    /// The folder, absolute, written with `/`.
    pub path: String,
    /// The branch it is on (a short commit when HEAD is detached); none when it could not be read.
    pub branch: Option<String>,
    /// When it was last used, in unix seconds: the later of git's own activity there and a session
    /// the daemon ran in it. Zero when neither is known.
    pub last_used: u64,
}

/// What the daemon knows of its machine's repositories.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepositoryIndex {
    /// Most recently used first, at most `REPOSITORIES_MAX`.
    pub repos: Vec<IndexedRepository>,
    /// When the search that made this list ended, in unix seconds; zero when none has.
    pub indexed_at: u64,
    /// More were found than `repos` carries, or the search ran out of time before it was done.
    pub more: bool,
}

impl IndexedRepository {
    /// This repository as safe to draw, or none when its path is not one.
    pub fn cleaned(&self) -> Option<IndexedRepository> {
        let path = sanitize(&self.path, false);
        if path.is_empty() || path.len() > REPOSITORY_PATH_MAX_BYTES || path != self.path {
            return None;
        }
        let branch = self
            .branch
            .as_deref()
            .map(|branch| sanitize(branch, false).chars().take(REPOSITORY_BRANCH_MAX_CHARS).collect::<String>())
            .filter(|branch| !branch.is_empty());
        Some(IndexedRepository { path, branch, last_used: self.last_used })
    }
}

impl RepositoryIndex {
    /// Another machine's index made safe: each repository cleaned, those without a proper path
    /// dropped, the list capped.
    pub fn cleaned(self) -> RepositoryIndex {
        RepositoryIndex {
            repos: self.repos.iter().filter_map(IndexedRepository::cleaned).take(REPOSITORIES_MAX).collect(),
            indexed_at: self.indexed_at,
            more: self.more,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(path: &str, branch: Option<&str>) -> IndexedRepository {
        IndexedRepository { path: path.into(), branch: branch.map(Into::into), last_used: 7 }
    }

    #[test]
    fn a_path_with_control_characters_is_dropped_and_a_branch_is_cleaned() {
        let index = RepositoryIndex {
            repos: vec![repo("/home/me/app", Some("fix\u{1b}[2J/one")), repo("/home/me/\u{1b}x", None), repo("", None)],
            indexed_at: 5,
            more: false,
        };
        let cleaned = index.cleaned();
        assert_eq!(cleaned.repos, vec![repo("/home/me/app", Some("fix[2J/one"))]);
        assert_eq!(cleaned.indexed_at, 5);
    }

    #[test]
    fn a_list_from_another_machine_is_capped() {
        let repos = (0..REPOSITORIES_MAX + 20).map(|n| repo(&format!("/r/{n}"), None)).collect();
        let cleaned = RepositoryIndex { repos, indexed_at: 1, more: false }.cleaned();
        assert_eq!(cleaned.repos.len(), REPOSITORIES_MAX);
    }
}
