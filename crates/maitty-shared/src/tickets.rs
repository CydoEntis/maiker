//! Tickets as the window sees them, whatever keeps them (GitHub issues today): a provider-neutral
//! model, the two writes a person may confirm (a comment, closing), and the rules for cleaning one. Ticket text is written by other people, so
//! nothing here trusts it: every string is cleaned and cut, every list is capped, and an id or an
//! address that is not the shape of one is dropped. No I/O: the daemon fills these in and the
//! window, and `maitty-machines` for another machine's answer, clean what arrives with
//! `TicketsReply::cleaned`.

use crate::hidden::sanitize;
use serde::{Deserialize, Serialize};

/// Tickets on one page of a list.
pub const TICKETS_PAGE_SIZE: usize = 30;
/// The last page of a list that can be asked for (the first is 0).
pub const TICKETS_PAGE_MAX: u32 = 9;
/// The most groups one answer carries.
pub const TICKET_GROUPS_MAX: usize = 100;
/// The most labels a ticket carries.
pub const TICKET_LABELS_MAX: usize = 20;
/// The most groups a ticket belongs to.
pub const TICKET_GROUP_IDS_MAX: usize = 10;
/// The most comments a ticket carries; `Ticket::comments_more` says there were more.
pub const TICKET_COMMENTS_MAX: usize = 50;
/// The most links a ticket carries.
pub const TICKET_LINKS_MAX: usize = 20;
/// The most blocking tickets a ticket names.
pub const TICKET_BLOCKED_BY_MAX: usize = 20;
/// The most characters of a ticket's title.
pub const TICKET_TITLE_MAX_CHARS: usize = 300;
/// The most characters of a ticket's body.
pub const TICKET_BODY_MAX_CHARS: usize = 20_000;
/// The most characters of one comment.
pub const TICKET_COMMENT_MAX_CHARS: usize = 4_000;
/// The most characters of a name: a label, a state, a login, a group.
pub const TICKET_NAME_MAX_CHARS: usize = 100;
/// The most characters of an id, a group id or an address.
pub const TICKET_ID_MAX_CHARS: usize = 200;
/// The most characters of the words a person searches for.
pub const TICKET_SEARCH_MAX_CHARS: usize = 100;
/// The most characters of a key's server address.
pub const TICKET_ADDRESS_MAX_CHARS: usize = 200;
/// The most characters of a Plane workspace name.
pub const TICKET_WORKSPACE_MAX_CHARS: usize = 64;
/// The most characters of the one line that says why a request failed.
pub const TICKET_ERROR_MAX_CHARS: usize = 200;
/// The most characters of a time as the provider writes it.
const TIME_MAX_CHARS: usize = 32;
/// The longest a provider name in an id may be.
const PROVIDER_MAX_CHARS: usize = 16;

