//! Linear issues as tickets, read over Linear's GraphQL API with the user's own personal API key:
//! the teams, projects and cycles, a page of issues, one issue with its comments. Read-only: every
//! request here is a `query`, never a `mutation` (Maiker only reads tickets, ADR 0011). The one server is `api.linear.app` over `https`,
//! fixed in this file and never read from the key file, so the key can go nowhere else; it travels
//! in the `Authorization` header, which `curl_http` hands curl on its standard input.
//!
//! What Linear sends is other people's writing. Every string is cleaned and cut and every list is
//! capped by `maitty_shared::tickets` before it leaves here; an id that is not the plain characters
//! of one never becomes a ticket id or a filter; an address is kept only when it is `linear.app`'s
//! and `https`; what a person typed (a search, a label, a name) travels as a GraphQL variable and
//! is never joined into the query text; no ticket text and no word of Linear's own error is logged
//! or put in an error, and neither is the key.
//!
//! Cost is capped, since Linear refuses a query that is too complex and rate limits by it: no
//! connection asks for more than `PAGE_FIRST` nodes, a list reads at most `PAGES_MAX` pages, and the
//! nested lists (labels, comments, relations, attachments) have small fixed sizes. Not verified
//! against a live server, only against the shapes below, which are Linear's public schema as
//! documented.

use super::ticket_http::{parse_json, plain_words, status_error};
use super::ticket_keys::Saved;
use crate::http::{Http, Method, Request};
use maitty_shared::github::is_pull_request_address;
use maitty_shared::tickets::{
    Filter, Group, GroupKind, StateCategory, TICKET_COMMENTS_MAX, TICKET_GROUPS_MAX, TICKET_NAME_MAX_CHARS, TICKET_SEARCH_MAX_CHARS, TICKETS_PAGE_MAX,
    TICKETS_PAGE_SIZE, Ticket, TicketComment, TicketError, TicketPage, TicketState, TicketSummary, TicketsReply, TicketsRequest,
};
use serde_json::{Map, Value, json};

/// The one server, and the only address a Linear key is ever sent to.
const ENDPOINT: &str = "https://api.linear.app/graphql";
/// The most nodes any one connection is asked for.
const PAGE_FIRST: usize = 50;
/// The most pages of issues read to fill one page of tickets (`TICKETS_PAGE_MAX` pages of 30 fit).
const PAGES_MAX: usize = 8;
/// Where an issue's address must start to be kept.
const ADDRESS_PREFIX: &str = "https://linear.app/";
/// The longest a Linear id (a UUID) may be.
const ID_MAX_CHARS: usize = 64;

const GROUPS_QUERY: &str = "query Groups { \
    teams(first: 50) { nodes { id name } } \
    projects(first: 50) { nodes { id name teams(first: 1) { nodes { id } } } } \
    cycles(first: 50, filter: { or: [{ isActive: { eq: true } }, { isNext: { eq: true } }, { isPrevious: { eq: true } }] }) { nodes { id number name team { id } } } }";

const ISSUE_FIELDS: &str = "id title url updatedAt state { name type } labels(first: 10) { nodes { name } } assignee { displayName } team { id } project { id } cycle { id }";

fn list_query() -> String {
    format!(
        "query List($first: Int!, $after: String, $filter: IssueFilter) {{ issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {{ nodes {{ {ISSUE_FIELDS} }} pageInfo {{ hasNextPage endCursor }} }} }}"
    )
}

fn one_query() -> String {
    format!(
        "query One($id: String!) {{ issue(id: $id) {{ {ISSUE_FIELDS} description \
         comments(first: {comments}) {{ nodes {{ body createdAt user {{ displayName }} }} }} \
         inverseRelations(first: 21) {{ nodes {{ type issue {{ id }} }} }} \
         attachments(first: 21) {{ nodes {{ url }} }} }} }}",
        comments = TICKET_COMMENTS_MAX + 1
    )
}

fn invalid(why: &str) -> TicketError {
    TicketError::Invalid(why.into())
}

/// Whether `id` is the plain characters of a Linear id: what can safely be sent back in a filter.
fn is_linear_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= ID_MAX_CHARS && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn team_id(id: &str) -> String {
    format!("linear:team.{id}")
}

fn project_id(id: &str) -> String {
    format!("linear:project.{id}")
}

fn cycle_id(id: &str) -> String {
    format!("linear:cycle.{id}")
}

fn issue_id(id: &str) -> String {
    format!("linear:issue.{id}")
}

