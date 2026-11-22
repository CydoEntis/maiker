//! What this window may ask another machine's daemon about a pane's repository, and what that
//! daemon may answer. The machine is someone else's computer (ADR 0007, widened by ADR 0014): what
//! changed, the diff of it, a folder's listing and markdown documents (read and saved back, never
//! another kind of file) are asked for, only those answers are accepted, and every string in them
//! is made safe to draw before anything reads it. A fetch, pull, push, commit or pull request there answers
//! one line, cleaned the same way and checked against what was asked.

use crate::remote_chat::cleaned;
use maitty_shared::github::is_pull_request_address;
use maitty_shared::hidden::sanitize;
use maitty_shared::protocol::{GitRequest, Reply};
use maitty_shared::repo::{RepoReply, RepoRequest};

/// Longest path or branch name kept, in characters.
const NAME_MAX_CHARS: usize = 4096;
/// Longest line kept of how a request about a checkout ended, in characters.
const LINE_MAX_CHARS: usize = 512;
/// How short and how long a commit's id is as git abbreviates it.
const COMMIT_ID_MIN_CHARS: usize = 4;
const COMMIT_ID_MAX_CHARS: usize = 64;

/// The longest document text kept from another machine, in bytes: the daemon's own cap with room to spare.
const DOCUMENT_MAX_BYTES: usize = 512 * 1024;
/// The longest version stamp kept, in characters (the daemon makes a length, a dash and sixteen digits).
const VERSION_MAX_CHARS: usize = 64;
/// What a document's version is when its text had to be changed to be shown safely: it equals no real
/// version, so the window offers no editing of it (a save would write the changed text back).
pub const READ_ONLY_VERSION: &str = "";

/// Whether `path` names a markdown document the window may read or save on another machine: relative, forward
/// slashes (the window writes project paths that way on every system), nothing climbing, nothing hidden by a
/// drive letter or a stream name. The daemon there checks it again against its own checkout.
pub fn is_document_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let markdown = [".md", ".markdown", ".mdx"].iter().any(|extension| lower.ends_with(extension));
    markdown
        && !path.starts_with('/')
        && !path.contains(['\\', '\0', ':'])
        && path.len() <= NAME_MAX_CHARS
        && path.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
}

/// Whether `request` may be asked of another machine: the changed files and their diff, a folder's
/// listing, and one markdown document with its version. Reading any other file whole, branches and
/// the rest stay this computer's.
pub fn may_ask(request: &RepoRequest) -> bool {
    match request {
        RepoRequest::Status | RepoRequest::Diff { .. } | RepoRequest::Tree { .. } => true,
        RepoRequest::FileStamped { path } => is_document_path(path),
        _ => false,
    }
}

/// Whether a markdown document's text may be saved on another machine.
pub fn may_save(path: &str) -> bool {
    is_document_path(path)
}

/// `text` as it may be shown, and whether showing it meant changing it: tabs, returns and line breaks stay (a
/// document is edited and saved back), every other control or invisible character goes.
fn document_text(text: String) -> (String, bool) {
    let mut shown = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\n' | '\t' | '\r' => shown.push(c),
            c => shown.push_str(&sanitize(c.encode_utf8(&mut [0; 4]), true)),
        }
    }
    let changed = shown != text;
    (shown, changed)
}

