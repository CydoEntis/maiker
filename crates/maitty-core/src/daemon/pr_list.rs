//! The open pull requests of the repository a folder is in (`Query::PullRequests`), as this
//! machine's GitHub command line (`gh`) lists them, with which of them wait for the signed-in
//! account. `gh` runs here because the checkout and its sign-in are here; no token is read.
//!
//! A client asks, never a timer. The folder is all a client gives, and it only becomes the folder
//! `gh` runs in: nothing of a client's is on its command line. A folder's list is kept for a
//! minute, so two windows or a double trigger cost one call, and a rate limit stops the asking
//! for a while.

use super::ClientId;
use super::github::{active_login, first_line, gh};
use super::pr::{BACKOFF_FIRST, BACKOFF_LONGEST, RawCheck, pull_request_url, rate_limited, review_of, standing};
use crate::proc::{RunError, run_within};
use crate::protocol::{
    GitHubAnswer, PULL_REQUEST_TEXT_MAX_CHARS, PULL_REQUESTS_LIMIT_SECS, PULL_REQUESTS_MAX, PrChecksState, PrReview, ProjectPr, ProjectPulls,
    PullRequestList,
};
use maitty_shared::github::is_time;
use maitty_shared::hidden::sanitize;
use serde::Deserialize;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const LIST_LIMIT: Duration = Duration::from_secs(PULL_REQUESTS_LIMIT_SECS);
/// How long a folder's list answers the next ask without `gh` running again.
const KEEP: Duration = Duration::from_secs(60);
/// The most folders `gh` is listing at once; one more is told to try again.
const MOST_AT_ONCE: usize = 32;
/// The most asks that wait on one folder's list; one more is told to try again.
const MOST_WAITING: usize = 64;
const JSON_FIELDS: &str = "number,url,title,author,headRefName,isDraft,mergeable,reviewDecision,reviewRequests,statusCheckRollup,updatedAt";
/// What `gh` says of a folder that is in no repository GitHub hosts: no repository at all, one with
/// no remote, one whose remotes are elsewhere. Matched in lower case.
const NOT_ON_GITHUB: [&str; 3] = ["not a git repository", "no git remotes found", "known github host"];
const BUSY: &str = "Too many pull request lists are being read at once. Try again in a moment";
const HELD: &str = "GitHub's rate limit was reached. Pull requests are read again in a while";

/// The open pull requests of the repository `folder` is in. Blocks while `gh` runs.
pub(super) fn list(folder: &Path) -> GitHubAnswer<ProjectPulls> {
    list_from(OsStr::new("gh"), folder, LIST_LIMIT)
}

fn list_from(program: &OsStr, folder: &Path, limit: Duration) -> GitHubAnswer<ProjectPulls> {
    if !folder.is_dir() {
        return GitHubAnswer::Failed(format!("There is no folder {}", folder.to_string_lossy().replace('\\', "/")));
    }
    let login = match active_login(program) {
        Ok(login) => login,
        Err(answer) => return answer,
    };
    // One more than is given, to know whether there are more.
    let asked = (PULL_REQUESTS_MAX + 1).to_string();
    let mut command = gh(program);
    // git's own words are matched below (`NOT_ON_GITHUB`): keep them in English.
    command.current_dir(folder).env("LC_ALL", "C").args(["pr", "list", "--state", "open", "--limit", &asked, "--json", JSON_FIELDS]);
    let ran = match run_within(&mut command, limit) {
        Ok(ran) => ran,
        Err(RunError::Missing) => return GitHubAnswer::NotInstalled,
        Err(RunError::Start(why)) => return GitHubAnswer::Failed(format!("couldn't run gh: {why}")),
        Err(RunError::TimedOut) => return GitHubAnswer::Failed("gh did not answer in time".into()),
    };
    if !ran.success {
        let said = ran.stderr.to_ascii_lowercase();
        if NOT_ON_GITHUB.iter().any(|mark| said.contains(mark)) {
            return GitHubAnswer::Listed(ProjectPulls::NotOnGitHub);
        }
        return GitHubAnswer::Failed(first_line(&ran.stderr).map_or_else(|| "gh could not list the pull requests".to_owned(), line));
    }
    match parse(&ran.stdout, &login) {
        Some(list) => GitHubAnswer::Listed(ProjectPulls::Open(list)),
        None => GitHubAnswer::Failed("gh did not list the pull requests".into()),
    }
}

