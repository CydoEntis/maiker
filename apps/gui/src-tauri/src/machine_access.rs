//! How a person gets a machine to log in from the window, without a terminal: look at its host key
//! and trust it (only when it is new), and set the user it connects as. The key work is in
//! `maitty_machines::host_key`; here it is run off the UI thread and tied to a machine by name.

use maitty_machines::host_key::{self, Inspection, Standing, TOOL_LIMIT, Tools};
use maitty_machines::key_login;
use maitty_machines::local_machines::{config_path, machines_beside};
use maitty_machines::machine_config::set_target;
use maitty_machines::machine_target::{build_target, split_target, valid_user};
use serde::Serialize;

/// The longest fingerprint text accepted back from the window: `SHA256:` and 43 base64 characters.
const MOST_FINGERPRINT_CHARS: usize = 64;

/// What the window is shown about a machine's host key. A `changed` key has no way to be trusted
/// from here.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum HostKeyReport {
    /// A key this computer has never seen for the host.
    Unknown { host: String, port: u16, key_type: String, fingerprint: String },
    /// The key is already trusted: the login failed for another reason.
    Trusted { host: String, port: u16, key_type: String, fingerprint: String },
    /// The machine offers a key that differs from the one on record.
    Changed { host: String, port: u16, key_type: String, fingerprint: String, known_fingerprint: String },
}

pub fn report_of(seen: &Inspection) -> HostKeyReport {
    let (host, port, key_type, fingerprint) = (
        seen.host.clone(),
        seen.port,
        seen.key.key_type.clone(),
        seen.fingerprint.clone(),
    );
    match &seen.standing {
        Standing::Unknown => HostKeyReport::Unknown { host, port, key_type, fingerprint },
        Standing::Trusted => HostKeyReport::Trusted { host, port, key_type, fingerprint },
        Standing::Changed { known_fingerprint } => HostKeyReport::Changed {
            host,
            port,
            key_type,
            fingerprint,
            known_fingerprint: known_fingerprint.clone(),
        },
    }
}

/// Whether `text` is shaped like the fingerprint the window was given.
pub fn is_fingerprint(text: &str) -> bool {
    text.len() <= MOST_FINGERPRINT_CHARS
        && text
            .strip_prefix("SHA256:")
            .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/')))
}

/// The ssh program, its leading arguments and the target of the machine called `name`.
fn ssh_of(wire: &crate::terminal_stream::Wire, name: &str) -> Result<(Vec<String>, String), String> {
    let handle = wire.handle()?;
    let id = handle
        .id_of(name)
        .ok_or_else(|| format!("{name} is not one of this computer's machines"))?;
    let route = handle
        .route(id)
        .ok_or_else(|| format!("{name} is no longer in the list"))?;
    let (ssh, target) = route
        .ssh_parts()
        .ok_or_else(|| format!("{name} is not reached over ssh, so it has no host key to look at"))?;
    Ok((ssh.to_vec(), target.to_string()))
}

/// Look at the host key a machine offers and whether this computer knows it. Fetching can take
/// seconds, so it runs off the UI thread.
#[tauri::command]
pub async fn inspect_host_key(wire: tauri::State<'_, crate::terminal_stream::Wire>, name: String) -> Result<HostKeyReport, String> {
    let (ssh, target) = ssh_of(&wire, &name)?;
    let seen = tauri::async_runtime::spawn_blocking(move || host_key::inspect(&ssh, &target, &Tools::default(), TOOL_LIMIT))
        .await
        .map_err(|error| format!("Could not look at the host key: {error}"))?
        .map_err(|error| format!("{error:#}"))?;
    Ok(report_of(&seen))
}

/// Trust the key whose fingerprint the person was shown: it is fetched again and added only when
/// it is still that key and is new. Then the machine is dialled at once.
#[tauri::command]
pub async fn trust_host_key(
    wire: tauri::State<'_, crate::terminal_stream::Wire>,
    name: String,
    fingerprint: String,
) -> Result<(), String> {
    if !is_fingerprint(&fingerprint) {
        return Err("That is not a fingerprint".to_string());
    }
    let (ssh, target) = ssh_of(&wire, &name)?;
    tauri::async_runtime::spawn_blocking(move || host_key::trust(&ssh, &target, &fingerprint, &Tools::default(), TOOL_LIMIT))
        .await
        .map_err(|error| format!("Could not trust the host key: {error}"))?
        .map_err(|error| format!("{error:#}"))?;
    wire.handle()?.retry(&name);
    Ok(())
}

/// The user name this computer's ssh would connect as when a machine names none.
#[tauri::command]
pub fn local_user_name() -> Option<String> {
    ["USER", "USERNAME", "LOGNAME"]
        .iter()
        .find_map(|key| std::env::var(key).ok())
        .filter(|user| valid_user(user))
}

