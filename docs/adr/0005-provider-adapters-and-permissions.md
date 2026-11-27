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
- **An adapter works with any version of its provider's CLI or app-server; a version list is
  never a gate.** A start is refused only when the binary cannot say what it is, or lacks a
  capability the adapter needs, and the refusal names the provider, the version found, what is
  missing and what to do (update it, or use the terminal agent). It is raised when the chat is
  admitted, before any conversation exists, so a refused start leaves no row. Each adapter probes
  what it can without starting a session:
  - Claude Code: `claude --version` must name a version and `claude --help` must list the flags the
    adapter passes, the permission channel included (`check_cli`).
  - Codex: `codex --version` must name a version and the generated app-server schema must declare
    every method and params type the adapter uses (`check_compatibility`). `turn/steer` stays
    optional and is read from the same schema.
  - ACP agents (Gemini CLI, OpenCode and any other): there is no probe before `initialize`, so the
    agent is asked, and it is refused only when it answers `initialize` with a protocol version other than 1.
    No program version is ever compared.
- A capability is reported `Verified::Pinned` only when it was run against that version of the
  provider; each adapter keeps a list of what it was run against (`VERIFIED_VERSIONS`) and it is
  only a tag. Any other version that passes its probe starts and is reported
  `Verified::Advertised`, the label for what a provider only says about itself.
- At run time, read leniently and grant strictly, for every provider. An output frame the adapter
  does not know asks for nothing: it is skipped and logged, and the turn goes on, because
  providers add frames between releases and ending the turn broke every chat on each one. A
  request the adapter cannot read is never granted: Claude Code gets an error answer and carries
  on, other providers' requests wait for a person. An unreadable permission request is never
  allowed, and nothing is ever allowed on the adapter's own say. A tool request that arrives
  while no turn is open (a Claude helper still running in the background) has nobody to ask, so
  it is denied with a reason the agent reads.

## Alternatives considered

- **Bundle our own agent runtime**: rejected, the point is to run the user's agents.

## Consequences

- A new enum variant is an incompatible message shape and bumps `PROTOCOL_VERSION` (0002).