/// Which way a state leans, whatever the provider calls it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StateCategory {
    Open,
    Started,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketState {
    /// What the provider calls it ("Open", "In Review").
    pub name: String,
    pub category: StateCategory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GroupKind {
    Project,
    Module,
    Milestone,
    Cycle,
}

/// A place tickets are kept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Group {
    /// `provider:key`, like a ticket's.
    pub id: String,
    pub kind: GroupKind,
    pub name: String,
    /// The group this one sits in (a module's project).
    pub parent: Option<String>,
    /// How many tickets it holds, when the provider says.
    pub ticket_count: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketSummary {
    /// `provider:key`, for GitHub `github:owner/name#12`.
    pub id: String,
    pub title: String,
    pub state: TicketState,
    pub labels: Vec<String>,
    pub assignee: Option<String>,
    /// An `https://` address, empty when the provider gave none that could be one.
    pub url: String,
    /// The ids of the groups it belongs to.
    pub groups: Vec<String>,
    /// When it last changed, as the provider writes a time; empty when unknown.
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketComment {
    pub author: String,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ticket {
    pub summary: TicketSummary,
    pub body: String,
    pub comments: Vec<TicketComment>,
    /// True when there were more than `TICKET_COMMENTS_MAX`.
    pub comments_more: bool,
    /// Addresses it points at (the pull requests that close it).
    pub links: Vec<String>,
    /// The ids of the tickets that block it.
    pub blocked_by: Vec<String>,
}

/// What a list is narrowed to. Every part is optional.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Filter {
    pub group: Option<String>,
    pub state: Option<StateCategory>,
    pub assignee: Option<String>,
    pub label: Option<String>,
    pub search: Option<String>,
    /// From 0, `TICKETS_PAGE_SIZE` tickets a page, up to `TICKETS_PAGE_MAX`.
    pub page: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketPage {
    pub tickets: Vec<TicketSummary>,
    /// True when there are tickets after this page.
    pub more: bool,
}

/// What a client asks of a ticket source to read. A write is `TicketWrite`, asked apart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TicketsRequest {
    Groups,
    List(Filter),
    Get { id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TicketsReply {
    Groups(Vec<Group>),
    List(TicketPage),
    Ticket(Box<Ticket>),
}

/// The only two things that change a ticket, and only after a person confirmed them: never an edit
/// of a ticket's own words, never a delete.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TicketWrite {
    /// Add a comment saying `text`, exactly as `clean_comment` leaves it.
    Comment { text: String },
    /// Move the ticket to the provider's finished state.
    Close,
}

/// What a confirmed write did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TicketWritten {
    Commented,
    Closed,
}

impl TicketWrite {
    /// This write if it is fit to send: a comment is checked by `clean_comment` and put in its
    /// clean form, so what a person confirmed on screen is what is sent.
    pub fn checked(self) -> Result<TicketWrite, TicketError> {
        match self {
            TicketWrite::Comment { text } => Ok(TicketWrite::Comment { text: clean_comment(&text)? }),
            TicketWrite::Close => Ok(TicketWrite::Close),
        }
    }
}

/// A comment as it will be sent: its line breaks are `\n` and its ends are trimmed. Refused, never
/// quietly changed, when it is empty, over `TICKET_COMMENT_MAX_CHARS`, or holds a control or hidden
/// character (a tab included), so the text a person confirmed is the text written.
pub fn clean_comment(text: &str) -> Result<String, TicketError> {
    let text = text.replace("\r\n", "\n");
    let text = text.trim();
    if text.is_empty() {
        return Err(TicketError::Invalid("The comment is empty".into()));
    }
    if text.chars().count() > TICKET_COMMENT_MAX_CHARS {
        return Err(TicketError::Invalid(format!("The comment is longer than {TICKET_COMMENT_MAX_CHARS} characters")));
    }
    if sanitize(text, true) != text {
        return Err(TicketError::Invalid("The comment has a tab, control or hidden character".into()));
    }
    Ok(text.to_owned())
}

/// A provider that keeps tickets behind a key the user adds. GitHub is not one: it is read through
/// the machine's own `gh`, which holds its own sign-in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TicketProvider {
    Plane,
    Linear,
}

impl TicketProvider {
    pub const ALL: [TicketProvider; 2] = [TicketProvider::Plane, TicketProvider::Linear];

    /// The name a ticket id and a request's source start with.
    pub fn name(self) -> &'static str {
        match self {
            TicketProvider::Plane => "plane",
            TicketProvider::Linear => "linear",
        }
    }

    /// The provider a request's source names, or `None` for a GitHub repository.
    pub fn from_source(source: &str) -> Option<TicketProvider> {
        TicketProvider::ALL.into_iter().find(|provider| provider.name() == source)
    }
}

/// Whether a provider's key is set on a machine, and where it points. Never the key itself: no
/// message carries it back from the daemon that holds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketKeyState {
    pub provider: TicketProvider,
    pub set: bool,
    /// The server the key is for (empty for a provider with a fixed one, and when none is set).
    pub address: String,
    /// The Plane workspace (empty for another provider, and when none is set).
    pub workspace: String,
}

