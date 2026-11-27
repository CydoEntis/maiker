# 0002. Terminal substrate and wire protocol

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

The daemon must run the user's own programs in real terminals on Windows, macOS and Linux, and
every client must be able to talk to it, including across versions and over ssh.

## Decision

- `portable-pty` spawns processes in pseudo-terminals (ConPTY on Windows). A vendored `vt100`
  keeps each pane's screen and scrollback in the daemon.
- Clients and daemon talk over `interprocess` local sockets, with length-delimited frames of
  msgpack (`rmp-serde`) `ClientMsg` and `ServerMsg` enums.
- `PROTOCOL_VERSION` (`crates/maitty-shared/src/protocol.rs`) is checked in the first exchange.
  It moves when a message shape changes incompatibly.
- Two versions talk only inside a compatibility window. `COMPATIBLE_SINCE` is the oldest version
  a build still talks to, in either role, and the daemon says its own in `Welcome`. The client
  decides (`speaks_with`): the same version always talks; an older daemon talks when it is at or
  after the client's `COMPATIBLE_SINCE`; a newer daemon talks when its `COMPATIBLE_SINCE` is at
  or before the client's version. Outside the window a mismatch is refused, never misparsed.
- Inside the window the newer side adapts. The daemon never sends a client a message added
  after that client's version (`ServerMsg::introduced_in`), and passes over a request it cannot
  decode from a newer client instead of ending the connection. A client checks
  `ClientMsg::introduced_in` before it sends an older daemon a request that needs an answer.
- One exception: a hook or usage report is also sent to an older daemon, back to
  `REPORTS_READ_SINCE`, the oldest version that reads today's reports. An update replaces the
  binary hooks run while the old daemon keeps its sessions, and their status must stay right
  until it restarts. A newer daemon is still refused.
- A remote machine uses the same frames through `ssh host maiker proxy`.

## Alternatives considered

- **JSON over sockets**: larger and slower for terminal output.
- **A shared-memory or in-process emulator**: breaks the daemon/client split (0001).

## Consequences

- Changes are additive (amended at protocol 131, after the window closed on nearly every
  release). A new message gets its own arm in `introduced_in`; a new field is
  `#[serde(default)]`; a new value goes into an enum that reads values it does not know as
  `Unknown` (`#[serde(other)]`, from `UNKNOWN_VALUES_READ_SINCE`), which a peer shows as not
  known and never as one of its own values, so status is never misreported (non-negotiable 5).
  Each bumps `PROTOCOL_VERSION`, so a peer can check for it, and leaves `COMPATIBLE_SINCE`.
- Only a real break moves `COMPATIBLE_SINCE` to the new version: a field removed, renamed or
  retyped, or a new value in an enum without `Unknown` inside a message an older peer is still
  sent. The older peer would misread it.
- A client passes over a pushed message it cannot decode, as the daemon does a newer client's
  request, so one new message never costs the connection.
- The window lets an updated app keep using a daemon that has not restarted yet, and one
  computer keep using a machine that is a release behind or ahead. It costs a decision at every
  bump, and code that must keep reading old shapes until `COMPATIBLE_SINCE` passes them.
- An added `#[serde(default)]` field needs no bump when a test decodes the old shape.
- A change that an older daemon cannot read in `Hook`, `Usage` or `HookStatus` also moves
  `REPORTS_READ_SINCE` to the new version, and the frozen shapes in its test with it.
