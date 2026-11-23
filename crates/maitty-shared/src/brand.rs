//! Every name that depends on the brand, in one place (ADR 0008, 0012). The values are set in
//! `apps/tui/Cargo.toml` (`[package]` and `[package.metadata.brand]`); this module is how Rust
//! reads them, and `apps/gui/src/brand.ts` is the same set for the desktop app and its scripts.
//! A test keeps the two equal.
//!
//! Nothing else writes the daemon's name, the command, the environment prefix or the folder
//! names out as text. A rename changes `Cargo.toml` and `brand.ts`.

use std::ffi::OsString;
use std::process::Command;

/// What people see: titles, the splash, messages.
pub const APP_NAME: &str = env!("APP_NAME");
/// What people type. The CLI binary is called this.
pub const APP_COMMAND: &str = env!("APP_COMMAND");
/// The background service that owns every session (ADR 0001), as people and the bundled binary
/// call it.
pub const DAEMON_NAME: &str = env!("APP_DAEMON");
/// The folder under the platform's data directory that holds the app's state.
pub const DATA_DIR_NAME: &str = APP_COMMAND;
/// The command in capitals: the heading of the app's own group in key lists.
pub const APP_HEADING: &str = env!("APP_HEADING");
/// The root of the socket / named-pipe name; a `<PREFIX>_SOCKET` label is added to it.
pub const SOCKET_BASE_NAME: &str = APP_COMMAND;
/// The prefix of the app's environment variables. It is generic on purpose, so a rename of the
/// product leaves every variable alone.
pub const ENV_PREFIX: &str = env!("APP_ENV");

/// The daemon's file names before `DAEMON_NAME`: what an old install or a running old service
/// is called.
pub fn previous_daemon_names() -> impl Iterator<Item = &'static str> {
    names(env!("APP_DAEMON_PREVIOUS"))
}

/// The environment prefixes the app used before `ENV_PREFIX`, newest first. Their variables are
/// still read when the current name is not set.
pub fn previous_env_prefixes() -> impl Iterator<Item = &'static str> {
    names(env!("APP_ENV_PREVIOUS"))
}

fn names(list: &'static str) -> impl Iterator<Item = &'static str> {
    list.split(',').filter(|name| !name.is_empty())
}

/// `<ENV_PREFIX>_<key>`: the variable to set. `key` is written without a prefix (`"SOCKET"`).
pub fn env_name(key: &str) -> String {
    format!("{ENV_PREFIX}_{key}")
}

/// Every name `key` has had, the current one first. Set all of them on a child, and remove all of
/// them when a child must not see the value.
pub fn env_names(key: &str) -> Vec<String> {
    std::iter::once(env_name(key))
        .chain(previous_env_prefixes().map(|prefix| format!("{prefix}_{key}")))
        .collect()
}

/// The first of `key`'s names `get` finds: the current name wins over an old one.
fn first_set<T>(key: &str, mut get: impl FnMut(&str) -> Option<T>) -> Option<T> {
    env_names(key).iter().find_map(|name| get(name))
}

/// Like `std::env::var`, for `key` without its prefix. The current name wins; an old name is a
/// fallback, so a session started before a prefix change still works.
pub fn env_var(key: &str) -> Result<String, std::env::VarError> {
    first_set(key, |name| match std::env::var(name) {
        Err(std::env::VarError::NotPresent) => None,
        found => Some(found),
    })
    .unwrap_or(Err(std::env::VarError::NotPresent))
}

/// Like `std::env::var_os`, with the same fallback as [`env_var`].
pub fn env_var_os(key: &str) -> Option<OsString> {
    first_set(key, |name| std::env::var_os(name))
}

/// Sets `key` under every name it has had on a child process. A child from an older build (an
/// agent hook already installed, the other end of an ssh) still finds the old name.
pub fn set_child_env(command: &mut Command, key: &str, value: impl AsRef<std::ffi::OsStr>) {
    for name in env_names(key) {
        command.env(name, value.as_ref());
    }
}

/// Removes `key` under every name it has had from a child process.
pub fn remove_child_env(command: &mut Command, key: &str) {
    for name in env_names(key) {
        command.env_remove(name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_prefix_does_not_come_from_the_brand() {
        assert_eq!(ENV_PREFIX, "AGENT");
        assert!(!ENV_PREFIX.eq_ignore_ascii_case(APP_COMMAND));
        assert!(!ENV_PREFIX.eq_ignore_ascii_case(APP_NAME));
        assert!(
            !DAEMON_NAME.is_empty() && previous_daemon_names().all(|old| old != DAEMON_NAME),
            "{DAEMON_NAME}"
        );
        assert!(previous_env_prefixes().all(|old| old != ENV_PREFIX));
    }

    #[test]
    fn the_process_environment_is_read_through_both_names() {
        // Unique keys, so no other test sees them.
        let current = env_name("BRAND_TEST_BOTH");
        let old = format!("{}_BRAND_TEST_BOTH", previous_env_prefixes().next().unwrap());
        let only_old = format!("{}_BRAND_TEST_OLD", previous_env_prefixes().next().unwrap());
        // SAFETY: these names are used by this test alone.
        unsafe {
            std::env::set_var(&old, "old");
            std::env::set_var(&current, "new");
            std::env::set_var(&only_old, "kept");
        }
        assert_eq!(env_var("BRAND_TEST_BOTH").as_deref(), Ok("new"));
        assert_eq!(env_var("BRAND_TEST_OLD").as_deref(), Ok("kept"));
        assert_eq!(env_var_os("BRAND_TEST_OLD"), Some("kept".into()));
        assert!(env_var("BRAND_TEST_NEITHER").is_err());
        unsafe {
            std::env::remove_var(&old);
            std::env::remove_var(&current);
            std::env::remove_var(&only_old);
        }
    }

    #[test]
    fn a_child_gets_every_name() {
        let mut command = Command::new("true");
        set_child_env(&mut command, "PANE_TOKEN", "t");
        let set: Vec<_> = command
            .get_envs()
            .map(|(name, value)| (name.to_string_lossy().into_owned(), value.is_some()))
            .collect();
        assert!(set.contains(&("AGENT_PANE_TOKEN".into(), true)), "{set:?}");
        assert!(set.contains(&("MAITTY_PANE_TOKEN".into(), true)), "{set:?}");
        remove_child_env(&mut command, "PANE_TOKEN");
        assert!(command.get_envs().all(|(_, value)| value.is_none()));
    }

    /// The desktop app and the scripts read `apps/gui/src/brand.ts`: it must say the same.
    #[test]
    fn the_desktop_constants_match_cargo_toml() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let text = std::fs::read_to_string(root.join("apps/gui/src/brand.ts"))
            .expect("apps/gui/src/brand.ts is readable");
        let said = |name: &str| {
            text.lines()
                .find_map(|line| {
                    line.strip_prefix(&format!("export const {name} = "))
                        .map(|rest| rest.trim().trim_matches(['\'', '"']).to_string())
                })
                .unwrap_or_else(|| panic!("brand.ts needs {name}"))
        };
        assert_eq!(said("APP_NAME"), APP_NAME);
        assert_eq!(said("APP_COMMAND"), APP_COMMAND);
        assert_eq!(said("DAEMON_NAME"), DAEMON_NAME);
        assert_eq!(said("ENV_PREFIX"), ENV_PREFIX);
        let previous: Vec<_> = previous_daemon_names().collect();
        assert_eq!(said("PREVIOUS_DAEMON_NAMES"), format!("[{}]", previous.iter().map(|n| format!("'{n}'")).collect::<Vec<_>>().join(", ")));
    }
}
