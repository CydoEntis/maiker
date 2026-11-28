# API and service patterns

This doc covers how requests flow through the system, how boundaries validate
data, and what responses and errors look like. It applies to any entry point:
HTTP, RPC, GraphQL, IPC, CLI, or queue consumer. `AGENTS.md` is the operating
contract; this doc holds the API and service practices in depth.

## Request flow

```text
entry point (handler / route / command / consumer)
  -> validate + parse input into typed command
    -> use case / service (authorize, apply rules, coordinate)
      -> repositories and adapters (ports)
  <- typed result or typed error
<- map to response shape / status
```

- A **handler** parses input, calls one service, and maps the result. It holds
  no business rules and no queries.
- A **service** owns one use case. It authorizes, applies the rules, and owns
  the transaction boundary.
- A **repository or adapter** owns I/O. It returns domain types, never raw rows
  or SDK objects.

## Input validation

- Validate every request at the entry point with a schema: body, params, query,
  headers, and message payloads. Reject the request before it reaches a service.
- Parse into types. After validation, the service receives a typed object, not
  a raw payload.
- Keep schemas next to the feature that owns them. If a client shares them, put
  them in a shared package, never duplicated.
- Treat IDs from clients as untrusted. Check that the resource exists **and**
  that the caller may access it.

## Responses

- Use one consistent success shape and one consistent error shape across the
  whole API. The project records both in *Project-specific: response and error
  shapes*.
- Return DTOs mapped from domain types. Never serialize database rows or
  internal objects directly.
- Use one field-naming convention on the wire, for example camelCase JSON.
- Use timestamps in UTC ISO 8601 and IDs as strings.

## Errors

- Services return or throw **typed domain errors**, such as `NotFound`,
  `Validation`, `Conflict`, `Unauthorized`, `Forbidden`, and `RateLimited`. The
  entry point maps each one to a status or exit code in exactly one place.
- Error responses include a stable machine-readable code, a safe human-readable
  message, and a request id. For validation errors, add field-level detail.
- Unexpected errors are logged with full context and return a generic message.
  Never expose stack traces, SQL, or internal paths.
- A client can act on the error code. Codes are part of the contract; don't
  rename them casually.

## Operations

- **Idempotency:** retryable mutations, such as payments, emails, and
  webhooks, accept an idempotency key or are naturally idempotent.
- **Pagination:** list endpoints are paginated from day one, with a documented
  default and maximum page size. Prefer cursor pagination for data that changes
  often.
- **Concurrency:** updates that can race carry a version or ETag, and stale
  writes are rejected with `Conflict` instead of overwriting.
- **Versioning:** removing or renaming a field, or changing its meaning, is a
  breaking change. Version the API or run old and new side by side, then retire
  the old one on purpose.
- **Timeouts and retries:** every outbound call has a timeout. Retries use
  backoff, and only on idempotent operations.

## Auth

- Authenticate at the edge, in middleware or the handler. Authorize in the
  service, against the resource the call acts on.
- Deny by default. A new endpoint without an explicit auth rule is a defect.
- Never trust a client-supplied role, user id, or tenant id without checking it
  against the authenticated identity.

## Client-side data (when there is a UI)

- Keep **server state**, the data owned by the backend, apart from **UI state**
  such as open panels, form drafts, and selection. Don't mirror server data into
  a global UI store.
- Represent every async view's loading, empty, success, and error states
  explicitly.
- After a mutation, invalidate or update the affected cached data at one place
  per feature.

## Observability

- Assign a request or correlation id at the edge and pass it through logs and
  outbound calls.
- Use structured logs: one event per line, with fields rather than
  interpolated strings.
- Log the decision points and failures. Never log secrets, tokens, or personal
  data.

## Project-specific: API style

