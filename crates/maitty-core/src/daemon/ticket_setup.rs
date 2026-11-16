//! An agent asks for its project's ticket setup (`Command::OpenTicketSetup`): the windows open it
//! with what the agent suggests, and you finish it there. The agent never gives or gets a key and
//! saves nothing; what it hears back is what was opened and what is already linked or connected,
//! as plain words.

use super::{ClientId, Daemon, Ev, ticket_links};
use crate::protocol::{Reply, ServerMsg, TermId};
use anyhow::{Result, bail};
use maitty_shared::ticket_links::{GitHubLink, TicketLink, TicketLinkChange, TicketPlace, TicketSetupAsk, TicketSetupSource, clean_suggested_link, trimmed_folder};
use maitty_shared::tickets::{TicketKeyState, TicketProvider};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// How long one project's setup is not opened again: an agent that asks twice in a row opens it once.
const AGAIN_AFTER: Duration = Duration::from_secs(5);

/// What was read for an ask: the project's folder, what it reads, and which keys are saved.
pub(super) type Found = (String, TicketLink, Vec<TicketKeyState>);

/// When each project's setup was last opened for an agent.
#[derive(Default)]
pub(super) struct Shown(HashMap<String, Instant>);

impl Shown {
    /// Whether `folder`'s setup may open now; marks it opened when it may.
    fn may_open(&mut self, folder: &str, now: Instant) -> bool {
        self.0.retain(|_, at| now.duration_since(*at) < AGAIN_AFTER);
        if self.0.contains_key(folder) {
            return false;
        }
        self.0.insert(folder.to_owned(), now);
        true
    }
}

/// The project of `pane_folder`, or of `asked` when it is inside the same project; why not, else.
fn project_for(pane_folder: &Path, asked: Option<&str>, main_checkout: impl Fn(&Path) -> Option<PathBuf>) -> Result<String, String> {
    let project_of = |folder: &Path| main_checkout(folder).unwrap_or_else(|| folder.to_path_buf());
    let mine = project_of(pane_folder);
    let folder = match asked.map(str::trim).filter(|asked| !asked.is_empty()) {
        None => mine,
        Some(asked) => {
            let theirs = project_of(Path::new(asked));
            if theirs != mine {
                return Err("That folder is in another project; an agent sets up only its own project's tickets".into());
            }
            theirs
        }
    };
    Ok(trimmed_folder(&folder.to_string_lossy()).to_owned())
}

/// What is already set up, as the agent is told it: never a key, only whether one is saved.
fn status_words(project: &str, link: &TicketLink, keys: &[TicketKeyState], opened: bool) -> String {
    let key = |provider| keys.iter().any(|state: &TicketKeyState| state.provider == provider && state.set);
    let github = match &link.github {
        GitHubLink::Origin => "GitHub: the repository's origin".to_string(),
        GitHubLink::Repo(repo) => format!("GitHub: {repo}"),
        GitHubLink::Off => "GitHub: off".to_string(),
    };
    let keyed = |name: &str, provider, pick: Option<&maitty_shared::ticket_links::TicketPick>| match (key(provider), pick) {
        (false, _) => format!("{name}: not connected"),
        (true, None) => format!("{name}: connected, no project picked"),
        (true, Some(pick)) => format!("{name}: {}", pick.name),
    };
    let first = if opened {
        format!("Opened the ticket setup for {project} in Maitty. The user finishes it there: they paste any key into Maitty's own box, never into this chat, and pick the project. Nothing was saved.")
    } else {
        format!("The ticket setup for {project} was opened a moment ago; it is still waiting for the user in Maitty.")
    };
    format!(
        "{first}\nNow: {github}; {}; {}.",
        keyed("Plane", TicketProvider::Plane, link.plane.as_ref()),
        keyed("Linear", TicketProvider::Linear, link.linear.as_ref()),
    )
}

