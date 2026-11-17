//! GitHub issues as tickets, read through this machine's own GitHub command line (`gh`): the
//! repository's milestones, a page of its issues, one issue with its comments. Read-only here (the
//! confirmed writes are `tickets_write`). No token
//! is asked for, kept, logged or sent: signing in and the credentials stay `gh`'s own.
//!
//! What `gh` prints is other people's writing. Every string is cleaned and cut and every list is
//! capped by `maitty_shared::tickets` before it leaves here, a number that is not a whole number is
//! refused, an address is built from the checked repository and number and never copied, and no
//! ticket text and no word of `gh`'s own error is logged or put in an error: a failure is one of a
//! few fixed lines.

use super::github::{gh, is_search};
use crate::proc::{RunError, run_within};
use maitty_shared::github::{is_login, is_pull_request_address, is_repo};
use maitty_shared::tickets::{
    Filter, Group, GroupKind, StateCategory, TICKET_COMMENTS_MAX, TICKET_GROUPS_MAX, TICKET_NAME_MAX_CHARS, TICKETS_PAGE_MAX,
    TICKETS_PAGE_SIZE, Ticket, TicketComment, TicketError, TicketPage, TicketState, TicketSummary, TicketsReply, TicketsRequest,
    clean_line, github_issue_id, github_milestone_id, parse_github_issue_id, parse_github_milestone_id,
};
use serde_json::Value;
use std::ffi::OsStr;
use std::time::Duration;

/// How long `gh` has to answer one question about issues.
pub(super) const LIMIT: Duration = Duration::from_secs(30);
/// The most `gh` may print before what it printed is not read. Far more than a full page, a full
/// set of milestones or an issue with its comments is.
const OUTPUT_MAX_BYTES: usize = 4 * 1024 * 1024;
/// The most milestones asked for.
const MILESTONES_PER_PAGE: usize = 100;
/// The fields a list is asked for.
const LIST_FIELDS: &str = "number,title,state,labels,assignees,updatedAt,milestone";
/// The fields one issue is asked for.
const VIEW_FIELDS: &str = "number,title,state,labels,assignees,updatedAt,milestone,body,comments,closedByPullRequestsReferences";
/// Where the repository named by another repository's `repository_url` is read from.
const API_REPOS: &str = "https://api.github.com/repos/";

/// What a client asked of the issues of `source` (`owner/name`). Blocks while `gh` runs.
pub(super) fn answer(source: &str, request: TicketsRequest) -> Result<TicketsReply, TicketError> {
    answer_from(OsStr::new("gh"), source, request, LIMIT)
}

fn answer_from(program: &OsStr, source: &str, request: TicketsRequest, limit: Duration) -> Result<TicketsReply, TicketError> {
    if !is_repo(source) {
        return Err(TicketError::Invalid("That is not a GitHub repository".into()));
    }
    let reply = match request {
        TicketsRequest::Groups => TicketsReply::Groups(groups(program, source, limit)?),
        TicketsRequest::List(filter) => TicketsReply::List(list(program, source, &filter, limit)?),
        TicketsRequest::Get { id } => TicketsReply::Ticket(Box::new(get(program, source, &id, limit)?)),
    };
    reply.cleaned().ok_or_else(|| invalid("gh did not give a ticket"))
}

pub(super) fn invalid(why: &str) -> TicketError {
    TicketError::Invalid(why.into())
}

/// What `gh` printed when it ran to its end and said it worked, or the typed error that says why
/// not. Its own words are read to tell the kinds apart and are never passed on.
pub(super) fn run(command: &mut std::process::Command, limit: Duration) -> Result<String, TicketError> {
    let ran = run_within(command, limit).map_err(|error| match error {
        RunError::Missing => TicketError::NotInstalled,
        RunError::Start(_) => TicketError::Unreachable("gh could not be started".into()),
        RunError::TimedOut => TicketError::Unreachable("gh did not answer in time".into()),
    })?;
    if !ran.success {
        return Err(why_failed(&ran.stderr));
    }
    if ran.stdout.len() > OUTPUT_MAX_BYTES {
        return Err(invalid("gh said more than can be read"));
    }
    Ok(ran.stdout)
}