/// What a group id made here points at.
enum Scope<'a> {
    Team(&'a str),
    Project(&'a str),
    Cycle(&'a str),
}

fn parse_group(id: &str) -> Option<Scope<'_>> {
    let key = id.strip_prefix("linear:")?;
    let (kind, id) = key.split_once('.')?;
    if !is_linear_id(id) {
        return None;
    }
    match kind {
        "team" => Some(Scope::Team(id)),
        "project" => Some(Scope::Project(id)),
        "cycle" => Some(Scope::Cycle(id)),
        _ => None,
    }
}

pub(super) fn parse_issue(id: &str) -> Option<&str> {
    id.strip_prefix("linear:issue.").filter(|id| is_linear_id(id))
}

/// Which way a Linear state type leans.
fn category(kind: &str) -> StateCategory {
    match kind {
        "started" => StateCategory::Started,
        "completed" | "canceled" => StateCategory::Closed,
        // Triage, backlog, unstarted and anything Linear adds later have not been started.
        _ => StateCategory::Open,
    }
}

/// The state types a category stands for, as Linear names them.
fn state_types(category: StateCategory) -> &'static [&'static str] {
    match category {
        StateCategory::Open => &["triage", "backlog", "unstarted"],
        StateCategory::Started => &["started"],
        StateCategory::Closed => &["completed", "canceled"],
    }
}

fn text_of<'a>(value: &'a Value, field: &str) -> &'a str {
    value.get(field).and_then(Value::as_str).unwrap_or_default()
}

/// The nodes of a connection, `[]` when it is missing or null.
fn nodes<'a>(value: &'a Value, field: &str) -> &'a [Value] {
    value.get(field).and_then(|connection| connection.get("nodes")).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// The id of the object under `field`, when it is there and is an id.
fn id_under<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).map(|inner| text_of(inner, "id")).filter(|id| is_linear_id(id))
}

struct Linear<'a> {
    http: &'a dyn Http,
    saved: &'a Saved,
}

