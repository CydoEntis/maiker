# Agent Client Protocol (ACP)

> **Use for:** Running an agent as a daemon-owned chat with no terminal: every chat the Chat view starts.
> **Requires:** the provider contract ([ADR 0016](../adr/0016-one-provider-contract-with-no-io.md))
> **Fills:** ARCHITECTURE § provider adapters; SECURITY § provider permissions

## Rules

- ACP is one dialect behind the provider contract, in `crates/adapters/maitty-provider-acp`.
  Nothing outside that crate names an ACP type, and no ACP frame reaches a client
  ([ADR 0017](../adr/0017-acp-for-agents-without-an-adapter.md)).
- Every chat the Chat view starts runs over ACP, Claude Code and Codex included
  ([ADR 0018](../adr/0018-the-chat-view-talks-to-the-agent-directly.md)). Their own adapters
  stay for chats already started with them and for the CLI.
- Speak protocol version 1 only. An agent that answers `initialize` with another version is
  refused, with its version in the message.
- The wire types are the adapter's own (`wire.rs`): only the messages it reads and writes. Do not
  add `agent-client-protocol-schema` or the SDK crate `agent-client-protocol` to the workspace.
  The schema crate turns on `serde_json`'s `preserve_order`, and cargo applies a feature to every
  crate in the build: with it, JSON objects stop sorting their keys everywhere, which changed the
  daemon's golden records and the CLI's call fingerprints when it was tried
  ([research](../research/acp-rust-package.md)).
- Route by method name, then read the payload as that method's type. A kind the adapter does not
  name (an update, a content block, a tool kind, a stop reason) reads as `Other`: it is skipped or
  shown as unsupported, never guessed at.
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

- `session/request_permission` offers a person only what the agent offered: allow once, allow
  for the session (the agent's `allow_always`) and decline (`reject_once`), each only when the
  agent listed an option of that kind. `reject_always` has no choice of ours and is not offered.
  Each choice carries the agent's own name for it (`ApprovalRequest::choice_labels`, cleaned and
  cut like every agent text; none when a name cleans to nothing). No client shows them yet
  (MAITTY-495).
- Maiker never sets an agent's mode (`session/set_mode` is never sent). A change of mode is the
  agent's to ask for, as a permission a person answers.
- A person's choice is sent back as the id of the agent's first option of that kind. Maiker never
  picks an option the person did not, and never answers from a remembered rule: the "always in this project" rule of
  [ADR 0005](../adr/0005-provider-adapters-and-permissions.md) is for command requests of the
  native adapters, whose commands Maiker can hash exactly.
- Interrupting a turn sends `session/cancel` and answers every permission request still open with
  the `cancelled` outcome, never with an option. A request that arrives outside a turn is
  answered `cancelled` and shown to nobody.
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
`max_tokens`, `max_turn_requests` and any other fail it with the reason as the error. A prompt
the agent answers with an error fails the turn with the agent's message, cleaned and cut, and
the conversation goes on.

A saved session's replayed updates (`session/load`) are dropped: the daemon does not rebuild
history from them yet, so `history_replay` is never claimed. The history of an ACP conversation
is what the daemon recorded while it ran (`HistorySource::Recorded`); the agent is never asked
for it. A conversation is continued only when the agent says it loads sessions and the daemon
still holds its record; otherwise it is blocked with the reason, and nothing is sent.

## Limits

- A frame is one line of UTF-8 JSON, bounded like every provider's (1 MiB). An agent's text,
  titles and tool input are cleaned, bounded and masked by the contract's shared code before they
  are kept or shown ([SECURITY](../SECURITY.md)).
- The agent's stderr is drained and never kept.

## Project-specific: configuration

An ACP agent is an `[[agents]]` entry with `acp = true`. The entry names the program and its
arguments; Maiker does not guess an agent's ACP flag. The keys and their checks are in
[ENVIRONMENT](../ENVIRONMENT.md#project-specific-agents-run-over-acp).

Claude Code and Codex have no ACP mode of their own, so each is run through a helper program
the daemon knows by name (`BUILTIN_ACP_HELPERS` in `maitty-core/src/config.rs`), with no
arguments. Each is an npm package that needs Node 22 or newer and is installed by the person,
never by Maiker:

| Agent | Program | Package |
| --- | --- | --- |
| `claude` | `claude-agent-acp` | `@agentclientprotocol/claude-agent-acp` |
| `codex` | `codex-acp` | `@agentclientprotocol/codex-acp` (not `@zed-industries/codex-acp`, which installs the same name around an older Codex) |

An `[[agents]]` entry named `claude` or `codex` with `acp = true` replaces the helper, and one
with `enabled = false` switches it off. A helper that is not installed is not found when a chat
asks for it, and the refusal names the program. The helper reads the agent's own sign-in and
settings: its model and permission mode are the agent's, not Maiker's.

## Project-specific: how the daemon runs it

`StartTarget::Acp { agent, cwd }` names an `[[agents]]` entry; the daemon resolves the program,
arguments and variables from its own config (`commands/start.rs`) and refuses a start that
names a program for the `Acp` provider. The registry entry (`daemon/providers.rs`) runs the
dialect on the generic runner (`conversation/dialect_runtime.rs`), one process per
conversation, owned and stopped as a process tree like every provider's. The daemon sets no
sandbox for the agent: the agent asks before it acts, and its own limits apply. The summary's
capabilities claim nothing yet: what one agent advertised stays inside its running dialect.

## Project-specific: what is verified

The dialect is tested against lines written by hand from the protocol's version 1 schema
(`maitty-provider-acp/src/fixtures/`), not recorded. Run by hand on Linux, through the daemon:

- **Claude Code** through `@agentclientprotocol/claude-agent-acp` 0.109.1: a chat started, two
  messages were answered and a file edit showed as a tool step. No approval was asked for,
  because that account's own Claude setting is the auto mode.
- **Codex** through `@agentclientprotocol/codex-acp` 2.9.0: a chat started, a message was
  answered and a file was written through commands shown as tool steps. Through
  `@zed-industries/codex-acp` 0.16.0 the chat opened and every message was refused by the
  service ("model is not supported"): its bundled Codex is older than the account's models.

Nothing has been run on Windows or macOS. Gemini CLI and OpenCode have not been run here;
recording real output and pinning versions is MAITTY-469, MAITTY-496 and MAITTY-497.
