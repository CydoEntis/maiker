//! The system's keychain, where the daemon keeps a ticket provider's key: Windows Credential
//! Manager, the macOS login Keychain, or the Secret Service on Linux and the BSDs (over pure-Rust
//! D-Bus, so the static build links no C library). A machine with none, such as a server reached
//! over ssh with no desktop session, answers `Unavailable`, and the key stays in its owner-only file
//! (`ticket_keys`). Every call blocks; the daemon makes them on a blocking task.
//!
//! An error from the keychain is never printed or logged as it came: one kind of it holds the
//! bytes that were stored. Only which of the two outcomes it was is kept.

use keyring_core::{CredentialStore, Error};
use std::sync::{Arc, Mutex};

/// The name every entry is kept under, beside the account that says which key it is.
const SERVICE: &str = concat!(env!("APP_COMMAND"), " ticket keys");

/// Why the keychain did not do what was asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum VaultError {
    /// There is no keychain here, or it refused access: keep the key in the file.
    Unavailable,
    /// The keychain is there but the call failed.
    Failed,
}

/// Somewhere other than a file to keep a secret, by account name.
pub(super) trait Vault: Send + Sync {
    fn read(&self, account: &str) -> Result<Option<String>, VaultError>;
    fn write(&self, account: &str, secret: &str) -> Result<(), VaultError>;
    /// Deleting what is not there is not an error.
    fn delete(&self, account: &str) -> Result<(), VaultError>;
}

/// No keychain at all: what tests and a store given only a folder use.
#[cfg(test)]
pub(super) struct NoVault;

#[cfg(test)]
impl Vault for NoVault {
    fn read(&self, _: &str) -> Result<Option<String>, VaultError> {
        Err(VaultError::Unavailable)
    }
    fn write(&self, _: &str, _: &str) -> Result<(), VaultError> {
        Err(VaultError::Unavailable)
    }
    fn delete(&self, _: &str) -> Result<(), VaultError> {
        Err(VaultError::Unavailable)
    }
}

/// This machine's own keychain.
pub(super) struct SystemKeychain;

impl SystemKeychain {
    fn entry(account: &str) -> Result<keyring_core::Entry, VaultError> {
        system_store().ok_or(VaultError::Unavailable)?.build(SERVICE, account, None).map_err(kind)
    }
}

impl Vault for SystemKeychain {
    fn read(&self, account: &str) -> Result<Option<String>, VaultError> {
        match Self::entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(kind(error)),
        }
    }

    fn write(&self, account: &str, secret: &str) -> Result<(), VaultError> {
        Self::entry(account)?.set_password(secret).map_err(kind)
    }

    fn delete(&self, account: &str) -> Result<(), VaultError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(kind(error)),
        }
    }
}

/// Which outcome an error is, and nothing else of it.
fn kind(error: Error) -> VaultError {
    match error {
        Error::NoStorageAccess(_) | Error::NoDefaultStore | Error::NotSupportedByStore(_) => VaultError::Unavailable,
        _ => VaultError::Failed,
    }
}

/// The platform's store, made once it can be. A store that could not be made (no Secret Service
/// yet) is asked for again next time, so a keychain that comes up later is used from then on.
fn system_store() -> Option<Arc<CredentialStore>> {
    static STORE: Mutex<Option<Arc<CredentialStore>>> = Mutex::new(None);
    let mut kept = STORE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if kept.is_none() {
        *kept = made_store();
    }
    kept.clone()
}

#[cfg(windows)]
fn made_store() -> Option<Arc<CredentialStore>> {
    windows_native_keyring_store::Store::new().ok().map(|store| store as Arc<CredentialStore>)
}

#[cfg(target_os = "macos")]
fn made_store() -> Option<Arc<CredentialStore>> {
    apple_native_keyring_store::keychain::Store::new().ok().map(|store| store as Arc<CredentialStore>)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn made_store() -> Option<Arc<CredentialStore>> {
    zbus_secret_service_keyring_store::Store::new().ok().map(|store| store as Arc<CredentialStore>)
}

#[cfg(not(any(windows, unix)))]
fn made_store() -> Option<Arc<CredentialStore>> {
    None
}

#[cfg(test)]
pub(super) mod fake {
    use super::{Vault, VaultError};
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// A keychain in memory. `lies` makes a write answer Ok and keep something else, so a read-back
    /// is what catches it; `gone` makes it unavailable.
    #[derive(Default)]
    pub(in crate::daemon) struct FakeVault {
        pub(in crate::daemon) kept: Mutex<HashMap<String, String>>,
        pub(in crate::daemon) lies: bool,
        pub(in crate::daemon) gone: bool,
    }

    impl Vault for FakeVault {
        fn read(&self, account: &str) -> Result<Option<String>, VaultError> {
            if self.gone {
                return Err(VaultError::Unavailable);
            }
            Ok(self.kept.lock().unwrap().get(account).cloned())
        }
        fn write(&self, account: &str, secret: &str) -> Result<(), VaultError> {
            if self.gone {
                return Err(VaultError::Unavailable);
            }
            let stored = if self.lies { "something else".to_owned() } else { secret.to_owned() };
            self.kept.lock().unwrap().insert(account.to_owned(), stored);
            Ok(())
        }
        fn delete(&self, account: &str) -> Result<(), VaultError> {
            if self.gone {
                return Err(VaultError::Unavailable);
            }
            self.kept.lock().unwrap().remove(account);
            Ok(())
        }
    }
}
