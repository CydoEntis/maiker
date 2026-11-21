# 0016. A chat asks before it starts helpers, and the consent belongs to the conversation

- **Status:** Proposed
- **Date:** 2026-11-20

## Context

A terminal session's agent may start helpers (other sessions, through `maiker mcp`) once the
person says so: the request is held on the pane, the pane reads needs-you until it is answered,
and `sessions.helpers_at_once` bounds how many work at once
([API_PATTERNS](../API_PATTERNS.md#project-specific-api-style), *Helpers*). The helper's
`TermInfo.started_by` names the pane, and both apps show it.

A chat (a structured conversation, [0005](0005-provider-adapters-and-permissions.md)) has none of
this, and the two providers differ:

- **A Codex chat** runs its tools with the daemon-minted runtime identity (`Hello.structured`).
  The daemon refuses every start from it: "Structured runtimes cannot start descendants until
  conversation-owned helper consent is supported".
- **A Claude chat** is launched with every identity variable removed and no runtime identity
  added. A `maiker mcp` it loads from the person's own Claude configuration therefore connects
  with no identity, which the daemon reads as a person. Read from the code, not yet run against
  a live chat: its starts are not asked about, not counted against `helpers_at_once`, and the
  sessions they start carry no `started_by`.

So in the desktop app's chat view a lead either cannot delegate (Codex) or delegates unasked and
unseen (Claude).

## Decision

1. **The conversation owns the consent.** What a chat has asked, and whether the person said
   Allow or No, is held on the conversation's state for as long as it runs, as a pane's is held
   on the pane. `[sessions] helpers`, `helpers_at_once` and `helper-projects.json` apply
   unchanged; there is no second setting.
2. **Who asks is the runtime, proven as its status is** ([0003](0003-status-and-conversation-trust.md)):
   a start counts as the chat's only on a connection that authenticated with the current
   runtime identity. A stale, revoked or partial claim is refused and is never read as a person.
3. **Only a person answers.** `Command::AnswerChatHelpers { conversation, choice }` is refused
   from a pane and from a structured runtime, and is an error unless that conversation is asking.
4. **Asking is needs-you.** `ConversationSummary.helper_ask` lists the tasks, and the
   conversation's status reads Blocked while it is not empty, whatever the provider reports.
5. **Only helper starts open.** A chat's runtime may send `NewWorkspace` and `NewWorktree` with a
   command, under the consent and the limit. Every other descendant command (a tab, a split, a
   popup, another chat) stays refused.
6. **A helper says which chat started it.** `TermInfo.started_by_chat` holds the conversation,
   beside `started_by` for a pane; at most one is set.
7. **A Claude chat's tools get the runtime identity a Codex chat's have**, so they are known as
   the chat and go through the same consent. This removes the unasked path above.

`PROTOCOL_VERSION` becomes 120 for the new command. `COMPATIBLE_SINCE` stays: the two fields are
`#[serde(default)]`, and an older daemon is never sent the command (`introduced_in`).

## Alternatives considered

- **Leave chats unable to start helpers**: the desktop app's main view could not use the one
  thing a multiplexer adds, delegating across providers, and the Claude path would stay unasked.
- **Reuse `AnswerHelpers` with a pane-or-conversation target**: retyping a field is an
  incompatible shape that an older peer would misread, where a new command is simply refused.
- **Ask on the chat's linked pane**: a chat usually has none, and the request would then have no
  row to show on.
- **Treat a chat's runtime as a person once the person has allowed helpers**: it would also be
  let through every human-only command (grants, check answers, helper answers).

## Consequences

- One more piece of per-conversation state, a command, and an answer control in both apps.
- A Claude chat that started sessions unasked is now asked first.
- Consent is cooperative, as a pane's is: any process of the same user can still connect with no
  identity. It stops an agent that plays by the rules from spending the machine unasked; it is
  not a sandbox.

## To confirm

1. That Claude Code passes its environment to the stdio MCP servers it starts, so decision 7
   reaches `maiker mcp`. To be checked against a live Claude chat.
2. That Codex's MCP environment allowlist (the appended identity names) still holds for a start,
   on a live Codex chat.