fn why_failed(stderr: &str) -> TicketError {
    let said = stderr.to_ascii_lowercase();
    let has = |words: &[&str]| words.iter().any(|word| said.contains(word));
    if has(&["could not resolve host", "error connecting", "dial tcp", "i/o timeout", "no such host", "network is unreachable"]) {
        TicketError::Unreachable("GitHub could not be reached".into())
    } else if has(&["rate limit", "http 429"]) {
        TicketError::RateLimited
    } else if has(&["gh auth login", "http 401", "bad credentials", "authentication required"]) {
        TicketError::SignedOut
    } else if has(&["http 404", "could not resolve to", "not found"]) {
        TicketError::NotFound
    } else {
        TicketError::Unreachable("gh could not read the tickets".into())
    }
}

fn parse(text: &str) -> Result<Value, TicketError> {
    serde_json::from_str(text).map_err(|_| invalid("gh did not give tickets"))
}

/// A whole number above nothing, which is all a number of an issue or a milestone can be. A
/// fraction, a negative number and anything else a hostile printer might send is not one.
fn number_of(value: &Value, field: &str) -> Option<u64> {
    value.get(field).and_then(Value::as_u64).filter(|number| *number > 0)
}

fn text_of<'a>(value: &'a Value, field: &str) -> &'a str {
    value.get(field).and_then(Value::as_str).unwrap_or_default()
}

fn groups(program: &OsStr, source: &str, limit: Duration) -> Result<Vec<Group>, TicketError> {
    let project = format!("github:{source}");
    let mut command = gh(program);
    command.args(["api", "--method", "GET"]).arg(format!("repos/{source}/milestones?state=all&per_page={MILESTONES_PER_PAGE}"));
    let parsed = parse(&run(&mut command, limit)?)?;
    let entries = parsed.as_array().ok_or_else(|| invalid("gh did not give milestones"))?;
    let milestones = entries.iter().filter_map(|entry| {
        let number = number_of(entry, "number")?;
        let open = entry.get("open_issues").and_then(Value::as_u64)?;
        let closed = entry.get("closed_issues").and_then(Value::as_u64)?;
        Some(Group {
            id: github_milestone_id(source, number),
            kind: GroupKind::Milestone,
            name: text_of(entry, "title").to_owned(),
            parent: Some(project.clone()),
            ticket_count: open.checked_add(closed).and_then(|count| u32::try_from(count).ok()),
        })
    });
    let repository = Group { id: project.clone(), kind: GroupKind::Project, name: source.to_owned(), parent: None, ticket_count: None };
    Ok(std::iter::once(repository).chain(milestones).take(TICKET_GROUPS_MAX).collect())
}

fn list(program: &OsStr, source: &str, filter: &Filter, limit: Duration) -> Result<TicketPage, TicketError> {
    if filter.page > TICKETS_PAGE_MAX {
        return Err(invalid("That page of tickets is too far on"));
    }
    // GitHub has no state between open and closed.
    if filter.state == Some(StateCategory::Started) {
        return Ok(TicketPage::default());
    }
    let state = match filter.state {
        Some(StateCategory::Open) => "open",
        Some(StateCategory::Closed) => "closed",
        _ => "all",
    };
    // `gh` pages only by size, so it is asked for everything up to one more than this page.
    let skip = filter.page as usize * TICKETS_PAGE_SIZE;
    let asked = skip + TICKETS_PAGE_SIZE + 1;
    // A value from a client is joined to its flag, so it can never be read as a flag of its own.
    let mut command = gh(program);
    command.args(["issue", "list", "--repo", source, "--json", LIST_FIELDS, "--state", state, "--limit"]).arg(asked.to_string());
    if let Some(assignee) = &filter.assignee {
        if !is_login(assignee) {
            return Err(invalid("That is not a GitHub login"));
        }
        command.arg(format!("--assignee={assignee}"));
    }
    if let Some(label) = &filter.label {
        if label.is_empty() || label.chars().count() > TICKET_NAME_MAX_CHARS || clean_line(label, usize::MAX) != *label {
            return Err(invalid("That is not a label"));
        }
        command.arg(format!("--label={label}"));
    }
    if let Some(search) = filter.search.as_deref().map(str::trim).filter(|search| !search.is_empty()) {
        if !is_search(search) {
            return Err(invalid("Search with letters, digits, spaces, dots and dashes"));
        }
        command.arg(format!("--search={search}"));
    }
    if let Some(group) = &filter.group {
        match parse_github_milestone_id(group) {
            Some((repo, number)) if repo == source => command.arg(format!("--milestone={number}")),
            _ => return Err(invalid("That is not a milestone of this repository")),
        };
    }
    let parsed = parse(&run(&mut command, limit)?)?;
    let entries = parsed.as_array().ok_or_else(|| invalid("gh did not give issues"))?;
    let more = entries.len() > skip + TICKETS_PAGE_SIZE;
    let tickets = entries.iter().skip(skip).take(TICKETS_PAGE_SIZE).filter_map(|entry| summary(source, entry)).collect();
    Ok(TicketPage { tickets, more })
}

