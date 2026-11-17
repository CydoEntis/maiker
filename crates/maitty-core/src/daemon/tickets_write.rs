//! The only two writes the tickets feature makes: add a comment to a ticket, or close it. Never an
//! edit of a ticket's own words and never a delete.
//!
//! Nothing here runs unless a person confirmed it. The daemon refuses an agent's connection before
//! it gets here (`mod.rs`), and `perform` refuses a request whose `confirmed` is false before it
//! reads a key, starts `gh` or sends a byte: a refused write leaves the ticket as it was. The
//! comment is checked by `maitty_shared::tickets::clean_comment` and sent exactly as it was
//! checked, so what the person saw is what is written.
//!
//! GitHub goes through the user's own `gh` (`gh issue comment`, `gh issue close`). Plane goes over
//! REST with the kept key (a comment is a POST, closing is a PATCH of the work item to a state of
//! Plane's "completed" group). Linear goes over GraphQL (`commentCreate`, and `issueUpdate` to a
//! state of type "completed"). A write is never retried: a second attempt after an unclear failure
//! could comment twice. Every failure is one of the fixed lines the readers use; no ticket text,
//! no word of the provider's own error and no key is logged or put in an error. Not verified
//! against a live Plane or Linear, only against the shapes below, which are their public APIs as
//! documented.

use super::github::gh;
use super::ticket_http::{parse_json, status_error};
use super::ticket_keys::{KeyStore, Saved, is_workspace};
use super::tickets_github::{LIMIT, invalid, run};
use super::tickets_linear::{graphql, parse_issue};
use super::tickets_plane::{is_plane_id, parse_ticket};
use crate::http::{Http, Method, Request, check_base_url};
use maitty_shared::github::is_repo;
use maitty_shared::tickets::{TicketError, TicketProvider, TicketWrite, TicketWritten, parse_github_issue_id};
use serde_json::{Value, json};
use std::ffi::OsStr;

const LINEAR_COMMENT: &str = "mutation Comment($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }";
const LINEAR_STATES: &str = "query States($id: String!) { issue(id: $id) { team { states(first: 50) { nodes { id type } } } } }";
const LINEAR_CLOSE: &str = "mutation Close($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }";

/// Write `write` to ticket `id` of `source` when `confirmed`, with the real `gh`, `curl` and key store.
pub(super) fn perform(source: &str, id: &str, write: TicketWrite, confirmed: bool) -> Result<TicketWritten, TicketError> {
    perform_with(OsStr::new("gh"), &crate::curl_http::CurlHttp, &KeyStore::real(), source, id, write, confirmed)
}

fn perform_with(
    program: &OsStr,
    http: &dyn Http,
    store: &KeyStore,
    source: &str,
    id: &str,
    write: TicketWrite,
    confirmed: bool,
) -> Result<TicketWritten, TicketError> {
    if !confirmed {
        return Err(invalid("The write was not confirmed"));
    }
    let write = write.checked()?;
    let Some(provider) = TicketProvider::from_source(source) else {
        return github(program, source, id, &write);
    };
    let saved = store.load(provider)?.ok_or(TicketError::NotInstalled)?;
    match provider {
        TicketProvider::Plane => plane(http, &saved, id, &write),
        TicketProvider::Linear => linear(http, &saved, id, &write),
    }
}

fn github(program: &OsStr, source: &str, id: &str, write: &TicketWrite) -> Result<TicketWritten, TicketError> {
    if !is_repo(source) {
        return Err(invalid("That is not a GitHub repository"));
    }
    let number = match parse_github_issue_id(id) {
        Some((repo, number)) if repo == source => number.to_string(),
        _ => return Err(invalid("That is not an issue of this repository")),
    };
    let mut command = gh(program);
    // The text is joined to its flag, so it can never be read as a flag of its own.
    match write {
        TicketWrite::Comment { text } => command.args(["issue", "comment", &number, "--repo", source]).arg(format!("--body={text}")),
        TicketWrite::Close => command.args(["issue", "close", &number, "--repo", source]),
    };
    run(&mut command, LIMIT)?;
    Ok(written(write))
}

fn written(write: &TicketWrite) -> TicketWritten {
    match write {
        TicketWrite::Comment { .. } => TicketWritten::Commented,
        TicketWrite::Close => TicketWritten::Closed,
    }
}