Not HTTP. A private IPC protocol between client and daemon over a local socket
(or `ssh host maiker proxy`): length-delimited frames carrying msgpack-encoded
`ClientMsg` / `ServerMsg` enums (`crates/maitty-shared/src/protocol.rs`). The first exchange is
`Hello { version }` → `Welcome { version, compatible_since }`. The client decides whether
the two talk (`protocol::speaks_with`): the same `PROTOCOL_VERSION` always does, and another
one does inside the compatibility window, which is from the newer side's `COMPATIBLE_SINCE`
up to its own version. Outside it the connection is refused. Inside it the newer side adapts:
the daemon does not send a client a message newer than the client (`ServerMsg::introduced_in`)
and passes over a request it cannot decode from a newer client; a client checks
`ClientMsg::introduced_in` before sending an older daemon a request that needs an answer.
One client is stricter: the desktop window's line to another machine (`Dial::newest_only`)
refuses a daemon on an older version even inside the window, so the machine shows
`needs-update` and the window offers its update.
Changes are additive, so the window rarely closes. A new message gets its own `introduced_in`
arm and `*_SINCE` constant. An added field with `#[serde(default)]` is compatible (messages are
named msgpack maps and unknown fields are ignored), provided a test decodes the old shape. A new
value in `Status`, `SubagentState`, `TurnKind`, `RecoveryState` or `RemovalReason` is compatible
too: each ends in `#[serde(other)] Unknown`, which a peer from `UNKNOWN_VALUES_READ_SINCE` (131)
on reads a value it does not know as, and shows as not known (the terminal app's `┆` and "not
known", the desktop app's `unknown`), never as one of the others. Bump `PROTOCOL_VERSION` for
anything a peer checks for; `COMPATIBLE_SINCE` stays. Until `COMPATIBLE_SINCE` reaches 131, a
new value in one of those enums still moves it to 131, since older peers lack `Unknown`. Any
other enum an older peer is sent gets an `Unknown` of its own, in a change ahead of its first
new value. Only a real break moves `COMPATIBLE_SINCE` to the new version: a field removed,
renamed or retyped, or a new value in an enum without `Unknown`. A client passes over a pushed
message it cannot decode (`connections::read_until_lost`, the desktop app's
`ipc::receive_pushed`) and says so when an answer it waited for is one
(`ipc::UNREADABLE_ANSWER`). Hooks say Hello
too, but a hook or usage report is also accepted by an older daemon back to
`REPORTS_READ_SINCE` (`ipc::open_for_report`), so an update does not stop hooked panes
reporting before the daemon restarts. When `Hook`, `Usage` or `HookStatus` changes in a way an
older daemon cannot read, set `REPORTS_READ_SINCE` to the new version in the same change; the
test `todays_reports_are_read_by_the_oldest_daemon_they_are_sent_to` holds the shapes. The CLI subcommands and the MCP server (`maiker mcp`, JSON-RPC over stdio)
are thin wrappers that send the same commands.

What each message does is documented on its type in `protocol.rs`. The rules below are the ones
that span several messages or that a client must follow.

- `StartTarget::Agent` is how a window starts a chat on another machine: that daemon finds the
  agent's program and settings folder itself (ADR 0007). A start on this computer names both
  (`StartTarget::Create`).
- `ApprovalRequest.choice_labels` holds a provider's own names for `choices`, in the same order.
  They pair only while the two lists are the same length.
- A request that changes something and is not safe to ask twice (`DiscardFile`, `FolderGit`,
  `CreateFolder`, …) is never sent on a kept connection (`safe_to_ask_twice`).

**Discarding a file.** `Query::DiscardFile` is for human clients only, with the pane checks and
the write grant of `Query::Git`. The daemon asks git what kind of change the path is and undoes
that kind; the client never names it. The rules and typed refusals are `maitty_shared::discard`
(SECURITY, *Discarding a file's changes*). It does no I/O itself: the daemon
(`daemon/discard.rs`) and the desktop host each run it with their own git. Another machine's
answer passes `remote_repo::vet_discard_reply`.

**Conversation changed.** `ServerMsg::ConversationChanged` goes to the desktop app's attached
clients only, at most once per 100 ms per conversation, and never for a conversation seen for the
first time. It carries no content: the window reads as before, under the same checks. The host
passes it on only for this computer; another machine's is ignored (`remote_policy`).

**Typing into a pane.** `Command::SendWhenReady` and `Command::QueueFollowUp` type into a pane
only once its agent is at rest, never while it works or asks. A held `SendWhenReady` is saved with
the pane (the desktop command `send_when_agent_ready` takes at most 256 KiB, not blank). Their
optional `operation` (`daemon/terminal_sends.rs`) is a random nonzero 64-bit nonce per send, never
a counter, since it is keyed by pane and not by sender; zero is refused. A retry with the same
pane, operation and text is acknowledged with `Ok` and not typed again (`Ok` means accepted
earlier, not delivered); the same operation with other text is refused. A client sends an
operation only to a daemon at `TERMINAL_SEND_OPERATIONS_SINCE` or later, never to another
machine's pane. The desktop app's nonce (`terminalSendOperation`) stays below 2^53 so a
JavaScript number carries it exactly, and is reused only for the same text resent within
`FAILED_SEND_REUSE_MS` after a failed send, with the box unedited.

**Prewarm.** `Command::Prewarm` runs a hidden spare agent (`daemon/warm.rs`). Only an app window
may ask, never a pane or a structured runtime.

**Worktrees from a window.** `Command::BranchWorktree` makes a worktree for a window with no pane
to ask from. The daemon checks `branch` as the branch agent does; `project` must be a git
repository the app shows, or from a person's own window any folder the person picked
(`may_name_checkout`). It uses `create_trusted_worktree`, runs the repo's `on_create` and lists the
folder in `made_worktrees`. Structured runtimes may not ask. With `base`, `branch` is always a new
branch cut from `base`, never the base branch itself. Another machine's reply passes
`remote_chat::vet_worktree_reply` (one plain absolute path).
`NewWorktree`'s `agent` and `prompt` are checked by the daemon (`daemon/branch_agent.rs`), and
the prompt is quoted for the pane's shell (`Config::agent_command`), never interpolated.

A project heading's New worktree (`new_worktree_session`) asks the daemon that owns the pane
(`Query::List`, then `Command::NewWorktree` with no command). For another machine both go over a
request line and only `List` and `Ok` are taken (`remote_chat::vet_new_worktree_reply`); a machine
that takes no requests is refused before anything is sent. Removing and comparing worktrees and
the worktree manager stay this computer's.

**Helper reads and specialists.** `Query::HelperRead` and `Query::Specialists` are read off the
event loop. A refused helper read is a `ServerMsg::Error` naming why, never content.

A pane's effort (`TermInfo.effort`, an optional field: no `PROTOCOL_VERSION` bump, a test decodes the old shape) is read by the
daemon from the agent's own files every five seconds off the loop (`usage::poll_effort`): for Claude the level in the newest request
line of its transcript, present only when a level was set; for Codex the level its thread settings name, else its model's default
from Codex's `models_cache.json`. Nothing is guessed: a pane whose files say none has none, and the window then says "agent's own".
The same read keeps what a Claude pane last ran (`Term.runs_with`, saved as `SavedPane.runs_with`): the newest level said, and
the model of the newest main-thread request (`querySource` `repl_main_thread` or `sdk`; a side request may run another model) or
the alias (`opus`, `sonnet`, `haiku`) of a `/model` typed after it. A read that finds neither keeps the last. Its resume (a
restart, a wake, a reload, a move) adds them as `--model` and `--effort` (`Daemon::running_as`), quoted for the shell, only for
Claude and only when they pass `TurnChoice::validate`: Claude starts a resumed session on the account's default model, which a
`/model` in any other session changes, and an effort set for the session only is gone.

`TermInfo.began_as_agent` is set once at start and saved with the pane; a pane saved without it
reads from its command. A pane with it whose agent ended (by its hook, or lost by several process
scans in a row) is ended by the daemon unless an agent is back, a program runs in it or someone
typed since (`close_ended_agents`).

**Follow-up queue.** A pane's follow-up queue (`TermInfo.queued`) is the daemon's. It types the
oldest when the agent's own report says the turn ended (`Term::own_turn_over`, even while
background helpers work), never into a question, and keeps the rest across a restart. Nothing the
daemon types for a pane (`Term::pending_input`) goes in while the pane is Blocked. A queue belongs
to the agent it was made for: a pane whose agent ends or changes drops it, and nothing goes in
while the scan has just missed the agent (`agent_missed`); Claude's `SessionEnd` for `/clear` is
not an end. A report from another session while the agent is mid-turn is ignored whole
(`apply_hook`). The Enter after a queued command (`/resume`) is not pressed again when no prompt is
reported. `DropQueued` drops the one at `index` only while it still reads `text`.

**State updates.** A state change reaches attached clients as `ServerMsg::State` (the whole
`Snapshot`) or `ServerMsg::TermsChanged` (the panes to replace and the ids to drop), and nothing is
sent when nothing visible changed. Both carry a `revision`, counted per surface from 1, so a gap
means a missed update (0: a daemon built before it, or nothing sent yet). Both say why each dropped
pane left, as a `RemovalReason` by pane id; no reason means not said, never a reason. A pane that
ended while nobody was attached is named to nobody.

- A client merges a delta only when its revision is 0 or one more than it holds, and sets the
  snapshot's `removed` to the delta's `reasons`. After a gap, or with no snapshot, it drops the
  delta and sends `Query::List`, once per run of such deltas, again only after
  `LIST_ASKED_AGAIN_AFTER` or a new line. The desktop host (`streams.rs`) and the TUI
  (`client/background.rs`) both follow this; the TUI also keeps a pane dropped without a reason
  until a whole list confirms it.
- A list alone is no base for a delta, so after `Query::List` from an attached client, and after
  an attach, the daemon sends that surface its next change in full.
- Another machine's delta is cleaned first and merged into that machine's own snapshot (SECURITY,
  "remote daemon").

**Replays** follow `Hello.replays`: a terminal client takes every pane's replay on attach; the
desktop window attaches without and sends `ClientMsg::WantReplay { term }` when it shows a pane.
A desktop replay is the last mebibyte of the ring, then the screen as it is. A replay of a pane on
the alternate screen repaints the main screen, switches, then repaints the alternate one.

**Over ssh.** `maiker proxy` writes `STREAM_MARKER` to stdout once, after it reaches the daemon
and before it relays a byte. The marker sits outside the frames, so it is not a protocol change.
The client sends its Hello, then discards stdout up to the marker (at most 64 KiB, within 30 s,
longer than ssh's `ConnectTimeout`). Text with no marker fails with "the remote login printed
text before maiker started (or it runs an older maiker: update it)"; nothing at all fails with
what ssh said. A remote from before the marker is not refused: when its first four bytes are a
plausible frame length (up to `MAX_FRAME_BYTES`), they are read as the first frame and the
version check applies.

**The desktop host.** The Tauri GUI invokes only fixed desktop commands from
`crates/maitty-desktop-client/`. Validate webview input in both the TypeScript boundary and the
Rust host. Never expose a generic process or shell command. Between the host and the webview
(`terminal_stream.rs`, `streams.rs`, `apps/gui/src/api/`):

- Pane output from every machine arrives as raw frames on the one channel opened with
  `watch_terminal_output`: machine (2 big-endian bytes, 0 for this computer), pane (4), sequence
  number (8), one replay byte, then the output. This header is host-to-webview only. Another
  machine gets at most 256 KiB per flush; when 4 MiB of a pane's output waits, it is dropped and a
  fresh replay asked, so one machine cannot slow this computer's panes.
- `terminal_history`, `terminal_input` and the pane commands take an optional `machine` (this
  computer when left out). Another machine's pane is asked over its line (`PaneCommand`), and its
  reply is taken only while a request is out (30 s, 64 kept). Typing for a machine with no line is
  refused, counted and reported as `unsent` on its next `connected` state.
- The daemon's `Snapshot` goes out as `sessions-changed` (`null` when the stream dropped), and
  another machine's, cleaned, as `machine-sessions-changed`. A sidebar row goes at once only for a
  session in `removed` or closed in the window; any other miss waits for a list to confirm it
  (`list_sessions`, or `ask_machine_list` at most once per `WINDOW_LIST_ASK_EVERY`).
- A machine's `clipboard`, `notices` and `sounds` are off unless its entry says.
  `set_machine_grant` writes `config.local.toml` first, then applies. `remove_machine` deletes the
  entry first and only then stops the machine; its sessions and saved layout are left alone.
- `add_machine` looks at the machine over ssh without asking anyone anything and writes the entry
  only when that held up (`login`: written, but ssh could not log in alone; `failed`: nothing
  written). A login that needs a person opens ssh in a session on this computer
  (`open_machine_login`).
- The window names another machine's sessions `build/t12` (by machine name, so a saved layout
  survives a restart) and passes `machine` only for a pane of another machine.
- Files, Changes, Find, managing worktrees (except `new_worktree_session`), file drops and system
  notices are for this computer's panes only. The host commands that read a pane's files or
  repository refuse another machine's with the terminal app's words, as the window does first
  (`apps/gui/src/lib/localOnly.ts`).

**Restarting an older daemon.** A desktop protocol-mismatch restart rechecks the exact local
protocol before stopping an older daemon and refuses to downgrade a newer one. It stops an older
daemon that owns sessions only after the user confirms, and only when those sessions are saved on
disk; one that isn't saving them is left running. On another machine the same refusal comes back
from `machine update`; **Restart anyway** asks every time (`restart-machine-service`) and runs
`<remote_cmd> kill-server` there, ending those sessions.

## Project-specific: response and error shapes

Commands are fire-and-forget; the daemon's answer is the next `Snapshot` (full
state) and pane output frames. Failures come back as `ServerMsg::Error(String)`,
a human-readable message the client shows as a toast; CLI subcommands print it
and exit non-zero.

