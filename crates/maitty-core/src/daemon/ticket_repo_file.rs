//! A repository's `.maitty/tickets.toml`: which ticket sources it reads, committed with it so a
//! clone or a second computer needs only the keys. The file is the repository's, so it is read as
//! untrusted: every part is checked, a link you made here always wins over it, and it never
//! decides where a saved key is sent (a Plane entry is used only for the server and workspace
//! your own key is for).

use maitty_shared::ticket_links::{
    GitHubLink, REPO_TICKETS_FILE, REPO_TICKETS_NOTE_MAX_CHARS, REPO_TICKETS_NOTES_MAX, RepoTicketFile, TicketLink, TicketPick,
};
use maitty_shared::tickets::{TICKET_NAME_MAX_CHARS, TicketKeyState, TicketProvider, clean_line, is_ticket_id};
use serde::Deserialize;
use std::io::Read;
use std::path::Path;

/// The largest file read; a ticket file is a few lines.
const MAX_BYTES: u64 = 16 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Shape {
    #[serde(default)]
    github: Option<String>,
    #[serde(default)]
    plane: Option<PlaneShape>,
    #[serde(default)]
    linear: Option<LinearShape>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PlaneShape {
    address: String,
    workspace: String,
    project: String,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LinearShape {
    team: String,
    #[serde(default)]
    name: Option<String>,
}

/// The text of `root`'s ticket file: `None` when there is none, or why it is not read. A file or
/// folder that is a link is refused, so the file read is always inside the repository. Blocks.
pub(super) fn read_text(root: &Path) -> Option<Result<String, String>> {
    let folder = root.join(REPO_TICKETS_FILE).parent()?.to_path_buf();
    let path = root.join(REPO_TICKETS_FILE);
    match std::fs::symlink_metadata(&folder) {
        Err(_) => return None,
        Ok(meta) if !meta.is_dir() => return Some(Err(format!("{REPO_TICKETS_FILE} is not read: its folder is a link or a file"))),
        Ok(_) => {}
    }
    let meta = match std::fs::symlink_metadata(&path) {
        Err(_) => return None,
        Ok(meta) => meta,
    };
    if !meta.is_file() {
        return Some(Err(format!("{REPO_TICKETS_FILE} is not read: it is a link or a folder")));
    }
    if meta.len() > MAX_BYTES {
        return Some(Err(format!("{REPO_TICKETS_FILE} is not read: it is larger than {} KB", MAX_BYTES / 1024)));
    }
    let mut text = String::new();
    let read = std::fs::File::open(&path).and_then(|file| file.take(MAX_BYTES).read_to_string(&mut text));
    Some(read.map(|_| text).map_err(|_| format!("{REPO_TICKETS_FILE} could not be read")))
}

/// What a ticket file names, each part checked; what is not used is said in `notes`.
#[derive(Debug, Default, PartialEq)]
pub(super) struct Named {
    github: Option<String>,
    plane: Option<TicketPick>,
    linear: Option<TicketPick>,
    notes: Vec<String>,
}

fn note(notes: &mut Vec<String>, line: String) {
    if notes.len() < REPO_TICKETS_NOTES_MAX {
        notes.push(clean_line(&line, REPO_TICKETS_NOTE_MAX_CHARS));
    }
}

fn same_address(a: &str, b: &str) -> bool {
    a.trim().trim_end_matches('/').eq_ignore_ascii_case(b.trim().trim_end_matches('/'))
}

/// The file's text, checked against the keys saved here. Plane's project is taken only when your
/// Plane key is for the server and workspace the file names: the file never points a key elsewhere.
pub(super) fn parse(text: &str, keys: &[TicketKeyState]) -> Named {
    let mut named = Named::default();
    let shape: Shape = match toml::from_str(text) {
        Ok(shape) => shape,
        Err(_) => {
            note(&mut named.notes, format!("{REPO_TICKETS_FILE} is not read: it is not the shape Maiker reads"));
            return named;
        }
    };
    if let Some(repo) = shape.github {
        let repo = repo.trim();
        if maitty_shared::github::is_repo(repo) {
            named.github = Some(repo.to_owned());
        } else {
            note(&mut named.notes, "Its GitHub repository is not written owner/name, so it is not used".into());
        }
    }
    if let Some(plane) = shape.plane {
        let id = format!("plane:{}", plane.project.trim());
        let address = plane.address.trim().trim_end_matches('/');
        let key = keys.iter().find(|state| state.provider == TicketProvider::Plane && state.set);
        if !is_ticket_id(&id) || plane.project.contains(['#', '!', '/', '.', '_']) {
            note(&mut named.notes, "Its Plane project is not a project id, so it is not used".into());
        } else if crate::http::check_base_url(address).is_err() || !super::ticket_keys::is_workspace(plane.workspace.trim()) {
            note(&mut named.notes, "Its Plane address or workspace is not usable, so it is not used".into());
        } else {
            match key {
                None => note(&mut named.notes, format!("It names a Plane project at {address}, workspace {}: connect your Plane key there to read it", plane.workspace.trim())),
                Some(key) if !same_address(&key.address, address) || key.workspace != plane.workspace.trim() => note(
                    &mut named.notes,
                    format!("It names a Plane at {address}, workspace {}, not the one your key is for, so it is not used", plane.workspace.trim()),
                ),
                Some(_) => named.plane = Some(pick(id, plane.name.as_deref(), &plane.project)),
            }
        }
    }
    if let Some(linear) = shape.linear {
        let team = linear.team.trim();
        let id = format!("linear:team.{team}");
        if !team.is_empty() && team.len() <= 64 && team.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && is_ticket_id(&id) {
            named.linear = Some(pick(id, linear.name.as_deref(), team));
        } else {
            note(&mut named.notes, "Its Linear team is not a team id, so it is not used".into());
        }
    }
    named
}

fn pick(id: String, name: Option<&str>, fallback: &str) -> TicketPick {
    let name = clean_line(name.unwrap_or(""), TICKET_NAME_MAX_CHARS);
    TicketPick { id, name: if name.is_empty() { clean_line(fallback, TICKET_NAME_MAX_CHARS) } else { name } }
}

/// `local` with what the file names filling each source you did not link here, and which ones it
/// filled. A GitHub link you set (a repository or none) wins; following `origin`, the default, is
/// not setting one.
pub(super) fn merged(local: &TicketLink, named: Named) -> (TicketLink, RepoTicketFile) {
    let mut link = local.clone();
    let mut report = RepoTicketFile { notes: named.notes, ..RepoTicketFile::default() };
    if local.github == GitHubLink::Origin
        && let Some(repo) = named.github
    {
        link.github = GitHubLink::Repo(repo);
        report.github = true;
    }
    if local.plane.is_none() && named.plane.is_some() {
        link.plane = named.plane;
        report.plane = true;
    }
    if local.linear.is_none() && named.linear.is_some() {
        link.linear = named.linear;
        report.linear = true;
    }
    (link, report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plane_key(address: &str, workspace: &str) -> Vec<TicketKeyState> {
        vec![TicketKeyState { provider: TicketProvider::Plane, set: true, address: address.into(), workspace: workspace.into(), stored_in: maitty_shared::tickets::KeyStorage::Keychain }]
    }

    const FILE: &str = r#"
github = "acme/shop"

[plane]
address = "http://192.168.1.244/"
workspace = "acme"
project = "0d6c2f1e-1111-2222-3333-444455556666"
name = "Shop"

[linear]
team = "a1b2c3"
"#;

    #[test]
    fn a_file_names_each_source_checked() {
        let named = parse(FILE, &plane_key("http://192.168.1.244", "acme"));
        assert_eq!(named.github.as_deref(), Some("acme/shop"));
        assert_eq!(named.plane, Some(TicketPick { id: "plane:0d6c2f1e-1111-2222-3333-444455556666".into(), name: "Shop".into() }));
        assert_eq!(named.linear, Some(TicketPick { id: "linear:team.a1b2c3".into(), name: "a1b2c3".into() }));
        assert!(named.notes.is_empty(), "{:?}", named.notes);
    }

    #[test]
    fn a_plane_entry_never_points_your_key_at_another_server() {
        let elsewhere = parse(FILE, &plane_key("https://plane.evil.example", "acme"));
        assert_eq!(elsewhere.plane, None);
        assert!(elsewhere.notes[0].contains("not the one your key is for"), "{:?}", elsewhere.notes);
        let other_workspace = parse(FILE, &plane_key("http://192.168.1.244", "other"));
        assert_eq!(other_workspace.plane, None);
        let no_key = parse(FILE, &[]);
        assert_eq!(no_key.plane, None);
        assert!(no_key.notes[0].contains("connect your Plane key"), "{:?}", no_key.notes);
        let public_http = "[plane]\naddress = \"http://plane.example\"\nworkspace = \"acme\"\nproject = \"p1\"\n";
        assert_eq!(parse(public_http, &plane_key("http://plane.example", "acme")).plane, None, "plain http off your network is refused");
    }

    #[test]
    fn what_is_not_a_source_is_said_and_not_used() {
        let bad = "github = \"../etc\"\n[plane]\naddress = \"https://p.example\"\nworkspace = \"acme\"\nproject = \"p#1\"\n[linear]\nteam = \"a b\"\n";
        let named = parse(bad, &plane_key("https://p.example", "acme"));
        assert_eq!((named.github, named.plane, named.linear), (None, None, None));
        assert_eq!(named.notes.len(), 3);
        let unknown = parse("jira = \"x\"\n", &[]);
        assert!(unknown.notes[0].contains("not the shape"), "an unknown key is refused, never half read");
        let named = parse("[linear]\nteam = \"t1\"\nname = \"Eng\\u001b[31m\"\n", &[]);
        assert_eq!(named.linear.unwrap().name, "Eng[31m", "no escape survives in a name");
    }

    #[test]
    fn a_link_made_here_wins_and_the_file_fills_the_rest() {
        let named = parse(FILE, &plane_key("http://192.168.1.244", "acme"));
        let local = TicketLink { github: GitHubLink::Off, linear: Some(TicketPick { id: "linear:team.mine".into(), name: "Mine".into() }), plane: None };
        let (link, report) = merged(&local, named);
        assert_eq!(link.github, GitHubLink::Off, "GitHub turned off here stays off");
        assert_eq!(link.linear.as_ref().unwrap().id, "linear:team.mine");
        assert_eq!(link.plane.as_ref().unwrap().name, "Shop");
        assert_eq!((report.github, report.plane, report.linear), (false, true, false));
        let (link, report) = merged(&TicketLink::default(), parse(FILE, &[]));
        assert_eq!(link.github, GitHubLink::Repo("acme/shop".into()), "following origin is not a link, so the file's repository is read");
        assert!(report.github && !report.plane && report.linear);
    }

    #[test]
    fn the_file_is_read_only_inside_the_repository_and_only_when_small() {
        let root = std::env::temp_dir().join(format!("maitty-repo-tickets-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        assert!(read_text(&root).is_none(), "no repository, no file");
        std::fs::create_dir_all(root.join(".maitty")).unwrap();
        assert!(read_text(&root).is_none(), "no file is nothing to say");
        std::fs::write(root.join(REPO_TICKETS_FILE), FILE).unwrap();
        assert_eq!(read_text(&root), Some(Ok(FILE.to_owned())));
        std::fs::write(root.join(REPO_TICKETS_FILE), "#".repeat(MAX_BYTES as usize + 1)).unwrap();
        assert!(matches!(read_text(&root), Some(Err(why)) if why.contains("larger")));
        #[cfg(unix)]
        {
            let outside = root.with_extension("outside");
            std::fs::write(&outside, FILE).unwrap();
            std::fs::remove_file(root.join(REPO_TICKETS_FILE)).unwrap();
            std::os::unix::fs::symlink(&outside, root.join(REPO_TICKETS_FILE)).unwrap();
            assert!(matches!(read_text(&root), Some(Err(why)) if why.contains("link")), "a link out of the repository is not followed");
            std::fs::remove_file(outside).unwrap();
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
