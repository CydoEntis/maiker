//! Plane work items as tickets, read over Plane's REST API with the user's own key: the projects
//! and modules, a page of a project's or module's work items, one work item with its comments.
//! Read-only: no request here creates, edits, comments on or moves anything (the confirmed writes
//! are `tickets_write`). The key and the server
//! come from `ticket_keys`; the request is sent by an `Http` (the system `curl`, with the key on its
//! standard input), and the address has to pass `check_base_url` on every call.
//!
//! What Plane sends is other people's writing. Every string is cleaned and cut and every list is
//! capped by `maitty_shared::tickets` before it leaves here; an id that is not the plain characters
//! of one never reaches a request or a ticket id; an address is built here from the checked server,
//! workspace and numbers and never copied from the answer; no ticket text and no word of Plane's own
//! error is logged or put in an error, and neither is the key. A failure is one of a few fixed
//! lines. Not verified against a live server, only against the shapes below, which are Plane's
//! public API as documented: the lists are `{"results": [...]}` or a plain array, a work item has
//! `id`, `sequence_id`, `name`, `state`, `labels`, `assignees`, `updated_at` and a description, and
//! its relations come from `work-items/<id>/relations/` (a Plane without that route has none).

use super::ticket_http::{parse_json, plain_words, status_error};
use super::ticket_keys::{Saved, is_workspace};
use crate::http::{Http, Method, Request, check_base_url};
use maitty_shared::tickets::{
    Filter, Group, GroupKind, StateCategory, TICKET_COMMENTS_MAX, TICKET_GROUPS_MAX, TICKET_NAME_MAX_CHARS, TICKET_SEARCH_MAX_CHARS, TICKETS_PAGE_MAX,
    TICKETS_PAGE_SIZE, Ticket, TicketComment, TicketError, TicketPage, TicketState, TicketSummary, TicketsReply, TicketsRequest,
};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;

/// How long to wait before a rate-limited call is tried again (Plane allows about 60 a minute).
pub(super) const RETRY_WAIT: Duration = Duration::from_secs(10);
/// How many times a rate-limited call is tried again before it is reported.
const RETRIES: usize = 2;
/// The most work items Plane is asked for at once.
const PER_PAGE: usize = 100;
/// The most pages of work items read to fill one page of tickets: a ceiling on a runaway or hostile
/// server, and on the calls a rate limit allows.
const PAGES_MAX: usize = 5;
/// The most projects whose modules are listed; each is a call of its own.
const PROJECTS_WITH_MODULES_MAX: usize = 20;
/// The longest a Plane id (a UUID) may be.
const ID_MAX_CHARS: usize = 64;
/// The longest a project's identifier (the letters before a number) may be.
const IDENTIFIER_MAX_CHARS: usize = 20;
/// Plane's own empty list, for an answer that has none.
const NONE: &[Value] = &[];

fn invalid(why: &str) -> TicketError {
    TicketError::Invalid(why.into())
}

/// Whether `id` is the plain characters of a Plane id: what can safely become part of an address.
pub(super) fn is_plane_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= ID_MAX_CHARS && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn project_id(project: &str) -> String {
    format!("plane:{project}")
}

fn module_id(project: &str, module: &str) -> String {
    format!("plane:{project}!{module}")
}

fn ticket_id(project: &str, issue: &str) -> String {
    format!("plane:{project}#{issue}")
}

/// The project, and the module when there is one, of a group id made here.
fn parse_group(id: &str) -> Option<(&str, Option<&str>)> {
    let key = id.strip_prefix("plane:")?;
    let (project, module) = match key.split_once('!') {
        Some((project, module)) => (project, Some(module)),
        None => (key, None),
    };
    (is_plane_id(project) && module.is_none_or(is_plane_id)).then_some((project, module))
}

/// The project and work item of a ticket id made here.
pub(super) fn parse_ticket(id: &str) -> Option<(&str, &str)> {
    let (project, issue) = id.strip_prefix("plane:")?.split_once('#')?;
    (is_plane_id(project) && is_plane_id(issue)).then_some((project, issue))
}

/// Which way a Plane state group leans.
fn category(group: &str) -> StateCategory {
    match group {
        "started" => StateCategory::Started,
        "completed" | "cancelled" => StateCategory::Closed,
        // Backlog, unstarted, triage and anything Plane adds later have not been started.
        _ => StateCategory::Open,
    }
}

fn text_of<'a>(value: &'a Value, field: &str) -> &'a str {
    value.get(field).and_then(Value::as_str).unwrap_or_default()
}

/// The entries of a list answer, whether Plane sent a plain array or `{"results": [...]}`.
fn results(value: &Value) -> &[Value] {
    value.as_array().or_else(|| value.get("results").and_then(Value::as_array)).map_or(NONE, Vec::as_slice)
}

fn strings<'a>(value: &'a Value, field: &str) -> impl Iterator<Item = &'a str> {
    value.get(field).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str)
}

