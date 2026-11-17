//! The app's name (ADR 0008). It is set in `Cargo.toml` and nowhere else: the package name is the
//! command, `[package.metadata.brand]` holds the name people see and the names it had before.
//! Code writes it with `env!("APP_COMMAND")`, `env!("APP_NAME")` and `env!("APP_ENV")` inside
//! `concat!`, so a file, variable or message stays a constant; a format string with arguments
//! of its own names these constants instead (`format!("{APP_NAME} saw {n}")`).

/// What people see: titles, the splash, messages.
pub const APP_NAME: &str = env!("APP_NAME");
/// What people type, and the root of the app's files, folders and tags.
pub const APP_COMMAND: &str = env!("APP_COMMAND");
/// The release version shared by the TUI and daemon.
pub const APP_VERSION: &str = env!("APP_VERSION");
/// The prefix of the app's environment variables.
pub const APP_ENV: &str = env!("APP_ENV");

/// The commands the app had before, newest first: what an old install left is carried over.
pub fn previous() -> impl Iterator<Item = &'static str> {
    env!("APP_PREVIOUS").split(',').filter(|p| !p.is_empty())
}

/// The environment variables an older name set (`<OLD>_SOCKET`) under this name's prefix, each only where the new
/// name's own is not set: what a shell profile or script still exports keeps working after a rename.
pub fn adopted_env<I>(vars: I, is_set: impl Fn(&str) -> bool) -> Vec<(String, std::ffi::OsString)>
where
    I: IntoIterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
{
    let vars: Vec<_> = vars.into_iter().collect();
    let mut adopted: Vec<(String, std::ffi::OsString)> = Vec::new();
    // Newest name first, so its value wins over an even older one's.
    for old in previous() {
        let prefix = format!("{}_", old.to_ascii_uppercase().replace('-', "_"));
        for (key, value) in &vars {
            let Some(rest) = key.to_str().and_then(|key| key.strip_prefix(&prefix)) else {
                continue;
            };
            let new = format!("{APP_ENV}_{rest}");
            if !is_set(&new) && !adopted.iter().any(|(taken, _)| *taken == new) {
                adopted.push((new, value.clone()));
            }
        }
    }
    adopted
}

/// Set `adopted_env` in this process. Call it first thing, before any thread starts.
pub fn adopt_previous_env() {
    for (key, value) in adopted_env(std::env::vars_os(), |key| std::env::var_os(key).is_some()) {
        // SAFETY: called once at startup, before any thread is started.
        unsafe { std::env::set_var(key, value) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_older_names_variables_count_until_the_new_name_sets_its_own() {
        let Some(old) = previous().next() else {
            return;
        };
        let old = old.to_ascii_uppercase();
        let vars = [
            (format!("{old}_SOCKET").into(), "dev".into()),
            (format!("{old}_CONFIG").into(), "/old".into()),
            ("PATH".into(), "/bin".into()),
        ];
        let set = format!("{APP_ENV}_CONFIG");
        let adopted = adopted_env(vars, |key| key == set);
        assert_eq!(adopted, [(format!("{APP_ENV}_SOCKET"), "dev".into())]);
    }

    #[test]
    fn the_name_comes_from_cargo_toml() {
        assert_eq!(APP_COMMAND, env!("APP_PACKAGE"));
        assert!(
            !APP_NAME.is_empty()
                && APP_NAME
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == ' '),
            "{APP_NAME}"
        );
        assert_eq!(APP_ENV, APP_COMMAND.to_ascii_uppercase().replace('-', "_"));
        assert!(
            previous().all(|p| p != APP_COMMAND),
            "a previous name is not the current one"
        );
    }
}
