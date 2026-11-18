//! The app's names (ADR 0008, 0012). They are set in `Cargo.toml` and nowhere else, and
//! `maitty_shared::brand` is where code reads them. Code writes the command with
//! `env!("APP_COMMAND")` and `env!("APP_NAME")` inside `concat!`, so a file or message stays a
//! constant; a format string with arguments of its own names these constants instead
//! (`format!("{APP_NAME} saw {n}")`). Environment variables go through `env_var` and `env_names`,
//! never through a written-out prefix.

pub use maitty_shared::brand::*;

/// The release version shared by the TUI and daemon.
pub const APP_VERSION: &str = env!("APP_VERSION");
/// The prefix of the app's environment variables (brand-free, ADR 0012).
pub const APP_ENV: &str = ENV_PREFIX;

/// The commands the app had before, newest first: what an old install left is carried over.
pub fn previous() -> impl Iterator<Item = &'static str> {
    env!("APP_PREVIOUS").split(',').filter(|p| !p.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(APP_ENV, env!("APP_ENV"));
        assert!(
            previous().all(|p| p != APP_COMMAND),
            "a previous name is not the current one"
        );
    }
}