/// An issue as `gh … --json` prints it, or `None` when it has no number of an issue. The address
/// is built here from the repository and number.
fn summary(source: &str, entry: &Value) -> Option<TicketSummary> {
    let number = number_of(entry, "number")?;
    let closed = text_of(entry, "state").eq_ignore_ascii_case("closed");
    let names = |field: &str, key: &str| -> Vec<String> {
        entry.get(field).and_then(Value::as_array).into_iter().flatten().map(|item| text_of(item, key).to_owned()).collect()
    };
    let milestone = entry.get("milestone").filter(|milestone| milestone.is_object()).and_then(|milestone| number_of(milestone, "number"));
    Some(TicketSummary {
        id: github_issue_id(source, number),
        title: text_of(entry, "title").to_owned(),
        state: if closed {
            TicketState { name: "Closed".into(), category: StateCategory::Closed }
        } else {
            TicketState { name: "Open".into(), category: StateCategory::Open }
        },
        labels: names("labels", "name"),
        assignee: names("assignees", "login").into_iter().find(|login| is_login(login)),
        url: format!("https://github.com/{source}/issues/{number}"),
        groups: std::iter::once(format!("github:{source}")).chain(milestone.map(|number| github_milestone_id(source, number))).collect(),
        updated_at: text_of(entry, "updatedAt").to_owned(),
    })
}

fn get(program: &OsStr, source: &str, id: &str, limit: Duration) -> Result<Ticket, TicketError> {
    let number = match parse_github_issue_id(id) {
        Some((repo, number)) if repo == source => number,
        _ => return Err(invalid("That is not an issue of this repository")),
    };
    let mut command = gh(program);
    command.args(["issue", "view"]).arg(number.to_string()).args(["--repo", source, "--json", VIEW_FIELDS]);
    let parsed = parse(&run(&mut command, limit)?)?;
    if number_of(&parsed, "number") != Some(number) {
        return Err(invalid("gh gave another issue"));
    }
    let summary = summary(source, &parsed).ok_or_else(|| invalid("gh did not give an issue"))?;
    let comments = parsed.get("comments").and_then(Value::as_array).into_iter().flatten();
    // One more than is kept, so the ticket can say there were more.
    let comments = comments
        .take(TICKET_COMMENTS_MAX + 1)
        .map(|comment| TicketComment {
            author: comment.get("author").map(|author| text_of(author, "login").to_owned()).unwrap_or_default(),
            body: text_of(comment, "body").to_owned(),
            created_at: text_of(comment, "createdAt").to_owned(),
        })
        .collect();
    let links = parsed
        .get("closedByPullRequestsReferences")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|reference| text_of(reference, "url"))
        .filter(|url| is_pull_request_address(url))
        .map(str::to_owned)
        .collect();
    Ok(Ticket {
        summary,
        body: text_of(&parsed, "body").to_owned(),
        comments,
        comments_more: false,
        links,
        blocked_by: blocked_by(program, source, number, limit)?,
    })
}

