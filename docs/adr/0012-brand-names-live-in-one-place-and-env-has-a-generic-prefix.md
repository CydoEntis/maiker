# 0012. Brand-dependent names live in one place, and environment variables have a generic prefix

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

ADR 0008 put the product name in `apps/tui/Cargo.toml`. Three kinds of name still followed the
brand by accident or were written out by hand: the environment prefix was the command in capitals
(`MAITTY_SOCKET`), so a rename changed every variable, installer setting and doc; the daemon had
no name of its own (the window said `maittyd`, the bundled copy was `maitty-gui-daemon`, both
built from the command); and the desktop app and its scripts wrote the same names again in TypeScript, PowerShell and
YAML. A rename meant a hunt, and the last one missed the daemon.

## Decision

- **One set of constants.** `[package.metadata.brand]` in `apps/tui/Cargo.toml` holds the display
  name, the daemon's name (`daemon = "maikerd"`), the environment prefix (`env_prefix`) and the
  names each had before. `build.rs` hands them to every crate, and `maitty_shared::brand` is the
  only Rust module that reads them (`APP_NAME`, `APP_COMMAND`, `DAEMON_NAME`, `DATA_DIR_NAME`,
  `SOCKET_BASE_NAME`, `ENV_PREFIX`, and the helpers below). `apps/gui/src/brand.ts` holds the same set for the
  desktop app and its scripts, which cannot read Rust; a test in `maitty-shared` keeps the two
  equal. The installers, which run on their own, and the workflow read `env_prefix` from
  `Cargo.toml` or name it once, and a test checks them. `tests/naming.rs` fails on the daemon's
  name or an environment prefix written out in Rust.
- **Generic environment prefix.** Every variable is `AGENT_<NAME>` (`AGENT_SOCKET`,
  `AGENT_DATA_DIR`, `AGENT_PANE_TOKEN`, ...). The prefix names no brand, so a rename never
  touches it. Code writes the key without a prefix and reads it with
  `brand::env_var("SOCKET")` / `env_var_os`; it sets it with `env_name("SOCKET")`.
- **The old prefix keeps working.** `MAITTY_<NAME>` is still read when `AGENT_<NAME>` is not set
  (the new name wins). Everything the app starts in a pane (pane id and token, socket, remote
  routing, the update-progress flag, worktree hook variables) is set under both names, and
  everything it scrubs from a child is scrubbed under both, so a `maitty` of an older build (an
  installed hook, the far end of an ssh) and a user's own hook script keep working, and a pane
  that was open before the update keeps reporting through the variables it already has.
- **The daemon is `maikerd`.** The desktop app bundles the program as `maikerd` (sidecar
  `maikerd-<target>`, installed as the one shared `maitty`), and the window, the terminal app
  and the docs call the service `maikerd`. A program named `maitty-gui-daemon` (an old bundled
  copy, or a service started before the update) is still recognised as the daemon, so the
  existing "restart the older service" flow finds and replaces it; hook files that name it are
  still recognised as the app's.
- **No wire or socket change.** The socket and pipe name, the data folder and the pid and
  session files still come from the command, and no protocol message changed, so
  `PROTOCOL_VERSION` and `COMPATIBLE_SINCE` stay. An older client reaches a newer daemon (and the
  reverse) on the same socket, and the existing handshake refuses a pair that cannot read each
  other. A data folder rename is not part of this decision; a rename of the command carries the
  folder over with its own one-time move (`previous` in the metadata).

## Alternatives considered

- **Keep deriving the prefix from the command.** A rename would again change every variable and
  need a fallback each time.
- **A separate `maikerd` binary.** The daemon is the `daemon` subcommand of the one binary, so
  a second binary would double the install and break "one shared daemon file" (ADR 0004). Only
  the bundled file and the name people see change.
- **Read the old prefix only, or only the new one.** Sessions already running, installed hooks and
  users' scripts all carry the old names; dropping them would silently break status reports.
- **A JSON file both sides read.** Cargo has to hold the package name anyway, so a second source
  would be two to keep equal; one source plus a mirrored file with a test is smaller.

## Consequences

- A rename of the product is `Cargo.toml` (name, `previous`), `brand.ts`, the two installers'
  `APP` line and the repository; the prefix and the daemon's name are separate decisions.
- Each variable exists under two names for as long as `env_previous` lists the old prefix.
  Remove the entry, and the fallbacks and double settings go with it, when no supported
  build or running session uses it.
- `AGENT_` is generic, so another tool could set a variable with the same prefix; the app reads
  only the names it documents in [ENVIRONMENT](../ENVIRONMENT.md#project-specific-variables), and
  a login shell's scrub removes only variables that start with the prefix and an underscore.

## Names a person saved under the old brand

A rename must also carry what the person already stored. Each of these moves once, never loses
the old value, and leaves the old name readable for an older build still installed:

- **Desktop window storage.** `maitty.*` keys become `maiker.*`. `apps/gui/src/data/storageMigration.ts`
  copies every `maitty.` entry to its `maiker.` name at startup (`migrateStorageOnLoad.ts` is the
  first import of `main.tsx`), never over a value already under the new name, and records a marker
  so a setting the person later resets is not brought back. The old keys stay (an older build and a
  rollback read them). New code keys a setting `maiker.*` and never writes `maitty.`; `brand.test.ts`
  fails if the source does. `public/boot-ground.js` runs before the app and reads the new key, then
  the old.
- **Theme ids.** Maiker's own `maitty-abyss`, `-dark`, `-dusk`, `-ember`, `-light`, `-moss`, `-paper`,
  `-retro-dark`, `-retro-light` are `maiker-*` (`theme::RENAMED`). A config that names an old id is
  rewritten to the new one on load and written that way the next time the config is saved; the old
  id still resolves everywhere through `theme::canonical`.
- **Git rule files.** The key that names a rule file's folder is `maiker.folder`. A file written
  before the rename has only `maitty.folder`; reading it accepts that key and copies the value to the
  new one (the old stays). Only Maiker's own files in its data folder are touched, never the
  person's git config. A rule written now carries the new key only, so a build from before the rename
  reports that rule as set outside Maiker until it is updated.

Kept on purpose, because an older install or an installed script reads them: the `AGENT_` and
`MAITTY_` variable names, the `maitty-platform` handshake, the desktop app's identifier
`com.cydoentis.maitty` and the `maitty-gui` binary and window name (app-data location and updater
identity), the `previous` metadata and the release artifact names. Remove one only with its own
decision.