impl Daemon {
    /// Pane `term`'s agent asks for its project's ticket setup. The answer comes back to `client`
    /// once the project and what is set up are read (they block, so in the background).
    pub(super) fn open_ticket_setup(
        &mut self,
        client: ClientId,
        term: TermId,
        folder: Option<String>,
        source: Option<TicketSetupSource>,
        link: String,
    ) -> Result<()> {
        let Some(pane) = self.terms.get(&term) else {
            bail!("no pane {term}");
        };
        let pane_folder = pane.cwd.clone();
        let link = clean_suggested_link(&link);
        let tx = self.tx.clone();
        tokio::task::spawn_blocking(move || {
            let found = project_for(&pane_folder, folder.as_deref(), ticket_links::main_checkout).map(|folder| {
                let place = TicketPlace { machine: None, folder: folder.clone() };
                let links = ticket_links::change(&ticket_links::LinkStore::real(), Some(place), TicketLinkChange::Read, ticket_links::main_checkout, &ticket_links::RepoFiles::real());
                let keys = super::ticket_keys::KeyStore::real().states();
                let current = links.ok().and_then(|links| links.project).map(|project| project.link).unwrap_or_default();
                (folder, current, keys)
            });
            let _ = tx.blocking_send(Ev::TicketSetupRead { client, term, source, link, found });
        });
        Ok(())
    }

    /// The project is read: open its setup in the windows (unless it just was) and tell the agent.
    pub(super) fn ticket_setup_read(
        &mut self,
        client: ClientId,
        term: TermId,
        source: Option<TicketSetupSource>,
        link: String,
        found: Result<Found, String>,
    ) {
        let (folder, current, keys) = match found {
            Ok(found) => found,
            Err(why) => {
                self.send(client, ServerMsg::Error(why));
                return;
            }
        };
        let opened = self.ticket_setups.may_open(&folder, Instant::now());
        if opened {
            let ask = TicketSetupAsk { term, folder: folder.clone(), source, link }.cleaned();
            self.broadcast(|c| c.attach && c.from.is_none() && c.structured.is_none(), ServerMsg::TicketSetup(ask));
        }
        self.send(client, ServerMsg::Reply(Reply::Text(status_words(&folder, &current, &keys, opened))));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use maitty_shared::ticket_links::TicketPick;

    fn checkout(folder: &Path) -> Option<PathBuf> {
        match folder.to_str()? {
            "/repo" | "/repo/src" | "/wt/feature" => Some(PathBuf::from("/repo")),
            _ => None,
        }
    }

    #[test]
    fn an_agent_sets_up_only_its_own_project() {
        assert_eq!(project_for(Path::new("/wt/feature"), None, checkout), Ok("/repo".into()), "a worktree's project is its repository");
        assert_eq!(project_for(Path::new("/wt/feature"), Some("/repo/src"), checkout), Ok("/repo".into()));
        assert!(project_for(Path::new("/wt/feature"), Some("/elsewhere"), checkout).is_err());
        assert_eq!(project_for(Path::new("/notes/"), None, checkout), Ok("/notes".into()), "a folder outside git is its own project");
    }

    #[test]
    fn the_setup_opens_once_for_a_burst_of_asks() {
        let mut shown = Shown::default();
        let now = Instant::now();
        assert!(shown.may_open("/repo", now));
        assert!(!shown.may_open("/repo", now + Duration::from_secs(1)));
        assert!(shown.may_open("/other", now + Duration::from_secs(1)), "another project is its own");
        assert!(shown.may_open("/repo", now + AGAIN_AFTER + Duration::from_secs(1)));
    }

    #[test]
    fn the_agent_hears_what_is_set_up_and_never_a_key() {
        let keys = vec![
            TicketKeyState { provider: TicketProvider::Plane, set: true, address: "http://192.168.1.244".into(), workspace: "acme".into(), stored_in: maitty_shared::tickets::KeyStorage::Keychain },
            TicketKeyState { provider: TicketProvider::Linear, set: false, address: String::new(), workspace: String::new(), stored_in: maitty_shared::tickets::KeyStorage::File },
        ];
        let link = TicketLink { plane: Some(TicketPick { id: "plane:p1".into(), name: "Shop".into() }), ..TicketLink::default() };
        let said = status_words("/repo", &link, &keys, true);
        assert!(said.starts_with("Opened the ticket setup for /repo"), "{said}");
        assert!(said.contains("Plane: Shop") && said.contains("Linear: not connected") && said.contains("GitHub: the repository's origin"), "{said}");
        assert!(!said.contains("192.168"), "where a key points is not the agent's to know");
        assert!(status_words("/repo", &link, &keys, false).contains("a moment ago"));
    }
}