A tagged query (`tag` in the request) is answered with the same `tag`. A refusal a client must
match to its request is an answer variant (`Err(one line)`, `Failed { reason }`, …), not
`ServerMsg::Error`.

## Project-specific: auth model

Socket access is the auth (see `docs/SECURITY.md`); pane status reports also need
the pane's process tree or `AGENT_PANE_TOKEN` (`MAITTY_PANE_TOKEN` is read the same way; ADR
0012). The names of the daemon, the socket and the variables are not part of the protocol:
renaming one is no `PROTOCOL_VERSION` change, and the handshake decides whether two versions can
talk. A rename of the command moves the socket; the first run under the new name stops the
daemon of the old one so it saves its sessions (`ipc::stop_previous_daemon`, ADR 0008).

Unless a message says otherwise, a query that reads or changes the daemon's computer (folders,
git, GitHub, repositories, settings, extensions, sign-in, closed sessions, workspaces) is for
human clients only: a pane's agent and a structured runtime are refused. An answer from another
machine is cleaned (`remote_policy::vet` and its `vet_*` helpers) and taken only while a request
to it waits. An answer that is about this computer only (sign-in, saved and importable
conversations, saved workspaces, ready closed folders, tidied worktrees, settings changes) is
ignored from another machine.

## Project-specific: feature/module structure

Saved role profiles, sequenced workflows and a fleet commander (`maiker brief`, `[team]`) are not
part of Maiker's interface: old config keys for them are read and ignored. The wire protocol
version is `PROTOCOL_VERSION` in `crates/maitty-shared/src/protocol.rs`.

Conversation tool-history entries carry a bounded provider-supplied `label`, and may carry
`input` (bounded: strings cut with a `[truncated]` marker, a value too deep or too big left out
whole), `exit_code` and `duration_ms` (Codex only), and `started_at_ms` / `completed_at_ms`.
`ConversationRead` returns `answered_approvals`, the last 64 a person answered, in daemon memory
only. A Claude approval's `item_id` is the tool-use id when Claude names it; an edit tool is a
`FileChange` request with its diff in `changes`.

`maiker_answer` takes the `prompt` id that `maiker_list` or `maiker_wait` gave: a hash of the
question and its choices, whitespace aside. If the prompt on screen has a different id, nothing
is sent and the error shows the current question, choices and id.

**Helpers.** A start from an agent's pane (`NewWorkspace`, `NewTab`, `Split`, `NewWorktree` over
a connection that proved it is that pane) is a helper start. Under `[sessions] helpers = "ask"`
the first one is refused with an error telling the agent the user was asked, and the task is
recorded in `TermInfo.helper_ask`; while that is not empty the pane reads Blocked whatever its
hooks report. Only a person answers (`Command::AnswerHelpers`: `Allow`, `Always` for the project
in `helper-projects.json`, or `No`); a pane may not send it. `always` and `never` skip the
question. A person's shell is never asked.
`sessions.helpers_at_once` bounds the helpers one session has working; consent comes first, and a
start past the limit waits for a slot.

**A helper is named by its task** (`helpers::task_title`) when its command starts a known agent
with a task quoted at its end. The agent's own reports replace the name. What a person starts is
never named here.

**A helper waiting for a slot** (`daemon/helper_queue.rs`). A start past the limit is answered as
a success: the pane is made at once as a plain shell and the daemon holds its command. The daemon
alone reports that row Working, with `TermInfo.waiting_for_slot` (made only by
`helper_queue::waiting_for_slot`); nothing read off the pane changes its status, it never rings
and is never quiet. When a slot frees, the oldest waiting helper of that starter gets the line
`Daemon::spawn` would have run, built from the held command as sent; nothing new goes into it. A
command with a control character other than line breaks is never held: past the limit it is
refused. At most `MOST_WAITING` wait per starter. When the starter is gone, its waiting helpers
are cancelled. The hold is saved (`SavedPane.waiting`) and cleared the moment it starts, so it
never starts twice. A chat started as a helper is not held.

