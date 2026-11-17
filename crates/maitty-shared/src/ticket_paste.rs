//! A link pasted into ticket setup, read for what it names: a GitHub repository, a Plane
//! workspace (and project), or a Linear team. The text is untrusted: it is only ever split and
//! checked, never fetched, and what comes out is held to the shapes the links keep.
//! The desktop app reads the same links in `features/tickets/model/pastedLink.ts`.

use crate::github::is_repo;

/// The longest text read; a longer paste is refused, not cut.
pub const PASTED_LINK_MAX_CHARS: usize = 2048;
/// The longest Plane workspace slug taken.
const WORKSPACE_MAX_CHARS: usize = 64;
/// The longest Linear team key taken (Linear allows five; this leaves room).
const TEAM_KEY_MAX_CHARS: usize = 10;

const GITHUB_HOST: &str = "github.com";
const LINEAR_HOST: &str = "linear.app";
/// The path segment a Plane project's pages start with: `/<workspace>/projects/<id>/…`.
const PLANE_PROJECTS: &str = "projects";

/// What a pasted link names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PastedLink {
    /// `owner/name`.
    Github { repo: String },
    /// Where the Plane is (`http(s)://host[:port][/prefix]`), its workspace slug and, when the link
    /// was to a project, the project's id.
    Plane { address: String, workspace: String, project: Option<String> },
    /// The team's key, as in its issue keys (`ENG` of `ENG-123`).
    Linear { team_key: String },
}

/// What `text` names, or why it names nothing ticket setup can use, in a short plain sentence.
pub fn parse_ticket_link(text: &str) -> Result<PastedLink, &'static str> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Paste a link first");
    }
    if text.chars().count() > PASTED_LINK_MAX_CHARS || text.chars().any(char::is_control) {
        return Err("That is not a link");
    }
    if let Some(path) = text.strip_prefix("git@github.com:") {
        return github(path);
    }
    let (scheme, rest) = if let Some(rest) = text.strip_prefix("https://") {
        ("https", rest)
    } else if let Some(rest) = text.strip_prefix("http://") {
        ("http", rest)
    } else {
        return Err("A link starts with http:// or https://");
    };
    let rest = rest.split(['?', '#']).next().unwrap_or("");
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    if !is_host(host) {
        return Err("That link has no address Maiker can use");
    }
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let bare = host.to_ascii_lowercase();
    let bare = bare.strip_prefix("www.").unwrap_or(&bare);
    match bare {
        GITHUB_HOST => github(&segments.iter().take(2).copied().collect::<Vec<_>>().join("/")),
        LINEAR_HOST => linear(&segments),
        _ => plane(scheme, host, &segments),
    }
}

fn github(path: &str) -> Result<PastedLink, &'static str> {
    let repo = path.trim_end_matches('/');
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    if is_repo(repo) {
        Ok(PastedLink::Github { repo: repo.to_string() })
    } else {
        Err("That GitHub link names no repository")
    }
}

/// `linear.app/<org>/team/<KEY>/…` or `linear.app/<org>/issue/<KEY-123>/…`.
fn linear(segments: &[&str]) -> Result<PastedLink, &'static str> {
    let key = match segments {
        [_, "team", key, ..] => Some(*key),
        [_, "issue", issue, ..] => issue.split_once('-').map(|(key, _)| key),
        _ => None,
    };
    match key.filter(|key| is_team_key(key)) {
        Some(key) => Ok(PastedLink::Linear { team_key: key.to_ascii_uppercase() }),
        None => Err("That Linear link names no team: paste a link to a team or one of its issues"),
    }
}

/// `<address>/<workspace>/projects/<id>/…`, where the address may carry a path prefix, or
/// `<address>/<workspace>/…` with no project.
fn plane(scheme: &str, host: &str, segments: &[&str]) -> Result<PastedLink, &'static str> {
    let at = segments.iter().position(|s| *s == PLANE_PROJECTS);
    let (prefix, workspace, project) = match at {
        Some(at) if at >= 1 => (&segments[..at - 1], segments[at - 1], segments.get(at + 1).copied()),
        Some(_) => return Err("That Plane link names no workspace"),
        None => match segments.first() {
            Some(workspace) => (&segments[..0], *workspace, None),
            None => return Err("That link names no Plane workspace"),
        },
    };
    if !is_workspace(workspace) || prefix.iter().any(|s| !is_workspace(s)) {
        return Err("That link names no Plane workspace");
    }
    let project = match project {
        Some(id) if is_uuid(id) => Some(id.to_ascii_lowercase()),
        Some(_) => return Err("That Plane link names no project"),
        None => None,
    };
    let mut address = format!("{scheme}://{host}");
    for part in prefix {
        address.push('/');
        address.push_str(part);
    }
    Ok(PastedLink::Plane { address, workspace: workspace.to_string(), project })
}