/// One clean line of what a program or GitHub said, no longer than a list passes on.
fn line(text: &str) -> String {
    sanitize(text, false).trim().chars().take(PULL_REQUEST_TEXT_MAX_CHARS).collect()
}

/// A pull request as `gh pr list --json …` writes one. GitHub writes `null` where it has nothing.
#[derive(Deserialize)]
struct Raw {
    number: u32,
    url: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    author: Option<RawWho>,
    #[serde(default, rename = "headRefName")]
    branch: Option<String>,
    #[serde(default, rename = "isDraft")]
    draft: Option<bool>,
    #[serde(default)]
    mergeable: Option<String>,
    #[serde(default, rename = "reviewDecision")]
    review_decision: Option<String>,
    #[serde(default, rename = "reviewRequests")]
    review_requests: Option<Vec<RawWho>>,
    #[serde(default, rename = "statusCheckRollup")]
    checks: Option<Vec<RawCheck>>,
    #[serde(default, rename = "updatedAt")]
    updated_at: Option<String>,
}

/// An account. A team asked for a review has a name and no login.
#[derive(Deserialize)]
struct RawWho {
    #[serde(default)]
    login: Option<String>,
}

impl RawWho {
    fn is(&self, login: &str) -> bool {
        self.login.as_deref().is_some_and(|theirs| theirs.eq_ignore_ascii_case(login))
    }
}

/// Whether the signed-in account has something to do on a pull request: a review is asked of it,
/// or the pull request is its own and a check failed or a reviewer asked for changes.
fn needs_you(mine: bool, review_requested: bool, checks: PrChecksState, review: PrReview) -> bool {
    review_requested || (mine && (checks == PrChecksState::Failed || review == PrReview::ChangesRequested))
}

/// The pull requests in a `gh pr list --json …` answer, as `login` sees them. One whose address is
/// not a GitHub pull request's is left out. `None` when the text is not a list.
fn parse(json: &str, login: &str) -> Option<PullRequestList> {
    let listed: Vec<Raw> = serde_json::from_str(json).ok()?;
    let more = listed.len() > PULL_REQUESTS_MAX;
    let items = listed
        .into_iter()
        .take(PULL_REQUESTS_MAX)
        .filter_map(|raw| {
            let url = pull_request_url(&raw.url).ok()?;
            let mine = raw.author.as_ref().is_some_and(|author| author.is(login));
            let review_requested = raw.review_requests.iter().flatten().any(|asked| asked.is(login));
            let checks = standing(raw.checks.as_deref().unwrap_or_default());
            let review = review_of(raw.review_decision.as_deref());
            Some(ProjectPr {
                number: raw.number,
                url,
                title: line(raw.title.as_deref().unwrap_or_default()),
                author: line(raw.author.and_then(|author| author.login).as_deref().unwrap_or_default()),
                branch: line(raw.branch.as_deref().unwrap_or_default()),
                draft: raw.draft.unwrap_or(false),
                checks,
                review,
                conflicting: raw.mergeable.as_deref() == Some("CONFLICTING"),
                mine,
                review_requested,
                needs_you: needs_you(mine, review_requested, checks, review),
                updated_at: raw.updated_at.filter(|time| is_time(time)).unwrap_or_default(),
            })
        })
        .collect();
    Some(PullRequestList { login: login.to_owned(), items, more })
}

/// What to do with an ask for a folder's list.
#[derive(Debug, PartialEq)]
pub(super) enum Ask {
    /// It is known, or cannot be asked for now: answer this.
    Answer(GitHubAnswer<ProjectPulls>),
    /// `gh` is already listing that folder; the ask is answered when it ends.
    Wait,
    /// Run `list` for the folder off the loop and hand what it found to `Lists::finished`.
    Run,
}

/// Who asked: the client and the tag its answer carries.
type Asker = (ClientId, u64);

/// The lists kept and the asks waiting, by folder.
pub(super) struct Lists {
    kept: HashMap<PathBuf, (Instant, GitHubAnswer<ProjectPulls>)>,
    asking: HashMap<PathBuf, Vec<Asker>>,
    /// No asking before this (after a rate limit), and how long the next wait will be.
    hold_until: Option<Instant>,
    backoff: Duration,
}