**A chat's helpers** ([ADR 0016](adr/0016-a-chat-asks-before-it-starts-helpers.md), proposed). A
start from a chat's current runtime (`Hello.structured`) is that chat's helper start, under the
same rules. Only `NewWorkspace` and `NewWorktree` with a command are let through, with the `start`
grant. The ask is held on `ConversationSummary.helper_ask`, whose `status` reads Blocked while it
is not empty; only a person answers (`AnswerChatHelpers`). `TermInfo.started_by_chat` is never set
together with `started_by`. A runtime that is no longer current starts nothing.

**Pull requests.** The daemon polls `gh` off the event loop for each pane's branch, or the URL set
by `Command::LinkPr`. A pane may only link its own PR. With `[sessions] pr_wake`, a failed check,
review request or conflict queues a short follow-up for the pane's next idle turn, never into a
question.

**Secrets.** A pane asks through `Command::RequestSecret` on its authenticated connection. The
request appears in `Snapshot.secret_requests`; the value is never in a snapshot. Only the user
answers (`AnswerSecret`). The pane receives a single-use, 24-hour reference and spends it once
(`SpendSecret`). The reference belongs to the pane that asked, a daemon restart forgets all held
secrets, and disconnecting the pane withdraws its request.

**Checks.** A pane's check results travel as `CheckInfo` summaries on `TermInfo.checks`, one per
checkpoint in project order. `TermInfo::check()` is the headline (the worst wins: Failed >
CouldNotRun > NeedsApproval > Checking > Pending > Stale > Never > Overridden > Passed, the first
on ties). The output tail is never in the snapshot: `Query::CheckOutput` returns it under the read
grant. `RerunCheck`, `OverrideCheck` and `UndoOverride` need `Grant::Write`; override works only on
`Failed`, undo only on `Overridden`, and a pane may not override or undo its own check.
`ApproveCheck` and `ForgetCheckApproval` are never accepted from a pane, and an answer whose
`command_sha256` is not the waiting command's is an error.

**Subagents.** Subagent lifecycle is carried as `SubagentActivity` records in each pane snapshot
and saved with the pane. Hook reports use the pane's authenticated process/token boundary. Codex
disk records are accepted only for the exact thread ID that pane reported; discard background
results if the pane changes thread or agent. Merge by stable child ID and event time so stale
reports cannot replace newer state.

A new capability adds: a `Command` variant (and any new `ServerMsg` /
snapshot field) in `protocol.rs`, bumping `PROTOCOL_VERSION` when the change is
incompatible and deciding `COMPATIBLE_SINCE` with it (see *API style*); handling in
`daemon/mod.rs` (or a `daemon/<feature>.rs`); the client side as an `Action` in
`keys.rs`, a `Mode` and `draw_*` / `on_*_key` pair in `client/`, and a CLI
subcommand in `cli.rs` when scripts should reach it.

## Project-specific: agent turns and background shells

A `Hook` report's `call` is a fingerprint of the tool call that is starting: 16 hex characters, the
first 8 bytes of SHA-256 over the tool's name and its input. Only a tool-start event from the
session's own agent carries one (`PreToolUse` for Claude, Qwen and Codex, `BeforeTool` for Gemini),
and only when the payload has both the name and the input. The name and the input are never sent.

Honor a trusted turn-finished hook even when its transcript lists a background
shell or dev server. Background commands do not turn `Done` back into `Working`.
A Claude Stop that lists running background work new since its last stop stays `Done`
but is not announced ([agent-status](agent-status.md)).
Continue tracking actual subagents through their own lifecycle reports. Prepare
the hook message separately from socket I/O so its effective status is testable.

Codex's queued or expanded unanswered question takes precedence over its working spinner,
including with turn-end-only hooks. Clearing it restores ongoing work detection.

Pi/OpenCode native adapters retain blocked status until their reply/dismissal
events; quiet-screen heuristics must not clear native dialogs. Pi finishes on
`agent_settled`, after automatic continuation. OpenCode preserves pending asks
across busy events and resolves session ancestry so a helper finishing cannot
finish its parent. Status payloads include event evidence, not conversation text;
explicit status overrides retain that evidence. Existing pane authentication applies.

Full lifecycle authority applies to Pi, OMP, Mastracode, OpenCode, Kilo and Kimi.
For other hook sources, a fresh agent-owned blocker can override stale hook state.
The bundled Herdr manifest rules preserve status in transcript/history viewers.
OpenCode interactive TUI V1/V2 bridges report only the selected session/subtree;
shared serve/web/attach processes must not claim another pane's status.
`--status same` records session metadata without inventing a status transition.

Bind Codex disk usage/helpers to the exact thread ID reported by the pane's
authenticated integration. Never infer helper ownership from a shared working
directory. Unknown or multiply-owned thread IDs show no disk helpers. Discard
background results after a pane changes thread or agent; clear helpers when a
new thread is accepted.

For Codex's turn-end-only hooks, compare subsequent pane input to the accepted
turn end using monotonic instants. Keep that boundary when done becomes seen/idle;
do not impose a startup deadline or let a stale activity footer reopen the turn.
Screen patterns read logical lines across soft wraps, retaining hard newlines.
Codex activity matching accepts trailing background-terminal metadata.
An advancing activity footer after an accepted end also starts automatic follow-up
work without keyboard input; an unchanged completed footer stays finished.

Shell `agent-dir` classification is agent-specific: Codex `-c`/`-p` configure
new sessions; Claude's continue/print flags remain exclusions. Consume option
values before checking Codex subcommands. Resume/fork and explicit Codex
directory/worktree options retain the requested location. Worktree allocation
still requires the authenticated pane shell and the existing per-agent setting.

Snapshots include the daemon package version. Term evidence includes the latest
process observation time; screen evidence refreshes on repeated observations
without changing the status start time or repeating transition alerts.

Publish attention status immediately, but debounce its sound: blocked waits
300 ms and done waits one second. Queue the expected status with its deadline
in both client and daemon. Cancel on a different snapshot/status or pane removal;
recheck the exact status before ringing. Transient auto-approved asks and stale
attention messages must not ring while the agent is working. Background top-level
completion uses the soft completion sound; helper completion stays quiet. Helper
questions may ring after the same blocked delay.

**Checks and finishing.** A session whose project has a check is not finished until the check
settles. While it runs, no finished alert (desktop or phone) rings and `maiker wait`,
`maiker send --wait` and MCP `maiker_wait` / `maiker_send` with `wait` stay blocked, bounded by
their timeout. A failed check raises a blocked attention alert and a "check failed" notice, rings
no finished alert, and the waiter returns with the result (`Waited::Turn` carries the
`CheckInfo`); `maiker wait` prints its line to stderr and exits 4 (2 is timed out, 3 needs you). A
check that could not run gives a notice, then the normal finished alert. Queued follow-ups still
send when the turn ends. With several checkpoints, they run in order whatever each returned, the
session is reported by the headline (`protocol::headline`), a waiter stays blocked while any is
checking or pending and exits 4 when any failed. Waiting for approval raises a blocked attention
alert and the notice `<place>: approve check: <command>` once a turn; it is never a finish.

