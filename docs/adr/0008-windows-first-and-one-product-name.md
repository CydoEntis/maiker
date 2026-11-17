# 0008. Windows is a first-class target, and the product name lives in one place

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Maiker ships on Windows, macOS and Linux. A change that only builds on Linux breaks a platform.
The product has been renamed twice, and a name copied into many files made each rename costly.

## Decision

- Every change builds and behaves on Windows (ConPTY, named pipes, PowerShell) as well as Linux
  and macOS. The cross-checks in the verification gate are not optional.
- The product name is set in one place (`crates/maitty-core/src/brand.rs` and `apps/tui/Cargo.toml`)
  and everything else derives from it.

## Alternatives considered

- **Treat Windows as best effort**: rejected, it is a stated user base.

## Consequences

- A rename is a change to one place plus the release assets. The old command goes first in
  `previous`, and the first run under the new name carries an install over (`config::migrate_old_names`):
  a service still running under the old name is asked to stop, so it saves its sessions, then its config
  and data are copied and the new service restores them with their agents resumed; `<OLD>_*` environment
  variables count until the new name's are set (`brand::adopt_previous_env`); hooks, themes, per-repo files
  and references under the old name are still read. The desktop app keeps the old command's shared file
  current too, so hooks and MCP entries that call it run the new app, and a machine update treats the app
  under its old name as an older version to replace. The desktop app's bundle identifier
  (`com.cydoentis.maitty`) does not change: a new one would install a second app and lose its saved state.