impl Linear<'_> {
    /// One query, and the `data` of its answer. A status that is not a success, or an answer that
    /// carries `errors`, is a fixed line; what the errors say is read only to tell the kinds apart.
    fn query(&self, query: &str, variables: Value) -> Result<Value, TicketError> {
        let request = Request {
            method: Method::Post,
            url: ENDPOINT.to_owned(),
            body: Some(json!({ "query": query, "variables": variables }).to_string()),
            key_header: "Authorization",
            key: self.saved.key.clone(),
        };
        let response = self.http.send(&request)?;
        let answer = parse_json(&response.body);
        // Linear reports a refused key and a rate limit as a 400 whose errors say which.
        if let Some(errors) = answer.as_ref().ok().and_then(|answer| answer.get("errors")).and_then(Value::as_array) {
            return Err(why_refused(errors, response.status));
        }
        if !(200..=299).contains(&response.status) {
            return Err(status_error(response.status));
        }
        answer?.get("data").filter(|data| data.is_object()).cloned().ok_or_else(|| invalid("The server did not give tickets"))
    }

    fn groups(&self) -> Result<Vec<Group>, TicketError> {
        let data = self.query(GROUPS_QUERY, json!({}))?;
        let teams = nodes(&data, "teams").iter().filter(|team| is_linear_id(text_of(team, "id"))).map(|team| Group {
            id: team_id(text_of(team, "id")),
            kind: GroupKind::Project,
            name: text_of(team, "name").to_owned(),
            parent: None,
            ticket_count: None,
        });
        let projects = nodes(&data, "projects").iter().filter(|project| is_linear_id(text_of(project, "id"))).map(|project| Group {
            id: project_id(text_of(project, "id")),
            kind: GroupKind::Module,
            name: text_of(project, "name").to_owned(),
            // A project may span teams; the first is where it is listed.
            parent: nodes(project, "teams").iter().find_map(|team| Some(text_of(team, "id")).filter(|id| is_linear_id(id))).map(team_id),
            ticket_count: None,
        });
        let cycles = nodes(&data, "cycles").iter().filter(|cycle| is_linear_id(text_of(cycle, "id"))).map(|cycle| {
            let number = cycle.get("number").and_then(Value::as_u64).unwrap_or_default();
            let name = Some(text_of(cycle, "name")).filter(|name| !name.trim().is_empty()).map_or_else(|| format!("Cycle {number}"), str::to_owned);
            Group { id: cycle_id(text_of(cycle, "id")), kind: GroupKind::Cycle, name, parent: id_under(cycle, "team").map(team_id), ticket_count: None }
        });
        Ok(teams.chain(projects).chain(cycles).take(TICKET_GROUPS_MAX).collect())
    }

    fn list(&self, filter: &Filter) -> Result<TicketPage, TicketError> {
        if filter.page > TICKETS_PAGE_MAX {
            return Err(invalid("That page of tickets is too far on"));
        }
        let search = plain_words(&filter.search, TICKET_SEARCH_MAX_CHARS, "something to search for")?;
        let label = plain_words(&filter.label, TICKET_NAME_MAX_CHARS, "a label")?;
        let assignee = plain_words(&filter.assignee, TICKET_NAME_MAX_CHARS, "a person")?;
        // What a person typed is a value in the filter object, which travels as a variable.
        let mut narrowed = Map::new();
        if let Some(group) = &filter.group {
            let (field, id) = match parse_group(group).ok_or_else(|| invalid("That is not a Linear team, project or cycle"))? {
                Scope::Team(id) => ("team", id),
                Scope::Project(id) => ("project", id),
                Scope::Cycle(id) => ("cycle", id),
            };
            narrowed.insert(field.into(), json!({ "id": { "eq": id } }));
        }
        if let Some(state) = filter.state {
            narrowed.insert("state".into(), json!({ "type": { "in": state_types(state) } }));
        }
        if let Some(who) = assignee {
            narrowed.insert("assignee".into(), json!({ "displayName": { "eqIgnoreCase": who } }));
        }
        if let Some(label) = label {
            narrowed.insert("labels".into(), json!({ "name": { "eqIgnoreCase": label } }));
        }
        if let Some(search) = search {
            narrowed.insert("title".into(), json!({ "containsIgnoreCase": search }));
        }
        let skip = filter.page as usize * TICKETS_PAGE_SIZE;
        let wanted = skip + TICKETS_PAGE_SIZE + 1;
        let query = list_query();
        let (mut found, mut after) = (Vec::new(), Value::Null);
        for _ in 0..PAGES_MAX {
            let first = (wanted - found.len()).min(PAGE_FIRST);
            let data = self.query(&query, json!({ "first": first, "after": after, "filter": narrowed }))?;
            let issues = data.get("issues").ok_or_else(|| invalid("The server did not give issues"))?;
            found.extend(nodes(&data, "issues").iter().filter_map(summary));
            let next = issues.get("pageInfo").filter(|info| info.get("hasNextPage").and_then(Value::as_bool) == Some(true)).map(|info| text_of(info, "endCursor"));
            match next {
                Some(cursor) if !cursor.is_empty() && found.len() < wanted => after = Value::String(cursor.to_owned()),
                _ => break,
            }
        }
        let more = found.len() > skip + TICKETS_PAGE_SIZE;
        Ok(TicketPage { tickets: found.into_iter().skip(skip).take(TICKETS_PAGE_SIZE).collect(), more })
    }

    fn get(&self, id: &str) -> Result<Ticket, TicketError> {
        let key = parse_issue(id).ok_or_else(|| invalid("That is not a Linear issue"))?;
        let data = self.query(&one_query(), json!({ "id": key }))?;
        let issue = data.get("issue").filter(|issue| issue.is_object()).ok_or(TicketError::NotFound)?;
        if text_of(issue, "id") != key {
            return Err(invalid("The server gave another issue"));
        }
        let summary = summary(issue).ok_or_else(|| invalid("The server did not give an issue"))?;
        // One more than is kept, so the ticket can say there were more.
        let comments = nodes(issue, "comments")
            .iter()
            .take(TICKET_COMMENTS_MAX + 1)
            .map(|comment| TicketComment {
                author: comment.get("user").map(|user| text_of(user, "displayName").to_owned()).unwrap_or_default(),
                body: text_of(comment, "body").to_owned(),
                created_at: text_of(comment, "createdAt").to_owned(),
            })
            .collect();
        let links = nodes(issue, "attachments").iter().map(|attachment| text_of(attachment, "url")).filter(|url| is_pull_request_address(url)).map(str::to_owned).collect();
        // A relation read from the other side: the issue in it blocks this one.
        let blocked_by = nodes(issue, "inverseRelations")
            .iter()
            .filter(|relation| text_of(relation, "type") == "blocks")
            .filter_map(|relation| id_under(relation, "issue"))
            .map(issue_id)
            .collect();
        Ok(Ticket { summary, body: text_of(issue, "description").to_owned(), comments, comments_more: false, links, blocked_by })
    }
}