/// `text` as the HTML Plane keeps a comment in: each line a paragraph, every character that is
/// markup escaped, so the words can never become a tag.
fn plane_html(text: &str) -> String {
    let mut html = String::with_capacity(text.len() + 16);
    for line in text.split('\n') {
        html.push_str("<p>");
        for c in line.chars() {
            match c {
                '&' => html.push_str("&amp;"),
                '<' => html.push_str("&lt;"),
                '>' => html.push_str("&gt;"),
                '"' => html.push_str("&quot;"),
                '\'' => html.push_str("&#39;"),
                c => html.push(c),
            }
        }
        html.push_str("</p>");
    }
    html
}

/// One Plane call that changes something: sent once, whatever the answer.
fn plane_send(http: &dyn Http, saved: &Saved, method: Method, path: &str, body: Option<Value>) -> Result<Value, TicketError> {
    let request = Request {
        method,
        url: format!("{}/api/v1/workspaces/{}/{path}", saved.address, saved.workspace),
        body: body.map(|body| body.to_string()),
        key_header: "X-API-Key",
        key: saved.key.clone(),
    };
    let response = http.send(&request)?;
    match response.status {
        200..=299 => Ok(parse_json(&response.body).unwrap_or(Value::Null)),
        other => Err(status_error(other)),
    }
}

fn plane(http: &dyn Http, saved: &Saved, id: &str, write: &TicketWrite) -> Result<TicketWritten, TicketError> {
    // The key goes only where it may: checked again here, whatever the file held.
    check_base_url(&saved.address).map_err(invalid)?;
    if !is_workspace(&saved.workspace) {
        return Err(invalid("The workspace is not usable"));
    }
    let (project, issue) = parse_ticket(id).ok_or_else(|| invalid("That is not a Plane work item"))?;
    match write {
        TicketWrite::Comment { text } => {
            plane_send(http, saved, Method::Post, &format!("projects/{project}/issues/{issue}/comments/"), Some(json!({ "comment_html": plane_html(text) })))?;
        }
        TicketWrite::Close => {
            let states = plane_send(http, saved, Method::Get, &format!("projects/{project}/states/"), None)?;
            let entries = states.as_array().or_else(|| states.get("results").and_then(Value::as_array)).map_or(&[][..], Vec::as_slice);
            let done = entries
                .iter()
                .find(|state| state.get("group").and_then(Value::as_str) == Some("completed"))
                .and_then(|state| state.get("id").and_then(Value::as_str))
                .filter(|state| is_plane_id(state))
                .ok_or_else(|| invalid("The project has no finished state"))?;
            plane_send(http, saved, Method::Patch, &format!("projects/{project}/issues/{issue}/"), Some(json!({ "state": done })))?;
        }
    }
    Ok(written(write))
}

/// A mutation's answer is a success only when Linear says `success: true` under `field`.
fn succeeded(data: &Value, field: &str) -> Result<(), TicketError> {
    match data.get(field).and_then(|done| done.get("success")).and_then(Value::as_bool) {
        Some(true) => Ok(()),
        _ => Err(invalid("Linear did not accept the change")),
    }
}

