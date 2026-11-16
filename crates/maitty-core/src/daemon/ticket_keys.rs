//! The keys of the ticket providers that need one (Plane, Linear), kept by the daemon.
//!
//! A key is kept in the system's keychain (`keychain`): Windows Credential Manager, the macOS
//! Keychain or the Secret Service, under an account named for the provider and this data folder,
//! so a second daemon with its own data folder (a test one beside the real one) never reads or
//! replaces this one's keys. Beside it, one small file per provider,
//! `<data folder>/ticket-keys/<provider>.json`, holds what is not secret: Plane's address and
//! workspace. A machine with no keychain (a server reached over ssh, a Linux with no Secret
//! Service) keeps the key in that file too, as every daemon did before keychains: the folder is
//! the owner's alone (`0700`) and the file `0600` on unix, and on Windows it sits in the user's own
//! app data. A file that still holds a key moves it into the keychain when it is next read, and
//! the file lets go of it only once the keychain gives it back.
//!
//! The key is never `config.toml` (which is synced), a repository, a log line, a snapshot, an
//! agent's environment or a reply to a client: a client can set a key or remove it and ask only
//! whether one is set, where it points and where it is kept. In the daemon the key is a `Secret`,
//! which never prints. Setting one is a human client's alone (the daemon refuses a pane and a
//! structured runtime before it gets here).

#[cfg(test)]
use super::keychain::NoVault;
use super::keychain::{SystemKeychain, Vault, VaultError};
use super::usage_store::write_file;
use crate::http::{Secret, check_base_url};
use maitty_shared::protocol::TicketKeyChange;
use maitty_shared::tickets::{KeyStorage, TICKET_ADDRESS_MAX_CHARS, TICKET_WORKSPACE_MAX_CHARS, TicketError, TicketKeyState, TicketProvider};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// The folder of keys inside the data folder.
const FOLDER: &str = "ticket-keys";
/// The shortest and longest a key may be. Real keys are 40 to 80 characters.
const KEY_MIN_CHARS: usize = 8;
const KEY_MAX_CHARS: usize = 200;
/// Linear has one server; the address of its key is not asked for.
pub(super) const LINEAR_ADDRESS: &str = "https://api.linear.app";
/// How many hex characters of the data folder's hash name it in a keychain account: enough that
/// two folders never meet, short enough to read in the keychain's own list.
const FOLDER_ID_CHARS: usize = 16;

/// What is kept for one provider, as it sits on disk. It has no `Debug`: the key can be in it.
#[derive(Serialize, Deserialize)]
struct OnDisk {
    #[serde(default)]
    address: String,
    #[serde(default)]
    workspace: String,
    /// The key itself, only where there is no keychain; absent when the keychain holds it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    key: Option<String>,
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
    vault: Arc<dyn Vault>,
    /// Names this data folder in keychain accounts.
    folder_id: String,
}

impl KeyStore {
    pub(super) fn real() -> KeyStore {
        KeyStore::with_vault(crate::config::data_dir().join(FOLDER), Arc::new(SystemKeychain))
    }

    /// Keys kept in files under `dir` alone, with no keychain.
    #[cfg(test)]
    pub(super) fn at(dir: PathBuf) -> KeyStore {
        KeyStore::with_vault(dir, Arc::new(NoVault))
    }

    pub(super) fn with_vault(dir: PathBuf, vault: Arc<dyn Vault>) -> KeyStore {
        let folder_id = folder_id(&dir);
        KeyStore { dir, vault, folder_id }
    }

    fn path(&self, provider: TicketProvider) -> PathBuf {
        self.dir.join(format!("{}.json", provider.name()))
    }

    /// The keychain account of `provider`'s key in this data folder.
    fn account(&self, provider: TicketProvider) -> String {
        format!("{}@{}", provider.name(), self.folder_id)
    }