**Hints in lists and waits.** Quiet (`TermInfo::quiet_since`) and repeating (`TermInfo::repeats`)
are hints, never a status: nothing waits on them or rings for them. `ls`, `ls --json` and
`maiker_list` show them only when set, and a wait that times out on one says so (quiet first). A
check is reported next to the status, never in place of it: `TermInfo::reported_check` decides
whether a result is shown (not while the agent works or asks), and `cli::check_note` is the one
wording for both text surfaces. A pane with no check has no `check` key in `ls --json`.

## Project-specific: structured display history foundation

`daemon/conversation/history.rs` owns a display projection, separate from native
executable context. Stable identities are conversation + exact native turn/item
IDs; turn status has a separate row (empty item ID reserved internally).
Lifecycle events upsert the existing row in place. Codex deltas have no sequence
or offset, so equal chunks are appended within one connection; completed native
items win over replayed deltas. Reconnect drops uncertain drafts before ordered
authoritative hydration. Unknown items/events make completeness explicit.

Every entry is passed through `redact_entry` (`redact.rs`) before it is stored, so a history page
never carries a token-shaped string (shown as `[redacted]`) or the text of a secret file (`[content
of a secret file omitted]`, with `omitted_bytes` in the input). Clients show them as hidden, not as
errors. See [SECURITY](SECURITY.md#conversation-history-and-secrets).

Internal reads accept a conversation/revision/position cursor, at most 128 entries
and 256 KiB of serialized JSON including the page envelope. Content/order changes
invalidate cursors; oversized entries fail explicitly. `next = None` means cached
exhaustion only. Completeness is independently Unknown, Loading, Complete or
Incomplete(reason). Ordinary snapshots contain summaries only; explicit
`ConversationRead` replies carry bounded history pages.

**Following a long history.** Entries are added at the end and changed in place, never moved or
removed until the history is rebuilt. A page's `resume` is a `delta` cursor (`epoch`, `revision`)
that returns only entries changed after it; a delta read pages against the revision its first page
began at, so a change between pages is returned again rather than missed. A cursor from another
epoch, from the future or from another generation is not an error: the page starts over and sets
`reset`, and the client discards what it held. A plain paging cursor goes stale on any change.

**An unusable cache.** A history cache the daemon can tell is unusable never stops it starting:
`Cache::load_or_rebuild` moves it aside to `<id>.bad-<n>` and reads the history again from the
agent. The `.bad-<n>` files may be the only copy and are kept for a person to recover. Nothing is
deleted before a move succeeds: a failed move returns the error and the daemon refuses to start
rather than overwrite. Only the conversation id and a category are logged, never the error text.

Daemon notifications reach
attached projections only after current generation/connection acceptance, and
client disconnect drops that attachment's memory. Production admission pages
`thread/turns/list` ascending with `itemsView: full`, checks every continuation
cursor and refuses partial/unsupported history before enabling writes. Hydration
is capped at 100,000 entries and 32 MiB. Cached completeness is never fresh native
completeness.

`Cache::load` describes only its committed historical revision. Attachment
`hydrate_cached` demotes it to disconnected/incomplete; only `hydrate_native`
after authoritative reconciliation may establish current completeness. Structured
admission must use this boundary when a provider continued during an attachment
gap; cached exhaustion/Complete never proves fresh native completeness.

Native hydration preserves running item prefixes as connection drafts: following
deltas append to them, and durable snapshots omit them with incomplete status.
Empty deltas do not mutate the projection. Attachment hydration advances beyond
both imported and existing revisions; cache commits reject older or equal
revisions so competing attachment snapshots cannot replace an equal revision.

The cache accepts one daemon-owned authoritative projection/writer per
conversation. Attachment read views are not independent cache writers. A
`commit` result of `false` explicitly rejects a stale/equal revision or obsolete
policy epoch; it is not a save acknowledgement. The caller must retain dirty
state and refresh/reconcile before retrying. The daemon retains dirty revisions
until a matching commit succeeds, with at most one cache write in flight per
conversation. Reload fences the policy synchronously; deletion runs in the shared
background storage lock. Attachments never submit independent cache revisions.

## Project-specific: structured conversation IPC

See [stack/claude-code-cli.md](stack/claude-code-cli.md) for the Claude CLI
process boundary and event/approval handling rules.

Between the daemon and a provider the flow is the provider contract
([ADR 0018](adr/0018-one-provider-contract-with-no-io.md)): a client's command becomes a typed
`runtime::Rpc`, the provider's adapter turns it into its own wire form, and what the provider
reports comes back as typed `ProviderEvent`s that one place in the daemon turns into status and
history. No provider frame is forwarded to a client, and a client names a provider only by the
`Provider` in a summary.

**An agent in a pane has a read-only conversation** ([ADR 0003](adr/0003-status-and-conversation-trust.md)).
For an owned desktop pane whose hook-verified agent is Claude, Codex or Gemini and whose hook gave
a session id, the snapshot's `conversations` holds a `ConversationSummary` with `execution:
Native` and `native_term`, served by `Query::ConversationRead`. It is in memory only, and its
`generation` rises when the pane's session id changes. Every write on it fails as "read-only"
(`Rename` and `Archive` as for an unknown id). A client the pane does not belong to (ADR 0004)
gets "No such conversation". The history is the provider's own transcript projected through the
same entries (`conversation/follow_transcript.rs`); nothing read from the file sets any status.
Gemini has no structured runtime: starting one is refused.

In a transcript, `<system-reminder>`, `<local-command-caveat>` and `isMeta` lines are never shown,
and a thinking block's `signature` and Codex's `content` and `encrypted_content` are never read.
Reasoning has its own budget (`follow::MAX_REASONING_BYTES`) apart from the entry cap, and a
history is not marked incomplete for a thought that did not fit.

`ConversationSend` carries an optional `choice` (`TurnChoice { model, effort }`, `#[serde(default)]`, no
protocol bump; a send from before it decodes as no choice). The daemon validates it (a plain model name that
cannot read as an option, an effort in `low | medium | high | xhigh | max`) and keeps it with a queued
message. For Claude every message has its own `claude` process, so the choice becomes `--model` and
`--effort` on that process (one started ahead with the last message's choice is used only when the arguments
match exactly; see [PERFORMANCE](PERFORMANCE.md#a-claude-chats-next-message-2026-11-18)); for Codex it rides on `turn/start` as `model` and `effort`, which Codex applies
to that turn and the ones after. The choice never touches the permission arguments or the thread's sandbox
(ADR 0005). The window sends the picked values with each message, so the daemon stores nothing.

**The send queue.** A `ConversationSend` for a conversation that is mid-turn (or has messages
waiting, or a send in flight) is held and answered `Reply::ConversationQueued`. The daemon
delivers the oldest once the turn has ended with no unanswered request, no cancel in flight and no
uncertain earlier send, through the same receipt and durable-barrier path as a direct send. The
queue is in order (an operation number must exceed the last one held), bounded, in memory only,
and dropped with the conversation or a new generation. `ConversationDequeue` is human-only with
the write grant.

**Send now.** `ConversationSendNow` (human clients only, write grant) refuses a stale generation,
a number that is not waiting, and a conversation with an unanswered approval or question, with a
reason, never ignored. A Codex runtime whose schema declares `turn/steer` gets the message steered
into the acknowledged active turn; it stays queued until Codex answers, and an error leaves it
waiting without marking the conversation blocked. Otherwise the turn is interrupted as
`ConversationCancel` does and the message moves to the front; that interrupt is not a person's
cancel, so a refusal leaves the status untouched. Each conversation remembers its last
`RECENT_OPERATIONS` acknowledged operations per generation, so a steered message is never sent
again as a turn; a retry answers `ConversationSent` or `Ok`. A runtime that dies mid-steer can
deliver the message twice (at-least-once).

**Starting a chat.** `ConversationStart.branch` is accepted only with `StartTarget::Create`; the
folder must be a git repository the app shows (`conversation/branch_start.rs`), and the worktree
is made as `BranchWorktree` makes one. `start_chat_session` is local-only and asks for workspace
write with approval on request, or with `full_access` for `Sandbox::FullAccess` with
`ApprovalPolicy::Never` (ADR 0005). `StartTarget::Acp` names an `[[agents]]` entry of the
daemon's config, never a program (ADR 0019). `StartTarget::AcpSession` is refused, and no chat
kept, unless the agent advertised `loadSession`.

**Chat controls.** `ConversationSetPermissions` needs the admin grant; full access goes only with
`Never`, and the pair rides on the next `Rpc::Send`. `ConversationMarkSeen` turns only done to
idle. A title is cleaned by `clean_title` (80 characters; empty clears it). Name and archived flag
belong to the conversation, so every client reads the same ones; archiving is not stopping.
Clients keep no copy of either in browser or file storage. A session is a chat or a terminal
session from the moment it starts.

**Waking and reconnecting.** After a daemon restart a chat is asleep until a client's first
`ConversationRead`, which is answered at once and then starts it. A chat cut mid-turn is not
started by a read: `ConversationSummary.interrupted` lists it until a person resumes it.
`KillServer` saves the sessions, then ends every agent on purpose; that ending is told to no
client as a failure. Agents do not outlive the daemon. A chat whose saved history cannot be read
back is not left half-alive: the daemon drops its agent, marks it stopped and keeps the real
reason as its error. A failed wake is retried once (`wake_retried`); after that only a person's
Reconnect (`StartTarget::Conversation`) does, which is refused while a start or history read is
under way and for a healthy runtime.

**Shared settings.** `Command::SetSetting` (human clients only) edits `config.toml` in place and
reloads; keys and limits are in [ENVIRONMENT](ENVIRONMENT.md#project-specific-settings-both-apps-share).
A value of the wrong kind or out of range answers `ServerMsg::Error` before the file is opened. A
client sends a newer key only to a daemon that reads it.

**Panes.** `SnoozePane` is a person's only; the daemon owns the snooze and ends it at once through
`Daemon::needs_you`. Snoozing never changes the status (ADR 0003). A pane saved mid-turn or asking
comes back as a plain shell with `interrupted` set; the daemon never resumes it.
`Snapshot.daemon_id` is kept across restarts, and a window refuses a machine whose id changed
(SECURITY).

**Repository requests.** `Query::Repo` is read-only, human clients only, with the pane's read
grant. Every path is rooted at the top of the pane's repository; symbolic links, paths that climb
out and a revision starting with `-` are refused, and git runs on a blocking thread.
`Command::RestoreSnapshot` is the one request that changes the repository, and `WriteFile` /
`SaveFile` the only ones that change a file: human only. `SaveFile` checks `version` again just
before the rename; a write that fails is an error, never a quiet success. Line endings are the
window's business. `FindFiles` never joins its query to a folder. For another machine's pane each
answer is vetted to the kind asked (`remote_repo::vet_repo_reply`); an empty `version` in a vetted
`FileStamped` means the text was cleaned and must not be saved.

**Git and GitHub.** git runs off the event loop with `GIT_TERMINAL_PROMPT=0` and a time limit, and
`gh` never asks a question. Nothing merges, rebases, forces or amends. Commit paths are checked
and read literally (`--literal-pathspecs`). No token is read. A pull request's address and a
repository's `clone_url` are always rebuilt from checked parts, never copied from what was printed
or sent. Git identities are changed only through `git config`, never as text. **The daemon decides
a pull request's `needs_you`** (`daemon/pr_list.rs`): a client shows and counts it, never works it
out. Clone, sign-in and folder-git rules are in SECURITY.

**Other questions.** Paths a client names are absolute or start with `~` (at most 4,096 bytes).
An id from an agent's store is plain (a letter or digit first, never read as a flag). A closed
session's folder, branch and repository come from the daemon's record, never the client. An
extension add runs only with the one-time token its `PreviewAdd` gave, and a change names only an
item the daemon lists. An agent program missing from the daemon's login PATH is an error, never an
empty list. A usage figure no provider reported is `null`, never zero (ADR 0009).

**Terminal access.** The `Terminal*` messages resolve nothing but the pane number they are given;
the `ConversationTerminal*` ones need the exact conversation generation and resolve the pane
inside the daemon. Input is human-only, needs write (and respond while the pane is blocked), and is
at most 16 KiB per message; sizes are 2x2 to 500x300; queries need read.

**Grants.** Start needs the start grant, send and cancel the write grant, approval answers the
respond grant and read the read grant. Conversation IDs grant no pane self-exemption.
Programmatic prompts use the same invisible-character refusal as ordinary send.
Pane-originated starts also use existing helper consent and concurrency limits.
Pending structured launches and live structured helpers count alongside native
helpers; the verified initiating pane remains attached to the runtime's state.

Daemon-owned structured processes receive a separate generation/connection-bound
identity through four reserved environment variables and `Hello.structured`.
The runtime mints its own secret; it never copies a pane token. Partial/malformed
environment claims and rejected/stale handshakes cannot become human callers.
Every incoming request rechecks the live owner and configured MCP grants;
structured callers have no pane self exemption or human-only approval authority.
Granted list/read/send workflows remain available under their respective grants.
A structured runtime may start helpers only, under the conversation's own helper
consent (*A chat's helpers*, above); every other descendant is refused. Ordinary
native helper behavior is unchanged.

Before creating/resuming a thread, the actor reads effective provider config for
the selected cwd on its own initialized connection. Supported shell policy retains
the four identity variables; unsupported custom filtering/set/profile policies
fail before thread creation. Runtime-only, value-free config overrides preserve
existing stdio MCP inherited-variable lists and append the identity variable
names. Explicit conflicting MCP environment values are refused. No authentication
secret is inserted into provider config, persisted thread settings or metadata.
MCP references revalidate authenticated read access before filesystem listing.

Start targets are Create with explicit launch settings, Session with an exact
Codex `Thread.id`, or Conversation with a Maiker ID and expected generation.
Paths are resolved in background before admission. Explicit resume never uses
latest, a picker, a fork, alternate history or a missing-thread fallback. Native
profile-v2 remains unsupported. Effective cwd/model/provider/approval reviewer
and sandbox are validated against the requested posture before identity commits.
The exact native binding commits before start acknowledgement or turn submission.

Send carries conversation ID, generation, a nonzero increasing operation ID and
text. One current receipt and content digest are retained per conversation;
prompt text stays in memory. Persist `SubmissionUncertain` before the RPC and
persist the acknowledged native turn ID before replying. Same-operation retries
return a durable receipt without sending again. Changed/reused/older IDs, stale
generations and busy/blocked runtimes fail. EOF, partial writes, timeout, crash or
failed acknowledgement persistence leave delivery uncertain and prohibit automatic
resend. Request correlation IDs do not establish provider idempotency.
Explicit reads expose an uncertain receipt while acknowledgement persistence is
pending; the staged in-memory native acknowledgement is not a durable receipt.

Command execution, file-change, permission and user-input requests retain the exact provider
request ID, method, generation and connection. File-change approval is enabled only after the
matching patch notification arrives, so the GUI can show the requested files and diff before a
decision. A human with the respond grant may answer only the currently pending request with
`accept`, `acceptForSession`, `decline` or `cancel`. The request ID is removed only after its
response is queued on the owning runtime; stale generations, duplicate answers, and structured
runtime callers are refused. Only the command, requested write root, permission profile and reason
needed for a decision are exposed to the client; invisible Unicode characters are displayed as
`\\u{...}` escapes. Raw provider params are not retained in conversation history or the metadata
ledger. User-input answers must cover each displayed question, use offered choices or an explicit
free-form option, and contain no hidden Unicode. Secret answers are forwarded only in the live
provider response and are not stored in conversation history or metadata. Permission requests
show the exact requested profile and allow only that profile for the current turn; declining
returns an empty profile. Session-wide grants are not offered. Other provider request kinds
remain visibly blocked and unanswered.

Turn cancellation names only the acknowledged active turn ID and exact native thread; uncertain
submissions cannot be canceled by guessing. The interrupt response means the request was
accepted, not that the turn stopped; the GUI waits for the matching `turn/completed` event. Only
human clients can cancel. A completed native turn enters the existing checkpoint
resolver/approval/worker path once; generation/run fences reject obsolete results. Provider
completion cannot turn a failed or pending checkpoint into a pass.

`ConversationDiff` accepts only a conversation ID and generation. The daemon
resolves its checkout from the stored conversation binding, requires the read
grant, and runs Git on a blocking worker. It includes tracked and non-ignored
untracked changes, returns at most 100 files and 2 MiB of patch text, and marks
the result truncated when large or symlinked untracked files or excess diff data
are omitted. `ConversationFiles` and `ConversationFileRead` use the same exact
conversation binding and read grant. Paths are relative to its checkout; parent
traversal and symbolic links are refused. Listings are bounded to 500 entries,
and previews are UTF-8 files no larger than 256 KiB. Filesystem work runs on a
blocking worker, and results from obsolete generations are discarded.

Snapshot conversation summaries expose stable ID/generation, provider, cwd,
worktree, recovery/status/checkpoint context and the optional real native pane.
They carry no transcripts, launch environment, configuration roots or credentials.
`ConversationSummary.helpers` and `capabilities` are display only, never status; a client with
no `capabilities` falls back to what it knows of the agent (`agentAbilities.ts`).
Explicit read replies carry the same checkpoint-gated status and checkpoint
summaries. Provider error notifications and failed/interrupted native turns stay
blocked with an explicit error reason; they cannot report successful completion.
That reason belongs to the turn (`turn_error`): sending the next message, or the
next turn starting or completing without a reason of its own, clears it. A problem
that outlives turns (a history that is incomplete or holds unsupported content, an
unanswered provider request) is kept apart (`error`), so a turn neither clears nor
hides it; while both are set, a read reports that one.
Failures answer the owning pending request and notify attached observers, without
injecting unrelated errors into other one-shot clients.

Revision advances use checked arithmetic before changing content, order or
completeness. Exhaustion returns typed `RevisionExhausted`, preserves the prior
view/cursor revision and surfaces at the daemon boundary. Cache loading/preparing
rejects an exhausted manifest/projection revision; imported attachment revisions
are checked before replacing the existing view. Revisions never wrap or saturate.

## Project-specific: connections to other machines

One supervisor task per `[[machines]]` entry (`link/` in `maitty-machines`) keeps that machine's
line up. It talks to the window only through `LinkEvent`s and `LinkControl` commands, so a dead
machine cannot hold a lock or block drawing. With no `[[machines]]` entry nothing starts.
`--remote host` is the window's one machine, `MachineId::LOCAL`, connected by `open_or_spawn`.

**Ids.** `MachineId` 0 is this computer. Configured machines get 1, 2, ... in name order
(case-insensitive). Ids are never saved (layout is kept under the machine's name), so adding a
machine renumbers the ones after it without harm.

**States** (`ConnectionState`; `link::next(state, event, now)` is pure and takes the time):

| State | Meaning | Left by |
| --- | --- | --- |
| `Connecting` | first dial of this run | success, or a classified failure |
| `Connected` | a line is up | the line dropping (`LineDropped`, `WatchdogFired`) |
| `Reconnecting { attempt, since }` | a line that was up dropped; the first `RECONNECT_DIALS` (3) failed dials still read as this | success, or a failure that needs a person, or the dials running out |
| `NeedsLogin { why }` | ssh could not log in without a prompt | success |
| `NeedsUpdate { why }` | the far side runs another protocol version, or has no app | success |
| `Unreachable { since, why }` | no answer (also: no daemon running there; refused) | success; `Retry` shows `Reconnecting` |

A failed dial in `NeedsLogin`, `NeedsUpdate` or `Unreachable` changes only `why`: retries are
quiet. `Retry` (a person asks, or the machine's config entry changed) dials at once. A machine's
agents stay in the sidebar model through every state, and the next `State` replaces them.

**Backoff** (`Backoff::DEFAULT`): no wait before the first dial or the redial of a line that
held; then 250 ms doubled per failure, at most 30 s. A line that ends before `STEADY_LINE` counts as
a failure.

**Failure classes** come from `link_failure::classify`, from structured signals: the error's
type, ssh's exit status, and whether the far side ever sent its stream marker or a frame. ssh's
words are read only for exit 255 with nothing received, and only for a few fixed tokens. Only the
`REMOTE HOST IDENTIFICATION HAS CHANGED` banner means the host key changed. The login classes
(`is_login`) wait for a person. Everything else is `Unreachable` with ssh's last stderr line,
control characters removed and cut to 200 characters. What can't be told apart (a firewall ban, a
proxy's hang-up, a hang-up after other lines) stays `Unreachable`. The connection state carries
the class (`ConnectionState::failure`); a refusal by daemon id is `Refused`.

**Failure sentences.** `link_failure::sentence(failure, subject, os)` is the only place a failure
is worded: one sentence that names the machine and gives the exact fix for the system the person
types on (`ClientOs`), never an internal part of the app (no helper, probe or daemon), and never
an offer to accept a changed host key. `fix_command` is the one command a sentence names, for a
Copy button. The terminal app (Machines list, toasts, CLI connect errors, `doctor`) and the
desktop app (`MachineState.why`, `failure`, `fix_command`; the add outcomes' `message`) show these
sentences and write none of their own; `doctor` only puts the two versions before the sentence.
`is_failure_sentence` tells such a sentence apart, for MCP's `unreachable` error code.

**Custom transport.** A machine with `via` is reached by running the user's program
(`Route::Command`) in place of ssh, with the same marker skipping and handshake. Its failures
classify without ssh's words and are never `NeedsLogin`. On Windows it fails with `a custom
transport (via) is not supported on Windows in v1; use ssh`.

**Attach only, and when the daemon may start.** A daemon exits ~30 s after it has no session and
no attached window. The supervisor decides per dial (`MayStart`): `<remote_cmd> proxy` (which
starts a daemon if none runs) on the first dial, every retry of a failed first dial, and after an
explicit `Command::Retry`. Redials after an established line ended run `<remote_cmd> proxy
--attach-only`: with no daemon there it exits `NO_DAEMON_EXIT` before writing anything, and the
machine is `Unreachable` with `NoDaemon` until a person retries, so a dropped link never brings
back a daemon the user stopped. `Machine::from_def` is attach-only by default; the CLI's `--on`,
MCP and `doctor` never start a remote daemon.

**Liveness.** An idle line is kept honest by ssh (`ServerAliveInterval=15`,
`ServerAliveCountMax=3`). The client's watchdog (`STALL`, `Burst.stalled`) drops only a frame that
began and stopped arriving, never one that trickles in or an idle line. A dial that never answers
is dropped after `CONNECT_BUDGET`. A line's ssh child is killed and reaped by a background task;
nothing awaits ssh's end on the way out.

**On reconnect** the daemon sends `State` and a `Replay` per pane on attach, which replace the
machine's snapshot and each pane's screen. Typing sent while the machine was down is dropped,
never queued: replaying keystrokes into a pane that moved on could run commands the person no
longer meant. The window counts it and says, once the machine is back, "N keystrokes to <name>
were not sent while it was disconnected".

**Refusal.** A different daemon answering at a machine's name (`machine_ids`) parks the
supervisor (`Refuse`): no dial until a person asks. A new line re-checks the id. Editing or
removing the machine's `[[machines]]` entry and reloading clears the refusal and dials. A running
supervisor keeps the entry it started with until the app restarts.

## Project-specific: client routing across machines

Every message the window sends is an `Outgoing { machine, msg }`; `client/routing.rs` and
`App::{send, send_input, cmd_on}` decide `machine`. The rule:

1. Anything addressed to a pane (a `ClientTerm`) goes to `term.machine`.
2. Anything addressed to a project, session, tab or workspace goes to the machine that owns it:
   the `ClientSession` / `Proj.machine`, or the focus machine for a workspace or tab id read from
   the active workspace (`active_ws`, `active_tab`).
3. A new session, pane, tab or workspace goes to `target_machine()`: the machine of the session
   selected in the sidebar, else the focused one (ADR 0007); this computer when neither is anywhere else.
   A project's own "new" (its row, a recipe, "+ New") goes to `Proj.machine`.
4. Things with no owning machine (settings, themes, reload config, kill server, UI state) and
   anything that acts on this computer's disk stay local.

`focus_machine()` is the machine whose active workspace and tab hold the window's focus. It
follows the last command that moved a focus (`routing::moves_focus`) and falls back to this
computer when that machine is gone. `focused()`, `active_ws()`, `active_tab()`, `popup()` and
`target_ws()` / `target_term()` read that machine's snapshot. A popup on another machine than the
focus never takes the keys.

| Outgoing path | Machine |
| --- | --- |
| `Input`, `Resize`, `FocusPane`, `MarkSeen`, `ClosePane`, `RenamePane`, `SetTabOf`, `SwapPanes`, `TeachAgent`, `ClearQueue`, check commands, `AnswerHelpers`, `AnswerSecret`, `ConversationArchive` when a pane ends | `term.machine` |
| `Query::CheckOutput` | `term.machine`; the reply is taken only for an open sheet or waiting failure on that machine |
| `Hook`, `Usage` | sent by the CLI, never the window |
| `Query::Worktrees` | focus machine (worktrees are local-only for other machines) |
| `NewWorkspace` from new session, shell here, split, recipes, new-agent dialog | `target_machine()`, or `Proj.machine` for a project's own |
| `NewWorkspace` from a split menu | `term.machine` of the pane split |
| `NewTab` (`SpawnTab`) | `target_machine()` with that machine's active workspace |
| `RenameTab`, `CloseWorkspace` | `focus_machine()` (the ids came from its active workspace) |
| `ConversationRename`, `ConversationArchive` | `conversation_machine(id)`: the selected session's machine if it lists the chat, else the first machine that does |
| `NewWorktree`, `BranchWorktree`, `RemoveWorktree`, `TidyWorktrees`, `CloseWorktree`, `AgentWorktree`, `ReopenClosedSession` | this computer; refused for another machine's project or pane |
| `ForgetCheckApproval`, `ReloadConfig`, `KillServer`, first-state `SelectWorkspace` / `NewWorkspace` | this computer (no owning machine) |

**Local-only features.** `Feature` (Files, Changes, Find, Branches, References, image paste, agent
status setup, Worktrees) names what reads or writes a pane's files or runs git there. One gate,
`App::guard_local(machine, feature)`, decides per pane: allowed when the pane's files are on this
computer, otherwise a toast and nothing else. Every entry point calls it. A window attached to one
remote daemon (`--remote`) keeps its own worktrees; every other feature there is gated too. The
message is one format, `routing::local_only_message`: "<Feature> is local-only in v1: the files
are on <machine>, not on this computer."

A pane's folder becomes a path on this computer only through `App::local_cwd(term)`, which is
`None` for a pane on another machine. Git runs only in `local_git_projects`, never in a project
whose machine is not this one.

**Replies.** For each `Command` or `Query` sent to another machine the window keeps a timestamp
(`Routing::asked`); a `Reply` or `Error` from that machine is applied only while one is waiting,
and consumes the oldest. A timestamp older than 30 s is dropped and at most 64 are kept, because
most commands are never answered; a slow answer gets its own window (`routing::answer_window`). An
unsolicited reply or error is ignored (`remote_policy::Verdict::Answer`). This computer's own
daemon is not subject to it.

**A machine that is down.** `App::deliver` hands a message to `Connections::send`. On
`NotConnected`, typing is counted (`unsent_input`, told when the machine is back); any other
command or query raises one toast, "<machine> is disconnected; <what> was not sent."; resizes and
the rest are dropped silently. Nothing blocks and nothing is queued.

**One-shot commands.** `cli/target.rs` picks the machine of a command once, before it runs: a pane
address `machine/id`, else `--on`, else the `--remote` adapter (`ipc::Machine::current()`), else
this computer. Each command opens its connection with `ipc::open_to`; nothing reads the
environment for the machine after that. A configured machine only attaches. `$AGENT_TERM_ID` is
the default pane only when the target is this computer or the ad-hoc `--remote` route; a command
aimed at a named machine needs an explicit `--pane machine/id`. Named at a machine, `ls` heads the
list with `machine <name>`, writes panes as `name/id`, and `ls --json` adds `"machine"` to each
workspace. `ls --all` asks every machine at once, prints those that answer, writes
`<name>: unreachable (<why>)` (or similar) on stderr for each that does not, and fails only when
none answered.

**MCP tools.** `maiker_list`, `_read`, `_send`, `_wait` and `_start` take an optional `machine`; a
session of another machine is written `machine/id` and accepted as an `id` by every pane tool (if
both are given and differ, the call is an error). `machine = "all"` is for the list only. Errors
that name a machine are typed, with `structuredContent.error.code` and the text `code: message`:
`machine_not_enabled`, `unknown_machine`, `permission_denied`, `unsupported_for_remote`,
`unreachable`. Answering, interrupting and starting are `unsupported_for_remote`. See SECURITY "MCP
across machines" for who may reach what.
