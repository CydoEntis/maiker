# 0005. Provider adapters sit behind the daemon, and Maiker never widens permissions

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

The daemon can start an agent as a structured conversation (no terminal) as well as watch one in
a pane (0003). Each provider speaks its own protocol.

## Decision

- Codex (`app-server`) and Claude Code (headless `stream-json`) each live in their own adapter
  crate behind the daemon's provider contract, whose shape is
  [0018](0018-one-provider-contract-with-no-io.md). Adapters are built with the daemon; there is
  no plugin ABI or runtime download.
- Maiker launches the official CLI with the user's own sign-in. It offers no login screen and
  does not handle OAuth tokens.
- Permission posture is the provider's. Maiker only chooses the setting and never widens a
  session's permissions after it starts. **Bypass Permissions** (the provider's own skip-permissions
  mode: Claude `--dangerously-skip-permissions`, Codex `--dangerously-bypass-approvals-and-sandbox` or
  `Sandbox::FullAccess` always paired with `ApprovalPolicy::Never`, Gemini `--yolo`) is **on by default
  for every agent**, with one switch per agent to turn it off (`[permissions.bypass]` in `config.toml`,
  shared by both apps). It is chosen when a session starts and fixed for it: a chat still sends its
  choice explicitly and shows a visible tag, a session already running keeps how it started, and a
  resumed session gets the flag again only when it started with it and its switch is still on. An
  agent with no known flag (or a custom flag that is not a plain option) starts as it always did.
  The reason for the default: people run many agents at once and approving each step one by one was
  the main thing that stopped them; the switch keeps a per-agent way back.
- The one exception is a person's own, explicit **Always in this project** on a command request in
  a chat. The daemon then keeps that project and the hash of that exact command in
  `chat-allowed-commands.json` in the app's data folder (never in the repo) and approves the same
  command, written the same, in that project without asking. It covers command requests only: never
  a file change, a permission grant or a question. Only a human client can make it; a pane or
  structured client is refused. A rule widens nothing the person has not already said yes to.
- A capability is reported as verified only when it was checked against a pinned version of the
  provider. Each adapter states its own, and the daemon sends them with the conversation.

## Alternatives considered

- **Bundle our own agent runtime**: rejected, the point is to run the user's agents.

## Consequences

- A new enum variant is an incompatible message shape and bumps `PROTOCOL_VERSION` (0002).