impl TicketKeyState {
    /// This state with its words clean and cut, as another machine's report must be before it is used.
    pub fn cleaned(self) -> TicketKeyState {
        TicketKeyState {
            provider: self.provider,
            set: self.set,
            address: clean_line(&self.address, TICKET_ADDRESS_MAX_CHARS),
            workspace: clean_line(&self.workspace, TICKET_WORKSPACE_MAX_CHARS),
        }
    }
}

/// Why a request got no tickets. Each is an answer a client shows a way out of.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TicketError {
    /// The provider's command line is not installed on that machine, or no key is set for it.
    NotInstalled,
    /// Signed out, or the provider refused the key.
    SignedOut,
    NotFound,
    /// One fixed line; never the provider's own words.
    Unreachable(String),
    RateLimited,
    /// The request, or what came back, was not what a ticket source speaks.
    Invalid(String),
}

/// The words of `text` that are safe to draw on one line, cut to `max` characters.
pub fn clean_line(text: &str, max: usize) -> String {
    sanitize(text, false).trim().chars().take(max).collect()
}

/// `text` made safe to draw, keeping its line breaks, cut to `max` characters.
pub fn clean_text(text: &str, max: usize) -> String {
    sanitize(text, true).trim().chars().take(max).collect()
}

/// Whether `text` could be a provider's name in an id: lowercase letters and digits.
fn is_provider(text: &str) -> bool {
    !text.is_empty() && text.len() <= PROVIDER_MAX_CHARS && text.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

/// Whether `text` is a `provider:key` id: a provider name, a colon and a key of the plain
/// characters a repository, a number and a separator are written with.
pub fn is_ticket_id(text: &str) -> bool {
    let Some((provider, key)) = text.split_once(':') else {
        return false;
    };
    is_provider(provider)
        && !key.is_empty()
        && text.len() <= TICKET_ID_MAX_CHARS
        && key.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '#' | '!' | '.' | '_' | '-'))
}

/// Whether `text` is an `https://` address with nothing in it that is not part of one.
pub fn is_ticket_url(text: &str) -> bool {
    text.starts_with("https://")
        && text.len() > "https://".len()
        && text.len() <= TICKET_ID_MAX_CHARS * 2
        && text.chars().all(|c| c.is_ascii_graphic())
}

/// Whether `text` could be a time as a provider prints one.
pub fn is_ticket_time(text: &str) -> bool {
    !text.is_empty() && text.len() <= TIME_MAX_CHARS && text.chars().all(|c| c.is_ascii_digit() || matches!(c, '-' | ':' | 'T' | 'Z' | '.' | '+'))
}

/// The id of GitHub issue `number` of `repo` (`owner/name`).
pub fn github_issue_id(repo: &str, number: u64) -> String {
    format!("github:{repo}#{number}")
}

/// The id of GitHub milestone `number` of `repo`.
pub fn github_milestone_id(repo: &str, number: u64) -> String {
    format!("github:{repo}!{number}")
}

/// The `(repo, number)` in an id made by `github_issue_id`, or `None` when `id` is not one.
pub fn parse_github_issue_id(id: &str) -> Option<(&str, u64)> {
    parse_github_number(id, '#')
}

/// The `(repo, number)` in an id made by `github_milestone_id`, or `None` when `id` is not one.
pub fn parse_github_milestone_id(id: &str) -> Option<(&str, u64)> {
    parse_github_number(id, '!')
}

fn parse_github_number(id: &str, separator: char) -> Option<(&str, u64)> {
    let (repo, number) = id.strip_prefix("github:")?.rsplit_once(separator)?;
    if !crate::github::is_repo(repo) || number.is_empty() || number.len() > 10 || !number.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some((repo, number.parse().ok().filter(|number| *number > 0)?))
}

fn clean_id(id: String) -> Option<String> {
    is_ticket_id(&id).then_some(id)
}