fn plausible_version(version: &str) -> bool {
    !version.is_empty() && version.chars().count() <= VERSION_MAX_CHARS && version.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// The answer to a `SaveFile` made safe: it was written (with a plausible new version) or the file had changed.
pub fn vet_save_reply(reply: Reply) -> Result<Reply, String> {
    let Reply::Repo { tag, reply } = reply else {
        return Err("it is not an answer about saving a file".into());
    };
    match reply {
        RepoReply::Saved { version } if plausible_version(&version) => Ok(Reply::Repo { tag, reply: RepoReply::Saved { version } }),
        RepoReply::Saved { .. } => Err("it names no usable version of the saved file".into()),
        RepoReply::ChangedOnDisk => Ok(Reply::Repo { tag, reply: RepoReply::ChangedOnDisk }),
        _ => Err("it is not what was asked about saving".into()),
    }
}

/// `reply` made safe, or why it is refused. Only the answer to what `request` asked passes (a status, a
/// diff, a folder's listing or a document with its version), and nothing else. A path or a branch is one
/// clean line; a patch keeps its lines; a document keeps its tabs and line breaks.
pub fn vet_repo_reply(request: &RepoRequest, reply: Reply) -> Result<Reply, String> {
    let Reply::Repo { tag, reply } = reply else {
        return Err("it is not an answer about a repository".into());
    };
    if !may_ask(request) {
        return Err("it was not asked for".into());
    }
    if let RepoReply::FileStamped { text, version } = reply {
        if !matches!(request, RepoRequest::FileStamped { .. }) {
            return Err("it is not what was asked about the repository".into());
        }
        if text.len() > DOCUMENT_MAX_BYTES || version.chars().count() > VERSION_MAX_CHARS {
            return Err("the document is longer than a document may be".into());
        }
        let (text, changed) = document_text(text);
        let version = if changed || !plausible_version(&version) { READ_ONLY_VERSION.to_string() } else { version };
        return Ok(Reply::Repo { tag, reply: RepoReply::FileStamped { text, version } });
    }
    let asked_for = matches!(
        (request, &reply),
        (RepoRequest::Status, RepoReply::Status(_)) | (RepoRequest::Diff { .. }, RepoReply::Diff(_)) | (RepoRequest::Tree { .. }, RepoReply::Tree(_))
    );
    if !asked_for {
        return Err("it is not what was asked about the repository".into());
    }
    let reply = match cleaned(reply)? {
        RepoReply::Tree(mut entries) => {
            for entry in &mut entries {
                entry.name = one_line(std::mem::take(&mut entry.name));
            }
            RepoReply::Tree(entries)
        }
        RepoReply::Status(mut status) => {
            status.branch = status.branch.map(one_line);
            for file in &mut status.files {
                file.path = one_line(std::mem::take(&mut file.path));
            }
            RepoReply::Status(status)
        }
        RepoReply::Diff(mut diff) => {
            for file in &mut diff.files {
                file.path = one_line(std::mem::take(&mut file.path));
            }
            RepoReply::Diff(diff)
        }
        _ => return Err("it is not what was asked about the repository".into()),
    };
    Ok(Reply::Repo { tag, reply })
}

/// The answer to `request` made safe, or why it is refused. Only how the request ended passes, as
/// one clean line either way, and what it must be when it went well depends on what was asked: a
/// commit's short id and subject, a pull request's address on GitHub, or else a line to show.
pub fn vet_git_reply(request: &GitRequest, reply: Reply) -> Result<Reply, String> {
    let Reply::GitDone { tag, outcome } = reply else {
        return Err("it is not an answer about a checkout".into());
    };
    let line = |text: String| one_line(text).chars().take(LINE_MAX_CHARS).collect::<String>();
    let outcome = match outcome.map(line).map_err(line) {
        Ok(done) => match request {
            GitRequest::Commit { .. } if !starts_with_commit_id(&done) => return Err("it does not name the new commit".into()),
            GitRequest::PullRequest if !is_pull_request_address(&done) => return Err("it is not a pull request's address on GitHub".into()),
            _ => Ok(done),
        },
        Err(why) => Err(why),
    };
    Ok(Reply::GitDone { tag, outcome })
}

/// The answer to a discard of one file made safe, or why it is refused: only how it ended
/// passes, as one clean line either way.
pub fn vet_discard_reply(reply: Reply) -> Result<Reply, String> {
    let Reply::GitDone { tag, outcome } = reply else {
        return Err("it is not an answer about a checkout".into());
    };
    let line = |text: String| one_line(text).chars().take(LINE_MAX_CHARS).collect::<String>();
    Ok(Reply::GitDone { tag, outcome: outcome.map(line).map_err(line) })
}

/// Whether `line` opens with a commit's short id: hexadecimal digits, then a space or the end.
fn starts_with_commit_id(line: &str) -> bool {
    let id = line.split(' ').next().unwrap_or("");
    (COMMIT_ID_MIN_CHARS..=COMMIT_ID_MAX_CHARS).contains(&id.len()) && id.chars().all(|c| c.is_ascii_hexdigit())
}

fn one_line(text: String) -> String {
    sanitize(&text, false).chars().take(NAME_MAX_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use maitty_shared::conversation::{ConversationDiff, ConversationDiffFile};
    use maitty_shared::repo::{ChangeKind, RepoChange, RepoStatus};

    #[test]
    fn only_the_changes_listings_and_markdown_documents_are_asked_of_another_machine() {
        assert!(may_ask(&RepoRequest::Status));
        assert!(may_ask(&RepoRequest::Diff { path: Some("src/a.rs".into()) }));
        assert!(may_ask(&RepoRequest::Tree { path: None }));
        assert!(may_ask(&RepoRequest::FileStamped { path: "docs/README.md".into() }));
        for local in [
            RepoRequest::File { path: "docs/README.md".into() },
            RepoRequest::FileStamped { path: "secrets.env".into() },
            RepoRequest::FileStamped { path: ".env".into() },
            RepoRequest::Branches,
            RepoRequest::Log { limit: 5 },
            RepoRequest::Worktrees,
            RepoRequest::References,
        ] {
            assert!(!may_ask(&local), "{local:?}");
        }
    }

    #[test]
    fn a_status_from_another_machine_has_clean_one_line_paths() {
        let status = RepoStatus {
            branch: Some("main\u{1b}[31m\nx".into()),
            ahead: 1,
            behind: 2,
            files: vec![RepoChange { path: "src/a\u{7}\n.rs".into(), kind: ChangeKind::Modified }],
        };
        let Ok(Reply::Repo { tag: 7, reply: RepoReply::Status(status) }) = vet_repo_reply(&RepoRequest::Status, Reply::Repo { tag: 7, reply: RepoReply::Status(status) }) else {
            panic!("a status is an answer that was asked for");
        };
        assert_eq!(status.branch.as_deref(), Some("main[31m x"));
        assert_eq!(status.files[0].path, "src/a .rs");
        assert_eq!((status.ahead, status.behind), (1, 2));
    }

    #[test]
    fn a_diff_from_another_machine_keeps_its_lines_and_loses_escapes() {
        let diff = ConversationDiff {
            files: vec![ConversationDiffFile {
                path: "a\u{1b}]0;x\u{7}.rs".into(),
                additions: 1,
                deletions: 0,
                patch: "@@ -1 +1 @@\n-old\n+new\u{1b}[2J\n".into(),
                binary: false,
            }],
            additions: 1,
            deletions: 0,
            total_files: 1,
            truncated: false,
        };
        let Ok(Reply::Repo { reply: RepoReply::Diff(diff), .. }) = vet_repo_reply(&RepoRequest::Diff { path: None }, Reply::Repo { tag: 1, reply: RepoReply::Diff(diff) }) else {
            panic!("a diff is an answer that was asked for");
        };
        assert_eq!(diff.files[0].path, "a]0;x.rs");
        assert_eq!(diff.files[0].patch, "@@ -1 +1 @@\n-old\n+new[2J\n");
    }

    #[test]
    fn how_a_fetch_pull_or_push_ended_is_one_clean_line_and_nothing_else_passes() {
        let long = format!("fatal: \u{1b}[31mno\nway {}", "x".repeat(2000));
        for outcome in [Ok("Pushed ma\u{7}in".to_string()), Err(long)] {
            let Ok(Reply::GitDone { tag: 3, outcome }) = vet_git_reply(&GitRequest::Push, Reply::GitDone { tag: 3, outcome }) else {
                panic!("how it ended is an answer that was asked for");
            };
            let line = outcome.unwrap_or_else(|why| why);
            assert!(!line.contains(['\u{1b}', '\u{7}', '\n']) && line.chars().count() <= LINE_MAX_CHARS, "{line:?}");
        }
        assert!(vet_git_reply(&GitRequest::Push, Reply::Ok).is_err());
        assert!(vet_git_reply(&GitRequest::Push, Reply::Repo { tag: 1, reply: RepoReply::Written }).is_err());
    }

    #[test]
    fn how_a_discard_ended_is_one_clean_line_and_nothing_else_passes() {
        let long = format!("`a\u{1b}[31m.txt` is a folder\nand more {}", "x".repeat(2000));
        for outcome in [Ok("Deleted new\u{7}.txt".to_string()), Err(long)] {
            let Ok(Reply::GitDone { tag: 3, outcome }) = vet_discard_reply(Reply::GitDone { tag: 3, outcome }) else {
                panic!("how it ended is an answer that was asked for");
            };
            let line = outcome.unwrap_or_else(|why| why);
            assert!(!line.contains(['\u{1b}', '\u{7}', '\n']) && line.chars().count() <= LINE_MAX_CHARS, "{line:?}");
        }
        assert!(vet_discard_reply(Reply::Ok).is_err());
        assert!(vet_discard_reply(Reply::Repo { tag: 1, reply: RepoReply::Written }).is_err());
    }

    #[test]
    fn a_commit_must_name_its_id_and_a_pull_request_must_be_an_address_on_github() {
        let done = |request: &GitRequest, line: &str| vet_git_reply(request, Reply::GitDone { tag: 1, outcome: Ok(line.into()) });
        let commit = GitRequest::Commit { message: "m".into(), paths: None };
        assert!(matches!(done(&commit, "1a2b3c4 Add \u{1b}[31mrefunds"), Ok(Reply::GitDone { outcome: Ok(line), .. }) if line == "1a2b3c4 Add [31mrefunds"));
        for not in ["", "Committed", "zzzzzzz subject", "1a2 subject"] {
            assert!(done(&commit, not).is_err(), "{not:?}");
        }
        assert!(matches!(done(&GitRequest::PullRequest, "https://github.com/o/r/pull/12"), Ok(Reply::GitDone { outcome: Ok(line), .. }) if line == "https://github.com/o/r/pull/12"));
        for not in ["https://evil.example/o/r/pull/12", "https://github.com/o/r/pull/12/files", "Opened", "javascript:alert(1)"] {
            assert!(done(&GitRequest::PullRequest, not).is_err(), "{not:?}");
        }
        let failed = Reply::GitDone { tag: 1, outcome: Err("gh: no\nway".into()) };
        assert!(matches!(vet_git_reply(&GitRequest::PullRequest, failed), Ok(Reply::GitDone { outcome: Err(why), .. }) if why == "gh: no way"));
    }

    #[test]
    fn any_other_answer_is_refused() {
        assert!(vet_repo_reply(&RepoRequest::Status, Reply::Ok).is_err());
        assert!(vet_repo_reply(&RepoRequest::Status, Reply::Repo { tag: 1, reply: RepoReply::File("the file's text".into()) }).is_err());
        assert!(vet_repo_reply(&RepoRequest::Status, Reply::Repo { tag: 1, reply: RepoReply::Written }).is_err());
        // A diff is not an answer to a status, and no answer passes a question that may not be asked.
        let diff = maitty_shared::conversation::ConversationDiff { files: vec![], additions: 0, deletions: 0, total_files: 0, truncated: false };
        assert!(vet_repo_reply(&RepoRequest::Status, Reply::Repo { tag: 1, reply: RepoReply::Diff(diff) }).is_err());
        assert!(vet_repo_reply(&RepoRequest::Branches, Reply::Repo { tag: 1, reply: RepoReply::Branches(vec![]) }).is_err());
    }

    fn stamped(text: &str, version: &str) -> Reply {
        Reply::Repo { tag: 4, reply: RepoReply::FileStamped { text: text.into(), version: version.into() } }
    }
    fn document_request() -> RepoRequest {
        RepoRequest::FileStamped { path: "README.md".into() }
    }

    #[test]
    fn only_markdown_inside_the_project_is_a_document_on_another_machine() {
        for yes in ["README.md", "docs/guide.md", "a/b/NOTES.MARKDOWN", "x.mdx"] {
            assert!(is_document_path(yes), "{yes}");
        }
        for no in [
            "", "main.rs", "README", ".env", "/etc/passwd.md", "../x.md", "a/../x.md", "a//b.md", "./a.md",
            "C:\\Users\\me\\notes.md", "docs\\guide.md", "C:/notes.md", "a.md:stream", "a\0.md", "dir/",
        ] {
            assert!(!is_document_path(no), "{no:?}");
        }
        assert!(may_save("docs/guide.md") && !may_save("src/main.rs"));
    }

    #[test]
    fn a_document_from_another_machine_keeps_its_tabs_and_line_breaks_and_its_version() {
        let text = "# Title\r\n\tindented\n- [ ] task\n";
        let Ok(Reply::Repo { tag: 4, reply: RepoReply::FileStamped { text: shown, version } }) = vet_repo_reply(&document_request(), stamped(text, "12-00ab")) else {
            panic!("a document is what was asked for");
        };
        assert_eq!((shown.as_str(), version.as_str()), (text, "12-00ab"));
    }

    #[test]
    fn a_document_with_escapes_in_it_is_shown_clean_and_cannot_be_edited() {
        let Ok(Reply::Repo { reply: RepoReply::FileStamped { text, version }, .. }) = vet_repo_reply(&document_request(), stamped("a\u{1b}[31m\u{202e}b\n", "3-ff")) else {
            panic!("a document is what was asked for");
        };
        assert_eq!(text, "a[31mb\n");
        assert_eq!(version, READ_ONLY_VERSION, "saving the cleaned text would change the file");
    }

    #[test]
    fn a_document_that_is_too_long_or_the_wrong_answer_is_refused() {
        assert!(vet_repo_reply(&document_request(), stamped(&"x".repeat(DOCUMENT_MAX_BYTES + 1), "1-a")).is_err());
        assert!(vet_repo_reply(&document_request(), stamped("x", &"9".repeat(VERSION_MAX_CHARS + 1))).is_err());
        assert!(vet_repo_reply(&RepoRequest::Status, stamped("x", "1-a")).is_err(), "a document is not a status");
        assert!(vet_repo_reply(&document_request(), Reply::Repo { tag: 1, reply: RepoReply::File("x".into()) }).is_err());
        let Ok(Reply::Repo { reply: RepoReply::FileStamped { version, .. }, .. }) = vet_repo_reply(&document_request(), stamped("x", "not a version!")) else { panic!() };
        assert_eq!(version, READ_ONLY_VERSION, "an odd version is not trusted for a save");
    }

    #[test]
    fn a_folder_listing_from_another_machine_has_clean_names() {
        use maitty_shared::conversation::ConversationFileEntry;
        let listing = Reply::Repo { tag: 2, reply: RepoReply::Tree(vec![ConversationFileEntry { name: "a\u{1b}]0;x\u{7}\nb.md".into(), is_directory: false }]) };
        let Ok(Reply::Repo { reply: RepoReply::Tree(entries), .. }) = vet_repo_reply(&RepoRequest::Tree { path: None }, listing) else { panic!("a listing was asked for") };
        assert_eq!(entries[0].name, "a]0;x b.md");
    }

    #[test]
    fn how_a_save_ended_is_the_new_version_or_a_changed_file_and_nothing_else() {
        let saved = |version: &str| vet_save_reply(Reply::Repo { tag: 1, reply: RepoReply::Saved { version: version.into() } });
        assert!(matches!(saved("12-00ab"), Ok(Reply::Repo { reply: RepoReply::Saved { version }, .. }) if version == "12-00ab"));
        for odd in ["", "a b", "x\u{1b}[31m", &"9".repeat(VERSION_MAX_CHARS + 1)] {
            assert!(saved(odd).is_err(), "{odd:?}");
        }
        assert!(matches!(vet_save_reply(Reply::Repo { tag: 1, reply: RepoReply::ChangedOnDisk }), Ok(Reply::Repo { reply: RepoReply::ChangedOnDisk, .. })));
        for other in [Reply::Ok, Reply::Repo { tag: 1, reply: RepoReply::Written }, Reply::Repo { tag: 1, reply: RepoReply::File("x".into()) }] {
            assert!(vet_save_reply(other).is_err());
        }
    }
}