    fn read_file(&self, provider: TicketProvider) -> Result<Option<OnDisk>, TicketError> {
        let text = match std::fs::read_to_string(self.path(provider)) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                tracing::warn!("couldn't read the {} key file: {:?}", provider.name(), error.kind());
                return Err(unreadable());
            }
        };
        serde_json::from_str(&text).map(Some).map_err(|_| unreadable())
    }

    fn write_file(&self, provider: TicketProvider, stored: &OnDisk) -> Result<(), TicketError> {
        let bytes = serde_json::to_vec(stored).map_err(|_| unwritable())?;
        write_file(&self.path(provider), &bytes).map_err(|error| {
            // The cause can name a path but never a key; only that it failed is kept.
            tracing::warn!("couldn't keep the {} key: {}", provider.name(), error.root_cause().to_string().chars().take(100).collect::<String>());
            unwritable()
        })
    }

    /// Puts `key` in the keychain and reads it back. True only when the keychain gave back exactly
    /// what was put in; anything else leaves no entry behind.
    fn into_keychain(&self, provider: TicketProvider, key: &Secret) -> bool {
        let account = self.account(provider);
        if self.vault.write(&account, key.expose()).is_err() {
            return false;
        }
        match self.vault.read(&account) {
            Ok(Some(back)) if back == key.expose() => true,
            _ => {
                tracing::warn!("the keychain did not give the {} key back; it stays in the file", provider.name());
                let _ = self.vault.delete(&account);
                false
            }
        }
    }

    /// The key kept for `provider` and where it is, `None` when there is none. A file or keychain
    /// entry that cannot be read is an error that tells the user to set the key again, never a key
    /// that is silently not there. A key still in the file moves into the keychain here.
    fn load_kept(&self, provider: TicketProvider) -> Result<Option<(Saved, KeyStorage)>, TicketError> {
        let Some(stored) = self.read_file(provider)? else {
            return Ok(None);
        };
        let OnDisk { address, workspace, key } = stored;
        if let Some(key) = key {
            let key = Secret::new(key);
            let mut storage = KeyStorage::File;
            if self.into_keychain(provider, &key) {
                let without = OnDisk { address: address.clone(), workspace: workspace.clone(), key: None };
                if self.write_file(provider, &without).is_ok() {
                    storage = KeyStorage::Keychain;
                } else {
                    // The file still holds it, so the file is where it is kept.
                    let _ = self.vault.delete(&self.account(provider));
                }
            }
            return Ok(Some((Saved { address, workspace, key }, storage)));
        }
        match self.vault.read(&self.account(provider)) {
            Ok(Some(key)) => Ok(Some((Saved { address, workspace, key: Secret::new(key) }, KeyStorage::Keychain))),
            Ok(None) => {
                tracing::warn!("the {} key is gone from the keychain", provider.name());
                Err(unreadable())
            }
            Err(error) => {
                tracing::warn!("couldn't read the {} key from the keychain: {error:?}", provider.name());
                Err(TicketError::Invalid("The system keychain did not give the saved key; unlock it, or set the key again".into()))
            }
        }
    }

    /// The key kept for `provider`, `None` when there is none.
    pub(super) fn load(&self, provider: TicketProvider) -> Result<Option<Saved>, TicketError> {
        Ok(self.load_kept(provider)?.map(|(saved, _)| saved))
    }

    /// Keeps `saved`: the key in the keychain where there is one, else in the file.
    fn save(&self, provider: TicketProvider, saved: &Saved) -> Result<(), TicketError> {
        let in_keychain = self.into_keychain(provider, &saved.key);
        let stored = OnDisk {
            address: saved.address.clone(),
            workspace: saved.workspace.clone(),
            key: if in_keychain { None } else { Some(saved.key.expose().to_owned()) },
        };
        let written = self.write_file(provider, &stored);
        if written.is_err() && in_keychain {
            let _ = self.vault.delete(&self.account(provider));
        }
        written
    }

    /// Forgets `provider`'s key in the keychain and the file both.
    fn remove(&self, provider: TicketProvider) -> Result<(), TicketError> {
        let from_keychain = match self.vault.delete(&self.account(provider)) {
            Ok(()) | Err(VaultError::Unavailable) => Ok(()),
            Err(VaultError::Failed) => {
                tracing::warn!("couldn't remove the {} key from the keychain", provider.name());
                Err(TicketError::Invalid("The key could not be removed from the system keychain".into()))
            }
        };
        let from_file = match std::fs::remove_file(self.path(provider)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => {
                tracing::warn!("couldn't remove the {} key file: {:?}", provider.name(), error.kind());
                Err(unwritable())
            }
        };
        from_keychain.and(from_file)
    }

    /// Whether each provider has a key and where. One that cannot be read shows as not set (and is
    /// logged), so the user can set it again.
    pub(super) fn states(&self) -> Vec<TicketKeyState> {
        TicketProvider::ALL
            .into_iter()
            .map(|provider| {
                let kept = self.load_kept(provider).ok().flatten();
                let visible = |text: Option<String>| text.unwrap_or_default();
                TicketKeyState {
                    provider,
                    set: kept.is_some(),
                    // The address of Linear is fixed, so it is no setting to show.
                    address: visible(kept.as_ref().filter(|_| provider == TicketProvider::Plane).map(|(saved, _)| saved.address.clone())),
                    workspace: visible(kept.as_ref().map(|(saved, _)| saved.workspace.clone())),
                    stored_in: kept.map_or(KeyStorage::File, |(_, storage)| storage),
                }
            })
            .collect()
    }
}