/// The tickets that block issue `number`. A GitHub that does not know the question has none.
fn blocked_by(program: &OsStr, source: &str, number: u64, limit: Duration) -> Result<Vec<String>, TicketError> {
    let mut command = gh(program);
    command.args(["api", "--method", "GET"]).arg(format!("repos/{source}/issues/{number}/dependencies/blocked_by"));
    let text = match run(&mut command, limit) {
        Ok(text) => text,
        Err(TicketError::NotFound) => return Ok(Vec::new()),
        Err(other) => return Err(other),
    };
    let parsed = parse(&text)?;
    let entries = parsed.as_array().ok_or_else(|| invalid("gh did not give blocking issues"))?;
    Ok(entries
        .iter()
        .filter_map(|entry| {
            let blocker = number_of(entry, "number")?;
            // An issue of another repository says whose it is.
            let repo = match entry.get("repository_url").and_then(Value::as_str) {
                Some(url) => url.strip_prefix(API_REPOS).filter(|repo| is_repo(repo))?,
                None => source,
            };
            Some(github_issue_id(repo, blocker))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    const TOKEN: &str = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const SHORT: Duration = Duration::from_secs(10);

    /// What a pretend `gh` prints and the status it ends with.
    #[derive(Clone, Copy)]
    struct Says<'a>(&'a str, i32);

    /// A program called `gh`, in a folder of its own. Asked `api …` it says `api`; asked anything
    /// else it says `issue`. Each question is added to `args.txt` beside it.
    fn fake_gh(root: &Path, issue: Says, api: Says) -> PathBuf {
        std::fs::create_dir_all(root).unwrap();
        std::fs::write(root.join("issue.txt"), issue.0).unwrap();
        std::fs::write(root.join("api.txt"), api.0).unwrap();
        if cfg!(windows) {
            let program = root.join("gh.cmd");
            let script = format!(
                "@echo off\r\n>>\"%~dp0args.txt\" echo %*\r\nif \"%1\"==\"api\" (\r\n  type \"%~dp0api.txt\"\r\n  exit /b {}\r\n)\r\ntype \"%~dp0issue.txt\"\r\nexit /b {}\r\n",
                api.1, issue.1
            );
            std::fs::write(&program, script).unwrap();
            program
        } else {
            let program = root.join("gh");
            let script = format!(
                "#!/bin/sh\nhere=\"$(dirname \"$0\")\"\necho \"$@\" >> \"$here/args.txt\"\nif [ \"$1\" = api ]; then cat \"$here/api.txt\"; exit {}; fi\ncat \"$here/issue.txt\"\nexit {}\n",
                api.1, issue.1
            );
            std::fs::write(&program, script).unwrap();
            make_runnable(&program);
            program
        }
    }

    /// A `gh` that prints its error to the error stream and fails, as the real one does.
    fn failing_gh(root: &Path, stderr: &str) -> PathBuf {
        std::fs::create_dir_all(root).unwrap();
        std::fs::write(root.join("err.txt"), stderr).unwrap();
        if cfg!(windows) {
            let program = root.join("gh.cmd");
            std::fs::write(&program, "@echo off\r\ntype \"%~dp0err.txt\" 1>&2\r\nexit /b 1\r\n").unwrap();
            program
        } else {
            let program = root.join("gh");
            std::fs::write(&program, "#!/bin/sh\ncat \"$(dirname \"$0\")/err.txt\" >&2\nexit 1\n").unwrap();
            make_runnable(&program);
            program
        }
    }

    /// A `gh` that takes far longer than the limit.
    fn slow_gh(root: &Path) -> PathBuf {
        std::fs::create_dir_all(root).unwrap();
        if cfg!(windows) {
            let program = root.join("gh.cmd");
            std::fs::write(&program, "@echo off\r\nping -n 30 127.0.0.1 >nul\r\n").unwrap();
            program
        } else {
            let program = root.join("gh");
            std::fs::write(&program, "#!/bin/sh\nsleep 30\n").unwrap();
            make_runnable(&program);
            program
        }
    }

    fn make_runnable(program: &Path) {
        let script = std::fs::read_to_string(program).unwrap();
        std::fs::remove_file(program).unwrap();
        crate::test_support::write_program(program, &script);
    }

    /// Every question the pretend `gh` was asked, one a line.
    fn asked(root: &Path) -> Vec<String> {
        let text = std::fs::read_to_string(root.join("args.txt")).unwrap_or_default().replace('"', "");
        text.lines().map(|line| line.trim().to_owned()).filter(|line| !line.is_empty()).collect()
    }

    fn page(program: &Path, filter: Filter) -> Result<TicketPage, TicketError> {
        match answer_from(program.as_os_str(), "me/widgets", TicketsRequest::List(filter), SHORT)? {
            TicketsReply::List(page) => Ok(page),
            other => panic!("a list gave {other:?}"),
        }
    }

    fn one(program: &Path, id: &str) -> Result<Ticket, TicketError> {
        match answer_from(program.as_os_str(), "me/widgets", TicketsRequest::Get { id: id.into() }, SHORT)? {
            TicketsReply::Ticket(ticket) => Ok(*ticket),
            other => panic!("a get gave {other:?}"),
        }
    }

    const ISSUES: &str = r#"[
        {"number":12,"title":"Parser drops\u001b[31m the last line","state":"OPEN","updatedAt":"2026-01-02T03:04:05Z",
         "labels":[{"name":"bug"},{"name":"help wanted"}],"assignees":[{"login":"<b>"},{"login":"me"}],"milestone":{"number":3,"title":"v1"}},
        {"number":13,"title":"Closed one","state":"CLOSED","updatedAt":"<script>","labels":[],"assignees":[],"milestone":null},
        {"number":-1,"title":"negative"},
        {"number":2.5,"title":"fraction"},
        {"title":"no number"}
    ]"#;

    #[test]
    fn issues_are_listed_clean_with_an_address_built_here() {
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(root.path(), Says(ISSUES, 0), Says("", 0));

        let listed = page(&program, Filter::default()).unwrap();

        assert!(!listed.more);
        let [first, second] = &listed.tickets[..] else { panic!("{:?}", listed.tickets) };
        assert_eq!(first.id, "github:me/widgets#12");
        assert_eq!(first.title, "Parser drops[31m the last line");
        assert_eq!((first.state.name.as_str(), first.state.category), ("Open", StateCategory::Open));
        assert_eq!(first.labels, ["bug", "help wanted"]);
        assert_eq!(first.assignee.as_deref(), Some("me"));
        assert_eq!(first.url, "https://github.com/me/widgets/issues/12");
        assert_eq!(first.groups, ["github:me/widgets", "github:me/widgets!3"]);
        assert_eq!(first.updated_at, "2026-01-02T03:04:05Z");
        assert_eq!((second.state.category, second.updated_at.as_str(), second.assignee.clone()), (StateCategory::Closed, "", None));
        assert_eq!(asked(root.path()), ["issue list --repo me/widgets --json number,title,state,labels,assignees,updatedAt,milestone --state all --limit 31"]);
    }

    #[test]
    fn a_search_and_filters_are_joined_to_their_flags_and_a_page_asks_for_what_it_skips() {
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(root.path(), Says("[]", 0), Says("", 0));
        let filter = Filter {
            group: Some("github:me/widgets!3".into()),
            state: Some(StateCategory::Closed),
            assignee: Some("me".into()),
            label: Some("help wanted".into()),
            search: Some(" -parser bug ".into()),
            page: 2,
        };

        page(&program, filter).unwrap();

        assert_eq!(
            asked(root.path()),
            ["issue list --repo me/widgets --json number,title,state,labels,assignees,updatedAt,milestone --state closed --limit 91 --assignee=me --label=help wanted --search=-parser bug --milestone=3"]
        );
    }

    #[test]
    fn a_page_is_cut_from_what_gh_printed_and_says_when_there_is_more() {
        let issues: Vec<String> = (1..=TICKETS_PAGE_SIZE * 2 + 1).map(|n| format!(r#"{{"number":{n},"title":"t{n}","state":"OPEN"}}"#)).collect();
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(root.path(), Says(&format!("[{}]", issues.join(",")), 0), Says("", 0));

        let second = page(&program, Filter { page: 1, ..Filter::default() }).unwrap();

        assert!(second.more);
        assert_eq!(second.tickets.len(), TICKETS_PAGE_SIZE);
        assert_eq!(second.tickets[0].id, format!("github:me/widgets#{}", TICKETS_PAGE_SIZE + 1));
        let last = page(&program, Filter { page: 2, ..Filter::default() }).unwrap();
        assert_eq!((last.tickets.len(), last.more), (1, false));
    }

    #[test]
    fn a_filter_that_is_more_than_plain_values_is_refused_before_gh_runs() {
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(root.path(), Says("[]", 0), Says("", 0));
        let bad = [
            Filter { assignee: Some("--web".into()), ..Filter::default() },
            Filter { assignee: Some("a b".into()), ..Filter::default() },
            Filter { label: Some("a\nb".into()), ..Filter::default() },
            Filter { label: Some(String::new()), ..Filter::default() },
            Filter { label: Some("x".repeat(TICKET_NAME_MAX_CHARS + 1)), ..Filter::default() },
            Filter { search: Some("author:someone".into()), ..Filter::default() },
            Filter { search: Some("a\"b".into()), ..Filter::default() },
            Filter { group: Some("github:other/repo!3".into()), ..Filter::default() },
            Filter { group: Some("3".into()), ..Filter::default() },
            Filter { page: TICKETS_PAGE_MAX + 1, ..Filter::default() },
        ];
        for filter in bad {
            let answer = page(&program, filter.clone());
            assert!(matches!(answer, Err(TicketError::Invalid(_))), "{filter:?} gave {answer:?}");
        }
        assert!(asked(root.path()).is_empty());
    }

    #[test]
    fn a_repository_that_is_not_one_is_refused_and_github_has_no_started_state() {
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(root.path(), Says(ISSUES, 0), Says("[]", 0));

        for source in ["", "me", "me/--x y", "-me/x", "me/a;b", "me/widgets extra"] {
            let answer = answer_from(program.as_os_str(), source, TicketsRequest::Groups, SHORT);
            assert!(matches!(answer, Err(TicketError::Invalid(_))), "{source:?} gave {answer:?}");
        }
        let started = page(&program, Filter { state: Some(StateCategory::Started), ..Filter::default() }).unwrap();
        assert_eq!(started, TicketPage::default());
        assert!(asked(root.path()).is_empty());
    }

    #[test]
    fn the_milestones_are_groups_under_the_repository() {
        let milestones = r#"[
            {"number":3,"title":"v1\u001b[0m","open_issues":4,"closed_issues":6,"state":"open"},
            {"number":4,"title":"v2","open_issues":0,"closed_issues":0},
            {"number":5,"title":"no counts"},
            {"number":0,"title":"zero","open_issues":1,"closed_issues":1}
        ]"#;
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(root.path(), Says("", 0), Says(milestones, 0));

        let Ok(TicketsReply::Groups(groups)) = answer_from(program.as_os_str(), "me/widgets", TicketsRequest::Groups, SHORT) else {
            panic!("milestones are listed");
        };

        let shown: Vec<_> = groups.iter().map(|g| (g.id.as_str(), g.kind, g.name.as_str(), g.parent.as_deref(), g.ticket_count)).collect();
        assert_eq!(
            shown,
            [
                ("github:me/widgets", GroupKind::Project, "me/widgets", None, None),
                ("github:me/widgets!3", GroupKind::Milestone, "v1[0m", Some("github:me/widgets"), Some(10)),
                ("github:me/widgets!4", GroupKind::Milestone, "v2", Some("github:me/widgets"), Some(0)),
            ]
        );
        assert_eq!(asked(root.path()), ["api --method GET repos/me/widgets/milestones?state=all&per_page=100"]);
    }

    const ISSUE: &str = r#"{"number":12,"title":"Parser drops a line","state":"OPEN","updatedAt":"2026-01-02T03:04:05Z",
        "labels":[{"name":"bug"}],"assignees":[{"login":"me"}],"milestone":null,
        "body":"Steps:\n1. run it\u001b[2J\n2. see\u202e it fail\u200b",
        "comments":[
            {"author":{"login":"them"},"body":"Same here\nwith a second line","createdAt":"2026-01-03T00:00:00Z"},
            {"author":null,"body":"ghost","createdAt":"nope"}
        ],
        "closedByPullRequestsReferences":[{"url":"https://github.com/me/widgets/pull/14"},{"url":"https://evil.example/pull/1"}]}"#;
    const BLOCKERS: &str = r#"[
        {"number":9,"repository_url":"https://api.github.com/repos/me/widgets"},
        {"number":3,"repository_url":"https://api.github.com/repos/other/lib"},
        {"number":4,"repository_url":"https://evil.example/repos/x/y"},
        {"number":-1}
    ]"#;

    #[test]
    fn one_issue_comes_with_its_comments_pull_requests_and_blockers() {
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(root.path(), Says(ISSUE, 0), Says(BLOCKERS, 0));

        let ticket = one(&program, "github:me/widgets#12").unwrap();

        assert_eq!(ticket.summary.id, "github:me/widgets#12");
        assert_eq!(ticket.body, "Steps:\n1. run it[2J\n2. see it fail");
        assert_eq!(ticket.comments.len(), 2);
        assert_eq!((ticket.comments[0].author.as_str(), ticket.comments[0].body.as_str()), ("them", "Same here\nwith a second line"));
        assert_eq!((ticket.comments[1].author.as_str(), ticket.comments[1].created_at.as_str()), ("", ""));
        assert!(!ticket.comments_more);
        assert_eq!(ticket.links, ["https://github.com/me/widgets/pull/14"]);
        assert_eq!(ticket.blocked_by, ["github:me/widgets#9", "github:other/lib#3"]);
        assert_eq!(
            asked(root.path()),
            [
                "issue view 12 --repo me/widgets --json number,title,state,labels,assignees,updatedAt,milestone,body,comments,closedByPullRequestsReferences",
                "api --method GET repos/me/widgets/issues/12/dependencies/blocked_by",
            ]
        );
    }

    #[test]
    fn an_issue_of_another_repository_or_another_number_is_refused() {
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(root.path(), Says(ISSUE, 0), Says("[]", 0));

        for id in ["github:other/repo#12", "github:me/widgets!12", "me/widgets#12", "github:me/widgets#0", "github:me/widgets#1;x"] {
            assert!(matches!(one(&program, id), Err(TicketError::Invalid(_))), "{id}");
        }
        // gh answering with a different issue than the one asked for is not that issue.
        assert!(matches!(one(&program, "github:me/widgets#99"), Err(TicketError::Invalid(_))));
    }

    #[test]
    fn a_github_without_blocking_answers_gives_none_but_other_failures_are_not_hidden() {
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(root.path(), Says(ISSUE, 0), Says("", 1));
        // The fake says nothing on its error stream, so the failure is not a "not found".
        assert!(matches!(one(&program, "github:me/widgets#12"), Err(TicketError::Unreachable(_))));

        let not_found = crate::daemon::persist::scratch_dir();
        assert_eq!(blocked_by(failing_gh(not_found.path(), "gh: Not Found (HTTP 404)").as_os_str(), "me/widgets", 12, SHORT), Ok(Vec::new()));
    }

    #[test]
    fn the_comments_of_a_long_issue_are_capped_and_it_says_so() {
        let comments: Vec<String> = (0..TICKET_COMMENTS_MAX + 20).map(|n| format!(r#"{{"author":{{"login":"u{n}"}},"body":"b","createdAt":"2026-01-03T00:00:00Z"}}"#)).collect();
        let issue = format!(r#"{{"number":12,"title":"t","state":"OPEN","comments":[{}]}}"#, comments.join(","));
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(root.path(), Says(&issue, 0), Says("[]", 0));

        let ticket = one(&program, "github:me/widgets#12").unwrap();

        assert_eq!(ticket.comments.len(), TICKET_COMMENTS_MAX);
        assert!(ticket.comments_more);
    }

    #[test]
    fn a_huge_body_is_cut() {
        let issue = format!(r#"{{"number":12,"title":"{}","state":"OPEN","body":"{}"}}"#, "t".repeat(5000), "x".repeat(maitty_shared::tickets::TICKET_BODY_MAX_CHARS * 3));
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(root.path(), Says(&issue, 0), Says("[]", 0));

        let ticket = one(&program, "github:me/widgets#12").unwrap();

        assert_eq!(ticket.body.chars().count(), maitty_shared::tickets::TICKET_BODY_MAX_CHARS);
        assert_eq!(ticket.summary.title.chars().count(), maitty_shared::tickets::TICKET_TITLE_MAX_CHARS);
    }

    #[test]
    fn more_output_than_can_be_read_is_refused() {
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(root.path(), Says(&format!("[{}]", " ".repeat(OUTPUT_MAX_BYTES)), 0), Says("", 0));

        assert!(matches!(page(&program, Filter::default()), Err(TicketError::Invalid(_))));
    }

    #[test]
    fn what_gh_says_when_it_fails_becomes_a_typed_error() {
        let cases = [
            ("To get started with GitHub CLI, please run:  gh auth login", TicketError::SignedOut),
            ("gh: Bad credentials (HTTP 401)", TicketError::SignedOut),
            ("GraphQL: Could not resolve to a Repository with the name 'me/widgets'. (HTTP 404)", TicketError::NotFound),
            ("GraphQL: Could not resolve to an issue or pull request with the number of 99.", TicketError::NotFound),
            ("gh: API rate limit exceeded for user (HTTP 403)", TicketError::RateLimited),
            ("error connecting to api.github.com", TicketError::Unreachable("GitHub could not be reached".into())),
            ("dial tcp: lookup api.github.com: no such host", TicketError::Unreachable("GitHub could not be reached".into())),
            ("something nobody planned for", TicketError::Unreachable("gh could not read the tickets".into())),
        ];
        for (said, expected) in cases {
            let root = crate::daemon::persist::scratch_dir();
            let program = failing_gh(root.path(), said);
            assert_eq!(page(&program, Filter::default()), Err(expected), "{said}");
        }
    }

    #[test]
    fn a_machine_without_gh_says_it_is_not_installed() {
        let root = crate::daemon::persist::scratch_dir();
        let missing = root.path().join("no-such-program");

        assert_eq!(page(&missing, Filter::default()), Err(TicketError::NotInstalled));
    }

    #[test]
    fn a_gh_that_does_not_answer_in_time_is_unreachable() {
        let root = crate::daemon::persist::scratch_dir();
        let program = slow_gh(root.path());

        let answer = answer_from(program.as_os_str(), "me/widgets", TicketsRequest::List(Filter::default()), Duration::from_millis(300));

        assert_eq!(answer, Err(TicketError::Unreachable("gh did not answer in time".into())));
    }

    #[test]
    fn text_that_is_not_what_was_asked_for_is_an_invalid_answer() {
        for said in ["not json at all", "{\"number\":1}", "null", "[{"] {
            let root = crate::daemon::persist::scratch_dir();
            let program = fake_gh(root.path(), Says(said, 0), Says(said, 0));
            assert!(matches!(page(&program, Filter::default()), Err(TicketError::Invalid(_))), "{said}");
            assert!(matches!(one(&program, "github:me/widgets#1"), Err(TicketError::Invalid(_))), "{said}");
            let groups = answer_from(program.as_os_str(), "me/widgets", TicketsRequest::Groups, SHORT);
            assert!(matches!(groups, Err(TicketError::Invalid(_))), "{said}");
        }
    }

    #[test]
    fn a_token_in_ticket_text_is_the_tickets_words_and_in_no_error() {
        // In a ticket it is only text, shown as the ticket's words.
        let issue = format!(r#"{{"number":12,"title":"t","state":"OPEN","body":"my token is {TOKEN}"}}"#);
        let root = crate::daemon::persist::scratch_dir();
        let program = fake_gh(root.path(), Says(&issue, 0), Says("[]", 0));
        assert!(one(&program, "github:me/widgets#12").unwrap().body.contains(TOKEN));

        // In what gh says went wrong, or in what is not a list, it is never passed on.
        let failing = crate::daemon::persist::scratch_dir();
        let program = failing_gh(failing.path(), &format!("gh: failed with {TOKEN}"));
        let error = page(&program, Filter::default()).unwrap_err();
        assert!(!format!("{error:?}").contains(TOKEN), "{error:?}");

        let garbled = crate::daemon::persist::scratch_dir();
        let program = fake_gh(garbled.path(), Says(&format!("{TOKEN} is not json"), 0), Says("", 0));
        let error = page(&program, Filter::default()).unwrap_err();
        assert!(!format!("{error:?}").contains(TOKEN), "{error:?}");
    }
}
