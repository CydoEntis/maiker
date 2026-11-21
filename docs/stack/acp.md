# Agent Client Protocol (ACP)

> **Use for:** Running an agent that has no adapter of its own as a daemon-owned chat.
> **Requires:** the provider contract ([ADR 0016](../adr/0016-one-provider-contract-with-no-io.md))
> **Fills:** ARCHITECTURE § provider adapters; SECURITY § provider permissions

## Rules

- ACP is one dialect behind the provider contract, in `crates/adapters/maitty-provider-acp`.
  Nothing outside that crate names an ACP type, and no ACP frame reaches a client
  ([ADR 0017](../adr/0017-acp-for-agents-without-an-adapter.md)).
- Codex and Claude Code keep their own adapters. ACP is only for an agent that has none.
- Speak protocol version 1 only. An agent that answers `initialize` with another version is
  refused, with its version in the message. The crate's `unstable_*` and v2 features stay off.
- Depend on the types crate only, pinned exactly and without default features:
  `agent-client-protocol-schema = { version = "=1.20.0", default-features = false }`. Do not add
  the SDK crate `agent-client-protocol`
  ([why](../research/acp-rust-package.md)). Update the pin in a commit of its own.
- Route by method name (`from_method_and_params`). Never deserialize the crate's routing enums
  straight from a payload: they pick a variant by shape and can pick the wrong one.
- One agent process per conversation, started and stopped by the daemon like any provider's.
  The dialect does no I/O.

## What the daemon tells the agent it can do

- `initialize` declares **no** client capabilities: no `fs/read_text_file`, no
  `fs/write_text_file`, no `terminal/*`. The agent reads and writes with its own tools under its
  own permissions, so Maiker is never the hand that writes a file an agent asked for.
- `session/new` and `session/load` send the conversation's folder and an **empty** MCP server
  list. Maiker hands an agent no servers; the agent uses the ones in its own configuration.
- A request from the agent for a method not offered (`fs/*`, `terminal/*`, `elicitation/create`,
  an extension method) is answered with JSON-RPC "method not found" and reported as
  `UnsupportedRequest`. It never blocks the turn and is never answered as if allowed.

## Permissions

- `session/request_permission` is shown with the agent's **own options**, in its order and under
  its names. Maiker adds none and hides none.
- A person's choice is sent back as that option's id. Maiker never picks an option the person did
  not, and never answers from a remembered rule: the "always in this project" rule of
  [ADR 0005](../adr/0005-provider-adapters-and-permissions.md) is for command requests of the
  native adapters, whose commands Maiker can hash exactly.
- Interrupting a turn sends `session/cancel` and answers every permission request still open with
  the `cancelled` outcome, never with an option.
- Maiker never sends `session/set_mode` or `session/set_config_option` to move a running session
  to a wider mode. A mode is chosen by the person, and only among the modes the agent listed.

## Capabilities

- What an ACP agent can do is what it **advertised** in `initialize` and `session/new`
  (`loadSession`, its modes, its commands), reported as `Verified::Advertised` and labelled so in
  the window.
- A claim becomes `Verified::Pinned` only for an agent and version this project ran and recorded
  here. The two agents meant to be supported are Gemini CLI and OpenCode; neither is recorded
  yet, so every ACP capability is advertised.
- Steering is never claimed: ACP has no way to add a message to a running turn.

## Mapping to the provider contract

| Contract | ACP |
| --- | --- |
| `Command::Open` | spawn, `initialize`, then `session/new` or (resume, when advertised) `session/load` |
| `Command::Send` | `session/prompt`; its response ends the turn with its `stopReason` |
| `Command::Interrupt` | `session/cancel` (a notification); the turn ends when the prompt answers `cancelled` |
| `Command::Answer` | the response to `session/request_permission` |
| `Command::Steer`, `Command::ReadHistory` | refused |
| `ProviderEvent::Item`, `TextDelta` | `session/update`: message and thought chunks, tool calls and their updates, plans |
| `ProviderEvent::ApprovalRequested` | `session/request_permission` |

Stop reasons: `end_turn` completes the turn; `cancelled` interrupts it; `refusal`,
`max_tokens` and `max_turn_requests` fail it with the reason as the error.

## Limits

- A frame is one line of UTF-8 JSON, bounded like every provider's (1 MiB). An agent's text,
  titles and tool input are cleaned, bounded and masked by the contract's shared code before they
  are kept or shown ([SECURITY](../SECURITY.md)).
- The agent's stderr is drained and never kept.

## Project-specific: configuration

An ACP agent is an `[[agents]]` entry with `acp = true`. The entry names the program and its
arguments; Maiker does not guess an agent's ACP flag. The keys and their checks are in
[ENVIRONMENT](../ENVIRONMENT.md) once the daemon reads them (MAITTY-493); until then no agent
runs through ACP.

## Project-specific: what is verified

Nothing against a real agent. The dialect is tested against the protocol's types and a fake
agent whose lines were written by hand from the schema, not recorded. Gemini CLI and OpenCode
have not been run here; recording their real output and pinning their versions is MAITTY-469,
MAITTY-496 and MAITTY-497.

`agent-client-protocol-schema` turns on `serde_json`'s `preserve_order` for the whole build, so
JSON objects keep the order they were built in instead of sorting their keys. The golden records
must stay unchanged when the dependency is added.