impl TicketSummary {
    /// This summary with every string clean and cut and every list capped, or `None` when its id
    /// is not an id. An address that is not `https://` and a time that is not a time are emptied.
    pub fn cleaned(self) -> Option<TicketSummary> {
        let id = clean_id(self.id)?;
        let line = |text: String, max| clean_line(&text, max);
        let mut labels: Vec<String> = self.labels.into_iter().map(|label| line(label, TICKET_NAME_MAX_CHARS)).filter(|label| !label.is_empty()).collect();
        labels.truncate(TICKET_LABELS_MAX);
        let mut groups: Vec<String> = self.groups.into_iter().filter_map(clean_id).collect();
        groups.truncate(TICKET_GROUP_IDS_MAX);
        Some(TicketSummary {
            id,
            title: line(self.title, TICKET_TITLE_MAX_CHARS),
            state: TicketState { name: line(self.state.name, TICKET_NAME_MAX_CHARS), category: self.state.category },
            labels,
            assignee: self.assignee.map(|login| line(login, TICKET_NAME_MAX_CHARS)).filter(|login| !login.is_empty()),
            url: Some(self.url).filter(|url| is_ticket_url(url)).unwrap_or_default(),
            groups,
            updated_at: Some(self.updated_at).filter(|time| is_ticket_time(time)).unwrap_or_default(),
        })
    }
}

impl Group {
    /// This group with its strings clean and cut, or `None` when its id is not an id.
    pub fn cleaned(self) -> Option<Group> {
        Some(Group {
            id: clean_id(self.id)?,
            kind: self.kind,
            name: clean_line(&self.name, TICKET_NAME_MAX_CHARS),
            parent: self.parent.and_then(clean_id),
            ticket_count: self.ticket_count,
        })
    }
}

impl Ticket {
    /// This ticket with everything in it cleaned and capped, or `None` when its id is not an id.
    pub fn cleaned(self) -> Option<Ticket> {
        let summary = self.summary.cleaned()?;
        let mut comments: Vec<TicketComment> = self
            .comments
            .into_iter()
            .map(|comment| TicketComment {
                author: clean_line(&comment.author, TICKET_NAME_MAX_CHARS),
                body: clean_text(&comment.body, TICKET_COMMENT_MAX_CHARS),
                created_at: Some(comment.created_at).filter(|time| is_ticket_time(time)).unwrap_or_default(),
            })
            .collect();
        let comments_more = self.comments_more || comments.len() > TICKET_COMMENTS_MAX;
        comments.truncate(TICKET_COMMENTS_MAX);
        let mut links: Vec<String> = self.links.into_iter().filter(|link| is_ticket_url(link)).collect();
        links.truncate(TICKET_LINKS_MAX);
        let mut blocked_by: Vec<String> = self.blocked_by.into_iter().filter_map(clean_id).collect();
        blocked_by.truncate(TICKET_BLOCKED_BY_MAX);
        Some(Ticket { summary, body: clean_text(&self.body, TICKET_BODY_MAX_CHARS), comments, comments_more, links, blocked_by })
    }
}

impl TicketPage {
    /// This page with no more tickets than a page holds, each of them clean.
    pub fn cleaned(self) -> TicketPage {
        let mut tickets: Vec<TicketSummary> = self.tickets.into_iter().filter_map(TicketSummary::cleaned).collect();
        let more = self.more;
        tickets.truncate(TICKETS_PAGE_SIZE);
        TicketPage { tickets, more }
    }
}

impl TicketError {
    /// This error with its line clean and cut.
    pub fn cleaned(self) -> TicketError {
        match self {
            TicketError::Unreachable(why) => TicketError::Unreachable(clean_line(&why, TICKET_ERROR_MAX_CHARS)),
            TicketError::Invalid(why) => TicketError::Invalid(clean_line(&why, TICKET_ERROR_MAX_CHARS)),
            other => other,
        }
    }
}