/// An issue as a summary, or `None` when it has no id that could be one. An address is kept only
/// when it is Linear's own.
fn summary(issue: &Value) -> Option<TicketSummary> {
    let id = Some(text_of(issue, "id")).filter(|id| is_linear_id(id))?;
    let state = issue.get("state").filter(|state| state.is_object());
    let url = Some(text_of(issue, "url")).filter(|url| url.starts_with(ADDRESS_PREFIX)).unwrap_or_default();
    Some(TicketSummary {
        id: issue_id(id),
        title: text_of(issue, "title").to_owned(),
        state: TicketState {
            name: state.map(|state| text_of(state, "name").to_owned()).unwrap_or_default(),
            category: state.map_or(StateCategory::Open, |state| category(text_of(state, "type"))),
        },
        labels: nodes(issue, "labels").iter().map(|label| text_of(label, "name").to_owned()).collect(),
        assignee: issue.get("assignee").map(|person| text_of(person, "displayName").to_owned()).filter(|name| !name.is_empty()),
        url: url.to_owned(),
        groups: [id_under(issue, "team").map(team_id), id_under(issue, "project").map(project_id), id_under(issue, "cycle").map(cycle_id)].into_iter().flatten().collect(),
        updated_at: text_of(issue, "updatedAt").to_owned(),
    })
}

/// What Linear's `errors` say went wrong, as one of the fixed answers. Their words are only read.
fn why_refused(errors: &[Value], status: u16) -> TicketError {
    let said: String = errors
        .iter()
        .flat_map(|error| {
            let extensions = error.get("extensions");
            [extensions.map(|e| text_of(e, "code")), extensions.map(|e| text_of(e, "type"))]
        })
        .flatten()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_uppercase();
    if said.contains("RATELIMIT") || status == 429 {
        TicketError::RateLimited
    } else if said.contains("AUTHENTICATION") || said.contains("FORBIDDEN") || said.contains("UNAUTHORIZED") || matches!(status, 401 | 403) {
        TicketError::SignedOut
    } else {
        invalid("Linear did not accept the request")
    }
}