/// A host with an optional port, IPv6 in brackets; never a user name or password.
fn is_host(host: &str) -> bool {
    !host.is_empty() && host.len() <= 255 && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'))
}

fn is_workspace(slug: &str) -> bool {
    !slug.is_empty() && slug.len() <= WORKSPACE_MAX_CHARS && slug.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

fn is_team_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= TEAM_KEY_MAX_CHARS && key.chars().all(|c| c.is_ascii_alphanumeric())
}

/// `8-4-4-4-12` hex digits, as Plane's ids are.
fn is_uuid(id: &str) -> bool {
    let parts: Vec<&str> = id.split('-').collect();
    parts.len() == 5
        && parts.iter().zip([8, 4, 4, 4, 12]).all(|(part, len)| part.len() == len && part.chars().all(|c| c.is_ascii_hexdigit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

    fn plane_of(address: &str, workspace: &str, project: Option<&str>) -> Result<PastedLink, &'static str> {
        Ok(PastedLink::Plane { address: address.into(), workspace: workspace.into(), project: project.map(Into::into) })
    }

    #[test]
    fn a_self_hosted_plane_project_link_gives_its_address_workspace_and_project() {
        let link = format!("http://192.168.1.244/ideayard/projects/{ID}/issues/");
        assert_eq!(parse_ticket_link(&link), plane_of("http://192.168.1.244", "ideayard", Some(ID)));
    }

    #[test]
    fn plane_cloud_a_port_and_a_path_prefix_are_kept_in_the_address() {
        assert_eq!(parse_ticket_link(&format!("https://app.plane.so/acme/projects/{ID}/cycles?x=1")), plane_of("https://app.plane.so", "acme", Some(ID)));
        assert_eq!(parse_ticket_link(&format!("https://pm.example.com:8443/plane/acme/projects/{ID}")), plane_of("https://pm.example.com:8443/plane", "acme", Some(ID)));
    }

    #[test]
    fn a_plane_link_with_no_project_gives_the_workspace() {
        assert_eq!(parse_ticket_link("https://app.plane.so/acme/"), plane_of("https://app.plane.so", "acme", None));
        assert_eq!(parse_ticket_link("  http://192.168.1.244/ideayard  "), plane_of("http://192.168.1.244", "ideayard", None));
    }

    #[test]
    fn linear_team_and_issue_links_give_the_team_key() {
        assert_eq!(parse_ticket_link("https://linear.app/acme/team/ENG/active"), Ok(PastedLink::Linear { team_key: "ENG".into() }));
        assert_eq!(parse_ticket_link("https://linear.app/acme/issue/eng-123/fix-login"), Ok(PastedLink::Linear { team_key: "ENG".into() }));
        assert!(parse_ticket_link("https://linear.app/acme/settings").is_err());
    }

    #[test]
    fn github_https_and_ssh_links_give_owner_and_name() {
        let repo = Ok(PastedLink::Github { repo: "CydoEntis/maiker".into() });
        assert_eq!(parse_ticket_link("https://github.com/CydoEntis/maiker/issues/12"), repo);
        assert_eq!(parse_ticket_link("https://github.com/CydoEntis/maiker.git"), repo);
        assert_eq!(parse_ticket_link("git@github.com:CydoEntis/maiker.git"), repo);
        assert!(parse_ticket_link("https://github.com/CydoEntis").is_err());
    }

    #[test]
    fn anything_else_is_refused_with_a_reason_and_never_panics() {
        for text in ["", "maiker", "ftp://x/y", "https://", "https://user:pw@host/ws", "https://host/ws/projects/not-an-id", "https://host/projects", "https://host/w%20s", "http://x/\u{7}"] {
            assert!(parse_ticket_link(text).is_err(), "{text:?} should be refused");
        }
        assert!(parse_ticket_link(&format!("https://h/{}", "a".repeat(PASTED_LINK_MAX_CHARS))).is_err());
    }
}