impl Default for Lists {
    fn default() -> Self {
        Lists { kept: HashMap::new(), asking: HashMap::new(), hold_until: None, backoff: BACKOFF_FIRST }
    }
}

impl Lists {
    /// `asker` wants `folder`'s list at `now`; `fresh` when one kept from before will not do.
    pub(super) fn ask(&mut self, folder: &Path, fresh: bool, asker: Asker, now: Instant) -> Ask {
        if let Some(waiting) = self.asking.get_mut(folder) {
            if waiting.len() >= MOST_WAITING {
                return Ask::Answer(GitHubAnswer::Failed(BUSY.into()));
            }
            waiting.push(asker);
            return Ask::Wait;
        }
        self.kept.retain(|_, (at, _)| now.saturating_duration_since(*at) < KEEP);
        if !fresh && let Some((_, answer)) = self.kept.get(folder) {
            return Ask::Answer(answer.clone());
        }
        if self.hold_until.is_some_and(|until| now < until) {
            return Ask::Answer(GitHubAnswer::Failed(HELD.into()));
        }
        if self.asking.len() >= MOST_AT_ONCE {
            return Ask::Answer(GitHubAnswer::Failed(BUSY.into()));
        }
        self.asking.insert(folder.to_path_buf(), vec![asker]);
        Ask::Run
    }

    /// `gh` ended for `folder` with `answer` at `now`: who waits for it. Only a list is kept: a
    /// machine that just got `gh`, or signed in, is asked again at once.
    pub(super) fn finished(&mut self, folder: &Path, answer: &GitHubAnswer<ProjectPulls>, now: Instant) -> Vec<Asker> {
        match answer {
            GitHubAnswer::Listed(_) => {
                self.kept.insert(folder.to_path_buf(), (now, answer.clone()));
                self.hold_until = None;
                self.backoff = BACKOFF_FIRST;
            }
            GitHubAnswer::Failed(why) if rate_limited(why) => {
                self.hold_until = Some(now + self.backoff);
                self.backoff = (self.backoff * 2).min(BACKOFF_LONGEST);
            }
            _ => {}
        }
        self.asking.remove(folder).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIGNED_IN: &str = r#"{"hosts":{"github.com":[{"state":"success","active":true,"host":"github.com","login":"me"}]}}"#;
    const NOBODY: &str = r#"{"hosts":{}}"#;

    /// What a pretend `gh` prints, what it complains of, and the status it ends with.
    #[derive(Clone, Copy)]
    struct Says<'a>(&'a str, &'a str, i32);

    /// A program called `gh`, in a folder of its own. Asked `auth …` it prints `auth`; asked
    /// anything else it writes what it was asked to `args.txt` beside it and says `rest`.
    fn fake_gh(root: &Path, auth: &str, rest: Says) -> PathBuf {
        std::fs::create_dir_all(root).unwrap();
        std::fs::write(root.join("auth.txt"), auth).unwrap();
        std::fs::write(root.join("out.txt"), rest.0).unwrap();
        std::fs::write(root.join("err.txt"), rest.1).unwrap();
        let status = rest.2;
        if cfg!(windows) {
            let program = root.join("gh.cmd");
            let script = format!(
                "@echo off\r\nif \"%1\"==\"auth\" (\r\n  type \"%~dp0auth.txt\"\r\n  exit /b 0\r\n)\r\n>\"%~dp0args.txt\" echo %*\r\ntype \"%~dp0out.txt\"\r\ntype \"%~dp0err.txt\" 1>&2\r\nexit /b {status}\r\n"
            );
            std::fs::write(&program, script).unwrap();
            program
        } else {
            let program = root.join("gh");
            let script = format!(
                "#!/bin/sh\nhere=\"$(dirname \"$0\")\"\nif [ \"$1\" = auth ]; then cat \"$here/auth.txt\"; exit 0; fi\necho \"$@\" > \"$here/args.txt\"\ncat \"$here/out.txt\"\ncat \"$here/err.txt\" >&2\nexit {status}\n"
            );
            crate::test_support::write_program(&program, &script);
            program
        }
    }

    fn asked(root: &Path) -> String {
        std::fs::read_to_string(root.join("args.txt")).unwrap_or_default().replace('"', "").trim().to_owned()
    }

    const LISTED: &str = r#"[
        {"number":142,"url":"https://github.com/o/r/pull/142","title":"Fix the\u001b[31m cart\ntotal","author":{"login":"Me","is_bot":false},
         "headRefName":"fix/cart-total","isDraft":true,"mergeable":"CONFLICTING","reviewDecision":"","reviewRequests":[],
         "statusCheckRollup":[{"__typename":"CheckRun","name":"test","status":"IN_PROGRESS","conclusion":""}],"updatedAt":"2026-01-02T03:04:05Z"},
        {"number":139,"url":"https://github.com/o/r/pull/139","title":"Add a dark mode toggle","author":{"login":"someone"},
         "headRefName":"feat/dark-mode","isDraft":false,"mergeable":"MERGEABLE","reviewDecision":"REVIEW_REQUIRED",
         "reviewRequests":[{"__typename":"Team","name":"Core","slug":"o/core"},{"__typename":"User","login":"me"}],
         "statusCheckRollup":[{"name":"test","status":"COMPLETED","conclusion":"SUCCESS"}],"updatedAt":"<script>"},
        {"number":137,"url":"https://github.com/o/r/pull/137","title":null,"author":null,"headRefName":null,"isDraft":null,
         "mergeable":null,"reviewDecision":null,"reviewRequests":null,"statusCheckRollup":null,"updatedAt":null},
        {"number":7,"url":"https://evil.example/o/r/pull/7","title":"Elsewhere","author":{"login":"me"}}
    ]"#;