impl TicketsReply {
    /// This answer with everything in it clean and capped; `None` when it is a ticket whose id is
    /// not an id.
    pub fn cleaned(self) -> Option<TicketsReply> {
        Some(match self {
            TicketsReply::Groups(groups) => {
                let mut groups: Vec<Group> = groups.into_iter().filter_map(Group::cleaned).collect();
                groups.truncate(TICKET_GROUPS_MAX);
                TicketsReply::Groups(groups)
            }
            TicketsReply::List(page) => TicketsReply::List(page.cleaned()),
            TicketsReply::Ticket(ticket) => TicketsReply::Ticket(Box::new((*ticket).cleaned()?)),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(id: &str) -> TicketSummary {
        TicketSummary {
            id: id.into(),
            title: "Fix\u{1b}[31m it\u{202e}\n now".into(),
            state: TicketState { name: "Open".into(), category: StateCategory::Open },
            labels: vec!["bug".into(), "\u{200b}".into(), "x".repeat(500)],
            assignee: Some("me".into()),
            url: "https://github.com/o/r/issues/1".into(),
            groups: vec!["github:o/r!3".into(), "not an id".into()],
            updated_at: "2026-01-02T03:04:05Z".into(),
        }
    }

    #[test]
    fn an_id_is_a_provider_a_colon_and_a_plain_key() {
        for good in ["github:o/r#12", "github:my-org/my.repo_1!3", "plane:ab-12"] {
            assert!(is_ticket_id(good), "{good}");
        }
        for bad in ["", "github", "GitHub:o/r#1", "github:", "github:o r#1", "github:o/r#1\n", "git hub:x", &format!("github:{}", "a".repeat(TICKET_ID_MAX_CHARS))] {
            assert!(!is_ticket_id(bad), "{bad:?}");
        }
    }

    #[test]
    fn an_address_is_https_and_printable_ascii_only() {
        assert!(is_ticket_url("https://github.com/o/r/issues/1"));
        for bad in ["", "http://x.example/1", "javascript:alert(1)", "https://", "https://a b", "https://x.example/\u{202e}", "https://x.example/\n"] {
            assert!(!is_ticket_url(bad), "{bad:?}");
        }
    }

    #[test]
    fn github_ids_are_built_and_read_back_only_for_a_real_repository_and_number() {
        let id = github_issue_id("me/widgets", 12);
        assert_eq!(id, "github:me/widgets#12");
        assert_eq!(parse_github_issue_id(&id), Some(("me/widgets", 12)));
        assert_eq!(parse_github_milestone_id(&github_milestone_id("me/widgets", 3)), Some(("me/widgets", 3)));
        assert_eq!(parse_github_issue_id("github:me/widgets!3"), None);
        for bad in ["github:me/widgets#0", "github:me/widgets#", "github:me/widgets#1x", "github:-me/x#1", "github:me/widgets#99999999999", "plane:me/widgets#1"] {
            assert_eq!(parse_github_issue_id(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_summary_is_cleaned_cut_and_capped_and_one_without_an_id_is_dropped() {
        let clean = summary("github:o/r#1").cleaned().unwrap();
        assert_eq!(clean.title, "Fix[31m it  now");
        assert_eq!(clean.labels.len(), 2);
        assert_eq!(clean.labels[1].chars().count(), TICKET_NAME_MAX_CHARS);
        assert_eq!(clean.groups, ["github:o/r!3"]);
        assert_eq!(clean.cleaned().as_ref().map(|again| again.title.as_str()), Some("Fix[31m it  now"));
        assert!(summary("not an id").cleaned().is_none());

        let mut odd = summary("github:o/r#1");
        odd.url = "javascript:alert(1)".into();
        odd.updated_at = "<b>".into();
        odd.labels = (0..TICKET_LABELS_MAX + 5).map(|n| format!("l{n}")).collect();
        let clean = odd.cleaned().unwrap();
        assert_eq!((clean.url.as_str(), clean.updated_at.as_str(), clean.labels.len()), ("", "", TICKET_LABELS_MAX));
    }

    #[test]
    fn a_ticket_keeps_its_lines_but_is_cut_and_its_comments_capped() {
        let comment = |n: usize| TicketComment { author: format!("a{n}"), body: format!("line\none\u{1b}[0m{}", "x".repeat(TICKET_COMMENT_MAX_CHARS)), created_at: "<script>".into() };
        let ticket = Ticket {
            summary: summary("github:o/r#1"),
            body: format!("first\nsecond\u{200b}{}", "y".repeat(TICKET_BODY_MAX_CHARS)),
            comments: (0..TICKET_COMMENTS_MAX + 3).map(comment).collect(),
            comments_more: false,
            links: vec!["https://github.com/o/r/pull/2".into(), "ftp://x".into()],
            blocked_by: vec!["github:o/r#9".into(), "junk id".into()],
        };
        let clean = ticket.cleaned().unwrap();
        assert!(clean.body.starts_with("first\nsecond") && !clean.body.contains('\u{200b}'));
        assert_eq!(clean.body.chars().count(), TICKET_BODY_MAX_CHARS);
        assert_eq!(clean.comments.len(), TICKET_COMMENTS_MAX);
        assert!(clean.comments_more);
        assert!(clean.comments.iter().all(|c| c.body.chars().count() <= TICKET_COMMENT_MAX_CHARS && c.created_at.is_empty() && !c.body.contains('\u{1b}')));
        assert_eq!((clean.links.len(), clean.blocked_by.len()), (1, 1));
    }

    #[test]
    fn a_page_and_its_groups_are_capped() {
        let page = TicketPage { tickets: (1..=TICKETS_PAGE_SIZE + 5).map(|n| summary(&format!("github:o/r#{n}"))).collect(), more: true };
        let page = page.cleaned();
        assert_eq!((page.tickets.len(), page.more), (TICKETS_PAGE_SIZE, true));
        let groups: Vec<Group> = (1..=TICKET_GROUPS_MAX + 5)
            .map(|n| Group { id: format!("github:o/r!{n}"), kind: GroupKind::Milestone, name: "v\u{1b}1".into(), parent: Some("junk".into()), ticket_count: Some(3) })
            .collect();
        let Some(TicketsReply::Groups(groups)) = TicketsReply::Groups(groups).cleaned() else { panic!("groups stay groups") };
        assert_eq!(groups.len(), TICKET_GROUPS_MAX);
        assert_eq!((groups[0].name.as_str(), groups[0].parent.as_deref()), ("v1", None));
    }

    #[test]
    fn an_error_line_is_one_clean_line() {
        let error = TicketError::Unreachable("no\u{1b}[0m\nway".into()).cleaned();
        assert_eq!(error, TicketError::Unreachable("no[0m way".into()));
    }

    #[test]
    fn a_comment_is_trimmed_and_refused_when_empty_long_or_hiding_something() {
        assert_eq!(clean_comment("  hello\r\nworld \n").unwrap(), "hello\nworld");
        let long = "x".repeat(TICKET_COMMENT_MAX_CHARS);
        assert_eq!(clean_comment(&long).unwrap().len(), TICKET_COMMENT_MAX_CHARS);
        for bad in ["", " \n ", "tab\there", "esc\u{1b}[31m", "zero\u{200b}width", "bidi\u{202e}", &format!("{long}x")] {
            assert!(matches!(clean_comment(bad), Err(TicketError::Invalid(_))), "{bad:?}");
        }
        assert_eq!(TicketWrite::Close.checked(), Ok(TicketWrite::Close));
        assert!(TicketWrite::Comment { text: " ".into() }.checked().is_err());
        assert_eq!(TicketWrite::Comment { text: " hi ".into() }.checked(), Ok(TicketWrite::Comment { text: "hi".into() }));
    }
}
