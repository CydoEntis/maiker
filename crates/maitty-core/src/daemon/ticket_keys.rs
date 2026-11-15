//! The keys of the ticket providers that need one (Plane, Linear), kept by the daemon.
//!
//! One small file per provider, `<data folder>/ticket-keys/<provider>.json`: the folder is the
//! owner's alone (`0700`) and the file `0600` on unix, and on Windows it sits in the user's own app
//! data. It is never `config.toml` (which is synced), a repository, a log line, a snapshot, an
//! agent's environment or a reply to a client: a client can set a key or remove it and ask
//! only whether one is set and where it points. In the daemon the key is a `Secret`, which never
//! prints. Setting one is a human client's alone (the daemon refuses a pane and a structured
//! runtime before it gets here).

use super::usage_store::write_file;
use crate::http::{Secret, check_base_url};
use maitty_shared::protocol::TicketKeyChange;
use maitty_shared::tickets::{TICKET_ADDRESS_MAX_CHARS, TICKET_WORKSPACE_MAX_CHARS, TicketError, TicketKeyState, TicketProvider};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// The folder of keys inside the data folder.
const FOLDER: &str = "ticket-keys";
/// The shortest and longest a key may be. Real keys are 40 to 80 characters.
const KEY_MIN_CHARS: usize = 8;
const KEY_MAX_CHARS: usize = 200;
/// Linear has one server; the address of its key is not asked for.
pub(super) const LINEAR_ADDRESS: &str = "https://api.linear.app";

/// What is kept for one provider, as it sits on disk. It has no `Debug`: the key is in it.
#[derive(Serialize, Deserialize)]
struct OnDisk {
    #[serde(default)]
    address: String,
    #[serde(default)]
    workspace: String,
    key: String,
}

/// What a provider needs to make a request.
#[derive(Debug, Clone)]
pub(super) struct Saved {
    /// The server, with no trailing slash.
    pub(super) address: String,
    pub(super) workspace: String,
    pub(super) key: Secret,
}

pub(super) struct KeyStore {
    dir: PathBuf,
}

impl KeyStore {
    pub(super) fn real() -> KeyStore {
        KeyStore::at(crate::config::data_dir().join(FOLDER))
    }

    pub(super) fn at(dir: PathBuf) -> KeyStore {
        KeyStore { dir }
    }

    fn path(&self, provider: TicketProvider) -> PathBuf {
        self.dir.join(format!("{}.json", provider.name()))
    }

    /// The key kept for `provider`, `None` when there is none. A file that cannot be read is an
    /// error that tells the user to set the key again, never a key that is silently not there.
    pub(super) fn load(&self, provider: TicketProvider) -> Result<Option<Saved>, TicketError> {
        let text = match std::fs::read_to_string(self.path(provider)) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                tracing::warn!("couldn't read the {} key file: {:?}", provider.name(), error.kind());
                return Err(unreadable());
            }
        };
        let stored: OnDisk = serde_json::from_str(&text).map_err(|_| unreadable())?;
        Ok(Some(Saved { address: stored.address, workspace: stored.workspace, key: Secret::new(stored.key) }))
    }

    fn save(&self, provider: TicketProvider, saved: &Saved) -> Result<(), TicketError> {
        let stored = OnDisk { address: saved.address.clone(), workspace: saved.workspace.clone(), key: saved.key.expose().to_owned() };
        let bytes = serde_json::to_vec(&stored).map_err(|_| unwritable())?;
        write_file(&self.path(provider), &bytes).map_err(|error| {
            // The cause can name a path but never a key; only that it failed is kept.
            tracing::warn!("couldn't keep the {} key: {}", provider.name(), error.root_cause().to_string().chars().take(100).collect::<String>());
            unwritable()
        })
    }

    fn remove(&self, provider: TicketProvider) -> Result<(), TicketError> {
        match std::fs::remove_file(self.path(provider)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => {
                tracing::warn!("couldn't remove the {} key file: {:?}", provider.name(), error.kind());
                Err(unwritable())
            }
        }
    }

    /// Whether each provider has a key. A file that cannot be read shows as not set (and is
    /// logged), so the user can set it again.
    pub(super) fn states(&self) -> Vec<TicketKeyState> {
        TicketProvider::ALL
            .into_iter()
            .map(|provider| {
                let saved = self.load(provider).ok().flatten();
                let visible = |text: Option<String>| text.unwrap_or_default();
                TicketKeyState {
                    provider,
                    set: saved.is_some(),
                    // The address of Linear is fixed, so it is no setting to show.
                    address: visible(saved.as_ref().filter(|_| provider == TicketProvider::Plane).map(|saved| saved.address.clone())),
                    workspace: visible(saved.map(|saved| saved.workspace)),
                }
            })
            .collect()
    }
}