/// Plain text from the HTML Plane keeps for a description or a comment. It is shown as text and
/// never as HTML, so this only has to be readable, not exact: tags go, the breaks they stand for
/// stay, and the common entities are read.
fn html_to_text(html: &str) -> String {
    let mut text = String::with_capacity(html.len());
    let (mut in_tag, mut tag) = (false, String::new());
    for c in html.chars() {
        match (in_tag, c) {
            (false, '<') => in_tag = true,
            (false, c) => text.push(c),
            (true, '>') => {
                in_tag = false;
                let name: String = tag.trim_start_matches('/').chars().take_while(char::is_ascii_alphanumeric).collect();
                if matches!(name.to_ascii_lowercase().as_str(), "br" | "p" | "div" | "li" | "tr" | "pre" | "blockquote" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
                    text.push('\n');
                }
                tag.clear();
            }
            (true, c) => tag.push(c),
        }
    }
    let text = text.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&");
    let mut collapsed = String::with_capacity(text.len());
    let mut breaks = 0;
    for c in text.chars() {
        breaks = if c == '\n' { breaks + 1 } else { 0 };
        if breaks <= 2 {
            collapsed.push(c);
        }
    }
    collapsed
}

/// A description or a comment: Plane's own plain text when it sends one, else its HTML as text.
fn body_of(value: &Value, stripped: &str, html: &str) -> String {
    let plain = text_of(value, stripped);
    if plain.trim().is_empty() { html_to_text(text_of(value, html)) } else { plain.to_owned() }
}

/// What is known of one project: how its states, labels and people are named.
struct Project {
    id: String,
    /// The letters before a work item's number, or empty when Plane sent none that could be one.
    identifier: String,
    /// State id to its name and the way it leans.
    states: HashMap<String, (String, StateCategory)>,
    labels: HashMap<String, String>,
    /// Member id to display name.
    members: HashMap<String, String>,
}

struct Plane<'a> {
    http: &'a dyn Http,
    saved: &'a Saved,
    retry_wait: Duration,
}