    #[test]
    fn the_open_pull_requests_are_listed_clean_as_the_signed_in_account_sees_them() {
        let list = parse(LISTED, "me").unwrap();

        assert_eq!(list.login, "me");
        assert!(!list.more);
        assert_eq!(
            list.items,
            vec![
                ProjectPr {
                    number: 142,
                    url: "https://github.com/o/r/pull/142".into(),
                    title: "Fix the[31m cart total".into(),
                    author: "Me".into(),
                    branch: "fix/cart-total".into(),
                    draft: true,
                    checks: PrChecksState::Running,
                    review: PrReview::None,
                    conflicting: true,
                    mine: true,
                    review_requested: false,
                    needs_you: false,
                    updated_at: "2026-01-02T03:04:05Z".into(),
                },
                ProjectPr {
                    number: 139,
                    url: "https://github.com/o/r/pull/139".into(),
                    title: "Add a dark mode toggle".into(),
                    author: "someone".into(),
                    branch: "feat/dark-mode".into(),
                    draft: false,
                    checks: PrChecksState::Passed,
                    review: PrReview::Required,
                    conflicting: false,
                    mine: false,
                    review_requested: true,
                    needs_you: true,
                    updated_at: String::new(),
                },
                ProjectPr {
                    number: 137,
                    url: "https://github.com/o/r/pull/137".into(),
                    title: String::new(),
                    author: String::new(),
                    branch: String::new(),
                    draft: false,
                    checks: PrChecksState::None,
                    review: PrReview::None,
                    conflicting: false,
                    mine: false,
                    review_requested: false,
                    needs_you: false,
                    updated_at: String::new(),
                },
            ]
        );
        assert_eq!(parse("not a list", "me"), None);
    }

    #[test]
    fn a_pull_request_needs_you_when_a_review_is_asked_of_you_or_your_own_is_stuck() {
        use PrChecksState::{Failed, Passed, Running};
        use PrReview::{Approved, ChangesRequested, Required};
        // Asked to review, whatever else is true of it.
        assert!(needs_you(false, true, Passed, Required));
        assert!(needs_you(false, true, Failed, Approved));
        // Your own, with a failed check or changes asked for.
        assert!(needs_you(true, false, Failed, Required));
        assert!(needs_you(true, false, Passed, ChangesRequested));
        // Your own and waiting on others, or somebody else's trouble.
        assert!(!needs_you(true, false, Running, Required));
        assert!(!needs_you(true, false, Passed, Approved));
        assert!(!needs_you(false, false, Failed, ChangesRequested));
    }

