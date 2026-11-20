//! Read-only questions about the repository a pane is in, and the answers.
//! Every request is scoped by the daemon to the pane's own checkout; none changes it.

use crate::conversation::{ConversationDiff, ConversationFileEntry};
use serde::{Deserialize, Serialize};

/// The longest `FindFiles` query, in characters; a longer one is refused.
pub const FIND_FILES_MAX_QUERY_CHARS: usize = 200;

/// The most paths one `FindFiles` answer carries, whatever limit was asked for.
pub const FIND_FILES_MAX_RESULTS: usize = 80;

/// The longest branch name taken from a client, in bytes.
pub const BRANCH_NAME_MAX_BYTES: usize = 200;

/// Whether `name` is a branch name safe to put on git's command line: plain ref characters, and
/// nothing git would read as an option or a revision expression.
pub fn is_branch_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= BRANCH_NAME_MAX_BYTES
        && !name.starts_with(['-', '/', '.'])
        && !name.ends_with(['/', '.'])
        && !name.ends_with(".lock")
        && !name.contains("..")
        && !name.contains("//")
        && !name.contains("@{")
        && name != "@"
        && !name.chars().any(|c| c.is_whitespace() || c.is_control() || "~^:?*[\\".contains(c))
}

/// What to read. Paths are relative to the checkout root and may not climb out of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RepoRequest {
    /// Branch, upstream distance and the changed files.
    Status,
    /// One folder's entries (None: the root).
    Tree { path: Option<String> },
    /// One text file's contents.
    File { path: String },
    /// One text file's contents and its version, for an editor that saves it back (`Command::SaveFile`).
    FileStamped { path: String },
    /// Where a path seen in the pane's output is in this repository: absolute, or relative to
    /// the pane's folder. Refused when it is not a file inside the repository.
    Locate { path: String },
    /// The working tree against HEAD, or one file of it.
    Diff { path: Option<String> },
    /// Two commits or branches against each other, or one file of that.
    DiffRange {
        from: String,
        to: String,
        path: Option<String>,
    },
    /// Local branches, the current one marked.
    Branches,
    /// The latest commits on HEAD, newest first.
    Log { limit: usize },
    /// Every worktree of the repository, open in the app or not.
    Worktrees,
    /// What the daemon saved of the checkout before and after each agent turn, newest first.
    Snapshots,
    /// How many files restoring one of those snapshots would change now; nothing is changed.
    RestoreCount { commit: String },
    /// The project's reference files (`.maiker/references/`), newest first.
    References,
    /// Files whose path holds `query` (case-insensitive), best match first, at most `limit`
    /// (capped at `FIND_FILES_MAX_RESULTS`). Ignored and hidden files are left out.
    FindFiles { query: String, limit: usize },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum RepoReply {
    Status(RepoStatus),
    Tree(Vec<ConversationFileEntry>),
    File(String),
    /// A file's text and its version: opaque, equal only for the same bytes.
    FileStamped { text: String, version: String },
    /// A `SaveFile` was written; the file's new version.
    Saved { version: String },
    /// A `SaveFile` was refused: the file is no longer the version the editor read. Nothing was written.
    ChangedOnDisk,
    /// The repository-relative path (with `/`) that `Locate` found.
    Located(String),
    Diff(ConversationDiff),
    Branches(Vec<RepoBranch>),
    Log(Vec<RepoCommit>),
    Worktrees(Vec<crate::protocol::WorktreeEntry>),
    Snapshots(Vec<RepoSnapshot>),
    References(Vec<RepoReference>),
    /// A restore finished: how many files changed.
    Restored(usize),
    /// How many files a restore would change now.
    RestoreCount(usize),
    /// A file was written.
    Written,
    /// What `FindFiles` matched: paths relative to the checkout root, with `/`. `truncated`: the
    /// walk stopped at its file or time limit, so a file past that point was not searched.
    Files { paths: Vec<String>, truncated: bool },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoStatus {
    /// None when HEAD is detached.
    pub branch: Option<String>,
    /// Commits on HEAD the upstream lacks; 0 with no upstream.
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<RepoChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoChange {
    pub path: String,
    pub kind: ChangeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoBranch {
    pub name: String,
    pub current: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoCommit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    /// Unix seconds.
    pub time: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoSnapshot {
    pub commit: String,
    /// Unix seconds.
    pub at: u64,
    /// What it was taken before ("before claude's turn").
    pub why: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoReference {
    /// Relative to the references folder.
    pub name: String,
    /// "image", "pdf", "text" and so on, as the terminal app labels it.
    pub kind: String,
    pub bytes: u64,
    /// Unix seconds.
    pub modified: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_branch_name_is_plain_ref_characters_and_never_an_option() {
        for good in ["main", "feature/x-1", "fix_2.0", "origin/main"] {
            assert!(is_branch_name(good), "{good}");
        }
        for bad in ["", "-x", "--upload-pack=x", "/x", ".x", "x/", "x.", "x.lock", "a..b", "a//b", "a@{1}", "@", "a b", "a\nb", "a~1", "a^", "a:b", "a?", "a*", "a[", "a\\b"] {
            assert!(!is_branch_name(bad), "{bad:?}");
        }
        assert!(!is_branch_name(&"a".repeat(BRANCH_NAME_MAX_BYTES + 1)));
    }
}
