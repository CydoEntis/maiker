# 0018. Every provider is one dialect with no I/O, named in one registry

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

The daemon runs Codex and Claude Code as chats (0005). Each was written against its own wire
format inside the daemon: Claude's loop took its commands in Codex's JSON shapes, and a dozen
places compared the provider to decide how a chat runs, where its history is read and how its
transcript is named. A third agent would have meant finding every one of them. Agents that speak
a shared protocol are coming, and the daemon must not learn each one again.

Status has one writer (0003). A provider's code that owned a process, a clock or an identity could
report a turn the daemon never started, or keep running after the daemon stopped it.

## Decision

A provider is a `ProviderDialect` (`crates/adapters/maitty-provider`): a state machine with no
I/O, one per conversation. The daemon hands it what a person asked for (`Command`) and each line
the provider printed, and carries out the `Step`s it returns: start a process, write a line, close
the input, report a `ProviderEvent`. The daemon owns the process, its pipes, the clock, every
identity and the status; a dialect reports and never decides. Events and commands are typed and in
no provider's words, and no provider frame reaches a client.

The daemon names a provider in one registry (`daemon/providers.rs`), one entry per agent holding
everything that differs. Code elsewhere reads a field and never compares a provider. Each adapter
states what it can do once, and the daemon sends that with the conversation (0005 says what may be
claimed).

Adapters are crates built with the daemon. Each depends on the contract and on
`maitty-shared`, never on the daemon.

## Alternatives considered

- **An async trait that owns its process**: the usual shape, and the one both loops had. It lost
  because every adapter would repeat process cleanup, frame limits and environment filtering, and
  because a test would need a real process to reach any of its logic.
- **Make every provider speak Codex's JSON-RPC inside the daemon**: what the Claude loop did. It
  lost because the daemon then validated a made-up Codex for each provider, and a mistake in the
  pretending looked like a provider fault.
- **Use ACP as the contract itself**: it lost because Codex and Claude report things it does not
  carry (remembered command approvals, file-change previews, steering), and their native
  protocols are the ones verified here. ACP becomes one dialect behind the contract.

## Consequences

- A new agent is an adapter crate and a registry entry. Its tests feed lines and read steps, with
  no process.
- `conversation/dialect_runtime.rs` runs any dialect. Codex and Claude still run in their own
  loops, which hold what it has not learned: Codex's handshake and version checks, and Claude's
  process started ahead of the next message. Until they move there are three process loops to
  keep alike in cleanup and limits.
- The daemon still reads a command's answer in Codex's JSON shape; the generic runner writes that
  shape for other dialects. Typing those answers is the remaining step.
- The contract is internal. Changing it touches every adapter in one commit and no installed
  peer; what it sends to clients is governed by 0002.
- Revisit if a provider needs something a line-based process cannot give, such as a socket or a
  library loaded into the daemon.