    #[test]
    fn a_failed_check_decides_your_own_pull_request_and_nobody_elses() {
        let one = |author: &str, decision: &str| {
            format!(
                r#"[{{"number":1,"url":"https://github.com/o/r/pull/1","author":{{"login":"{author}"}},"reviewDecision":"{decision}",
                "statusCheckRollup":[{{"name":"a","status":"COMPLETED","conclusion":"SUCCESS"}},{{"context":"ci","state":"FAILURE"}}]}}]"#
            )
        };
        let read = |author: &str, decision: &str| parse(&one(author, decision), "me").unwrap().items.remove(0);

        let mine = read("me", "");
        assert_eq!((mine.checks, mine.mine, mine.needs_you), (PrChecksState::Failed, true, true));
        let theirs = read("someone", "CHANGES_REQUESTED");
        assert_eq!((theirs.checks, theirs.review, theirs.mine, theirs.needs_you), (PrChecksState::Failed, PrReview::ChangesRequested, false, false));
    }

    #[test]
    fn at_most_fifty_are_given_and_it_says_there_are_more() {
        let many: Vec<String> = (0..=PULL_REQUESTS_MAX)
            .map(|n| format!(r#"{{"number":{n},"url":"https://github.com/o/r/pull/{n}","title":"{}"}}"#, "t".repeat(400)))
            .collect();

        let list = parse(&format!("[{}]", many.join(",")), "me").unwrap();

        assert_eq!(list.items.len(), PULL_REQUESTS_MAX);
        assert!(list.more);
        assert_eq!(list.items[0].title.chars().count(), PULL_REQUEST_TEXT_MAX_CHARS);
    }

    #[test]
    fn gh_is_asked_in_the_folder_with_nothing_of_the_clients_on_its_command_line() {
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(&root.path().join("bin"), SIGNED_IN, Says(LISTED, "", 0));
        let folder = root.path().join("--web; rm -rf x");
        std::fs::create_dir_all(&folder).unwrap();

        let GitHubAnswer::Listed(ProjectPulls::Open(list)) = list_from(program.as_os_str(), &folder, LIST_LIMIT) else {
            panic!("a signed-in machine lists the pull requests");
        };

        assert_eq!(list.items.len(), 3);
        assert_eq!(asked(&root.path().join("bin")), format!("pr list --state open --limit 51 --json {JSON_FIELDS}"));
    }

    #[test]
    fn a_machine_without_gh_and_one_where_nobody_is_signed_in_each_say_so() {
        let root = crate::daemon::persist::scratch_dir();
        std::fs::create_dir_all(root.path()).unwrap();
        let missing = root.path().join("no-such-program");
        assert_eq!(list_from(missing.as_os_str(), root.path(), LIST_LIMIT), GitHubAnswer::NotInstalled);

        let program = fake_gh(&root.path().join("bin"), NOBODY, Says("[]", "", 0));
        assert_eq!(list_from(program.as_os_str(), root.path(), LIST_LIMIT), GitHubAnswer::NotSignedIn);
        assert_eq!(asked(&root.path().join("bin")), "", "gh is asked for no list");
    }

    #[test]
    fn a_folder_github_does_not_host_is_an_answer_and_any_other_failure_is_one_clean_line() {
        let root = crate::daemon::persist::scratch_dir();
        let bin = root.path().join("bin");
        for said in [
            "failed to run git: fatal: not a git repository (or any of the parent directories): .git",
            "no git remotes found",
            "none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`",
        ] {
            let program = fake_gh(&bin, SIGNED_IN, Says("", said, 1));
            assert_eq!(list_from(program.as_os_str(), root.path(), LIST_LIMIT), GitHubAnswer::Listed(ProjectPulls::NotOnGitHub), "{said}");
        }

        let program = fake_gh(&bin, SIGNED_IN, Says("", "\nerror connecting to \u{1b}[31mapi.github.com\ncheck your internet connection", 1));
        assert_eq!(list_from(program.as_os_str(), root.path(), LIST_LIMIT), GitHubAnswer::Failed("error connecting to [31mapi.github.com".into()));

        let program = fake_gh(&bin, SIGNED_IN, Says("{}", "", 0));
        assert!(matches!(list_from(program.as_os_str(), root.path(), LIST_LIMIT), GitHubAnswer::Failed(_)));
        assert!(matches!(list_from(program.as_os_str(), &root.path().join("gone"), LIST_LIMIT), GitHubAnswer::Failed(_)));
    }

    fn open(number: u32) -> GitHubAnswer<ProjectPulls> {
        let list = parse(&format!(r#"[{{"number":{number},"url":"https://github.com/o/r/pull/{number}"}}]"#), "me").unwrap();
        GitHubAnswer::Listed(ProjectPulls::Open(list))
    }

    #[test]
    fn a_folders_list_is_kept_for_a_minute_and_asks_made_meanwhile_share_one_call() {
        let (app, other) = (Path::new("/code/app"), Path::new("/code/other"));
        let start = Instant::now();
        let mut lists = Lists::default();

        assert_eq!(lists.ask(app, false, (1, 10), start), Ask::Run);
        assert_eq!(lists.ask(app, false, (2, 20), start), Ask::Wait, "gh is already listing it");
        assert_eq!(lists.ask(app, true, (2, 21), start), Ask::Wait);
        assert_eq!(lists.ask(other, false, (1, 11), start), Ask::Run, "another folder is another call");
        assert_eq!(lists.finished(app, &open(1), start), vec![(1, 10), (2, 20), (2, 21)]);

        let soon = start + KEEP - Duration::from_secs(1);
        assert_eq!(lists.ask(app, false, (1, 12), soon), Ask::Answer(open(1)));
        assert_eq!(lists.ask(app, true, (1, 13), soon), Ask::Run, "a fresh ask goes past the kept list");
        assert_eq!(lists.finished(app, &open(2), soon), vec![(1, 13)]);
        assert_eq!(lists.ask(app, false, (1, 14), soon + KEEP), Ask::Run, "a minute on it is asked again");
    }

    #[test]
    fn only_a_list_is_kept_so_a_machine_that_signs_in_is_asked_again_at_once() {
        let app = Path::new("/code/app");
        let now = Instant::now();
        let mut lists = Lists::default();

        for answer in [GitHubAnswer::NotInstalled, GitHubAnswer::NotSignedIn, GitHubAnswer::Failed("no network".into())] {
            assert_eq!(lists.ask(app, false, (1, 1), now), Ask::Run);
            assert_eq!(lists.finished(app, &answer, now), vec![(1, 1)]);
        }
        assert_eq!(lists.ask(app, false, (1, 2), now), Ask::Run);
        lists.finished(app, &GitHubAnswer::Listed(ProjectPulls::NotOnGitHub), now);
        assert_eq!(lists.ask(app, false, (1, 3), now), Ask::Answer(GitHubAnswer::Listed(ProjectPulls::NotOnGitHub)));
    }

    #[test]
    fn a_rate_limit_stops_the_asking_for_a_while_and_longer_the_next_time() {
        let app = Path::new("/code/app");
        let start = Instant::now();
        let limited = GitHubAnswer::Failed("GraphQL: API rate limit already exceeded for user ID 1".into());
        let held = Ask::Answer(GitHubAnswer::Failed(HELD.into()));
        let mut lists = Lists::default();

        assert_eq!(lists.ask(app, false, (1, 1), start), Ask::Run);
        lists.finished(app, &limited, start);
        assert_eq!(lists.ask(app, true, (1, 2), start + BACKOFF_FIRST - Duration::from_secs(1)), held);

        let again = start + BACKOFF_FIRST;
        assert_eq!(lists.ask(app, false, (1, 3), again), Ask::Run);
        lists.finished(app, &limited, again);
        assert_eq!(lists.ask(app, false, (1, 4), again + BACKOFF_FIRST), held, "the second wait is longer");

        let later = again + BACKOFF_FIRST * 2;
        assert_eq!(lists.ask(app, false, (1, 5), later), Ask::Run);
        lists.finished(app, &open(1), later);
        assert_eq!(lists.ask(app, true, (1, 6), later), Ask::Run, "a list that came through ends the wait");
    }

    #[test]
    fn more_lists_at_once_than_the_daemon_runs_are_told_to_try_again() {
        let now = Instant::now();
        let mut lists = Lists::default();
        for n in 0..MOST_AT_ONCE {
            assert_eq!(lists.ask(Path::new(&format!("/code/{n}")), false, (1, n as u64), now), Ask::Run);
        }

        assert_eq!(lists.ask(Path::new("/code/one-more"), false, (1, 99), now), Ask::Answer(GitHubAnswer::Failed(BUSY.into())));
    }
}
