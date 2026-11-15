//! Which ticket sources a project reads, kept by the daemon of the computer the tickets are read on
//! (`Query::TicketLinks`). A provider's key is set once for every project (`Query::TicketKeys`); a
//! link says which of its places one project reads: a GitHub repository (or none), a Plane project
//! and a Linear team. A project is a repository's main checkout, so every worktree of it reads the
//! same tickets, or a folder outside git. Nothing here is a secret.

use crate::tickets::{TICKET_NAME_MAX_CHARS, TicketProvider, clean_line, is_ticket_id};
use serde::{Deserialize, Serialize};

/// The longest folder a link is kept under.
pub const TICKET_LINK_FOLDER_MAX_CHARS: usize = 1024;
/// The longest machine name a link is kept under (a `[[machines]]` name).
pub const TICKET_LINK_MACHINE_MAX_CHARS: usize = 64;
/// The most projects one daemon keeps links for.
pub const TICKET_LINKS_MAX: usize = 500;

/// A Plane project or a Linear team a project reads: its id (`plane:<project>`, `linear:team.<id>`)
/// and the name it was picked by.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketPick {
    pub id: String,
    pub name: String,
}

impl TicketPick {
    /// This pick with its name clean, or `None` when its id is not a ticket id.
    pub fn checked(self) -> Option<TicketPick> {
        is_ticket_id(&self.id).then(|| TicketPick { id: self.id, name: clean_line(&self.name, TICKET_NAME_MAX_CHARS) })
    }
}

/// What GitHub source a project reads.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum GitHubLink {
    /// The repository the folder's `origin` names (the default: nothing to set up).
    #[default]
    Origin,
    /// This repository, `owner/name`.
    Repo(String),
    /// None: the project's tickets are not on GitHub.
    Off,
}

/// The sources one project reads.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct TicketLink {
    #[serde(default)]
    pub github: GitHubLink,
    #[serde(default)]
    pub plane: Option<TicketPick>,
    #[serde(default)]
    pub linear: Option<TicketPick>,
}

impl TicketLink {
    /// Whether this link says nothing beyond the defaults (and so is not kept).
    pub fn is_empty(&self) -> bool {
        self.github == GitHubLink::Origin && self.plane.is_none() && self.linear.is_none()
    }

    /// The pick for a keyed provider.
    pub fn pick(&self, provider: TicketProvider) -> Option<&TicketPick> {
        match provider {
            TicketProvider::Plane => self.plane.as_ref(),
            TicketProvider::Linear => self.linear.as_ref(),
        }
    }

    /// This link with every part checked: a repository that is not `owner/name` and a pick whose
    /// id is not a ticket id are refused, so nothing a client sent is kept unchecked.
    pub fn checked(self) -> Result<TicketLink, String> {
        let github = match self.github {
            GitHubLink::Repo(repo) if crate::github::is_repo(repo.trim()) => GitHubLink::Repo(repo.trim().to_owned()),
            GitHubLink::Repo(_) => return Err("A GitHub repository is written owner/name".into()),
            other => other,
        };
        let pick = |pick: Option<TicketPick>| match pick {
            None => Ok(None),
            Some(pick) => pick.checked().map(Some).ok_or_else(|| "That project or team is not one a provider gave".to_string()),
        };
        Ok(TicketLink { github, plane: pick(self.plane)?, linear: pick(self.linear)? })
    }
}

/// A project and what it reads. `machine` is the `[[machines]]` name of the computer the folder is
/// on, `None` for this one; `folder` is the project's root as that computer writes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkedProject {
    #[serde(default)]
    pub machine: Option<String>,
    pub folder: String,
    pub link: TicketLink,
}

/// The names you are known by in Plane and Linear, for Mine. GitHub's is the signed-in login.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct TicketMe {
    #[serde(default)]
    pub plane: String,
    #[serde(default)]
    pub linear: String,
}

impl TicketMe {
    pub fn of(&self, provider: TicketProvider) -> &str {
        match provider {
            TicketProvider::Plane => &self.plane,
            TicketProvider::Linear => &self.linear,
        }
    }
}

