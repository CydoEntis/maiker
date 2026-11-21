# Claude Code CLI

> **Use for:** daemon-owned Claude Code conversations in Maiker's optional chat GUI.
> **Requires:** the Claude Code CLI installed on the user's machine.
> **Fills:** ARCHITECTURE § planned structured conversations; API_PATTERNS § structured conversation IPC.

## Rules

- Drive the installed Claude Code executable through headless JSON streaming.
  Keep process ownership, session identity and durable conversation state in
  Maiker's daemon; the GUI and Tauri host are clients.
- Keep the Claude protocol in its own provider adapter. Do not emulate Codex
  JSON-RPC or expose provider frames to the GUI.
- Preserve and resume only the exact native session ID and its verified
  configuration root and working directory. Never continue the most recent
  session by inference.
- Pin and verify Claude Code versions before enabling structured chat. Validate
  each JSONL frame, cap frame and queue sizes, use argument arrays, and reject
  unknown or ambiguous control messages.
- Route permission prompts through Claude Code's Agent SDK stdio callback
  channel using `--permission-prompt-tool=stdio`. Keep every offered choice and
  request ID exact; fail closed on unsupported input. The public CLI reference
  describes the flag as an MCP tool name; the official Agent SDK uses `stdio`
  internally when its `canUseTool` callback is configured.
- Correlate each submitted operation to Claude's own message and lifecycle
  evidence. Persist an uncertain receipt before sending; never replay a prompt
  whose delivery is uncertain.
- Interrupt the exact active turn, then wait for provider completion and child
  tree cleanup before releasing conversation ownership. Client disconnects do
  not stop daemon-owned work.
- Let the installed Claude Code CLI own authentication. The user signs in with
  `claude auth login`; Maiker does not collect, copy, store or transmit Claude
  credentials. Do not put credentials in process arguments, logs, conversation
  records or GUI IPC.
- Keep the TUI-only build independent of desktop packaging. Test Windows,
  macOS, Linux and real Omarchy before advertising Claude support.

## Project-specific: Claude Code CLI

The selected protocol is Claude Code's `stream-json` input/output, following
PandaCode's installed-CLI provider shape. The user approved subscription sign-in
through the installed CLI. Anthropic's Help Center currently says third-party
app usage continues to draw from Claude subscription limits; Maiker does not
provide a separate Claude login or implement its own agent harness. The official
Agent SDK uses `--permission-prompt-tool=stdio` for its `canUseTool` callback.
The Maiker adapter follows that wire contract. See
[ADR 0005](../adr/0005-provider-adapters-and-permissions.md) and
the [transport research](../research/claude-code-gui-transport.md).

The rule above against emulating Codex JSON-RPC is not yet met inside the daemon: `TurnProjector`
and `claude.rs` hand the daemon Claude's events under Codex's notification names (`turn/started`,
`item/completed`, `item/commandExecution/requestApproval`), because the daemon's conversation
code reads that one vocabulary. No Claude frame and no Codex name reaches a client. The provider
trait (MAITTY-482, MAITTY-484) replaces those names with provider events;
[the fit check](../research/provider-trait-claude-fit.md) lists what moves.

Windows Claude Code 2.1.314 was verified directly and through Maiker's daemon on
2026-10-30. The daemon smoke covered conversation creation, streamed
response/history, exact-session resume, an SDK stdio permission request, user
approval, and a completed file write. A direct CLI check covered active-turn
interruption. Authentication uses the existing local Claude Code sign-in.
Claude Code 2.1.316 also passed a Windows GUI smoke on 2026-10-31: Maiker
created a Claude conversation, sent a prompt, and displayed the reply in that
conversation. This smoke does not replace the deeper 2.1.314 permission and
resume checks.
Claude Code 2.1.327 passed on Linux on 2026-11-18 (`--model haiku`, a scratch project), both
through the adapter's own launch arguments and parser and through a nested daemon: initialize,
streamed text, a Bash `can_use_tool` request approved once and denied once, an interrupt, `--resume`
of the exact session (it recalled the first turn) and the result frames with `usage` and
`modelUsage`. Every frame parsed; the ones the adapter does not use (`system` `hook_started`,
`hook_response`, `status`, `thinking_tokens`, `rate_limit_event`, thinking and signature deltas)
are ignored. Two shapes, also seen on 2.1.325: `system`/`init` arrives after the user message,
not before the initialize answer, so the adapter checks its session during the turn too; and an
interrupted turn ends with `is_error: true`, `subtype: "error_during_execution"`, which the adapter
reports as `interrupted` once Claude acknowledged the interrupt. Verified versions:
2.1.312, 2.1.314, 2.1.316 and 2.1.327 (`VERIFIED_VERSIONS` in `maitty-provider-claude`).
A Claude chat with history is not taken up again after a daemon restart; that is the daemon's
history rule, not a version limit.
Native Linux/Omarchy and macOS checks, plus daemon recovery after interruption,
remain open; keep those as release acceptance items in the roadmap.
