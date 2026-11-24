# 0005. Provider adapters sit behind the daemon, and only a person changes permissions

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
- Permission posture is the provider's. Maiker only chooses the setting, and never widens a
  session's permissions on its own: only a person does, in the app. **Bypass Permissions** (the provider's own skip-permissions
  mode: Claude `--dangerously-skip-permissions`, Codex `--dangerously-bypass-approvals-and-sandbox` or
  `Sandbox::FullAccess` always paired with `ApprovalPolicy::Never`, Gemini `--yolo`) is **on by default
  for every agent**, with one switch per agent to turn it off (`[permissions.bypass]` in `config.toml`,
  shared by both apps). It is chosen when a session starts: a chat still sends its choice
  explicitly and shows a visible tag, and a resumed session gets the flag again only when it started
  with it and its switch is still on.
- A person may change a running **Claude or Codex chat** the daemon runs to read-only, ask before
  edits, or full access, wider or narrower (`Command::ConversationSetPermissions`): the same three
  postures a chat starts with, never a mix (full access goes only with approval `Never`). Only a
  human client with the admin grant may send it; a pane or a chat's own agent is refused. The daemon
  saves the new settings at once, so a restart or resume keeps them, and hands them to the agent
  with the next message: Claude starts that turn's process with them, Codex takes them on
  `turn/start` and keeps them for the turns after. The turn under way keeps how it started. An agent
  run over ACP, and an agent in a terminal, keep their own settings; a terminal's mode is the
  agent's own key or command, typed as its user would. An
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
- **A Claude Code version does not need adding by hand.** A chat starts on any Claude Code that
  prints a version and whose `claude --help` lists the flags the adapter passes (the permission
  channel included). A missing flag refuses the start, naming it, before any conversation exists.
  A version the adapter was not run against is tagged `Verified::Advertised`, the label this
  contract already has for what a provider only says about itself; the pinned list
  (`VERIFIED_VERSIONS`) records only what was run. What stays strict at run time: unknown frames,
  unknown control requests and unreadable permission requests end the turn or wait for a person;
  nothing is ever allowed on the adapter's own say. Codex keeps its pinned-version gate.

## Alternatives considered

- **Bundle our own agent runtime**: rejected, the point is to run the user's agents.

## Consequences

- A new enum variant is an incompatible message shape and bumps `PROTOCOL_VERSION` (0002).
