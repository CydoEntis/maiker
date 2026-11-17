# 0013. Maitty has no in-app tickets

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

[0011](0011-maitty-reads-tickets-and-shows-no-workflow-runs.md) kept a read-only *Start from a
ticket* feature: GitHub, Plane and Linear tickets listed in both apps, read with `gh` or with a
Plane or Linear key the daemon kept, started on an agent. It carried its own daemon readers,
key storage in the system keychain, per-project links, a repository file, an MCP tool
(`maitty_tickets_setup`), protocol messages, two views, settings pages, docs and tests. The user
decided it is a worse version of what Plane, Linear and GitHub Issues already are, and does not
help tell which agent needs you ([mission](../../AGENTS.md#project-specific-mission)).

## Decision

Maitty has no tickets of any kind. Tickets are read, started from and changed in their own tracker.
This replaces the line of 0011 that kept tickets as *Start from a ticket*.

**Removed:**

- the desktop *Tickets* view (the pane's ⋯ entry, the palette entry, the overlay, the setup from a
  pasted link, **Settings › Tickets**) and the terminal app's Tickets side-panel view (leader `p`,
  its Menu row, its Tab stop, `Saved::ticket_links` and `Saved::ticket_me`);
- the daemon's GitHub, Plane and Linear readers, the key store (and the keychain and `curl` HTTP
  seam only they used, with the `keyring-core` and the three native keyring-store dependencies),
  the per-project links, the repository file `.maitty/tickets.toml` and the agent's setup ask;
- the MCP tool `maitty_tickets_setup` and its line in the server instructions;
- the protocol messages `Query::Tickets`, `TicketKeys`, `TicketWrite` and `TicketLinks`, their
  replies, `Command::OpenTicketSetup` and `ServerMsg::TicketSetup`, and the host commands and events
  that carried them.

**Stays:** the pull request headline and Checks in the header, branches, the GitHub repository list
of the New session dialog and worktrees (`gh`), and every feature that is not tickets.

**Protocol.** Removing messages is incompatible, so `PROTOCOL_VERSION` goes 114 → 115 and
`COMPATIBLE_SINCE` goes 78 → 115 ([API_PATTERNS](../API_PATTERNS.md#project-specific-api-style),
[0002](0002-terminal-substrate-and-wire-protocol.md)). A window from 105 to 114 asks for tickets
and a daemon of that range sends a setup ask a window of this version cannot read, so each side
refuses the other instead of misreading it. With the window at one version, the `*_SINCE` gates and
the `introduced_in` arms of earlier messages became dead and were removed; `introduced_in` stays for
the next message added inside a window.

**Old data is ignored, not migrated.** A saved binding to the `tickets` action loads and does
nothing; the terminal app's saved state with `ticket_links` or `ticket_me` still loads and the
fields are not written back. Files the daemon wrote before (`ticket-keys/`, `ticket-links.json` in
the data folder) and keys in the system keychain under the service "<app> ticket keys" are no longer
read and are not deleted.

## Alternatives considered

- **Keep reading tickets, drop the writes and the setup**: 0011's position; the rest still needed
  two views, key storage and three provider readers for a tracker the user already has open.
- **Keep the window open (`COMPATIBLE_SINCE` 78) and leave the removed messages on the wire**: 0011
  did this for `TicketWrite`. It keeps old windows connected, but the wire keeps messages nobody
  answers, and 0002 asks for a bump when a message goes.
- **Delete the stored keys and files on start**: it would delete secrets without the user's say.
  Proposed instead: say so in the release notes and let the user remove them.

## Consequences

- Fewer messages, views, dependencies and docs to keep in step on three platforms.
- A running daemon from before this version and an updated window refuse each other until the
  daemon restarts (the cost 0011 declined to pay for a smaller change).
- Plane and Linear keys already in the keychain, and plain key files on machines with no keychain,
  stay on disk unused.
- Bringing tickets back is a new decision; it would need its own place that does not pull Maitty
  away from its mission.