impl Plane<'_> {
    /// One question to Plane, tried again while it is rate limited. `path` is under the workspace.
    fn call(&self, path: &str) -> Result<Value, TicketError> {
        let request = Request {
            method: Method::Get,
            url: format!("{}/api/v1/workspaces/{}/{path}", self.saved.address, self.saved.workspace),
            body: None,
            key_header: "X-API-Key",
            key: self.saved.key.clone(),
        };
        for attempt in 0..=RETRIES {
            let response = self.http.send(&request)?;
            match response.status {
                200..=299 => return parse_json(&response.body),
                429 if attempt < RETRIES => std::thread::sleep(self.retry_wait),
                other => return Err(status_error(other)),
            }
        }
        Err(TicketError::RateLimited)
    }

    /// `call`, for a thing that is only decoration: a Plane that refuses the question or has no such
    /// route is read as having nothing to say. Anything else (rate limit, no network) is still an error.
    fn optional(&self, path: &str) -> Result<Value, TicketError> {
        match self.call(path) {
            Err(TicketError::NotFound | TicketError::SignedOut) => Ok(Value::Null),
            other => other,
        }
    }

    fn project(&self, id: &str) -> Result<Project, TicketError> {
        let about = self.call(&format!("projects/{id}/"))?;
        let identifier = Some(text_of(&about, "identifier")).filter(|name| !name.is_empty() && name.len() <= IDENTIFIER_MAX_CHARS && name.chars().all(|c| c.is_ascii_alphanumeric())).unwrap_or_default();
        let states = self.call(&format!("projects/{id}/states/"))?;
        let states = results(&states)
            .iter()
            .filter(|state| is_plane_id(text_of(state, "id")))
            .map(|state| (text_of(state, "id").to_owned(), (text_of(state, "name").to_owned(), category(text_of(state, "group")))))
            .collect();
        let labels = self.call(&format!("projects/{id}/labels/"))?;
        let labels = results(&labels).iter().filter(|label| is_plane_id(text_of(label, "id"))).map(|label| (text_of(label, "id").to_owned(), text_of(label, "name").to_owned())).collect();
        // People are only names beside a ticket; a key that may not list them still reads tickets.
        let members = self.optional(&format!("projects/{id}/members/"))?;
        let members = results(&members)
            .iter()
            .filter_map(|entry| {
                // A member is either the person or a record that holds one under `member`.
                let person = entry.get("member").filter(|member| member.is_object()).unwrap_or(entry);
                let id = Some(text_of(person, "id")).filter(|id| is_plane_id(id))?;
                Some((id.to_owned(), text_of(person, "display_name").to_owned()))
            })
            .collect();
        Ok(Project { id: id.to_owned(), identifier: identifier.to_owned(), states, labels, members })
    }

    fn groups(&self) -> Result<Vec<Group>, TicketError> {
        let projects = self.call(&format!("projects/?per_page={PER_PAGE}"))?;
        let mut groups = Vec::new();
        for (index, project) in results(&projects).iter().enumerate() {
            let id = text_of(project, "id");
            if !is_plane_id(id) || !project.get("archived_at").is_none_or(Value::is_null) {
                continue;
            }
            groups.push(Group { id: project_id(id), kind: GroupKind::Project, name: text_of(project, "name").to_owned(), parent: None, ticket_count: None });
            if index >= PROJECTS_WITH_MODULES_MAX {
                continue;
            }
            // A project that has modules turned off answers "not found": it has none.
            let modules = self.optional(&format!("projects/{id}/modules/?per_page={PER_PAGE}"))?;
            groups.extend(results(&modules).iter().filter(|module| is_plane_id(text_of(module, "id"))).map(|module| Group {
                id: module_id(id, text_of(module, "id")),
                kind: GroupKind::Module,
                name: text_of(module, "name").to_owned(),
                parent: Some(project_id(id)),
                ticket_count: module.get("total_issues").and_then(Value::as_u64).and_then(|count| u32::try_from(count).ok()),
            }));
            if groups.len() >= TICKET_GROUPS_MAX {
                break;
            }
        }
        groups.truncate(TICKET_GROUPS_MAX);
        Ok(groups)
    }

    /// A work item as a summary, with the names of everyone it is given to, or `None` when it has no
    /// id that could be one. The address is built here.
    fn summary(&self, project: &Project, issue: &Value, module: Option<&str>) -> Option<(TicketSummary, Vec<String>)> {
        let id = Some(text_of(issue, "id")).filter(|id| is_plane_id(id))?;
        let (state_name, state_category) = project.states.get(text_of(issue, "state")).cloned().unwrap_or_else(|| (String::new(), StateCategory::Open));
        let labels = strings(issue, "labels").filter_map(|label| project.labels.get(label)).cloned().collect();
        let people: Vec<String> = strings(issue, "assignees").filter_map(|member| project.members.get(member)).cloned().collect();
        let sequence = issue.get("sequence_id").and_then(Value::as_u64).filter(|number| *number > 0);
        let url = match (project.identifier.as_str(), sequence) {
            ("", _) | (_, None) => String::new(),
            (identifier, Some(number)) => format!("{}/{}/browse/{identifier}-{number}/", self.saved.address, self.saved.workspace),
        };
        let summary = TicketSummary {
            id: ticket_id(&project.id, id),
            title: text_of(issue, "name").to_owned(),
            state: TicketState { name: state_name, category: state_category },
            labels,
            assignee: people.first().cloned(),
            url,
            groups: std::iter::once(project_id(&project.id)).chain(module.map(|module| module_id(&project.id, module))).collect(),
            updated_at: text_of(issue, "updated_at").to_owned(),
        };
        Some((summary, people))
    }

    fn list(&self, filter: &Filter) -> Result<TicketPage, TicketError> {
        if filter.page > TICKETS_PAGE_MAX {
            return Err(invalid("That page of tickets is too far on"));
        }
        let group = filter.group.as_deref().ok_or_else(|| invalid("Choose a Plane project or module"))?;
        let (project_key, module) = parse_group(group).ok_or_else(|| invalid("That is not a Plane project or module"))?;
        let search = plain_words(&filter.search, TICKET_SEARCH_MAX_CHARS, "something to search for")?;
        let label = plain_words(&filter.label, TICKET_NAME_MAX_CHARS, "a label")?;
        let assignee = plain_words(&filter.assignee, TICKET_NAME_MAX_CHARS, "a person")?;
        let project = self.project(project_key)?;
        let skip = filter.page as usize * TICKETS_PAGE_SIZE;
        let wanted = skip + TICKETS_PAGE_SIZE + 1;
        let path = match module {
            Some(module) => format!("projects/{project_key}/modules/{module}/module-issues/"),
            None => format!("projects/{project_key}/issues/"),
        };
        // Plane filters nothing of this server-side, so a page is cut from what is read: the first
        // few pages of the group, stopping as soon as there are enough that match.
        let mut found = Vec::new();
        for page in 0..PAGES_MAX {
            let answer = self.call(&format!("{path}?per_page={PER_PAGE}&cursor={PER_PAGE}:{page}:0"))?;
            let batch = results(&answer);
            for (summary, people) in batch.iter().filter_map(|issue| self.summary(&project, issue, module)) {
                let is_match = filter.state.is_none_or(|state| state == summary.state.category)
                    && search.as_deref().is_none_or(|search| summary.title.to_lowercase().contains(search))
                    && label.as_deref().is_none_or(|label| summary.labels.iter().any(|name| name.to_lowercase() == *label))
                    && assignee.as_deref().is_none_or(|who| people.iter().any(|name| name.to_lowercase() == *who));
                if is_match {
                    found.push(summary);
                }
            }
            let more = answer.get("next_page_results").and_then(Value::as_bool).unwrap_or(false);
            if !more || batch.is_empty() || found.len() >= wanted {
                break;
            }
        }
        let more = found.len() > skip + TICKETS_PAGE_SIZE;
        Ok(TicketPage { tickets: found.into_iter().skip(skip).take(TICKETS_PAGE_SIZE).collect(), more })
    }

    fn get(&self, id: &str) -> Result<Ticket, TicketError> {
        let (project_key, issue_key) = parse_ticket(id).ok_or_else(|| invalid("That is not a Plane work item"))?;
        let project = self.project(project_key)?;
        let issue = self.call(&format!("projects/{project_key}/issues/{issue_key}/"))?;
        if text_of(&issue, "id") != issue_key {
            return Err(invalid("The server gave another work item"));
        }
        let (summary, _) = self.summary(&project, &issue, None).ok_or_else(|| invalid("The server did not give a work item"))?;
        let comments = self.call(&format!("projects/{project_key}/issues/{issue_key}/comments/"))?;
        // One more than is kept, so the ticket can say there were more.
        let comments = results(&comments)
            .iter()
            .take(TICKET_COMMENTS_MAX + 1)
            .map(|comment| TicketComment {
                author: author_of(&project, comment),
                body: body_of(comment, "comment_stripped", "comment_html"),
                created_at: text_of(comment, "created_at").to_owned(),
            })
            .collect();
        Ok(Ticket {
            summary,
            body: body_of(&issue, "description_stripped", "description_html"),
            comments,
            comments_more: false,
            links: Vec::new(),
            blocked_by: self.blocked_by(&project, issue_key)?,
        })
    }

    /// The work items that block `issue`. A Plane that does not know the question has none.
    fn blocked_by(&self, project: &Project, issue: &str) -> Result<Vec<String>, TicketError> {
        let relations = self.optional(&format!("projects/{}/work-items/{issue}/relations/", project.id))?;
        Ok(relations
            .get("blocked_by")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|blocker| {
                // An entry is the work item's id, or a record of it that may name another project.
                let (blocker_project, blocker_id) = match blocker {
                    Value::String(id) => (project.id.as_str(), id.as_str()),
                    record => {
                        let own = Some(text_of(record, "issue_id")).filter(|id| !id.is_empty()).unwrap_or_else(|| text_of(record, "id"));
                        (Some(text_of(record, "project_id")).filter(|id| !id.is_empty()).unwrap_or(project.id.as_str()), own)
                    }
                };
                (is_plane_id(blocker_project) && is_plane_id(blocker_id)).then(|| ticket_id(blocker_project, blocker_id))
            })
            .collect())
    }
}

