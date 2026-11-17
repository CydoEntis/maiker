/**
 * Every brand-dependent name the desktop app and its scripts use, in one file (ADR 0012). It
 * says what `apps/tui/Cargo.toml` says, and `crates/maitty-shared/src/brand.rs` has a test that
 * keeps the two equal. Write these constants in copy and code; do not write the names out.
 * The values stay plain `export const NAME = 'value'` lines so a script (and that test) can read them.
 */

/** What people see in titles and messages. */
export const APP_NAME = 'Maitty'
/** What people type: the CLI binary. */
export const APP_COMMAND = 'maitty'
/** The background service that owns every session, as people and the bundled binary call it. */
export const DAEMON_NAME = 'maikerd'
/** The names the bundled service had before DAEMON_NAME: a running old one still answers to them. */
export const PREVIOUS_DAEMON_NAMES = ['maitty-gui-daemon']
/** The prefix of the app's environment variables. It is generic on purpose, so a rename leaves it alone. */
export const ENV_PREFIX = 'AGENT'