/// What a client asked of Linear's tickets, read with `saved`'s key. Blocks while Linear answers.
pub(super) fn answer(http: &dyn Http, saved: &Saved, request: TicketsRequest) -> Result<TicketsReply, TicketError> {
    let linear = Linear { http, saved };
    let reply = match request {
        TicketsRequest::Groups => TicketsReply::Groups(linear.groups()?),
        TicketsRequest::List(filter) => TicketsReply::List(linear.list(&filter)?),
        TicketsRequest::Get { id } => TicketsReply::Ticket(Box::new(linear.get(&id)?)),
    };
    reply.cleaned().ok_or_else(|| invalid("The server did not give a ticket"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::fake::FakeHttp;
    use crate::http::{HttpError, Secret};

    const KEY: &str = "lin_api_SECRETVALUE0123456789";

    fn saved() -> Saved {
        // Whatever the file held for the address, the one server is the constant above.
        Saved { address: "https://evil.example".into(), workspace: String::new(), key: Secret::new(KEY) }
    }

    fn ask(http: &FakeHttp, request: TicketsRequest) -> Result<TicketsReply, TicketError> {
        answer(http, &saved(), request)
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

    /// The variables of the `n`th request sent.
    fn variables(http: &FakeHttp, n: usize) -> Value {
        let body: Value = serde_json::from_str(http.seen()[n].body.as_deref().unwrap()).unwrap();
        body["variables"].clone()
    }

    fn data(inner: &str) -> String {
        format!(r#"{{"data":{inner}}}"#)
    }

    const ISSUES: &str = r#"{"issues":{"nodes":[
        {"id":"a1","title":"Fix the \u001b[31mlogin\u202e bug","url":"https://linear.app/ws/issue/ENG-1/fix","updatedAt":"2026-01-02T03:04:05.000Z",
         "state":{"name":"In Progress","type":"started"},"labels":{"nodes":[{"name":"bug"},{"name":"ui"}]},"assignee":{"displayName":"ann"},
         "team":{"id":"t1"},"project":{"id":"pr1"},"cycle":{"id":"c1"}},
        {"id":"a2","title":"Write docs","url":"https://evil.example/x","updatedAt":"2026-01-01T00:00:00.000Z",
         "state":{"name":"Backlog","type":"backlog"},"labels":{"nodes":[]},"assignee":null,"team":{"id":"t1"},"project":null,"cycle":null},
        {"id":"a3","title":"Ship","url":"","updatedAt":"2026-01-03T00:00:00.000Z","state":{"name":"Done","type":"completed"},"labels":{"nodes":[]},"assignee":null,"team":{"id":"t1"},"project":null,"cycle":null},
        {"id":"../evil","title":"not an id","state":{"name":"x","type":"started"}}],
        "pageInfo":{"hasNextPage":false,"endCursor":null}}}"#;

    #[test]
    fn teams_projects_and_cycles_are_groups() {
        let http = FakeHttp::new().on(
            "query Groups",
            200,
            &data(
                r#"{"teams":{"nodes":[{"id":"t1","name":"Engineering"},{"id":"bad id","name":"x"}]},
                    "projects":{"nodes":[{"id":"pr1","name":"Tickets","teams":{"nodes":[{"id":"t1"}]}},{"id":"pr2","name":"Loose","teams":{"nodes":[]}}]},
                    "cycles":{"nodes":[{"id":"c1","number":4,"name":null,"team":{"id":"t1"}},{"id":"c2","number":5,"name":"Big one","team":null}]}}"#,
            ),
        );
        let found = groups(&http).unwrap();
        let shown: Vec<_> = found.iter().map(|g| (g.id.as_str(), g.kind, g.name.as_str(), g.parent.as_deref())).collect();
        assert_eq!(
            shown,
            [
                ("linear:team.t1", GroupKind::Project, "Engineering", None),
                ("linear:project.pr1", GroupKind::Module, "Tickets", Some("linear:team.t1")),
                ("linear:project.pr2", GroupKind::Module, "Loose", None),
                ("linear:cycle.c1", GroupKind::Cycle, "Cycle 4", Some("linear:team.t1")),
                ("linear:cycle.c2", GroupKind::Cycle, "Big one", None),
            ]
        );
    }

    #[test]
    fn the_key_goes_to_the_one_server_in_the_authorization_header_and_every_request_is_a_query() {
        let http = FakeHttp::new().on("query Groups", 200, &data("{}")).on("query List", 200, &data(ISSUES)).on("query One", 200, &data(r#"{"issue":null}"#));
        groups(&http).unwrap();
        page(&http, Filter::default()).unwrap();
        let _ = one(&http, "linear:issue.a1");
        let seen = http.seen();
        assert_eq!(seen.len(), 3);
        for request in &seen {
            assert_eq!((request.url.as_str(), request.key_header, request.key.expose(), request.method), ("https://api.linear.app/graphql", "Authorization", KEY, Method::Post));
            let body = request.body.as_deref().unwrap();
            assert!(body.starts_with(r#"{"query":"query "#) && !body.to_lowercase().contains("mutation"), "{body}");
            assert!(!body.contains("SECRETVALUE"), "the key is never in the body");
        }
    }

    #[test]
    fn issues_are_listed_clean_with_the_state_from_its_type_and_an_address_only_if_linears() {
        let http = FakeHttp::new().on("query List", 200, &data(ISSUES));
        let found = page(&http, Filter::default()).unwrap();
        assert_eq!(found.tickets.len(), 3, "the one without an id is dropped");
        let first = &found.tickets[0];
        assert_eq!(first.id, "linear:issue.a1");
        assert_eq!(first.title, "Fix the [31mlogin bug");
        assert_eq!((first.state.name.as_str(), first.state.category), ("In Progress", StateCategory::Started));
        assert_eq!((first.labels.as_slice(), first.assignee.as_deref()), (["bug".to_owned(), "ui".to_owned()].as_slice(), Some("ann")));
        assert_eq!(first.url, "https://linear.app/ws/issue/ENG-1/fix");
        assert_eq!(first.groups, ["linear:team.t1", "linear:project.pr1", "linear:cycle.c1"]);
        assert_eq!(first.updated_at, "2026-01-02T03:04:05.000Z");
        assert_eq!((found.tickets[1].url.as_str(), found.tickets[1].state.category, found.tickets[1].assignee.as_deref()), ("", StateCategory::Open, None));
        assert_eq!(found.tickets[2].state.category, StateCategory::Closed);
        assert!(!found.more);
    }

    #[test]
    fn what_a_person_typed_is_a_variable_and_never_part_of_the_query_text() {
        let http = FakeHttp::new().on("query List", 200, &data(ISSUES));
        let hostile = r#"x") { id } mutation { issueDelete(id: "1") "#;
        let filter = Filter {
            group: Some("linear:project.pr1".into()),
            state: Some(StateCategory::Closed),
            assignee: Some("Ann".into()),
            label: Some("Bug".into()),
            search: Some(hostile.into()),
            page: 0,
        };
        page(&http, filter).unwrap();
        let request = &http.seen()[0];
        let body: Value = serde_json::from_str(request.body.as_deref().unwrap()).unwrap();
        assert!(!body["query"].as_str().unwrap().contains("issueDelete") && !body["query"].as_str().unwrap().contains("Ann"));
        assert_eq!(
            body["variables"]["filter"],
            json!({
                "project": { "id": { "eq": "pr1" } },
                "state": { "type": { "in": ["completed", "canceled"] } },
                "assignee": { "displayName": { "eqIgnoreCase": "ann" } },
                "labels": { "name": { "eqIgnoreCase": "bug" } },
                "title": { "containsIgnoreCase": hostile.trim().to_lowercase() },
            })
        );
        for (group, field) in [("linear:team.t1", "team"), ("linear:cycle.c1", "cycle")] {
            let http = FakeHttp::new().on("query List", 200, &data(ISSUES));
            page(&http, Filter { group: Some(group.into()), ..Filter::default() }).unwrap();
            assert_eq!(variables(&http, 0)["filter"], json!({ field: { "id": { "eq": &group[group.find('.').unwrap() + 1..] } } }));
        }
    }

    #[test]
    fn a_group_that_is_not_one_and_a_filter_that_is_not_plain_are_refused_before_anything_is_sent() {
        let http = FakeHttp::new().on("query List", 200, &data(ISSUES));
        for bad in ["linear:team.", "linear:team.a b", "linear:team.a\"}", "linear:issue.a1", "linear:cycle", "plane:p1", "linear:team.../x"] {
            let error = page(&http, Filter { group: Some(bad.into()), ..Filter::default() }).unwrap_err();
            assert!(matches!(error, TicketError::Invalid(_)), "{bad}");
        }
        for filter in [
            Filter { search: Some("a\u{1b}b".into()), ..Filter::default() },
            Filter { label: Some("x".repeat(TICKET_NAME_MAX_CHARS + 1)), ..Filter::default() },
            Filter { assignee: Some("a\nb".into()), ..Filter::default() },
            Filter { page: TICKETS_PAGE_MAX + 1, ..Filter::default() },
        ] {
            assert!(matches!(page(&http, filter), Err(TicketError::Invalid(_))));
        }
        assert!(http.seen().is_empty());
    }

    #[test]
    fn pages_are_cut_from_what_was_read_with_a_cursor_and_the_cost_of_each_is_capped() {
        let node = |n: usize| format!(r#"{{"id":"a{n}","title":"t{n}","state":{{"name":"Todo","type":"unstarted"}}}}"#);
        let batch = |range: std::ops::Range<usize>, more: bool| {
            let nodes: Vec<String> = range.map(node).collect();
            data(&format!(r#"{{"issues":{{"nodes":[{}],"pageInfo":{{"hasNextPage":{more},"endCursor":"cur"}}}}}}"#, nodes.join(",")))
        };
        let http = FakeHttp::new().on("query List", 200, &batch(0..50, true)).on("query List", 200, &batch(50..70, false));
        let found = page(&http, Filter { page: 1, ..Filter::default() }).unwrap();
        assert_eq!((found.tickets.len(), found.more, found.tickets[0].id.as_str()), (TICKETS_PAGE_SIZE, true, "linear:issue.a30"));
        assert_eq!(http.seen().len(), 2);
        assert_eq!(variables(&http, 0)["after"], Value::Null);
        assert_eq!(variables(&http, 1)["after"], "cur");
        for n in 0..2 {
            assert!(variables(&http, n)["first"].as_u64().unwrap() <= PAGE_FIRST as u64);
        }
        assert_eq!(variables(&http, 0)["first"], 50, "a first page asks for one more than it shows, in one request");

        // A server that always says there is more is read only so far.
        let endless = FakeHttp::new().on("query List", 200, &batch(0..1, true));
        page(&endless, Filter { search: Some("x".into()), page: TICKETS_PAGE_MAX, ..Filter::default() }).unwrap();
        assert_eq!(endless.seen().len(), PAGES_MAX);
    }

    const ISSUE: &str = r#"{"issue":{"id":"a1","title":"Fix login","url":"https://linear.app/ws/issue/ENG-1/fix","updatedAt":"2026-01-02T03:04:05.000Z",
        "state":{"name":"Todo","type":"unstarted"},"labels":{"nodes":[]},"assignee":null,"team":{"id":"t1"},"project":null,"cycle":null,
        "description":"It fails\u200b\nbadly\u001b[0m",
        "comments":{"nodes":[{"body":"Same\u202e here","createdAt":"2026-01-02T04:00:00.000Z","user":{"displayName":"bo"}},{"body":"bot says","createdAt":"2026-01-02T05:00:00.000Z","user":null}]},
        "inverseRelations":{"nodes":[{"type":"blocks","issue":{"id":"b9"}},{"type":"related","issue":{"id":"b8"}},{"type":"blocks","issue":{"id":"bad id"}},{"type":"duplicate","issue":{"id":"b7"}}]},
        "attachments":{"nodes":[{"url":"https://github.com/o/r/pull/12"},{"url":"https://slack.com/x"},{"url":"javascript:alert(1)"}]}}}"#;

    #[test]
    fn one_issue_comes_with_its_comments_pull_requests_and_blockers() {
        let http = FakeHttp::new().on("query One", 200, &data(ISSUE));
        let ticket = one(&http, "linear:issue.a1").unwrap();
        assert_eq!(ticket.summary.id, "linear:issue.a1");
        assert_eq!(ticket.body, "It fails\nbadly[0m");
        let comments: Vec<_> = ticket.comments.iter().map(|c| (c.author.as_str(), c.body.as_str())).collect();
        assert_eq!(comments, [("bo", "Same here"), ("", "bot says")]);
        assert_eq!(ticket.links, ["https://github.com/o/r/pull/12"]);
        assert_eq!(ticket.blocked_by, ["linear:issue.b9"]);
        assert_eq!(variables(&http, 0), json!({ "id": "a1" }));
    }

    #[test]
    fn the_comments_of_a_long_issue_are_capped_and_it_says_so() {
        let many: Vec<String> = (0..TICKET_COMMENTS_MAX + 1).map(|n| format!(r#"{{"body":"c{n}","createdAt":"","user":null}}"#)).collect();
        let issue = ISSUE.replace(r#""comments":{"nodes":[{"body":"Same\u202e here","createdAt":"2026-01-02T04:00:00.000Z","user":{"displayName":"bo"}},{"body":"bot says","createdAt":"2026-01-02T05:00:00.000Z","user":null}]}"#, &format!(r#""comments":{{"nodes":[{}]}}"#, many.join(",")));
        let http = FakeHttp::new().on("query One", 200, &data(&issue));
        let ticket = one(&http, "linear:issue.a1").unwrap();
        assert_eq!((ticket.comments.len(), ticket.comments_more), (TICKET_COMMENTS_MAX, true));
        assert!(http.seen()[0].body.as_deref().unwrap().contains(&format!("comments(first: {})", TICKET_COMMENTS_MAX + 1)));
    }

    #[test]
    fn an_issue_that_is_missing_another_or_not_an_id_is_refused() {
        let missing = FakeHttp::new().on("query One", 200, &data(r#"{"issue":null}"#));
        assert_eq!(one(&missing, "linear:issue.a1").unwrap_err(), TicketError::NotFound);
        let other = FakeHttp::new().on("query One", 200, &data(ISSUE));
        assert!(matches!(one(&other, "linear:issue.a2"), Err(TicketError::Invalid(_))), "Linear gave a1 for a2");
        for bad in ["linear:issue.", "linear:issue.../x", "linear:team.t1", "github:o/r#1", "linear:issue.a b", "linear:issue.a1\"}"] {
            assert!(matches!(one(&other, bad), Err(TicketError::Invalid(_))), "{bad}");
        }
        assert_eq!(other.seen().len(), 1, "only the one that could be an id was sent");
    }

    #[test]
    fn a_refused_key_a_rate_limit_an_outage_and_a_dead_network_are_each_their_own_fixed_answer() {
        let bad_key = |status, body: &str| groups(&FakeHttp::new().on("query Groups", status, body)).unwrap_err();
        assert_eq!(bad_key(401, ""), TicketError::SignedOut);
        assert_eq!(bad_key(400, r#"{"errors":[{"message":"Authentication required, not authenticated lin_api_SECRETVALUE0123456789","extensions":{"type":"authentication error","code":"AUTHENTICATION_ERROR"}}]}"#), TicketError::SignedOut);
        assert_eq!(bad_key(200, r#"{"errors":[{"extensions":{"code":"FORBIDDEN"}}],"data":null}"#), TicketError::SignedOut);
        assert_eq!(bad_key(400, r#"{"errors":[{"extensions":{"code":"RATELIMITED","type":"Ratelimited"}}]}"#), TicketError::RateLimited);
        assert_eq!(bad_key(429, ""), TicketError::RateLimited);
        assert!(matches!(bad_key(503, "<html>"), TicketError::Unreachable(line) if line == "The server had an error"));
        assert!(matches!(bad_key(200, r#"{"errors":[{"message":"Field x is not defined"}]}"#), TicketError::Invalid(line) if line == "Linear did not accept the request"));
        let gone = FakeHttp::new().fail("query Groups", HttpError::Unreachable("The server could not be reached"));
        assert!(matches!(groups(&gone).unwrap_err(), TicketError::Unreachable(line) if line == "The server could not be reached"));
    }

    #[test]
    fn an_answer_that_is_not_json_or_is_too_large_is_one_fixed_line() {
        assert_eq!(groups(&FakeHttp::new().on("query Groups", 200, "<html>")).unwrap_err(), TicketError::Invalid("The server did not give tickets".into()));
        assert!(matches!(groups(&FakeHttp::new().on("query Groups", 200, "{}")).unwrap_err(), TicketError::Invalid(_)), "no data");
        assert!(matches!(groups(&FakeHttp::new().on("query Groups", 200, r#"{"data":null}"#)).unwrap_err(), TicketError::Invalid(_)));
        assert!(matches!(groups(&FakeHttp::new().fail("query Groups", HttpError::TooLarge)).unwrap_err(), TicketError::Invalid(line) if line.contains("larger")));
    }

    #[test]
    fn hidden_and_hostile_text_is_cleaned_and_cut_before_it_leaves() {
        let long = "y".repeat(2 * maitty_shared::tickets::TICKET_TITLE_MAX_CHARS);
        let issues = format!(
            r#"{{"issues":{{"nodes":[{{"id":"a1","title":"a\u202eb\u200bc\u001b]0;pwn\u0007 {long}","state":{{"name":"T\u202eodo","type":"unstarted"}},"updatedAt":"<script>","url":"https://linear.app/\u202e"}}],"pageInfo":{{"hasNextPage":false}}}}}}"#
        );
        let http = FakeHttp::new().on("query List", 200, &data(&issues));
        let found = page(&http, Filter::default()).unwrap();
        let ticket = &found.tickets[0];
        assert!(ticket.title.starts_with("abc]0;pwn") && !ticket.title.contains(['\u{202e}', '\u{200b}', '\u{1b}', '\u{7}']), "{:?}", ticket.title);
        assert_eq!(ticket.title.chars().count(), maitty_shared::tickets::TICKET_TITLE_MAX_CHARS);
        assert_eq!((ticket.state.name.as_str(), ticket.updated_at.as_str(), ticket.url.as_str()), ("Todo", "", ""));
    }

    #[test]
    fn the_key_is_in_no_error_and_no_debug_output() {
        let scenarios = [
            FakeHttp::new().on("query", 401, KEY),
            FakeHttp::new().on("query", 500, KEY),
            FakeHttp::new().on("query", 200, KEY),
            FakeHttp::new().on("query", 400, &format!(r#"{{"errors":[{{"message":"{KEY}"}}]}}"#)),
            FakeHttp::new().on("query", 200, &format!(r#"{{"data":{{"issue":{{"id":"{KEY}"}}}}}}"#)),
            FakeHttp::new().fail("query", HttpError::Unreachable("The server could not be reached")),
        ];
        for http in scenarios {
            for result in [groups(&http).map(drop), page(&http, Filter::default()).map(drop), one(&http, "linear:issue.a1").map(drop)] {
                // An answer that happens to be well formed is no error; none that is one holds the key.
                if let Err(error) = result {
                    assert!(!format!("{error:?}").contains("SECRETVALUE"), "{error:?}");
                }
            }
            assert!(!format!("{:?}", http.seen()).contains("SECRETVALUE"), "a request prints without its key");
        }
        assert!(!format!("{:?}", saved()).contains("SECRETVALUE"));
    }
}