/// Set the user a machine connects as (blank: none), and dial it again as that user. The entry in
/// `config.local.toml` is rewritten first, its other keys left as they are; the machine is then
/// stopped and started from the entry, so its sessions are shown again once it connects.
#[tauri::command]
pub async fn set_machine_user(wire: tauri::State<'_, crate::terminal_stream::Wire>, name: String, user: String) -> Result<(), String> {
    let (_, target) = ssh_of(&wire, &name)?;
    let (_, host) = split_target(&target);
    let new_target = build_target(&user, host)?;
    let file = config_path().with_file_name("config.local.toml");
    let entry = name.clone();
    let def = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        if !set_target(&file, &entry, &new_target).map_err(|error| format!("Could not change {entry}: {error:#}"))? {
            return Err(format!("{entry} is not in config.local.toml"));
        }
        machines_beside(&config_path())
            .machines
            .into_iter()
            .find(|def| def.name.eq_ignore_ascii_case(&entry))
            .ok_or_else(|| format!("{entry} is not in config.local.toml"))
    })
    .await
    .map_err(|error| format!("Could not change {name}: {error}"))??;
    let handle = wire.handle()?;
    handle.remove(&name);
    handle.add(def);
    Ok(())
}

/// What the "Set up key login" dialog is told before it asks for anything.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum KeyLoginReport {
    /// This computer cannot do it; `reason` says why and the terminal is the way.
    Unavailable { reason: String },
    /// The machine's host key is not trusted yet: the host key card comes first.
    HostKeyNotTrusted,
    /// There is no key here. Creating one is the person's choice; it will be made at `path`.
    NoKey { path: String },
    /// The key here has a passphrase, which Maiker does not handle.
    Encrypted { path: String },
    /// Something is at the usual place that cannot be used or safely replaced.
    Blocked { reason: String },
    Ready { path: String, key_type: String, fingerprint: String },
}

/// What setting up came to. Never carries the password.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "kebab-case")]
pub enum KeySetupResult {
    /// The key is on the machine and a key login worked. `added` is false when it was there already.
    Installed { added: bool, fingerprint: String },
    WrongPassword { attempts_left: u32 },
    /// Too many wrong passwords in a row for this machine.
    Stopped,
    /// Could not be done safely: why, and the exact steps to do it by hand.
    Manual { reason: String, steps: String },
    /// The key was put there but a key login still failed.
    NotVerified { message: String, steps: String },
}

/// Wrong passwords typed per machine, in memory only.
#[derive(Default)]
pub struct KeySetup(std::sync::Mutex<key_login::Attempts>);

fn ssh_dir() -> Result<std::path::PathBuf, String> {
    key_login::default_ssh_dir()
        .ok_or_else(|| "Could not find your home folder".to_string())
}

/// Whether the machine's host key is trusted already: the password step never runs before that.
fn host_key_trusted(ssh: &[String], target: &str) -> Result<bool, String> {
    let seen = host_key::inspect(ssh, target, &Tools::default(), TOOL_LIMIT).map_err(|error| format!("{error:#}"))?;
    Ok(seen.standing == Standing::Trusted)
}

/// What the dialog needs to know: whether this can run, the host key, and the key on this computer.
#[tauri::command]
pub async fn inspect_key_login(wire: tauri::State<'_, crate::terminal_stream::Wire>, name: String) -> Result<KeyLoginReport, String> {
    if let Some(reason) = key_login::unavailable_reason() {
        return Ok(KeyLoginReport::Unavailable { reason: reason.to_string() });
    }
    let (ssh, target) = ssh_of(&wire, &name)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<KeyLoginReport, String> {
        if !host_key_trusted(&ssh, &target)? {
            return Ok(KeyLoginReport::HostKeyNotTrusted);
        }
        Ok(match key_login::local_key(&ssh_dir()?) {
            key_login::LocalKey::Ready { path, key } => KeyLoginReport::Ready {
                path: path.display().to_string(),
                key_type: key.key.key_type.clone(),
                fingerprint: key.fingerprint(),
            },
            key_login::LocalKey::Encrypted { path } => KeyLoginReport::Encrypted { path: path.display().to_string() },
            key_login::LocalKey::Missing { path } => KeyLoginReport::NoKey { path: path.display().to_string() },
            key_login::LocalKey::Blocked { reason } => KeyLoginReport::Blocked { reason },
        })
    })
    .await
    .map_err(|error| format!("Could not look at the key: {error}"))?
}