fn linear(http: &dyn Http, saved: &Saved, id: &str, write: &TicketWrite) -> Result<TicketWritten, TicketError> {
    let issue = parse_issue(id).ok_or_else(|| invalid("That is not a Linear issue"))?;
    match write {
        TicketWrite::Comment { text } => {
            let data = graphql(http, saved, LINEAR_COMMENT, json!({ "issueId": issue, "body": text }))?;
            succeeded(&data, "commentCreate")?;
        }
        TicketWrite::Close => {
            let data = graphql(http, saved, LINEAR_STATES, json!({ "id": issue }))?;
            let states = data.get("issue").and_then(|issue| issue.get("team")).and_then(|team| team.get("states")).and_then(|states| states.get("nodes")).and_then(Value::as_array);
            let done = states
                .into_iter()
                .flatten()
                .find(|state| state.get("type").and_then(Value::as_str) == Some("completed"))
                .and_then(|state| state.get("id").and_then(Value::as_str))
                .filter(|state| !state.is_empty() && state.len() <= 64 && state.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
                .ok_or_else(|| invalid("The team has no finished state"))?;
            let data = graphql(http, saved, LINEAR_CLOSE, json!({ "id": issue, "stateId": done }))?;
            succeeded(&data, "issueUpdate")?;
        }
    }
    Ok(written(write))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::persist::{ScratchDir, scratch_dir};
    use crate::http::fake::FakeHttp;
    use maitty_shared::protocol::{SecretText, TicketKeyChange};
    use maitty_shared::tickets::TICKET_COMMENT_MAX_CHARS;
    use std::path::{Path, PathBuf};

    const PLANE_KEY: &str = "plane_api_SECRETVALUE0123456789";
    const LINEAR_KEY: &str = "lin_api_SECRETVALUE0123456789";

    fn comment(text: &str) -> TicketWrite {
        TicketWrite::Comment { text: text.into() }
    }

    /// A key store with both providers' keys kept.
    fn keyed() -> (ScratchDir, KeyStore) {
        let root = scratch_dir();
        let store = KeyStore::at(root.path().join("ticket-keys"));
        let set = |provider, address: &str, workspace: &str, key: &str| {
            super::super::ticket_keys::change(&store, TicketKeyChange::Set { provider, address: address.into(), workspace: workspace.into(), key: SecretText(key.into()) }).unwrap();
        };
        set(TicketProvider::Plane, "https://plane.example.com", "ws", PLANE_KEY);
        set(TicketProvider::Linear, "", "", LINEAR_KEY);
        (root, store)
    }

    /// A program called `gh` that records each question to `args.txt` beside it and succeeds.
    fn fake_gh(root: &Path) -> PathBuf {
        std::fs::create_dir_all(root).unwrap();
        if cfg!(windows) {
            let program = root.join("gh.cmd");
            std::fs::write(&program, "@echo off\r\n>>\"%~dp0args.txt\" echo %*\r\n").unwrap();
            program
        } else {
            let program = root.join("gh");
            crate::test_support::write_program(&program, "#!/bin/sh\necho \"$@\" >> \"$(dirname \"$0\")/args.txt\"\n");
            program
        }
    }

    fn asked(root: &Path) -> Vec<String> {
        let text = std::fs::read_to_string(root.join("args.txt")).unwrap_or_default().replace('"', "");
        text.lines().map(|line| line.trim().to_owned()).filter(|line| !line.is_empty()).collect()
    }

    fn write(http: &FakeHttp, store: &KeyStore, program: &Path, source: &str, id: &str, write: TicketWrite, confirmed: bool) -> Result<TicketWritten, TicketError> {
        perform_with(program.as_os_str(), http, store, source, id, write, confirmed)
    }

    #[test]
    fn a_write_that_was_not_confirmed_touches_nothing_for_any_provider() {
        let (root, store) = keyed();
        let program = fake_gh(&root.path().join("bin"));
        let http = FakeHttp::new().on("", 200, "{}");
        let cases = [("me/widgets", "github:me/widgets#1"), ("plane", "plane:p1#i1"), ("linear", "linear:issue.a1")];
        for (source, id) in cases {
            for what in [comment("hello"), TicketWrite::Close] {
                let refused = write(&http, &store, &program, source, id, what, false);
                assert_eq!(refused, Err(TicketError::Invalid("The write was not confirmed".into())), "{source}");
            }
        }
        assert!(http.seen().is_empty(), "no request was sent");
        assert!(asked(&root.path().join("bin")).is_empty(), "gh was never started");
    }

    #[test]
    fn a_comment_that_is_not_fit_is_refused_before_anything_is_sent() {
        let (root, store) = keyed();
        let program = fake_gh(&root.path().join("bin"));
        let http = FakeHttp::new().on("", 200, "{}");
        for bad in ["", "   ", "tab\there", "hidden\u{200b}", &"x".repeat(TICKET_COMMENT_MAX_CHARS + 1)] {
            let refused = write(&http, &store, &program, "plane", "plane:p1#i1", comment(bad), true);
            assert!(matches!(refused, Err(TicketError::Invalid(_))), "{bad:?}");
        }
        assert!(http.seen().is_empty());
        assert!(asked(&root.path().join("bin")).is_empty());
    }

    #[test]
    fn github_comments_and_closes_through_gh_with_the_text_joined_to_its_flag() {
        let (root, store) = keyed();
        let bin = root.path().join("bin");
        let program = fake_gh(&bin);
        let http = FakeHttp::new();
        assert_eq!(write(&http, &store, &program, "me/widgets", "github:me/widgets#12", comment("  --web looks fixed  "), true), Ok(TicketWritten::Commented));
        assert_eq!(write(&http, &store, &program, "me/widgets", "github:me/widgets#12", TicketWrite::Close, true), Ok(TicketWritten::Closed));
        assert_eq!(asked(&bin), ["issue comment 12 --repo me/widgets --body=--web looks fixed", "issue close 12 --repo me/widgets"]);
        assert!(http.seen().is_empty());
    }

    #[test]
    fn an_issue_that_is_not_of_the_repository_is_refused_and_a_gh_that_fails_is_a_typed_error() {
        let (root, store) = keyed();
        let bin = root.path().join("bin");
        let program = fake_gh(&bin);
        let http = FakeHttp::new();
        for (source, id) in [("me/widgets", "github:other/repo#12"), ("me/widgets", "github:me/widgets!3"), ("me/widgets", "plane:p1#i1"), ("not a repo", "github:me/widgets#1")] {
            let refused = write(&http, &store, &program, source, id, TicketWrite::Close, true);
            assert!(matches!(refused, Err(TicketError::Invalid(_))), "{id}");
        }
        assert!(asked(&bin).is_empty());

        let missing = write(&http, &store, &root.path().join("no-such-gh"), "me/widgets", "github:me/widgets#1", TicketWrite::Close, true);
        assert_eq!(missing, Err(TicketError::NotInstalled));
    }

    #[test]
    fn a_provider_with_no_key_kept_is_not_written_to() {
        let root = scratch_dir();
        let store = KeyStore::at(root.path().join("ticket-keys"));
        let http = FakeHttp::new().on("", 200, "{}");
        let program = fake_gh(&root.path().join("bin"));
        for (source, id) in [("plane", "plane:p1#i1"), ("linear", "linear:issue.a1")] {
            assert_eq!(write(&http, &store, &program, source, id, comment("hi"), true), Err(TicketError::NotInstalled));
        }
        assert!(http.seen().is_empty());
    }

    #[test]
    fn plane_comments_with_escaped_html_once_and_closes_by_a_completed_state() {
        let (root, store) = keyed();
        let program = fake_gh(&root.path().join("bin"));
        let http = FakeHttp::new().on("p1/issues/i1/comments/", 201, r#"{"id":"c1"}"#);
        let said = "Done <b>now</b> & \"ok\"\nsecond line";
        assert_eq!(write(&http, &store, &program, "plane", "plane:p1#i1", comment(said), true), Ok(TicketWritten::Commented));
        let seen = http.seen();
        assert_eq!(seen.len(), 1);
        assert_eq!((seen[0].method, seen[0].url.as_str(), seen[0].key_header, seen[0].key.expose()), (Method::Post, "https://plane.example.com/api/v1/workspaces/ws/projects/p1/issues/i1/comments/", "X-API-Key", PLANE_KEY));
        let body: Value = serde_json::from_str(seen[0].body.as_deref().unwrap()).unwrap();
        assert_eq!(body["comment_html"], "<p>Done &lt;b&gt;now&lt;/b&gt; &amp; &quot;ok&quot;</p><p>second line</p>");

        let http = FakeHttp::new()
            .on("projects/p1/states/", 200, r#"{"results":[{"id":"s-todo","group":"unstarted"},{"id":"s-done","group":"completed"},{"id":"s-no","group":"cancelled"}]}"#)
            .on("projects/p1/issues/i1/", 200, "{}");
        assert_eq!(write(&http, &store, &program, "plane", "plane:p1#i1", TicketWrite::Close, true), Ok(TicketWritten::Closed));
        let seen = http.seen();
        assert_eq!((seen[0].method, seen[1].method), (Method::Get, Method::Patch));
        assert_eq!(seen[1].url, "https://plane.example.com/api/v1/workspaces/ws/projects/p1/issues/i1/");
        assert_eq!(seen[1].body.as_deref(), Some(r#"{"state":"s-done"}"#));
    }

    #[test]
    fn plane_failures_are_fixed_lines_and_a_write_is_never_retried() {
        let (root, store) = keyed();
        let program = fake_gh(&root.path().join("bin"));
        let go = |http: &FakeHttp, what| write(http, &store, &program, "plane", "plane:p1#i1", what, true);
        let limited = FakeHttp::new().on("comments/", 429, "slow down");
        assert_eq!(go(&limited, comment("hi")), Err(TicketError::RateLimited));
        assert_eq!(limited.seen().len(), 1);
        assert_eq!(go(&FakeHttp::new().on("comments/", 403, ""), comment("hi")), Err(TicketError::SignedOut));
        assert_eq!(go(&FakeHttp::new().on("comments/", 404, ""), comment("hi")), Err(TicketError::NotFound));
        assert!(matches!(go(&FakeHttp::new().fail("comments/", crate::http::HttpError::Unreachable("The server could not be reached")), comment("hi")), Err(TicketError::Unreachable(_))));
        // No finished state to move to: nothing is patched.
        let none = FakeHttp::new().on("states/", 200, r#"[{"id":"s1","group":"started"}]"#);
        assert!(matches!(go(&none, TicketWrite::Close), Err(TicketError::Invalid(_))));
        assert_eq!(none.seen().len(), 1);
        for id in ["plane:p1", "plane:../x#i1", "linear:issue.a1"] {
            assert!(matches!(write(&none, &store, &program, "plane", id, TicketWrite::Close, true), Err(TicketError::Invalid(_))), "{id}");
        }
    }

    #[test]
    fn linear_comments_and_closes_with_variables_to_the_one_server() {
        let (root, store) = keyed();
        let program = fake_gh(&root.path().join("bin"));
        let http = FakeHttp::new().on("mutation Comment", 200, r#"{"data":{"commentCreate":{"success":true}}}"#);
        let said = "mutation { evil } \"quoted\"";
        assert_eq!(write(&http, &store, &program, "linear", "linear:issue.a1", comment(said), true), Ok(TicketWritten::Commented));
        let seen = http.seen();
        assert_eq!((seen[0].url.as_str(), seen[0].key_header, seen[0].key.expose(), seen[0].method), ("https://api.linear.app/graphql", "Authorization", LINEAR_KEY, Method::Post));
        let body: Value = serde_json::from_str(seen[0].body.as_deref().unwrap()).unwrap();
        assert_eq!((body["variables"]["issueId"].as_str(), body["variables"]["body"].as_str()), (Some("a1"), Some(said)));
        assert!(!body["query"].as_str().unwrap().contains("evil"), "typed text is a variable, never query text");

        let http = FakeHttp::new()
            .on("query States", 200, r#"{"data":{"issue":{"team":{"states":{"nodes":[{"id":"st-1","type":"started"},{"id":"st-2","type":"completed"}]}}}}}"#)
            .on("mutation Close", 200, r#"{"data":{"issueUpdate":{"success":true}}}"#);
        assert_eq!(write(&http, &store, &program, "linear", "linear:issue.a1", TicketWrite::Close, true), Ok(TicketWritten::Closed));
        let variables: Value = serde_json::from_str::<Value>(http.seen()[1].body.as_deref().unwrap()).unwrap()["variables"].clone();
        assert_eq!(variables, json!({ "id": "a1", "stateId": "st-2" }));
    }

    #[test]
    fn linear_that_does_not_say_success_or_refuses_the_key_is_a_typed_error() {
        let (root, store) = keyed();
        let program = fake_gh(&root.path().join("bin"));
        let go = |http: &FakeHttp, what| write(http, &store, &program, "linear", "linear:issue.a1", what, true);
        let no = FakeHttp::new().on("mutation Comment", 200, r#"{"data":{"commentCreate":{"success":false}}}"#);
        assert!(matches!(go(&no, comment("hi")), Err(TicketError::Invalid(_))));
        let refused = FakeHttp::new().on("mutation Comment", 400, r#"{"errors":[{"extensions":{"code":"AUTHENTICATION_ERROR"}}]}"#);
        assert_eq!(go(&refused, comment("hi")), Err(TicketError::SignedOut));
        let none = FakeHttp::new().on("query States", 200, r#"{"data":{"issue":{"team":{"states":{"nodes":[{"id":"st-1","type":"started"}]}}}}}"#);
        assert!(matches!(go(&none, TicketWrite::Close), Err(TicketError::Invalid(_))));
        assert_eq!(none.seen().len(), 1, "nothing is updated without a finished state");
        assert!(matches!(write(&none, &store, &program, "linear", "linear:issue.../x", TicketWrite::Close, true), Err(TicketError::Invalid(_))));
    }

    #[test]
    fn the_key_is_in_no_error_and_no_debug_output() {
        let (root, store) = keyed();
        let program = fake_gh(&root.path().join("bin"));
        let http = FakeHttp::new().on("comments/", 500, PLANE_KEY);
        let error = write(&http, &store, &program, "plane", "plane:p1#i1", comment("hi"), true).unwrap_err();
        assert!(!format!("{error:?} {:?}", http.seen()).contains("SECRETVALUE"));
    }
}