/// Where a project's link is asked about or changed: the folder a session works in, on `machine`
/// (`None`: this computer). This computer's folder is taken to its repository's main checkout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketPlace {
    #[serde(default)]
    pub machine: Option<String>,
    pub folder: String,
}

/// What a `Query::TicketLinks` does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TicketLinkChange {
    /// Change nothing.
    Read,
    /// Keep `link` for the place's project, replacing what it had.
    Set { place: TicketPlace, link: TicketLink },
    /// Forget the place's project's link: it reads its `origin` again and nothing else.
    Unlink { place: TicketPlace },
    /// Keep the name you are known by in a provider (empty forgets it).
    SetMe { provider: TicketProvider, name: String },
    /// Links a client kept before the daemon kept them: each is added unless that project already
    /// has one, and the names fill only names not set yet. Sent once per client.
    Import { projects: Vec<LinkedProject>, me: TicketMe },
}

/// The daemon's answer: the asked place's project (its root and link, empty when it has none),
/// every linked project, and your names.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct TicketLinks {
    #[serde(default)]
    pub project: Option<LinkedProject>,
    #[serde(default)]
    pub projects: Vec<LinkedProject>,
    #[serde(default)]
    pub me: TicketMe,
}

/// Whether `machine` could be a `[[machines]]` name: printable, one line, not too long.
pub fn is_machine_name(machine: &str) -> bool {
    !machine.is_empty() && machine.chars().count() <= TICKET_LINK_MACHINE_MAX_CHARS && !machine.chars().any(char::is_control)
}

/// Whether `folder` could be a folder a link is kept under: absolute on some computer, one line.
pub fn is_link_folder(folder: &str) -> bool {
    let absolute = folder.starts_with('/') || folder.starts_with("\\\\") || folder.as_bytes().get(1..3) == Some(b":\\") || folder.as_bytes().get(1..3) == Some(b":/");
    absolute && folder.chars().count() <= TICKET_LINK_FOLDER_MAX_CHARS && !folder.chars().any(char::is_control)
}

/// `folder` without the separators at its end (but `/` and `C:\` stay whole).
pub fn trimmed_folder(folder: &str) -> &str {
    let trimmed = folder.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() || trimmed.ends_with(':') { folder } else { trimmed }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_keeps_only_what_it_was_given_checked() {
        let good = TicketLink {
            github: GitHubLink::Repo(" me/shop ".into()),
            plane: Some(TicketPick { id: "plane:p1".into(), name: "Shop\u{1b}[31m".into() }),
            linear: None,
        };
        let kept = good.checked().unwrap();
        assert_eq!(kept.github, GitHubLink::Repo("me/shop".into()));
        assert_eq!(kept.plane.unwrap().name, "Shop[31m", "no escape survives in a name");
        let bad_repo = TicketLink { github: GitHubLink::Repo("not a repo".into()), ..TicketLink::default() };
        assert!(bad_repo.checked().is_err());
        let bad_pick = TicketLink { linear: Some(TicketPick { id: "no id here".into(), name: "x".into() }), ..TicketLink::default() };
        assert!(bad_pick.checked().is_err());
        assert!(TicketLink::default().is_empty());
        assert!(!TicketLink { github: GitHubLink::Off, ..TicketLink::default() }.is_empty());
    }

    #[test]
    fn a_link_folder_is_absolute_and_one_line() {
        assert!(is_link_folder("/home/me/shop"));
        assert!(is_link_folder("C:\\dev\\shop"));
        assert!(is_link_folder("C:/dev/shop"));
        assert!(!is_link_folder("shop"));
        assert!(!is_link_folder("/home/me/sh\nop"));
        assert_eq!(trimmed_folder("/home/me/shop/"), "/home/me/shop");
        assert_eq!(trimmed_folder("/"), "/");
        assert_eq!(trimmed_folder("C:\\"), "C:\\");
        assert!(is_machine_name("kingdom"));
        assert!(!is_machine_name(""));
    }
}