/// Install this computer's public key on a machine, using the account password once. The password
/// is taken into a `Secret` at once (the argument is emptied), used for the ssh steps through a
/// one-shot askpass helper, and wiped; it is never echoed back, logged or stored. `create_key`
/// says the person agreed to make a new key when there is none.
#[tauri::command]
pub async fn set_up_key_login(
    wire: tauri::State<'_, crate::terminal_stream::Wire>,
    attempts: tauri::State<'_, KeySetup>,
    name: String,
    password: String,
    create_key: bool,
) -> Result<KeySetupResult, String> {
    let secret = key_login::Secret::new(password).map_err(|error| format!("{error:#}"))?;
    if let Some(reason) = key_login::unavailable_reason() {
        return Err(reason.to_string());
    }
    if !attempts.0.lock().map_err(|_| "Key setup is busy".to_string())?.allowed(&name) {
        return Ok(KeySetupResult::Stopped);
    }
    let (ssh, target) = ssh_of(&wire, &name)?;
    let outcome = tauri::async_runtime::spawn_blocking(move || -> Result<(key_login::PublicKey, key_login::Installed), String> {
        if !host_key_trusted(&ssh, &target)? {
            return Err("Trust the machine's host key first; the password is never sent to a host this computer does not trust.".to_string());
        }
        let key = match key_login::local_key(&ssh_dir()?) {
            key_login::LocalKey::Ready { key, .. } => key,
            key_login::LocalKey::Missing { path } if create_key => {
                key_login::create_key("ssh-keygen", &path, key_login::STEP_LIMIT).map_err(|error| format!("{error:#}"))?;
                match key_login::local_key(&ssh_dir()?) {
                    key_login::LocalKey::Ready { key, .. } => key,
                    _ => return Err("The new key could not be read back".to_string()),
                }
            }
            key_login::LocalKey::Missing { .. } => return Err("There is no key yet; agree to create one first".to_string()),
            key_login::LocalKey::Encrypted { path } => {
                return Err(format!("{} has a passphrase. Maiker does not handle passphrases here; use the terminal.", path.display()));
            }
            key_login::LocalKey::Blocked { reason } => return Err(reason),
        };
        let done = key_login::install(&ssh, &target, &secret, &key).map_err(|error| format!("{error:#}"))?;
        Ok((key, done))
    })
    .await
    .map_err(|error| format!("Could not set up the key: {error}"))??;
    let (key, done) = outcome;
    let mut counts = attempts.0.lock().map_err(|_| "Key setup is busy".to_string())?;
    Ok(match done {
        key_login::Installed::WrongPassword => KeySetupResult::WrongPassword { attempts_left: counts.wrong(&name) },
        key_login::Installed::Done { added } => {
            counts.forget(&name);
            wire.handle()?.retry(&name);
            KeySetupResult::Installed { added, fingerprint: key.fingerprint() }
        }
        key_login::Installed::Manual { reason, steps } => KeySetupResult::Manual { reason, steps },
        key_login::Installed::NotVerified { message } => KeySetupResult::NotVerified { message, steps: key_login::manual_steps(&key, None) },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use maitty_machines::host_key::HostKey;

    #[test]
    fn a_fingerprint_from_the_window_must_be_shaped_like_one() {
        assert!(is_fingerprint("SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"));
        for bad in ["", "SHA256:", "MD5:aa:bb", "SHA256:a b", "SHA256:x;rm", &format!("SHA256:{}", "a".repeat(80))] {
            assert!(!is_fingerprint(bad), "{bad}");
        }
    }

    #[test]
    fn what_key_setup_tells_the_window_has_no_place_for_the_password() {
        let told = serde_json::to_string(&KeySetupResult::WrongPassword { attempts_left: 2 }).unwrap();
        assert_eq!(told, r#"{"outcome":"wrong-password","attempts_left":2}"#);
        let manual = serde_json::to_string(&KeySetupResult::Manual { reason: "r".into(), steps: "s".into() }).unwrap();
        assert!(!manual.contains("password"));
    }

    #[test]
    fn the_local_user_name_is_only_one_ssh_could_use() {
        assert!(local_user_name().is_none_or(|user| valid_user(&user)));
    }

    #[test]
    fn a_changed_key_reaches_the_window_as_changed_with_both_prints() {
        let key = HostKey { key_type: "ssh-ed25519".into(), body: "x".into() };
        let seen = Inspection {
            host: "box".into(),
            port: 22,
            fingerprint: key.fingerprint(),
            key,
            standing: Standing::Changed { known_fingerprint: "SHA256:old".into() },
            known_hosts: std::path::PathBuf::from("known_hosts"),
        };
        match report_of(&seen) {
            HostKeyReport::Changed { known_fingerprint, .. } => assert_eq!(known_fingerprint, "SHA256:old"),
            other => panic!("{other:?}"),
        }
    }
}
