# 0017. ACP is for agents without an adapter, and what it claims is labelled

- **Status:** Proposed
- **Date:** 2026-11-20

## Context

Maiker runs Codex and Claude Code as chats through adapters written against each one's native
protocol and verified against pinned versions (0005). Other agents (Gemini CLI, OpenCode) can
only be watched in a terminal. Several of them speak the Agent Client Protocol, so one adapter
could run many agents. The provider contract (0016) gives it a place.

Three things had to be decided by the owner: which agents go through ACP, what "supported" means
for an agent nobody here has pinned, and how the protocol change reaches installed peers.

## Decision

- **ACP only where there is no native adapter.** Codex and Claude Code stay on their own
  adapters, even where they offer ACP. An agent is run through ACP only when its `[[agents]]`
  entry says `acp = true`.
- **Capabilities are labelled.** What this project checked against a pinned version is reported
  as verified; what an agent only says about itself is reported as advertised and shown with
  that label. Gemini CLI and OpenCode are the two agents meant to be supported through ACP.
- **One compatibility cut.** The ACP provider identity is a new enum variant, so it takes one
  `PROTOCOL_VERSION` bump that also raises `COMPATIBLE_SINCE`: an older peer refuses to talk and
  never misreads a conversation whose provider it does not know (0002).
- ACP is a dialect behind the provider contract: protocol version 1, its own wire types and no
  ACP library, one process per conversation. The daemon offers the agent no file or terminal methods and no MCP
  servers. A permission request shows the agent's own options; Maiker never chooses one, never
  remembers one, and never moves a running session to a wider mode. The rules are in
  [stack/acp.md](../stack/acp.md).

## Alternatives considered

- **Move every provider to ACP**: one adapter instead of three. It lost because the native
  protocols carry what ACP does not (steering, remembered command approvals, file-change
  previews) and are the ones verified here.
- **Claim only pinned capabilities, as 0005 did**: it lost because an ACP agent could then do
  nothing until someone pinned it, which defeats running an agent we have not met. The label
  keeps the claim honest.
- **Offer the agent Maiker's file and terminal methods**: richer diffs and terminals. It lost
  because Maiker would then be the one writing files and running commands, outside the agent's
  own permission checks (0005: Maiker never widens permissions).
- **A defaulted field instead of a version cut**: no upgrade needed. It lost because a provider
  an older peer cannot name is exactly what it would misread.

## Consequences

- A new ACP agent needs a config entry, not code. It works as far as it advertises.
- Client and daemon must be updated together once, at the cut.
- An ACP chat has no steering, no remembered approvals and no saved-history replay unless the
  agent advertises loading a session.
- The adapter's wire types are ours to keep in step with the protocol. No ACP crate is linked:
  the published types crate changes how `serde_json` orders keys for the whole build.
- Nothing here is verified against a real agent until Gemini CLI and OpenCode are run and
  recorded. Revisit the "no file or terminal methods" rule only with a way to hold them to the
  agent's own permissions.