/// A short, stable name for the data folder that holds `dir`: the hash of its real path, so the
/// same folder named two ways is one and two folders are two. `dir` may not exist yet; its parent,
/// the data folder, does whenever the daemon runs.
fn folder_id(dir: &Path) -> String {
    let real = std::fs::canonicalize(dir).ok().or_else(|| {
        let parent = std::fs::canonicalize(dir.parent()?).ok()?;
        Some(parent.join(dir.file_name()?))
    });
    let path = real.unwrap_or_else(|| dir.to_path_buf());
    let digest = Sha256::digest(path.to_string_lossy().as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect::<String>().chars().take(FOLDER_ID_CHARS).collect()
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

    use crate::daemon::keychain::fake::FakeVault;

    fn kept_in(vault: Arc<FakeVault>) -> (crate::daemon::persist::ScratchDir, KeyStore) {
        let root = crate::daemon::persist::scratch_dir();
        let store = KeyStore::with_vault(root.path().join(FOLDER), vault);
        (root, store)
    }

    fn file_text(store: &KeyStore, provider: TicketProvider) -> String {
        std::fs::read_to_string(store.path(provider)).unwrap()
    }

    fn plane_state(states: &[TicketKeyState]) -> &TicketKeyState {
        states.iter().find(|state| state.provider == TicketProvider::Plane).unwrap()
    }

    #[test]
    fn with_a_keychain_the_key_goes_there_and_the_file_keeps_only_where_it_points() {
        let vault = Arc::new(FakeVault::default());
        let (_root, store) = kept_in(vault.clone());
        let states = change(&store, plane("http://192.168.1.244", "ideayard", KEY)).unwrap();
        assert_eq!(plane_state(&states).stored_in, KeyStorage::Keychain);
        let text = file_text(&store, TicketProvider::Plane);
        assert!(!text.contains("SECRETVALUE") && text.contains("ideayard"), "{text}");
        assert_eq!(vault.kept.lock().unwrap().get(&store.account(TicketProvider::Plane)).map(String::as_str), Some(KEY));
        assert_eq!(store.load(TicketProvider::Plane).unwrap().unwrap().key.expose(), KEY);

        change(&store, TicketKeyChange::Remove { provider: TicketProvider::Plane }).unwrap();
        assert!(vault.kept.lock().unwrap().is_empty(), "removing forgets it in the keychain");
        assert!(!store.path(TicketProvider::Plane).exists(), "and the file");
    }

    #[test]
    fn with_no_keychain_the_key_stays_in_the_file_and_says_so() {
        let vault = Arc::new(FakeVault { gone: true, ..FakeVault::default() });
        let (_root, store) = kept_in(vault);
        let states = change(&store, plane("http://192.168.1.244", "ideayard", KEY)).unwrap();
        assert_eq!((plane_state(&states).set, plane_state(&states).stored_in), (true, KeyStorage::File));
        assert!(file_text(&store, TicketProvider::Plane).contains(KEY));
        assert_eq!(store.load(TicketProvider::Plane).unwrap().unwrap().key.expose(), KEY);
        // Removing with no keychain still removes the file.
        change(&store, TicketKeyChange::Remove { provider: TicketProvider::Plane }).unwrap();
        assert!(!store.path(TicketProvider::Plane).exists());
    }

    #[test]
    fn a_key_still_in_its_file_moves_into_the_keychain_when_it_is_next_read() {
        let (_root, files) = store();
        change(&files, plane("https://plane.example.com", "w", KEY)).unwrap();
        assert!(file_text(&files, TicketProvider::Plane).contains(KEY), "an older daemon's file");

        let vault = Arc::new(FakeVault::default());
        let store = KeyStore::with_vault(files.dir.clone(), vault.clone());
        assert_eq!(store.load(TicketProvider::Plane).unwrap().unwrap().key.expose(), KEY);
        assert!(!file_text(&store, TicketProvider::Plane).contains("SECRETVALUE"), "the file let go of it");
        assert_eq!(vault.kept.lock().unwrap().len(), 1);
        assert_eq!(plane_state(&store.states()).stored_in, KeyStorage::Keychain);
    }

    #[test]
    fn the_file_keeps_the_key_until_the_keychain_gives_it_back() {
        let (_root, files) = store();
        change(&files, plane("https://plane.example.com", "w", KEY)).unwrap();
        // A keychain that says it kept the key but gives back something else.
        let vault = Arc::new(FakeVault { lies: true, ..FakeVault::default() });
        let store = KeyStore::with_vault(files.dir.clone(), vault.clone());
        assert_eq!(store.load(TicketProvider::Plane).unwrap().unwrap().key.expose(), KEY);
        assert!(file_text(&store, TicketProvider::Plane).contains(KEY), "the key was not let go of");
        assert!(vault.kept.lock().unwrap().is_empty(), "and nothing wrong was left in the keychain");
        assert_eq!(plane_state(&store.states()).stored_in, KeyStorage::File);
        // A new key set through a keychain that lies stays in the file too.
        let states = change(&store, plane("https://plane.example.com", "w", "plane_api_OTHERVALUE99")).unwrap();
        assert_eq!(plane_state(&states).stored_in, KeyStorage::File);
        assert!(file_text(&store, TicketProvider::Plane).contains("OTHERVALUE"));
    }

    #[test]
    fn a_key_gone_from_the_keychain_is_an_error_to_set_again_not_a_missing_key() {
        let vault = Arc::new(FakeVault::default());
        let (_root, store) = kept_in(vault.clone());
        change(&store, plane("https://plane.example.com", "w", KEY)).unwrap();
        vault.kept.lock().unwrap().clear();
        assert!(matches!(store.load(TicketProvider::Plane), Err(TicketError::Invalid(_))));
        assert!(!plane_state(&store.states()).set);
    }

    #[test]
    fn two_data_folders_keep_their_keys_apart_in_one_keychain() {
        let vault = Arc::new(FakeVault::default());
        let (_real, real) = kept_in(vault.clone());
        let (_test, test) = kept_in(vault.clone());
        assert_ne!(real.account(TicketProvider::Plane), test.account(TicketProvider::Plane));
        change(&real, plane("https://plane.example.com", "real", KEY)).unwrap();
        change(&test, plane("https://plane.example.com", "test", "plane_api_TESTDAEMONKEY1")).unwrap();
        assert_eq!(real.load(TicketProvider::Plane).unwrap().unwrap().key.expose(), KEY);
        assert_eq!(test.load(TicketProvider::Plane).unwrap().unwrap().key.expose(), "plane_api_TESTDAEMONKEY1");
        change(&test, TicketKeyChange::Remove { provider: TicketProvider::Plane }).unwrap();
        assert_eq!(real.load(TicketProvider::Plane).unwrap().unwrap().key.expose(), KEY, "the other folder's key stays");
        // The same folder named before and after its key folder exists is one account.
        let again = KeyStore::with_vault(real.dir.clone(), vault);
        assert_eq!(again.account(TicketProvider::Plane), real.account(TicketProvider::Plane));
    }

    #[test]
    fn a_folder_is_named_the_same_before_and_after_it_is_made() {
        let root = crate::daemon::persist::scratch_dir();
        let dir = root.path().join(FOLDER);
        let before = folder_id(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(folder_id(&dir), before);
        assert_eq!(before.len(), FOLDER_ID_CHARS);
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