fn unreadable() -> TicketError {
    TicketError::Invalid("The saved key could not be read; set it again".into())
}

fn unwritable() -> TicketError {
    TicketError::Invalid("The key could not be saved".into())
}

fn invalid(line: &str) -> TicketError {
    TicketError::Invalid(line.into())
}

/// Whether `key` is the plain printable text of an API key.
fn is_key(key: &str) -> bool {
    (KEY_MIN_CHARS..=KEY_MAX_CHARS).contains(&key.len()) && key.chars().all(|c| c.is_ascii_graphic())
}

/// Whether `workspace` is a Plane workspace's slug.
pub(super) fn is_workspace(workspace: &str) -> bool {
    !workspace.is_empty() && workspace.len() <= TICKET_WORKSPACE_MAX_CHARS && workspace.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

/// What a client asked to keep for `provider`, checked, or the reason it is refused.
fn checked(provider: TicketProvider, address: &str, workspace: &str, key: &str) -> Result<Saved, TicketError> {
    if !is_key(key) {
        return Err(invalid("That is not an API key"));
    }
    let key = Secret::new(key);
    match provider {
        TicketProvider::Plane => {
            let address = address.trim().trim_end_matches('/');
            if address.len() > TICKET_ADDRESS_MAX_CHARS || address.contains(['?', '#']) {
                return Err(invalid("The server address is not usable"));
            }
            check_base_url(address).map_err(invalid)?;
            if !is_workspace(workspace) {
                return Err(invalid("The workspace is not usable"));
            }
            Ok(Saved { address: address.to_owned(), workspace: workspace.to_owned(), key })
        }
        TicketProvider::Linear => {
            if !address.is_empty() || !workspace.is_empty() {
                return Err(invalid("Linear needs only a key"));
            }
            Ok(Saved { address: LINEAR_ADDRESS.to_owned(), workspace: String::new(), key })
        }
    }
}

/// Do what a client asked and say where every provider's key stands afterwards. Blocks.
pub(super) fn change(store: &KeyStore, change: TicketKeyChange) -> Result<Vec<TicketKeyState>, TicketError> {
    match change {
        TicketKeyChange::Status => {}
        TicketKeyChange::Set { provider, address, workspace, key } => {
            let saved = checked(provider, &address, &workspace, &key.0)?;
            store.save(provider, &saved)?;
        }
        TicketKeyChange::Remove { provider } => store.remove(provider)?,
    }
    Ok(store.states())
}

#[cfg(test)]
mod tests {
    use super::*;
    use maitty_shared::protocol::SecretText;

    const KEY: &str = "plane_api_SECRETVALUE0123456789";

    fn plane(address: &str, workspace: &str, key: &str) -> TicketKeyChange {
        TicketKeyChange::Set { provider: TicketProvider::Plane, address: address.into(), workspace: workspace.into(), key: SecretText(key.into()) }
    }

    fn store() -> (crate::daemon::persist::ScratchDir, KeyStore) {
        let root = crate::daemon::persist::scratch_dir();
        let store = KeyStore::at(root.path().join(FOLDER));
        (root, store)
    }

    #[test]
    fn a_key_is_kept_and_read_back_by_the_daemon_and_a_client_learns_only_that_it_is_set() {
        let (_root, store) = store();
        let states = change(&store, TicketKeyChange::Status).unwrap();
        assert!(states.iter().all(|state| !state.set));

        let states = change(&store, plane("http://192.168.1.244/", "ideayard", KEY)).unwrap();
        let shown = states.iter().find(|state| state.provider == TicketProvider::Plane).unwrap();
        assert_eq!((shown.set, shown.address.as_str(), shown.workspace.as_str()), (true, "http://192.168.1.244", "ideayard"));
        assert!(!format!("{states:?}").contains("SECRETVALUE"), "no state carries the key");

        let saved = store.load(TicketProvider::Plane).unwrap().unwrap();
        assert_eq!(saved.key.expose(), KEY);
        assert!(!format!("{saved:?}").contains("SECRETVALUE"), "{saved:?}");
        assert!(store.load(TicketProvider::Linear).unwrap().is_none());

        let states = change(&store, TicketKeyChange::Remove { provider: TicketProvider::Plane }).unwrap();
        assert!(states.iter().all(|state| !state.set));
        // Removing what is not there is not an error.
        assert!(change(&store, TicketKeyChange::Remove { provider: TicketProvider::Plane }).is_ok());
    }

    #[test]
    fn linear_needs_a_key_alone_and_is_always_the_one_server() {
        let (_root, store) = store();
        let set = |address: &str, workspace: &str| TicketKeyChange::Set { provider: TicketProvider::Linear, address: address.into(), workspace: workspace.into(), key: SecretText("lin_api_ABCDEFGH123".into()) };
        assert!(change(&store, set("https://evil.example", "")).is_err(), "no other address for Linear's key");
        assert!(change(&store, set("", "w")).is_err());
        let states = change(&store, set("", "")).unwrap();
        let linear = states.iter().find(|state| state.provider == TicketProvider::Linear).unwrap();
        assert_eq!((linear.set, linear.address.as_str()), (true, ""));
        assert_eq!(store.load(TicketProvider::Linear).unwrap().unwrap().address, LINEAR_ADDRESS);
    }

    #[test]
    fn a_key_or_address_that_could_not_be_one_is_refused_and_nothing_is_written() {
        let (_root, store) = store();
        for (address, workspace, key) in [
            ("http://plane.example.com", "w", KEY),
            ("https://user:pass@plane.example.com", "w", KEY),
            ("https://plane.example.com?x=1", "w", KEY),
            ("ftp://plane", "w", KEY),
            ("https://plane.example.com", "", KEY),
            ("https://plane.example.com", "a/b", KEY),
            ("https://plane.example.com", "w", ""),
            ("https://plane.example.com", "w", "short"),
            ("https://plane.example.com", "w", "has a space in it 1234"),
            ("https://plane.example.com", "w", "line\nbreak12345"),
        ] {
            let error = change(&store, plane(address, workspace, key)).unwrap_err();
            assert!(matches!(error, TicketError::Invalid(_)), "{address} {workspace} {key:?}");
            assert!(key.is_empty() || !format!("{error:?}").contains(key), "{error:?}");
        }
        assert!(!store.dir.exists() || std::fs::read_dir(&store.dir).unwrap().next().is_none());
    }

    #[test]
    fn an_error_never_holds_the_key_even_when_it_is_the_address_that_is_wrong() {
        let (_root, store) = store();
        let error = change(&store, plane("http://plane.example.com", "w", KEY)).unwrap_err();
        assert!(!format!("{error:?}{error:?}").contains("SECRETVALUE"));
    }

    #[test]
    fn a_file_that_is_not_a_key_file_is_an_error_to_set_again_and_shows_as_not_set() {
        let (_root, store) = store();
        std::fs::create_dir_all(&store.dir).unwrap();
        std::fs::write(store.path(TicketProvider::Plane), "{ not json").unwrap();
        assert!(matches!(store.load(TicketProvider::Plane), Err(TicketError::Invalid(_))));
        assert!(store.states().iter().all(|state| !state.set));
        // Setting it again replaces the broken file.
        change(&store, plane("https://plane.example.com", "w", KEY)).unwrap();
        assert!(store.load(TicketProvider::Plane).unwrap().is_some());
    }

    #[cfg(unix)]
    #[test]
    fn the_folder_and_the_file_are_the_owners_alone() {
        use std::os::unix::fs::PermissionsExt;
        let (_root, store) = store();
        change(&store, plane("https://plane.example.com", "w", KEY)).unwrap();
        assert_eq!(std::fs::metadata(&store.dir).unwrap().permissions().mode() & 0o777, 0o700);
        assert_eq!(std::fs::metadata(store.path(TicketProvider::Plane)).unwrap().permissions().mode() & 0o777, 0o600);
    }
}