/// The name of a comment's author: the one Plane names, or the member it points at.
fn author_of(project: &Project, comment: &Value) -> String {
    let named = comment.get("actor_detail").map(|actor| text_of(actor, "display_name")).filter(|name| !name.is_empty());
    let member = ["actor", "created_by"].into_iter().find_map(|field| project.members.get(text_of(comment, field)).map(String::as_str));
    named.or(member).unwrap_or_default().to_owned()
}

/// What a client asked of Plane's tickets, read with `saved`. Blocks while Plane answers.
pub(super) fn answer(http: &dyn Http, saved: &Saved, request: TicketsRequest, retry_wait: Duration) -> Result<TicketsReply, TicketError> {
    // The key goes only where it may: checked again here, whatever the file held.
    check_base_url(&saved.address).map_err(invalid)?;
    if !is_workspace(&saved.workspace) {
        return Err(invalid("The workspace is not usable"));
    }
    let plane = Plane { http, saved, retry_wait };
    let reply = match request {
        TicketsRequest::Groups => TicketsReply::Groups(plane.groups()?),
        TicketsRequest::List(filter) => TicketsReply::List(plane.list(&filter)?),
        TicketsRequest::Get { id } => TicketsReply::Ticket(Box::new(plane.get(&id)?)),
    };
    reply.cleaned().ok_or_else(|| invalid("The server did not give a ticket"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::fake::FakeHttp;
    use crate::http::{HttpError, Secret};

    const KEY: &str = "plane_api_SECRETVALUE0123456789";
    const BASE: &str = "https://plane.example.com/api/v1/workspaces/ws";

    fn saved(address: &str) -> Saved {
        Saved { address: address.into(), workspace: "ws".into(), key: Secret::new(KEY) }
    }

    fn ask(http: &FakeHttp, request: TicketsRequest) -> Result<TicketsReply, TicketError> {
        answer(http, &saved("https://plane.example.com"), request, Duration::ZERO)
    }

    fn groups(http: &FakeHttp) -> Result<Vec<Group>, TicketError> {
        match ask(http, TicketsRequest::Groups)? {
            TicketsReply::Groups(groups) => Ok(groups),
            other => panic!("{other:?}"),
        }
    }

    fn page(http: &FakeHttp, filter: Filter) -> Result<TicketPage, TicketError> {
        match ask(http, TicketsRequest::List(filter))? {
            TicketsReply::List(page) => Ok(page),
            other => panic!("{other:?}"),
        }
    }

    fn one(http: &FakeHttp, id: &str) -> Result<Ticket, TicketError> {
        match ask(http, TicketsRequest::Get { id: id.into() })? {
            TicketsReply::Ticket(ticket) => Ok(*ticket),
            other => panic!("{other:?}"),
        }
    }

    const PROJECT: &str = r#"{"id":"p1","identifier":"MAITTY","name":"Maitty"}"#;
    const STATES: &str = r#"{"results":[
        {"id":"s-todo","name":"Todo","group":"unstarted"},
        {"id":"s-doing","name":"In Progress","group":"started"},
        {"id":"s-done","name":"Done","group":"completed"},
        {"id":"s-no","name":"Cancelled","group":"cancelled"},
        {"id":"s-back","name":"Backlog","group":"backlog"}]}"#;
    const LABELS: &str = r#"[{"id":"l-bug","name":"bug"},{"id":"l-ui","name":"ui"}]"#;
    const MEMBERS: &str = r#"[{"member":{"id":"m-ann","display_name":"Ann"}},{"id":"m-bo","display_name":"Bo"}]"#;

    /// A Plane that knows project `p1` and answers `issues` for its work items.
    fn plane_with(issues: &str) -> FakeHttp {
        FakeHttp::new()
            .on("workspaces/ws/projects/p1/states/", 200, STATES)
            .on("workspaces/ws/projects/p1/labels/", 200, LABELS)
            .on("workspaces/ws/projects/p1/members/", 200, MEMBERS)
            .on("workspaces/ws/projects/p1/issues/?", 200, issues)
            .on("workspaces/ws/projects/p1/$", 200, PROJECT)
    }

    const ISSUES: &str = r#"{"results":[
        {"id":"i1","sequence_id":1,"name":"Fix the \u001b[31mlogin\u202e bug","state":"s-doing","labels":["l-bug"],"assignees":["m-ann"],"updated_at":"2026-01-02T03:04:05Z"},
        {"id":"i2","sequence_id":2,"name":"Write docs","state":"s-todo","labels":["l-ui"],"assignees":["m-bo","m-ann"],"updated_at":"2026-01-01T00:00:00Z"},
        {"id":"i3","sequence_id":3,"name":"Ship it","state":"s-done","labels":[],"assignees":[],"updated_at":"2026-01-03T00:00:00Z"},
        {"id":"../evil","sequence_id":4,"name":"not an id","state":"s-todo","labels":[],"assignees":[]}],
        "next_page_results":false}"#;

    fn everything() -> Filter {
        Filter { group: Some("plane:p1".into()), ..Filter::default() }
    }

    #[test]
    fn projects_and_their_modules_are_groups() {
        let http = FakeHttp::new()
            .on("projects/p1/modules/", 200, r#"{"results":[{"id":"m1","name":"Tickets in the app","total_issues":8},{"id":"bad id","name":"x"}]}"#)
            .on("projects/p2/modules/", 404, "")
            .on(
                "/projects/?per_page",
                200,
                r#"{"results":[{"id":"p1","name":"Maitty"},{"id":"p2","name":"Old","archived_at":null},{"id":"p3","name":"Gone","archived_at":"2026-01-01"},{"id":"a/b","name":"odd"}]}"#,
            );
        let found = groups(&http).unwrap();
        let shown: Vec<_> = found.iter().map(|g| (g.id.as_str(), g.kind, g.parent.as_deref(), g.ticket_count)).collect();
        assert_eq!(
            shown,
            [
                ("plane:p1", GroupKind::Project, None, None),
                ("plane:p1!m1", GroupKind::Module, Some("plane:p1"), Some(8)),
                ("plane:p2", GroupKind::Project, None, None),
            ]
        );
        assert_eq!(http.seen()[0].url, format!("{BASE}/projects/?per_page=100"));
        assert!(http.seen().iter().all(|request| request.key_header == "X-API-Key" && request.key.expose() == KEY));
    }

    #[test]
    fn work_items_are_listed_clean_with_an_address_built_here_and_the_state_from_its_group() {
        let http = plane_with(ISSUES);
        let found = page(&http, everything()).unwrap();
        assert_eq!(found.tickets.len(), 3, "the one without an id is dropped");
        let first = &found.tickets[0];
        assert_eq!(first.id, "plane:p1#i1");
        assert_eq!(first.title, "Fix the [31mlogin bug");
        assert_eq!((first.state.name.as_str(), first.state.category), ("In Progress", StateCategory::Started));
        assert_eq!((first.labels.as_slice(), first.assignee.as_deref()), (["bug".to_owned()].as_slice(), Some("Ann")));
        assert_eq!(first.url, "https://plane.example.com/ws/browse/MAITTY-1/");
        assert_eq!(first.groups, ["plane:p1"]);
        assert_eq!(first.updated_at, "2026-01-02T03:04:05Z");
        assert_eq!(found.tickets[1].state.category, StateCategory::Open);
        assert_eq!(found.tickets[2].state.category, StateCategory::Closed);
        assert!(!found.more);
        assert!(http.seen().iter().any(|request| request.url == format!("{BASE}/projects/p1/issues/?per_page=100&cursor=100:0:0")));
    }

    #[test]
    fn a_search_and_the_filters_narrow_what_is_read() {
        let http = plane_with(ISSUES);
        let ids = |filter: Filter| page(&http, filter).unwrap().tickets.into_iter().map(|t| t.id).collect::<Vec<_>>();
        assert_eq!(ids(Filter { search: Some("LOGIN".into()), ..everything() }), ["plane:p1#i1"]);
        assert_eq!(ids(Filter { state: Some(StateCategory::Closed), ..everything() }), ["plane:p1#i3"]);
        assert_eq!(ids(Filter { label: Some("UI".into()), ..everything() }), ["plane:p1#i2"]);
        assert_eq!(ids(Filter { assignee: Some("bo".into()), ..everything() }), ["plane:p1#i2"]);
        assert_eq!(ids(Filter { assignee: Some("ann".into()), state: Some(StateCategory::Open), ..everything() }), ["plane:p1#i2"]);
        assert!(ids(Filter { search: Some("nothing like this".into()), ..everything() }).is_empty());
    }

    #[test]
    fn a_module_is_read_through_its_own_work_items_and_a_group_that_is_not_one_is_refused() {
        let http = plane_with("{}").on("projects/p1/modules/m1/module-issues/", 200, ISSUES);
        let found = page(&http, Filter { group: Some("plane:p1!m1".into()), ..Filter::default() }).unwrap();
        assert_eq!(found.tickets[0].groups, ["plane:p1", "plane:p1!m1"]);
        let before = http.seen().len();
        for bad in ["plane:p1!../x", "plane:../x", "github:o/r!1", "plane:p1#i1", "plane:", "plane:p1!m1!m2"] {
            let error = page(&http, Filter { group: Some(bad.into()), ..Filter::default() }).unwrap_err();
            assert!(matches!(error, TicketError::Invalid(_)), "{bad}");
        }
        assert!(matches!(page(&http, Filter::default()), Err(TicketError::Invalid(_))), "a list needs a project");
        assert_eq!(http.seen().len(), before, "nothing was asked of Plane for them");
    }

    #[test]
    fn a_page_is_cut_from_what_was_read_and_says_when_there_is_more() {
        let items: Vec<String> = (1..=70).map(|n| format!(r#"{{"id":"i{n}","sequence_id":{n},"name":"t{n}","state":"s-todo"}}"#)).collect();
        let http = plane_with(&format!(r#"{{"results":[{}],"next_page_results":false}}"#, items.join(",")));
        let first = page(&http, everything()).unwrap();
        assert_eq!((first.tickets.len(), first.more, first.tickets[0].id.as_str()), (TICKETS_PAGE_SIZE, true, "plane:p1#i1"));
        let second = page(&http, Filter { page: 1, ..everything() }).unwrap();
        assert_eq!((second.tickets.len(), second.more, second.tickets[0].id.as_str()), (TICKETS_PAGE_SIZE, true, "plane:p1#i31"));
        let third = page(&http, Filter { page: 2, ..everything() }).unwrap();
        assert_eq!((third.tickets.len(), third.more), (10, false));
        assert!(matches!(page(&http, Filter { page: TICKETS_PAGE_MAX + 1, ..everything() }), Err(TicketError::Invalid(_))));
    }

    #[test]
    fn it_reads_no_more_pages_than_the_ceiling_even_if_plane_says_there_are_more() {
        let http = plane_with(r#"{"results":[{"id":"i1","sequence_id":1,"name":"a","state":"s-todo"}],"next_page_results":true}"#);
        page(&http, Filter { search: Some("never matches".into()), ..everything() }).unwrap();
        let asked = http.seen().iter().filter(|request| request.url.contains("/issues/?per_page")).count();
        assert_eq!(asked, PAGES_MAX);
    }

    const ISSUE: &str = r#"{"id":"i1","sequence_id":7,"name":"Fix login","state":"s-doing","labels":["l-bug"],"assignees":["m-ann"],
        "updated_at":"2026-01-02T03:04:05Z","description_stripped":"","description_html":"<p>It fails &amp; <b>burns</b></p><p>Every\u200b time</p><script>x</script>"}"#;
    const COMMENTS: &str = r#"{"results":[
        {"comment_html":"<p>Same here</p>","created_at":"2026-01-02T04:00:00Z","actor":"m-bo"},
        {"comment_stripped":"Looking\u001b[0m now","created_at":"2026-01-02T05:00:00Z","actor_detail":{"display_name":"Cy"}}]}"#;

    #[test]
    fn one_work_item_comes_with_its_comments_and_what_blocks_it() {
        let http = plane_with("{}")
            .on("projects/p1/issues/i1/comments/", 200, COMMENTS)
            .on("projects/p1/work-items/i1/relations/", 200, r#"{"blocking":["z"],"blocked_by":["i9",{"issue_id":"j2","project_id":"p2"},{"id":"i3"},"bad/id",{"id":"x y"}]}"#)
            .on("projects/p1/issues/i1/", 200, ISSUE);
        let ticket = one(&http, "plane:p1#i1").unwrap();
        assert_eq!(ticket.summary.title, "Fix login");
        assert_eq!(ticket.summary.url, "https://plane.example.com/ws/browse/MAITTY-7/");
        assert!(ticket.body.starts_with("It fails & burns\n") && ticket.body.contains("Every time") && !ticket.body.contains('<') && !ticket.body.contains('\u{200b}'), "{:?}", ticket.body);
        let comments: Vec<_> = ticket.comments.iter().map(|c| (c.author.as_str(), c.body.as_str())).collect();
        assert_eq!(comments, [("Bo", "Same here"), ("Cy", "Looking[0m now")]);
        assert_eq!(ticket.blocked_by, ["plane:p1#i9", "plane:p2#j2", "plane:p1#i3"]);
        assert!(!ticket.comments_more);
        assert!(http.seen().iter().any(|request| request.url == format!("{BASE}/projects/p1/work-items/i1/relations/")));
    }

    #[test]
    fn a_plane_without_relations_has_none_but_other_failures_are_not_hidden() {
        let base = || plane_with("{}").on("projects/p1/issues/i1/comments/", 200, "[]").on("projects/p1/issues/i1/", 200, ISSUE);
        let none = base().on("work-items/i1/relations/", 404, "");
        assert!(one(&none, "plane:p1#i1").unwrap().blocked_by.is_empty());
        let broken = base().on("work-items/i1/relations/", 500, "");
        assert!(matches!(one(&broken, "plane:p1#i1"), Err(TicketError::Unreachable(_))));
        let limited = base().on("work-items/i1/relations/", 429, "");
        assert_eq!(one(&limited, "plane:p1#i1").unwrap_err(), TicketError::RateLimited);
    }

    #[test]
    fn the_comments_of_a_long_item_are_capped_and_it_says_so() {
        let many: Vec<String> = (0..TICKET_COMMENTS_MAX + 10).map(|n| format!(r#"{{"comment_stripped":"c{n}","actor":"m-bo"}}"#)).collect();
        let http = plane_with("{}")
            .on("projects/p1/issues/i1/comments/", 200, &format!("[{}]", many.join(",")))
            .on("work-items/i1/relations/", 404, "")
            .on("projects/p1/issues/i1/", 200, ISSUE);
        let ticket = one(&http, "plane:p1#i1").unwrap();
        assert_eq!((ticket.comments.len(), ticket.comments_more), (TICKET_COMMENTS_MAX, true));
    }

    #[test]
    fn an_item_of_another_id_or_a_bad_id_is_refused() {
        let http = plane_with("{}").on("projects/p1/issues/i2/comments/", 200, "[]").on("projects/p1/issues/i2/", 200, ISSUE);
        assert!(matches!(one(&http, "plane:p1#i2"), Err(TicketError::Invalid(_))), "Plane gave i1 for i2");
        let before = http.seen().len();
        for bad in ["plane:p1", "plane:p1#", "plane:p1#../x", "plane:#i1", "github:o/r#1", "plane:p1#i1/comments"] {
            assert!(matches!(one(&http, bad), Err(TicketError::Invalid(_))), "{bad}");
        }
        assert_eq!(http.seen().len(), before);
    }

    #[test]
    fn people_are_decoration_so_a_key_that_may_not_list_them_still_reads_tickets() {
        let http = FakeHttp::new()
            .on("projects/p1/members/", 403, "")
            .on("workspaces/ws/projects/p1/states/", 200, STATES)
            .on("workspaces/ws/projects/p1/labels/", 200, LABELS)
            .on("workspaces/ws/projects/p1/issues/?", 200, ISSUES)
            .on("workspaces/ws/projects/p1/$", 200, PROJECT);
        let found = page(&http, everything()).unwrap();
        assert_eq!(found.tickets[0].assignee, None);
    }

    #[test]
    fn a_refused_key_an_unreachable_server_and_a_rate_limit_are_each_their_own_fixed_answer() {
        let refused = FakeHttp::new().on("projects/", 401, r#"{"error":"bad key plane_api_SECRETVALUE0123456789"}"#);
        assert_eq!(groups(&refused).unwrap_err(), TicketError::SignedOut);
        let forbidden = FakeHttp::new().on("projects/", 403, "");
        assert_eq!(groups(&forbidden).unwrap_err(), TicketError::SignedOut);
        let gone = FakeHttp::new().fail("projects/", HttpError::Unreachable("The server could not be reached"));
        assert!(matches!(groups(&gone).unwrap_err(), TicketError::Unreachable(line) if line == "The server could not be reached"));
        let no_curl = FakeHttp::new().fail("projects/", HttpError::NoCurl);
        assert!(matches!(groups(&no_curl).unwrap_err(), TicketError::Unreachable(_)));
        let down = FakeHttp::new().on("projects/", 503, "<html>try later</html>");
        assert!(matches!(groups(&down).unwrap_err(), TicketError::Unreachable(line) if line == "The server had an error"));

        let limited = FakeHttp::new().on("projects/", 429, "");
        assert_eq!(groups(&limited).unwrap_err(), TicketError::RateLimited);
        assert_eq!(limited.seen().len(), RETRIES + 1, "it waited and tried again before it gave up");
        let recovers = FakeHttp::new().on("projects/", 429, "").on("projects/", 200, "[]");
        assert_eq!(groups(&recovers).unwrap(), Vec::new());
        assert_eq!(recovers.seen().len(), 2);
    }

    #[test]
    fn an_answer_that_is_not_json_or_is_too_large_is_one_fixed_line() {
        let malformed = FakeHttp::new().on("projects/", 200, "<html>login</html>");
        assert_eq!(groups(&malformed).unwrap_err(), TicketError::Invalid("The server did not give tickets".into()));
        let large = FakeHttp::new().fail("projects/", HttpError::TooLarge);
        assert!(matches!(groups(&large).unwrap_err(), TicketError::Invalid(line) if line.contains("larger")));
        let rejected = FakeHttp::new().on("projects/", 400, "plane_api_SECRETVALUE0123456789 is not welcome");
        assert!(matches!(groups(&rejected).unwrap_err(), TicketError::Invalid(_)));
    }

    #[test]
    fn hidden_and_hostile_text_is_cleaned_and_cut_before_it_leaves() {
        let long = "y".repeat(2 * maitty_shared::tickets::TICKET_TITLE_MAX_CHARS);
        let issues = format!(
            r#"[{{"id":"i1","sequence_id":1,"name":"a\u202eb\u200bc\u001b]0;pwn\u0007 {long}","state":"s-todo","labels":["l-bug"],"updated_at":"<script>"}}]"#
        );
        let http = plane_with(&issues);
        let found = page(&http, everything()).unwrap();
        let title = &found.tickets[0].title;
        assert!(title.starts_with("abc]0;pwn") && !title.contains(['\u{202e}', '\u{200b}', '\u{1b}', '\u{7}']), "{title:?}");
        assert_eq!(title.chars().count(), maitty_shared::tickets::TICKET_TITLE_MAX_CHARS);
        assert_eq!(found.tickets[0].updated_at, "");
    }

    #[test]
    fn the_key_is_in_no_error_and_no_debug_output_and_an_address_it_may_not_go_to_is_refused_first() {
        let scenarios: Vec<FakeHttp> = vec![
            FakeHttp::new().on("projects/", 401, KEY),
            FakeHttp::new().on("projects/", 500, KEY),
            FakeHttp::new().on("projects/", 200, KEY),
            FakeHttp::new().on("projects/", 429, KEY),
            FakeHttp::new().fail("projects/", HttpError::Unreachable("The server could not be reached")),
        ];
        for http in scenarios {
            let error = groups(&http).unwrap_err();
            assert!(!format!("{error:?}").contains("SECRETVALUE"), "{error:?}");
            assert!(!format!("{:?}", http.seen()).contains("SECRETVALUE"), "a request prints without its key");
        }
        assert!(!format!("{:?}", saved("https://plane.example.com")).contains("SECRETVALUE"));

        for bad in ["http://plane.example.com", "ftp://plane.example.com", "https://user:pass@plane.example.com", "plane.example.com", "https://plane.example.com/\n"] {
            let http = FakeHttp::new().on("projects/", 200, "[]");
            let error = answer(&http, &saved(bad), TicketsRequest::Groups, Duration::ZERO).unwrap_err();
            assert!(matches!(error, TicketError::Invalid(_)), "{bad}");
            assert!(http.seen().is_empty(), "no key was sent to {bad}");
        }
        let http = FakeHttp::new().on("projects/", 200, "[]");
        let mut odd = saved("https://plane.example.com");
        odd.workspace = "ws/../x".into();
        assert!(answer(&http, &odd, TicketsRequest::Groups, Duration::ZERO).is_err() && http.seen().is_empty());
        // Your own network may use http.
        assert!(answer(&http, &saved("http://192.168.1.244"), TicketsRequest::Groups, Duration::ZERO).is_ok());
    }

    /// Through the real sender and a real socket: the key reaches the server in a header and the
    /// answer is read back as groups.
    #[test]
    fn a_local_server_is_read_through_curl_with_the_key_in_its_header() {
        use std::io::{Read, Write};
        if !crate::proc::on_path("curl") {
            return;
        }
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        // The projects, then the modules of the one project, each on its own connection.
        let server = std::thread::spawn(move || {
            let mut first = String::new();
            for answer in [r#"{"results":[{"id":"p1","name":"Maitty"}]}"#, "[]"] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut seen = vec![0u8; 4096];
                let n = stream.read(&mut seen).unwrap();
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}", answer.len());
                if first.is_empty() {
                    first = String::from_utf8_lossy(&seen[..n]).into_owned();
                }
            }
            first
        });
        let local = Saved { address: format!("http://127.0.0.1:{port}"), workspace: "ws".into(), key: Secret::new(KEY) };
        let Ok(TicketsReply::Groups(found)) = answer(&crate::curl_http::CurlHttp, &local, TicketsRequest::Groups, Duration::ZERO) else {
            panic!("the groups were read");
        };
        assert_eq!(found[0].id, "plane:p1");
        let seen = server.join().unwrap();
        assert!(seen.starts_with("GET /api/v1/workspaces/ws/projects/?per_page=100 HTTP/1.1"), "{seen}");
        assert!(seen.to_lowercase().contains(&format!("x-api-key: {}", KEY.to_lowercase())), "{seen}");
    }

    #[test]
    fn html_becomes_readable_text() {
        assert_eq!(html_to_text("<p>a &lt;b&gt; &amp; c</p><p>d<br/>e</p>"), "\na <b> & c\n\nd\ne\n");
        assert_eq!(html_to_text("one<div>two</div><div></div><div></div><div></div>three"), "one\ntwo\n\nthree");
        assert_eq!(html_to_text("plain"), "plain");
    }
}
