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
- Gate structured chat on what the installed Claude Code can do, not on its version
  number (`check_cli`; the policy is in
  [ADR 0005](../adr/0005-provider-adapters-and-permissions.md)).
  Validate each JSONL frame, cap frame and queue sizes and use argument arrays. Skip and log
  an output frame type the adapter does not know; answer a control request it does not know
  with an error, never a grant ([ADR 0005](../adr/0005-provider-adapters-and-permissions.md)).
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

The rule above against emulating Codex JSON-RPC holds for what Claude reports and for what it
is asked: `TurnProjector` and the approval reading (`maitty-provider-claude/src/approvals.rs`)
hand the daemon typed provider events, no Claude frame reaches a client, and `claude.rs` takes
the daemon's typed commands (`runtime::Rpc`). One Codex shape is left: `claude.rs` answers a
send, and the opening of a conversation, in the JSON the daemon reads every provider's answers
in ([ADR 0018](../adr/0018-one-provider-contract-with-no-io.md)). `ClaudeDialect` (`dialect.rs`)
implements the provider contract and is tested by itself; the daemon still runs Claude through
`claude.rs`, which starts the next message's process ahead.

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
reports as `interrupted` once Claude acknowledged the interrupt. Any other `is_error: true` result
is a failed turn: its `result` text (or, without one, its `errors` list joined) is the turn's
error, capped at 1024 characters, and never the answer, which keeps what was streamed.
Claude Code 2.1.330 passed on Linux on 2026-11-20 (`--model haiku`, a scratch project) through the
adapter's launch arguments, parser and turn projector, not through a daemon: three processes on one
session, a Bash `can_use_tool` request approved (the file was written), one denied after
`--resume`, and an interrupt after a second `--resume`. All 97 frames parsed and the projector
ended the turns as completed, completed and interrupted. Both `can_use_tool` requests carried
`tool_use_id`, so an approval links to its tool step by that id; the request-id fallback in
`approval_request` stays for a request without one. The request also carries `description`,
`display_name`, `blocked_path` and `permission_suggestions`, which the adapter does not read.
Versions the adapter was run against: 2.1.312, 2.1.314, 2.1.316, 2.1.327 and 2.1.330
(`VERIFIED_VERSIONS` in `maitty-provider-claude`). It only tags them pinned; any other version
that passes the flag check starts, tagged advertised, and is not refused. Claude Code
2.1.331 accepted every launch flag the adapter passes and lists `--permission-prompts` in its help,
naming `--permission-prompt-tool` only in that option's text, so the check accepts either name.
**Background tasks outlive their turn.** A helper started with `run_in_background` (or a background
command) keeps running after the turn's result, and closing Claude Code's input ends it. Seen with
2.1.332 on 2026-11-27 (`claude -p` stream-json, one process, input left open): Claude Code lists what
runs in a `system` `background_tasks_changed` frame each time the list changes; when a task ends it
sends `system` `task_notification` (`task_id`, `status`, and `summary` with `summary_is_report` for a
helper's answer), then the list again, then an `init` and a whole turn of its own with no user
replay, ending in its own `result`. Its transcript keeps the news as a user message of
`<task-notification>` blocks. So `claude.rs` keeps the process after a turn while anything runs
(`Lingering`). Each `task_notification` becomes that block as a user message, so live and read back
look the same (`task_notification_text`): in the running turn when one is open, otherwise it opens a
turn Claude started (`TurnProjector::unprompted`, no delivery receipt). The person's next message goes
to the same process when it needs the same launch arguments. The process is closed once the list is
empty and no turn is open, and then a process for the next message is started ahead as after any
turn. It is also closed when a message needs other arguments, when the conversation stops, or after
`BACKGROUND_TIME_LIMIT` (2 hours). Each of those ends the tasks, so the daemon writes a `stopped`
notification for each one first. A tool request that arrives between turns has nobody to ask, so it
is refused (never granted) with a reason the helper reads.

After a daemon restart, a stop, or an agent gone mid-turn or between turns, a Claude chat is taken
up again by reading its past from Claude Code's own transcript (`begin_saved_history`), which needs
`restore.output` on. That transcript is what `claude --resume` itself continues from. When the
turn was cut (the daemon or the agent went away mid-turn) the transcript stops partway through it,
so the daemon marks that last turn interrupted (`stop_open_turn`) rather than leave it running.

Every Claude Code process a chat starts gets the chat's runtime identity (the four reserved
variables, ADR 0016) after the inherited pane and chat variables are removed, so a Maiker tool
server it loads is known as the chat. Seen on Linux with Claude Code 2.1.330 on 2026-11-21, on
terminal sessions and with `claude mcp list`, not through a chat:

- Claude Code passes its whole environment to the stdio MCP servers it starts: a `mcp` child of a
  session in a pane held the pane's variables.
- A chat is started with `CLAUDE_CONFIG_DIR` set, and Claude Code then reads the user's MCP
  servers from `<config root>/.claude.json`, not from `~/.claude.json`. `integrate` registers
  Maiker's server in `~/.claude.json` for the default root, so a chat on the default root loads
  no Maiker tool server and starts no helper.
A Claude chat in the desktop app on 2.1.330 (approve, decline, Stop, close the window, reopen),
native Linux/Omarchy and macOS checks, and daemon recovery after interruption remain open.
