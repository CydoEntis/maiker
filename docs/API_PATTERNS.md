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
Bump `PROTOCOL_VERSION` when a message shape changes incompatibly: a field removed, renamed
or retyped, or a new enum variant (an old decoder rejects it). An added field with
`#[serde(default)]` is compatible (messages are named msgpack maps and unknown fields
are ignored) and needs no bump, provided a test decodes the old shape. Hooks say Hello
too, but a hook or usage report is also accepted by an older daemon back to
`REPORTS_READ_SINCE` (`ipc::open_for_report`), so an update does not stop hooked panes
reporting before the daemon restarts. When `Hook`, `Usage` or `HookStatus` changes in a way an
older daemon cannot read, set `REPORTS_READ_SINCE` to the new version in the same change; the
test `todays_reports_are_read_by_the_oldest_daemon_they_are_sent_to` holds the shapes. The CLI subcommands and the MCP server (`maiker mcp`, JSON-RPC over stdio)
are thin wrappers that send the same commands.

Protocol 115 removed the in-app tickets (ADR 0013): `Query::Tickets`, `TicketKeys`, `TicketWrite` and `TicketLinks`, their
replies, `Command::OpenTicketSetup` and `ServerMsg::TicketSetup`. A peer from 105 to 114 sent or waited for them, so
`COMPATIBLE_SINCE` moved to 115 (the window is one version) and every older peer is refused. That made each earlier
message's `*_SINCE` gate and `introduced_in` arm dead, and they were removed; `ServerMsg::introduced_in` and
`ClientMsg::introduced_in` stay, answering `COMPATIBLE_SINCE`, for the next message added inside a window. Below, the
"came in protocol N" and "`COMPATIBLE_SINCE` stays 78" lines record when each message appeared, not a live gate.

Protocol 121 added a provider (ADR 0019): `Provider::Acp`, with the agent's name in `agent` on `LaunchSettings`,
`NativeBinding` and `ConversationSummary` (absent for every other provider), and `StartTarget::Acp { agent, cwd }`,
which names an `[[agents]]` entry of the daemon's config and never a program. The list of conversations goes to every
client, and a peer from before 121 cannot decode one that holds an ACP conversation, so `COMPATIBLE_SINCE` moved to
121 and every older peer is refused (test: `a_peer_from_before_acp_is_refused_because_it_cannot_read_an_acp_conversation`).
As with 115, the `*_SINCE` gates and `introduced_in` arms of 116 to 119 became dead and were removed; the lines below
that name them record when each message appeared. 120 belongs to a change that landed beside this one.

Protocol 122 added `StartTarget::Agent { provider, cwd, sandbox, approval_policy }`: a new Claude Code or Codex
conversation whose program and settings folder the daemon finds on its own machine. A window starting a chat on
another machine sends it, because it cannot know where that machine keeps either (ADR 0007); a start on this computer
still names both (`StartTarget::Create`). A daemon from before 122 cannot decode the request, and the window would
wait on a chat that never starts, so `COMPATIBLE_SINCE` moved to 122 (test:
`a_peer_from_before_the_daemon_found_start_is_refused_because_it_cannot_read_one`).
`ApprovalRequest.choice_labels` (defaulted; a test reads the shape from before it) holds a provider's own names for
`choices`, in the same order; they pair only while the two are as long as each other.

Protocol 123 added `Query::DiscardFile { term, path, tag }`: discard the uncommitted changes of the one file `path`
(relative to the top of the repository, with `/`) in the checkout pane `term` is in. Human clients only, with the
pane checks and the write grant of `Query::Git`. The answer is the existing `Reply::GitDone` with the same `tag`: one
line saying what was done, or one line saying why nothing was. The daemon asks git what kind of change the path is
and undoes that kind; the client never names it. The rules, the kinds and the typed refusals are
`maitty_shared::discard` (`discard_file`, `DiscardError`; SECURITY, *Discarding a file's changes*), which takes its
git and its disk as a `Checkout` so the crate does no I/O itself; `daemon/discard.rs` runs it for the daemon, and
the desktop host runs the same function with its own git for a checkout on this computer. It is a new message with its
own arm in `ClientMsg::introduced_in` (`DISCARD_FILE_SINCE`), so `COMPATIBLE_SINCE` stays 122: a daemon on 122 is
never asked, and the desktop client refuses in words instead (`refuse_unless_daemon_reads`; tests:
`a_discard_is_asked_only_of_a_daemon_that_reads_it_and_older_shapes_still_decode`,
`a_peer_from_before_a_message_cannot_read_it`). It is never sent on a kept connection (`safe_to_ask_twice`): asked
twice, the second would report a failure for a discard that landed. The desktop command is
`git_discard_file(machine, folder, path, term)`: this computer's checkout is named by `folder`, another machine's by
the pane `term`, whose answer passes `remote_repo::vet_discard_reply`.

A conversation that changed is announced to the desktop app's attached clients as
`ServerMsg::ConversationChanged { id, generation }` (`daemon/conversation/news.rs`): after each
batch of events the daemon compares a stamp of what a `ConversationRead` would answer (history
revision, status, error, approvals, queue) with the one it last announced, at most once per
100 ms per conversation, and never for a conversation seen for the first time. It carries no
content: the window reads as before, under the same checks. The host passes it to the webview as
the `conversation-changed` event, for this computer only; another machine's is ignored
(`remote_policy`). The terminal app is sent none.

`Command::SendWhenReady { term, text }` hands the daemon a message for the agent starting in a
pane. The daemon holds one per pane and types it in once the agent is running and at rest (idle or
done) with its hooks reporting, or 20 s after an agent without hooks was first seen; never while
the pane works or asks something. It is typed as a queued follow-up is (one paste when it has
several lines), and is saved with the pane, so a daemon restart keeps it. The desktop command is
`send_when_agent_ready` (at most 256 KiB, not blank).

`SendWhenReady` and `QueueFollowUp` take an optional `operation: Option<u64>` (`#[serde(default)]`; a
test decodes the old shape both ways). An older daemon reads the field and ignores it, so a retry there
could be typed twice: the version was raised to 91 and a send that carries one reports
`TERMINAL_SEND_OPERATIONS_SINCE` (91) from `ClientMsg::introduced_in`, while one without still reports
`COMPATIBLE_SINCE`, which stays 78. The operation is a random nonzero 64-bit nonce per send, never a
counter: it is keyed by pane, not by sender, so two senders counting from the same start would collide,
and the second message would be acknowledged and never typed. Zero is refused. The same pane, operation
and text (compared by SHA-256 digest of the trimmed text) within ten minutes is acknowledged with `Ok`
and not typed, held or queued again, even after it was typed; a `SendWhenReady` and a `QueueFollowUp`
with the same pane, operation and text count as one send. `Ok` on such a retry means the send was
accepted earlier, not that it was delivered. The same pane and operation with other text is refused.
Only an accepted send is remembered, so a retry of a refused one is tried afresh. The record is in
memory (`daemon/terminal_sends.rs`, at most 1024 sends, oldest forgotten first): after a daemon restart
a retry of an earlier send is a new send. A send without an operation behaves as before.

The desktop app draws that nonce in `terminalSendOperation` (`features/chat/sendOperation.ts`): random, nonzero and
below 2^53, so it passes through a JavaScript number into the `u64` exactly. `send_when_agent_ready` and
`queue_follow_up` take it as `operation`. The desktop client asks the running daemon its version first and sends the
operation only to one at `TERMINAL_SEND_OPERATIONS_SINCE` or later (`named_send`); an older daemon, or one the send has
to start, gets the message without it. A send to another machine's pane carries none, since its line does not say which
daemon version it reaches. The composer keeps the operation of a queued message whose send has finished and failed (a
timeout included) and reuses it only when the same text is sent again within `FAILED_SEND_REUSE_MS` (30 s) with the
box not edited in between; a send still pending, a different text, an edited or cleared draft and a later resend all
draw a new one (`paneSendOperation`). A first message held for the starting agent carries an operation too, but it is
handed over once and the id protects nothing further: if that call times out after the daemon took the message, the
window's own fallback sends it again through the terminal, not through this command, so the daemon cannot recognise
it and the message can be typed twice.

`Command::Prewarm { cwd, cmd }` starts an agent ahead of its first message (`daemon/warm.rs`). It runs hidden, as a spare
(no client is shown it, it alerts nobody and it is not saved), and the next `NewWorkspace` with the same command in the
same folder is that agent, already running, instead of a new one. One is kept at a time: asking for another stops the
first, asking again for the same one keeps it, `Command::DropPrewarm` stops it, and the daemon stops one nobody asked
for in ten minutes, so a window that closed or crashed leaves nothing running. Only an app window may ask, never a pane
or a structured runtime. Both commands came in protocol 79 (`PREWARM_SINCE`, each with its arm in
`ClientMsg::introduced_in`); `COMPATIBLE_SINCE` stays 78, since an older daemon is simply not asked. The desktop
commands are `prewarm_agent_session` (the agent names and flag rules of `start_agent_session`; it answers false when the
daemon running is older) and `drop_prewarmed_agent`.

`Command::BranchWorktree { project, branch, base }` makes a worktree for a window with no pane to ask from (the desktop
app's New session draft, on this computer or another machine, whose own daemon makes it in its checkout
over a request line and answers only the new folder, which `remote_chat::vet_worktree_reply` takes when it is one plain
absolute path, where "New worktree" used to run a plain `git worktree add` beside the project, skipping the
trust copy, the repo's setup hook and the tidy-up list). The daemon checks `branch` as `NewWorktree`'s branch agent
does, requires `project` to be one the app shows (or, from a person's own window, any folder the person picked:
`may_name_checkout`; a pane's agent, a structured runtime or a rejected client is held to the shown ones) and a git repository, then makes the checkout with
`create_trusted_worktree` (the `worktree.dir` template, an existing local or remote branch else a new one from HEAD,
trusted like its repo), runs the repo's `on_create` setup, lists the folder in `made_worktrees` and replies
`Reply::Text(folder)`. The window starts its agent in that folder. It came in protocol 81 (`BRANCH_WORKTREE_SINCE`, with
its arm in `ClientMsg::introduced_in`); `COMPATIBLE_SINCE` stays 78 because an older peer is never sent it. The desktop
command is `add_branch_worktree` (`maitty_desktop_client::branch_worktree`); it waits up to eleven minutes, since the
setup hook may take ten, and says the service is from an older release instead of asking a daemon that would never
answer. It is this computer's daemon only. Structured runtimes may not ask for it.

A project heading's New worktree (`new_worktree_session(machine?, term, branch, base)`, `maitty_desktop_client::new_worktree_session`)
asks the daemon that owns the pane: `Query::List` for the pane's workspace, then `Command::NewWorktree { ws, branch, base }`
with no command, agent or split, so that daemon makes the worktree and opens a session in it. For a pane of another machine
the host routes both over a request line (`Wire::new_worktree_daemon`) and takes only a `List`, cleaned like a snapshot,
and `Ok` (`remote_chat::vet_new_worktree_reply`); a machine that takes no requests (down, needing an update, or turned
away) is refused before anything is sent, as `<machine> is not connected`. The new session reaches the window in that
machine's own list. Removing worktrees (`remove_worktrees`), comparing checkouts (`worktree_overlaps`) and the worktree
manager's standing, merge and remake stay this computer's and refuse another machine's with the local-only words.

Protocol 113 removes `ClientMsg::WorkflowReport` and `TermInfo.workflows` (ADR 0011). An older
`maiker workflow report` is a one-shot connection whose frame the daemon cannot read, so that call
fails and nothing else does; an older window reading a pane without `workflows` defaults it to none.
`COMPATIBLE_SINCE` stays 78.

`Query::HelperRead { term, helper }` answers `Reply::HelperRead(HelperRecord)`: what one of the pane's
helpers did, as history entries read from its own record (Claude's side-chain file, a Codex helper's
rollout from where its own task begins), oldest first, with `start_missing` when the start is left
out. The read runs off the event loop; a refusal is a `ServerMsg::Error` naming why, never content.
It came in protocol 95 (`HELPER_READ_SINCE`, with arms in both `introduced_in`). Clients ask again
while the view is open; it is not followed.

`Query::Specialists { term }` answers `Reply::Specialists(SpecialistList)`: the Claude Code and Codex
agent files (`.claude/agents/*.md`, `.codex/agents/*.toml`) of the pane's repository (the nearest
folder above its working folder that holds `.git`) and of the user's home (`~/.claude/agents`,
`$CODEX_HOME/agents`), project first, each with its name, description, path and text. It is
read-only, for human clients, read off the event loop, and bounded (`specialists::SPECIALISTS_MAX`
files, `SPECIALIST_TEXT_MAX` bytes of each). It came in protocol 95 (`SPECIALISTS_SINCE`).

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

`TermInfo.began_as_agent` says the pane was started as an agent (its command is one), not as a shell an agent was typed
into. The daemon sets it once at start, saves it with the pane and keeps it across restarts; a pane saved before it
existed reads from its command. It is a `#[serde(default)]` field, so it needed no new `PROTOCOL_VERSION` and
`COMPATIBLE_SINCE` stays (a test decodes the old shape, which reads as a terminal, never ended on an agent's account). A
pane with it whose agent ended, said by its hook or lost by several process scans in a row, is ended by the daemon unless
an agent is back, a program runs in it or someone typed since (`close_ended_agents`).

A pane's follow-up queue (`TermInfo.queued`) is the daemon's: it types the oldest into the agent when a turn ends, never
into a question, and keeps the rest across a restart. A turn has ended when the agent's own report says so
(`Term::own_turn_over`, sent as `TermInfo.own_turn_over`, a defaulted field an older daemon leaves false), even while
background helpers keep the session working: the agent is back at its prompt. The next
waits for the turn that one starts (`UserPromptSubmit`), not a minute. Nothing the daemon types for a pane
(`Term::pending_input`: a queued message's Enter, a moved session's note, a wake) goes in while the pane is Blocked,
whatever its deadline: the Enter a beat after a message's text would answer a helper's question asked in between. A queue belongs to the agent it was made for:
a pane whose agent ends (its own `SessionEnd`) or changes (the process scan) drops it, and nothing goes in while
the scan has just missed the agent (`agent_missed`), since the pane at rest may be its shell. Claude's `SessionEnd`
for `/clear` is not an end: the next session starts in the same agent. A report from another session while the pane's agent is mid-turn is an agent it ran (a headless `claude -p`) and is ignored whole, even when the process scan could not tell (`apply_hook`): an agent does not change sessions inside a turn. The Enter after a queued command (`/resume`) is
not pressed again when no prompt is reported: such a command opens a menu that a second Enter would answer. `Command::QueueFollowUp { term, text, first }` adds one (`first`,
a defaulted field, puts it ahead of the ones waiting, for an agent's own command picked while it works),
`Command::ClearQueue` drops them all, and `Command::DropQueued { term, index, text }` drops one: the one at `index`, and
only while it still reads `text`, since the queue moves when a turn ends. `DropQueued` came in protocol 80
(`DROP_QUEUED_SINCE`, with its arm in `ClientMsg::introduced_in`); `COMPATIBLE_SINCE` stays 78. The desktop commands are
`queue_follow_up` and `drop_queued_follow_up`; the second says the service is from an older release instead of asking a
daemon that would never answer. A daemon on another machine that is older is asked anyway and does not answer.

A state change reaches attached clients as `ServerMsg::State` (the whole `Snapshot`) or, when only
some panes differ from what that surface's clients last received, as `ServerMsg::TermsChanged`
(the panes to replace and the ids to drop); the daemon compares encoded bytes and sends nothing
when nothing visible changed, and a client that has just attached gets the next change in full.
Each of the two carries a `revision` (`Snapshot::revision`, `TermsChanged.revision`): the daemon
counts them per surface from 1, one more for every message it sends that surface's attached
clients, so a gap means a missed update. The snapshot a client gets on attach and in `Reply::List`
carries the surface's current revision and uses none. The field is `#[serde(default)]`, so it
needed no new `PROTOCOL_VERSION`; 0 means a daemon built before it, or a surface sent nothing yet.
Each of the two also says why every pane it drops left, as a `RemovalReason` by pane id
(`TermsChanged.reasons` for the ids in `removed`; `Snapshot::removed` on a whole `State`, for the
panes that surface's clients were told of in the message before and are not in this one): `Closed`
(a person closed it; a session inside its undo window is `Closed` too and comes back as changed if
undone), `Exited` (its program ended, or the daemon closed the pane of an agent that had ended),
`PutAway` (hidden, still running: a spare), `Moved` (another surface owns it now),
`DaemonStopping` (it ended after the daemon was told to stop) or `Unknown` (the daemon recorded no
reason, or a pane is hidden by none of these). `Bye` is the signal that the daemon stopped:
`KillServer` kills every pane, sends `Bye` and exits without another update, so `DaemonStopping` is
best-effort, seen only for a pane that ends between the stop request and `Bye`. A pane replaced by a
new one for the same session (woken, or moved into a worktree) leaves as `Closed`, with the new pane
among the changed. What a surface was told of is the panes of the last message its attached clients
got and of the snapshot each got on attach: the first client to attach to a surface starts the list
from its snapshot, a later one adds to it, so the whole `State` that follows an attach still names
what left for the clients already there, and a pane that ended while nobody was attached is named
to nobody. Both fields are `#[serde(default)]` (no new `PROTOCOL_VERSION`): empty from an older
daemon, on the attach snapshot and in `Reply::List`, so no reason means not said, never a reason.
`RemovalReason::Unknown` is `#[serde(other)]`: a reason added later reads as `Unknown` to an older
build and the rest of the message stands, so an older peer can still read a message that carries one. A
client merges a delta into the snapshot it holds, sets that snapshot's `removed` to the delta's
`reasons`, and treats the result as a state update. The desktop
host (`streams.rs`) merges a delta only when its revision is 0 or one more than the revision it holds;
after a gap, or with no snapshot held, it drops the delta, sends `Query::List` on its stream and takes
the `Reply::List` as its snapshot. It asks once for a run of such deltas, and again only when the list has
not come after `LIST_ASKED_AGAIN_AFTER` (5 s) or the machine's line came up anew; a whole `State` settles
it too. The TUI (`crates/maitty-terminal-client/src/client/background.rs`) applies the same rule to
this computer's line and each other machine's, and with no snapshot held starts from revision 0. It
also keeps a pane a delta drops without a reason (a daemon from before reasons) until a whole list
confirms it, and asks for that list the same way; its tick asks again while an asked-for list has
not come after 5 s, so a kept pane cannot stall when the machine sends nothing more. A list alone is no base for a delta (it can hold a change the surface
was not sent yet), so after `Query::List` from an attached client the daemon sends that surface its next
change in full, as it does after an attach. That reset is what makes the delta after a resync right: a
daemon that numbers its updates but was built before the reset works its next delta out from what it
sent, so a pane can stay stale in the host's list until that daemon's next whole `State`. For a pane delta from another machine the snapshot is that machine's own,
and the delta is cleaned first (SECURITY, "remote daemon"). Replays follow `Hello.replays`: a terminal client takes every pane's replay on attach, the desktop window
attaches without and sends `ClientMsg::WantReplay { term }` on its stream when it shows a pane; a
desktop replay carries the last mebibyte of the ring and then the screen as it is, which is all the
window's scrollback holds. Any replay of a pane on the alternate screen repaints the main screen,
switches, then repaints the alternate one, so the view is on the right screen even when the
program's own switch is older than the ring.

Over ssh, `maiker proxy` writes `STREAM_MARKER` (`maitty-ipc-transport`) to stdout once, after it
reaches the daemon and before it relays a byte. The marker sits outside the frames, so it is
not a protocol change. The client sends its Hello, then discards stdout up to the marker (a
remote login that prints text, such as `.bashrc`, would otherwise corrupt the frames) and
reads frames from the first byte after it. At most 64 KiB is discarded and the wait is 30 s,
longer than ssh's `ConnectTimeout` so a slow login is not cut off. If text arrived and the
marker did not, the connection fails with "the remote login printed text before maiker
started (or it runs an older maiker: update it)". If nothing arrived, the error is what ssh
said. A remote from before the marker is not refused: when the first four bytes of its
output are a plausible frame length (up to `MAX_FRAME_BYTES`), the client reads them as the
first frame and the usual version check applies. Text never passes as a length. An old remote
whose login also prints text can't be told from noise, and gets the error above, hint included.

The optional Tauri GUI invokes only fixed desktop commands from
`crates/maitty-desktop-client/`; validate webview input in both the TypeScript boundary and
the Rust host. Never expose a generic process or shell command. Between the Tauri host and the
webview (`apps/gui/src-tauri/src/terminal_stream.rs`, `streams.rs`, `apps/gui/src/api/`): pane output
arrives, from every machine, as raw frames over the one channel the webview opens once with
`watch_terminal_output` (the machine as 2 big-endian bytes, 0 for this computer, the pane as 4, the
sequence number as 8, one replay byte, then the output; this header is the host-to-webview format
only and the daemon protocol is unchanged), one frame per pane per flush (the host gathers reads for
up to 12 ms or, for this computer, 64 KiB; a replay flushes what came before it; another machine gets
at most 256 KiB into a flush, and if 4 MiB of its output waits, that pane's waiting output is dropped
and its daemon is asked for a fresh replay, so one machine cannot slow this computer's panes);
history, sequence numbers and the last snapshot are kept per machine, and `terminal_history` and
`terminal_input` take an optional `machine` (this computer when left out), as do the pane commands
(resize, rename, pin, archive, seen, close): a pane of another machine is asked over that machine's
line (`PaneCommand` in `maitty-desktop-client` makes each message for both), a reply or error from it
is taken only while a request of the host's is out to it (30 s, 64 kept, as in the terminal app), and
typing or a command for a machine with no line is refused naming it, the typing counted and reported
as `unsent` on the machine's next `machine-state` `connected`;
the view uses the sequence number to catch up from `terminal_history`; `terminal_history` and the
replay commands answer with raw bytes
(`tauri::ipc::Response`), the history prefixed with its sequence number as 8 big-endian bytes and
empty once the host has asked the daemon for the pane's replay over the stream (it arrives as that
pane's next frame) and an error when there is no stream, so the view fetches a replay itself; the
daemon's `Snapshot` goes out as a `sessions-changed` event
whenever it changes, with `null` when the stream dropped, and the webview sets its session query
from it instead of polling (a 15 s poll remains as a safety net), reading its `revision` and `removed`
(`DaemonSnapshotSchema`): a sidebar row goes at once only for a session named in `removed` or closed in
the window, and any other miss waits for a `list_sessions` read to confirm it (UI, sidebar); another machine's goes out as
`machine-sessions-changed` (`{machine, snapshot}`), after the host has cleaned it, its `removed` read the same way for
that machine's sessions, and a miss of one waits for a later list of that machine, which `ask_machine_list(machine)`
asks for (`Query::List` on its line, refused for this computer and for a machine with no line, and dropped
within `WINDOW_LIST_ASK_EVERY`, 5 s, of the last ask of that machine it sent); its connection
state as `machine-state` (`connecting`, `connected`, `reconnecting`, `needs-login`, `needs-update`, `unreachable`, or `refused` when a different daemon answers at its name), with `since` (epoch ms) once it is not connected and the machine's `clipboard`, `notices` and `sounds` opt-ins from its entry (all off unless it says); a notice from a machine that opted in goes to the window as `machine-notice` (`{machine, text}`, cleaned, cut and led by `[name]`) and the window shows it as a toast or, away from it, a system notification; `retry_machine(name)` dials a machine now and clears a refusal; `remove_machine(name)` deletes its entry from `config.local.toml` first and only then stops it, forgets its daemon id and tells the window with `machine-removed` (its sessions and saved layout are left alone); the commands that read a pane's files or repository (`repo_query`, `restore_snapshot`, `snapshot_restore_count`, `pane_terminal_screen`) take the pane's `machine` and refuse another machine's with the terminal app's words (`<Feature> is local-only in v1: the files are on <machine>, not on this computer.`), as the window does before it asks (`apps/gui/src/lib/localOnly.ts`); `set_machine_grant(name, grant, on)` allows or stops a machine's `clipboard` or `notices` (written to its entry in `config.local.toml` first, then applied at once; the new state follows as `machine-state`); text an allowed machine asks to copy arrives as `machine-clipboard` (`{machine, text}`); `start_session_on_machine(machine, folder)` starts a terminal session in a typed folder of another machine (one that is not there opens in its home folder); `list_ssh_hosts` lists the `~/.ssh/config` hosts that are not machines yet; `add_machine(target, name?)` checks the target, looks at the machine over ssh without asking anyone anything (12 s at most; `cancel_add_machine` ends it), writes the entry only when that held up, and starts dialling it; it answers `added`, `login` (written, but ssh could not log in alone) or `failed` (nothing written: unreachable, or a changed host key), the last two with the shared sentence (`message`), the failure's kind and its `fix_command`, or `needs-name` or `cancelled`, and rejects with words only for a request it refuses before looking (a login that needs a person opens ssh in a session on this computer through `open_machine_login`, and the machine connects once it is done); `list_machines_overview` gives a window that starts late each machine's last state and
snapshot. The window names a machine's terminal sessions `build/t12` (the machine's name, so a saved
layout survives a restart; this computer's stay `t12`) and passes the number the host gave the
machine (`machine`) with each command, only for a pane of another machine. Files, Changes, Find,
managing worktrees (except New worktree off a pane, which `new_worktree_session` sends to the pane's machine), file drops and system notices are for this computer's panes only. A desktop
protocol-mismatch restart must recheck the exact local protocol before stopping
an older daemon and must refuse to downgrade a newer one. It stops an older daemon that
owns sessions only after the user confirms, and only when those sessions are saved on disk
(the next daemon restores them); one that isn't saving them is left running. On another machine the
same refusal comes back from `machine update`; the window then offers **Restart anyway**, which asks every time
(`restart-machine-service`) and runs `<remote_cmd> kill-server` there over ssh (`restart_machine_service`), ending
those sessions. The far side's own app stops a service too old to be asked by its process.

## Project-specific: response and error shapes

Commands are fire-and-forget; the daemon's answer is the next `Snapshot` (full
state) and pane output frames. Failures come back as `ServerMsg::Error(String)`,
a human-readable message the client shows as a toast; CLI subcommands print it
and exit non-zero.

## Project-specific: auth model

Socket access is the auth (see `docs/SECURITY.md`); pane status reports also need
the pane's process tree or `AGENT_PANE_TOKEN` (a pane started before the prefix change has
`MAITTY_PANE_TOKEN`, which is read the same way; ADR 0012). The names of the daemon, the socket and
the variables are not part of the protocol: renaming one is no `PROTOCOL_VERSION` change, and the socket
name still comes from the command, so a client of another version finds the same daemon and
the handshake decides whether they can talk. A rename of the command moves the socket; the first run under the
new name stops the daemon of the old one so it saves its sessions (`ipc::stop_previous_daemon`, ADR 0008).

## Project-specific: feature/module structure

Saved role profiles and sequenced planner/worker/reviewer workflows are not part
of Maiker's interface, and neither is a fleet commander (`maiker brief`, `[team]`): old
config keys for them are read and ignored. Sessions, ordinary agent launches, helpers, and
MCP session controls remain supported. The wire protocol version is `PROTOCOL_VERSION` in `crates/maitty-shared/src/protocol.rs`.
Conversation tool-history entries carry a bounded provider-supplied `label` for
display; `#[serde(default)]` keeps older cached entries readable without a
protocol bump. A tool entry may also carry `input` (the tool's own input JSON,
bounded: strings cut with a `[truncated]` marker, a value too deep or too big left
out whole), `exit_code` and `duration_ms` (Codex only), and every entry may carry
`started_at_ms` / `completed_at_ms` (Unix milliseconds). All are optional and skipped
when absent, so old shapes decode and no bump is needed. `ConversationRead` also
returns `answered_approvals`, the last 64 approvals a person answered (request,
decision, time), in daemon memory only. A Claude approval's `item_id` is the
tool-use id when Claude names it, so it links to the tool step; an edit tool is a
`FileChange` request with its diff in `changes`.

`SwapPanes { a, b }` trades the places of two panes of one tab (the split ratios stay with
their slots). Panes in different tabs, or one that isn't there, are an error.

`maiker_answer` takes the `prompt` id that `maiker_list` (`prompt` on a session that needs you) or
`maiker_wait` (`prompt <id>`) gave. It hashes the question and its choices, whitespace aside. If the
prompt on screen has a different id, nothing is sent and the error shows the current question,
choices and id.

**Helpers.** A start that comes from an agent's pane (`NewWorkspace`, `NewTab`, `Split`,
`NewWorktree` over a connection that proved it is that pane by its secret) is a helper
start. Under `[sessions] helpers = "ask"` the first one is refused with an error telling the
agent the user was asked, and the daemon records the task on the pane. `TermInfo.last_lines`
(`String`, `#[serde(default)]`, added without a protocol bump) is the last three lines of text on
the pane above its input line when its turn ended or it stopped to ask, for an agent whose hooks
reported no last message; it is empty while `TermInfo.said` has one, and cleared when a turn
starts (`daemon/last_lines.rs`). `TermInfo.helper_ask`
lists the recorded tasks (not empty: the pane needs you, and `TermInfo.status` reads Blocked
whatever its hooks report), and the request is announced like any needs-you. Only you answer
it, with `Command::AnswerHelpers { term, choice }`: `Allow` (this session may from now on),
`Always` (and every session in its project; kept in `helper-projects.json` in Maiker's data
folder), or `No` (its starts are refused for the rest of its run). A pane may not send it, and
it is an error unless the pane is asking. `always` and `never` skip the question; `never`
refuses with an error the agent can read. `sessions.helpers_at_once` (2, 4 or 8; default 4)
bounds the helpers one session has working at once; consent comes first, and a start past the
limit is not refused but waits for a free slot (*A helper waiting for a slot*, below). A
person's shell (no agent in the pane) is never asked. Sessions saved before a restart keep
`started_by`; any fleet or commander field in a saved file is ignored on load.

**A helper is named by its task** (`helpers::task_title`, `Daemon::name_after_task`). When a
helper's command starts a known agent with a task quoted at its end (as `maiker_start` builds it),
the daemon names it as it starts: the task's first non-blank line, whitespace collapsed, cut on a
word boundary to 80 characters with `…` after it. That is its first prompt, which `TermInfo.name`
falls back to (and is saved with the session), and its `TermInfo.summary`, which the desktop app
titles a row by: an agent given its task on its command line need not report it as a prompt, and
the row would read "New session". The agent's own reports replace both as for any session. A
command with no quoted task names nothing, and what a person starts is never named here.

**A helper waiting for a slot** (`daemon/helper_queue.rs`). A helper counts as working while
its status is Working or it is younger than `HELPER_SETTLES` (`Daemon::busy_helpers`); a waiting
one does not count. A start past the limit, or while its starter has others waiting, is answered
as a success: the pane is made at once as a plain shell in its folder (with the worktree, when
one was asked for), so the session number the starter is told stays its own, and the daemon
holds its command. The daemon itself sets the row to Working with
`TermInfo.waiting_for_slot` (one function, `helper_queue::waiting_for_slot`, makes the flag) and
`status_why` and `summary` reading `waiting for a free slot: 2 of 3 in line, 4 helpers at once is
the limit`, which is what the starter reads as `on` and `status_why` in `maiker_list` (the
`maiker_start` reply still says "started … as session N"); its name is already its task, and its
summary becomes the task when it starts. Nothing read off that pane (hooks, the
screen, the process scan) changes its status, it never rings and it is never quiet. On each tick,
and at once after `ReloadConfig`, the daemon starts the oldest waiting helper of each starter that
has room, one at a time in order; lowering the limit stops nothing. The start types into the
pane's shell the same line `Daemon::spawn` would have run: the account wrapper around the taught
command, built from the held command as the starter sent it (`maiker_start` quoted the task for
the shell then; nothing new is put into the line here). Several lines go in as one bracketed
paste, or joined into one line when the shell does not take one. A command with any other control
character is never held: past the limit it is refused as before. At most `MOST_WAITING` (12) wait
per starter; past that a start is refused with what to do. A start whose worktree was already made
is never refused. Text an agent sends a waiting helper is kept (up to 64 KiB, an error past it) and
typed once its agent takes input, as `SendWhenReady` is; a person's own keys reach the shell.
Closing a waiting helper takes it out of the line. When its starter is gone (closed, or not back
after a restart), each waiting helper is cancelled: its pane closes and its unused worktree is
cleaned up, and any text held for it is dropped (logged). The hold is saved with the session
(`SavedPane.waiting`, absent from an older file, which loads as not waiting): after a restart the
pane comes back as a shell, still waiting, and the hold is cleared and saved the moment it starts,
so it never starts twice. A chat started as a helper (`StartConversation` from a pane) is not
held: past the limit it is refused as before.

**A chat's helpers** ([ADR 0016](adr/0016-a-chat-asks-before-it-starts-helpers.md), proposed). A
start from a connection that authenticated as a chat's current runtime (`Hello.structured`) is that
chat's helper start, under the same setting, limit and `helper-projects.json`. Only `NewWorkspace`
and `NewWorktree` with a command are let through; a bare shell and every other descendant command
are refused ("A chat may start only helpers"), and all of them need the `start` grant in `[mcp]
grants`. The request is held on the conversation: `ConversationSummary.helper_ask` (`Vec<String>`,
`#[serde(default)]`) lists the tasks and its `status` reads Blocked while it is not empty. Only you
answer it, with `Command::AnswerChatHelpers { conversation, choice }` (protocol 120,
`CHAT_HELPERS_SINCE`; refused from a pane and from a chat's runtime, and an error unless that chat
asks). The helper's `TermInfo.started_by_chat` (`#[serde(default)]`) names the chat, never together
with `started_by`, and is saved with the session; a helper whose chat is gone from the saved
conversations comes back with neither. A chat's runtime that is no longer current starts nothing.
`COMPATIBLE_SINCE` stays 115: an older daemon is never sent the command and an older client reads
neither field (tests: `a_peer_from_before_a_message_cannot_read_it`, `every_message_is_as_old_as_the_window`, the summary's
old-shape decode).

**Pull requests.** The daemon polls `gh` off the event loop for each pane's branch, or the URL
set by `Command::LinkPr { term, url }`; `None` returns to branch discovery. A pane may only link
its own PR. `TermInfo.pr` holds the latest checks, review, conflict, title and URL. When a new
reading has a failed check, review request or merge conflict, Maiker queues a short follow-up
for the pane's next idle turn when `[sessions] pr_wake` is enabled. It never types into a question.

**Secrets.** A pane asks through `Command::RequestSecret { term, label, reason }` on its
authenticated connection. The request appears in `Snapshot.secret_requests`; the value is never
part of a snapshot. Only the user can answer with `Command::AnswerSecret { id, value }`. The
waiting pane receives a single-use, 24-hour reference, then requests its value once with
`Command::SpendSecret { reference }`. The reference belongs to the pane that asked, and a daemon
restart forgets all held secrets. Disconnecting the asking pane withdraws its request.

A pane's check results travel as `CheckInfo` summaries on `TermInfo.checks`, one per
checkpoint in project order; `TermInfo::check()` is the headline one (the worst state wins:
Failed > CouldNotRun > NeedsApproval > Checking > Pending > Stale > Never > Overridden >
Passed, the first in order on ties), and `reported_check` applies to it. A summary holds the
command, state, exit code, start, duration, the turn-end it followed, the first failing line (set by the server when it fails: the first failure-looking line of the output, else its last line, cut to `FIRST_FAILING_LINE_MAX_CHARS`; empty otherwise), whether a re-run
is queued, the override time and reason, the checkpoint `name`, the folder it ran in, the turn
it checked, the full output's line count, `stale_since` and `changed_files`, who overrode it,
its `source` (`User`, or `Repo` with the file and commit) and, on `NeedsApproval`, the
`previous_command`. The output tail is never in the snapshot:
`Query::CheckOutput { term, name }` returns it as `Reply::Text`, under the read grant (`name`
None: the headline checkpoint). Each result's
tail is capped at `CHECK_OUTPUT_MAX_BYTES` (1 MiB), cut on a character boundary. The latest
result and the overridden one of each checkpoint are saved in `SavedPane` (`checks`,
`checks_overridden`; a pane saved with the single `check` / `check_overridden` loads them as
one checkpoint); their tails are saved beside the pane's output files as
`<term>-<name>-<slot>.txt`, and a tail under the old `<term>-<slot>.txt` name is read once at
restore and dropped by the next save.

Three commands act on a check, each needing `Grant::Write` on the target pane and each naming
a checkpoint (`name` None: all of them for a re-run, the headline for the others). `RerunCheck`
runs it again at once, or, while the agent is working, sets `rerun_queued` on the result on
show; the turn end then runs it (a pane never checked has nothing to queue, since its turn end
checks it). `OverrideCheck { reason }` works only on a `Failed` result: it records the time and
the trimmed reason (at most `OVERRIDE_REASON_MAX_CHARS`), sets `Overridden`, and keeps the
output. `UndoOverride` works only on `Overridden` and restores `Failed`. Any other state
answers `ServerMsg::Error`. The next run replaces the result on show; `check_overridden` keeps
the overridden one with its output. A pane may not override or undo its own check.

`ApproveCheck { term, name, choice, command_sha256 }` (`Once`, `Always`, `Never`) answers a
repo-supplied check command and `ForgetCheckApproval { project, name }` drops a remembered
answer. No pane may send either, whatever its grants. `command_sha256` (`protocol::command_hash`)
is of the command the client showed; an answer for a checkpoint that isn't waiting, or whose
waiting command has another hash, is a `ServerMsg::Error`. The answered checkpoint then runs
again; while another checkpoint of the pane runs, it is queued (`rerun_queued`) and runs when
that run settles, in the same turn.

Subagent lifecycle is carried as structured `SubagentActivity` records in each
pane snapshot and persisted with its saved pane. Hook reports use the owning
pane's authenticated process/token boundary. Codex disk records are accepted
only for the exact thread ID reported by that pane; discard background polling
results if the pane changes thread or agent. Merge by stable child ID and event
time so duplicate or stale reports cannot replace newer lifecycle state.

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
and only when the payload has both the name and the input. Nothing else does, and the name and the
input are never sent.

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
new thread is accepted. This uses internal daemon events, not a wire change.

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

A session whose project has a check is not finished until the check settles. While it
runs, no finished alert (desktop or phone) rings and `maiker wait`, `maiker send --wait` and
MCP `maiker_wait` / `maiker_send` with `wait` stay blocked, bounded by their timeout. A
passed check lets the normal finished alert ring. A failed check raises a blocked
attention alert and a notice saying "check failed", rings no finished alert (desktop or
phone), and the waiter returns with the result: `Waited::Turn` carries the check's
`CheckInfo`, MCP replies end with its one-line result, and `maiker wait` prints that line
to stderr and exits 4 (2 is timed out, 3 needs you). A check that could not run gives a
notice and then the normal finished alert. Queued follow-ups still send when the turn
ends, and `sessions.helpers_at_once` still counts only working sessions. A session with no check
alerts and waits exactly as before.

A project with several checkpoints runs them in order, each whatever the one before it
returned. The session is reported by its headline checkpoint (`protocol::headline`, the
worst). A waiter stays blocked while any checkpoint is checking or pending and exits 4 when
any failed. A checkpoint waiting for approval, one you said never to, one that could not
run and a stale pass all exit 0. Waiting for approval raises a blocked attention alert and
the notice `<place>: approve check: <command>` once a turn; it is never a finish.

A working agent the daemon marks quiet (`TermInfo::quiet_since`) reads `[claude: working · quiet
12m]` in `maiker ls`; `ls --json` and `maiker_list` add `quiet_since` (unix seconds) only then. A
`maiker wait` or `maiker_wait` that times out on one says `still working, but quiet for 12m`.
A working agent the daemon marks repeating (`TermInfo::repeats`, the calls the repeat has reached)
reads `[claude: working · repeating 6x]` in `maiker ls`; `ls --json` and `maiker_list` add `repeats`
only then; and a wait that times out on one says `still working, but repeating itself (6x)`. A quiet
agent says so first. The count is a hint, never a status: nothing waits on it or rings for it.

`maiker ls`, `maiker ls --json` and MCP `maiker_list` report a check next to the status, never in
place of it: `status` keeps its value (`done`) and `TermInfo::reported_check` decides whether a
result is shown (not while the agent is working or asking, as in the sidebar). `cli::check_note`
is the one wording for both text surfaces: `check failed (exit 1)`, `checking`, `check passed`,
`check could not run`, `check overridden`. `ls` prints it in the agent tag
(`[claude: done · check failed (exit 1)]`); `maiker_list` adds it as a `check` string. `ls --json`
adds a `check` object (`state` as `checking`, `passed`, `failed`, `overridden` or
`could_not_run`; `command`; `exit_code`; `duration_ms`; `first_failing_line`; `rerun_queued`;
`overridden_at`). A pane with no check has no `check` key and its output is unchanged.
The newer states read `pending`, `approve check: npm test`, `stale pass: test · 3 files
changed` and `not checked: never for this repo`. With several checkpoints the note ends in
`· n checkpoints`, and `ls --json` also lists every one under `checks` (`name`, `state`,
`command`, `exit_code`, `duration_ms`, `first_failing_line`, `line_count`, `turn`,
`rerun_queued`, `overridden_at`, `overridden_by`, `stale_since`, `changed_files` as
`{kind, path}`); `check` stays the headline.

## Project-specific: structured display history foundation

`daemon/conversation/history.rs` owns a display projection, separate from native
executable context. Stable identities are conversation + exact native turn/item
IDs; turn status has a separate row (empty item ID reserved internally).
Lifecycle events upsert the existing row in place. Codex deltas have no sequence
or offset, so equal chunks are appended within one connection; completed native
items win over replayed deltas. Reconnect drops uncertain drafts before ordered
authoritative hydration. Unknown items/events make completeness explicit.

Every entry is passed through `redact_entry` (`redact.rs`) before it is stored, so a
history page never carries a token-shaped string (shown as `[redacted]`) or the text of a
secret file (a tool input, diff or command output holding `[content of a secret file
omitted]`, with `omitted_bytes` in the input). Both are plain strings in existing fields,
so the wire shape and `PROTOCOL_VERSION` are unchanged; clients show them as hidden, not as
errors. See [SECURITY](SECURITY.md#conversation-history-and-secrets).

Internal reads accept a conversation/revision/position cursor, at most 128 entries
and 256 KiB of serialized JSON including the page envelope. Content/order changes
invalidate cursors; oversized entries fail explicitly. `next = None` means cached
exhaustion only. Completeness is independently Unknown, Loading, Complete or
Incomplete(reason). Ordinary snapshots contain summaries only; explicit
`ConversationRead` replies carry bounded history pages.

**Following a long history.** Entries are added at the end and changed in place (a tool step
finishing, a message growing), never moved or removed until the history is rebuilt. Every page
carries `resume`, a `delta` cursor (`epoch`, `revision`): reading with it returns only the entries
added or changed after that revision, in order, paged with `next` like any read, so a client that
applies entries by their source id follows a conversation of any length with small reads. The
daemon keeps the revision of each entry's last change (`Track` in `history.rs`). A delta read pages
against the revision its first page began at, and its last page's `resume` starts there too, so a
change made between its pages is returned again rather than missed. A history that is rebuilt
(hydration, or a reconnect that drops drafts) gets a new `epoch`; a `delta` cursor from another
epoch, from the future (another run of the daemon) or from another generation is not an error: the
page starts from the beginning and sets `reset`, and the client discards what it held. A plain
paging cursor still goes stale on any change (`StaleCursor`) and the client starts that read over.
`epoch`, `delta`, `snapshot`, `resume` and `reset` are all defaulted, so an older client or daemon
reads the rest as before (a test decodes the old shapes); no `PROTOCOL_VERSION` bump.

A history entry's content is `TurnStatus`, `Message`, `Tool`, `Unsupported { kind }` or
`Reasoning { text }`. A Codex `reasoning` item becomes `Reasoning` when its `summary` holds plain
text (the parts joined as paragraphs, escapes stripped, cut at 64 KiB, secrets masked like a
message); one with no summary text, whose reasoning is only encrypted, is skipped, and
`item/reasoning/*` deltas are not read. The variant came in protocol 93 (`REASONING_ITEM_SINCE`);
`COMPATIBLE_SINCE` stays 78 because the daemon leaves these entries out of the pages it sends an
older client (`daemon::for_client`), which could not decode a page that held one. The desktop app
reads the item and shows nothing for it yet.
A history cache the daemon can tell is unusable (an entry kind it does not know, a corrupt or
missing page, a changed binding, an exhausted revision) never stops it starting:
`Cache::load_or_rebuild` moves the conversation's cache aside to `<id>.bad-<n>` (a number per
set-aside; the newest three kept, the oldest dropped only after a newer move succeeded), logs the
conversation id and a category (`decode`, `corrupt`, `binding`, `exhausted`; never the error
text, which can quote an entry), and treats the history as absent, so it is read again from the
agent. The check and the move happen under one lock, so a commit or a policy removal cannot slip
between them. That read can come back short if the agent no longer holds the conversation (its
transcript cleaned or compacted); the `.bad-<n>` files are the only copy then and are kept for a
person to recover. They hold the history as it was cached, unredacted by anything newer, and go
away with the cache root when the history policy deletes it. Nothing is deleted before a move
succeeds: if the move fails (a sharing violation on Windows, say) the error is returned and the
cache stays as it was, so the daemon refuses to start loudly rather than overwrite. Any other
failure (a sharing violation on a read, too many open files, an I/O error) is returned as before,
with the files untouched. **Rolling back to a daemon from before protocol 93 after a reasoning
item was cached still refuses to start:** that daemon cannot decode the page and cannot be
changed; the fix only protects the next unknown entry kind.

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

**An agent in a pane has a read-only conversation** ([ADR 0003](adr/0003-status-and-conversation-trust.md)),
with no protocol change. For an owned desktop pane whose hook-verified agent is `claude` or `codex` and
whose hook gave a session id (and, for Claude, its transcript path), the snapshot's `conversations` holds
a `ConversationSummary` with `execution: Native`, `native_term: <pane>`, the pane's `status` and no
checks; `Query::ConversationRead` serves its history. The id is the daemon's, stays while the pane runs
the agent (a lapse of the hook or of its session does not drop it), and its `generation` rises when the pane's session id changes. It is in memory only (never in
the session file or history cache). `ConversationSend`, `Approve`, `AnswerInput`, `Cancel` and `End` on it
fail with a "read-only" error; `Rename` and `Archive` fail as for an unknown id (the pane is named and
closed as a pane). A client the pane does not belong to (ADR 0004) gets "No such conversation". The
history is the provider's own transcript projected through the same entries a structured runtime
produces (`conversation/follow_transcript.rs`); nothing read from the file sets any status.
In a Claude transcript a slash command is a user message holding the command as typed
(`/plugin marketplace add x`). What a command Claude ran itself printed (`<local-command-stdout>`,
`<local-command-stderr>`) is a completed `commandExecution` entry labelled with that command, and it
completes the command's turn; a command that printed nothing gets no such entry. `<system-reminder>`,
`<local-command-caveat>` and `isMeta` lines are never shown.
A Claude `thinking` block with text and a Codex `response_item` of type `reasoning` with summary text
become `Reasoning` entries, cleaned, masked and cut like the structured runtimes' (the block's
`signature` and Codex's `content` and `encrypted_content` are never read); `redacted_thinking` and a
reasoning with no text are skipped. They reach a client through the same `daemon::for_client`.
Reasoning does not count toward a followed history's 20,000-entry cap (so thinking never pushes out a
message or tool step); it has its own budget of 4 MiB of text in all (`follow::MAX_REASONING_BYTES`).
A thought that would not fit in what is left is not kept, but a later, smaller one still can, so what
is kept is not a cut-off prefix. The history is not marked incomplete for it, and a client cannot tell
"no thinking" from "thinking dropped". A Gemini transcript's
thinking is not kept.

`ConversationSend` carries an optional `choice` (`TurnChoice { model, effort }`, `#[serde(default)]`, no
protocol bump; a send from before it decodes as no choice). The daemon validates it (a plain model name that
cannot read as an option, an effort in `low | medium | high | xhigh | max`) and keeps it with a queued
message. For Claude every message has its own `claude` process, so the choice becomes `--model` and
`--effort` on that process (one started ahead with the last message's choice is used only when the arguments
match exactly; see [PERFORMANCE](PERFORMANCE.md#a-claude-chats-next-message-2026-11-18)); for Codex it rides on `turn/start` as `model` and `effort`, which Codex applies
to that turn and the ones after. The choice never touches the permission arguments or the thread's sandbox
(ADR 0005). The window sends the picked values with each message, so the daemon stores nothing.

Protocol 71 adds the daemon-held send queue. A `ConversationSend` for a conversation that is
mid-turn (or whose earlier messages are still waiting, or with a send in flight) is not refused: the
daemon holds it and answers `Reply::ConversationQueued { conversation, generation, operation }`.
`ReadResult.queued` (`#[serde(default)]`) lists what it holds, oldest first (`operation`, `text`).
On its tick the daemon delivers the oldest message of each conversation whose turn has ended and
that has no unanswered request, no cancel in flight and no uncertain earlier send, through the same
receipt and durable-barrier path as a direct send, so a delivered message is one `Receipt` with its
own operation number. The queue is per conversation, in order (an operation number must exceed the
last one held), bounded (32 messages, 1 MiB), in memory only, and dropped when the conversation is
ended or has started over (a new generation). Retries keep their meaning: the same operation and text
while queued answers `ConversationQueued` again without a second copy, once delivered it answers the
`Receipt`, and the same number with other text is `stale or reused`. `Command::ConversationDequeue
{ id, generation, operation }` takes a waiting message back out (human clients only, write grant;
`Ok`, or an error that it is no longer waiting). A new command and a new reply variant, so
the version was raised to 71; tests assert an older peer cannot read them and that an older read reply
still decodes.

Protocol 72 adds `branch: Option<String>` (`#[serde(default)]`) to `Command::ConversationStart`, for a
chat session on a branch ([ADR 0003](adr/0003-status-and-conversation-trust.md)).
The daemon, before anything is made, refuses a `branch` beside anything but a new conversation
(`StartTarget::Create`), checks the name with the branch agent's rules (`branch_agent::branch_problem`),
and requires the target's folder to be a project the app shows and a git repository
(`conversation/branch_start.rs`). It then makes the worktree with `create_trusted_worktree`, runs the
repo's setup hook, notes it in `made_worktrees`, and starts the conversation in the new folder; the reply
is the usual `ConversationStarted`. The field is defaulted, so the old shape decodes (a test), but a
peer that predates it would drop the field and start in the main checkout, so the version was raised
to 72 and the two refuse to talk. The window's Tauri command `start_chat_session` asks for
workspace write with approval on request, or, with its optional `full_access` flag, for `Sandbox::FullAccess`
with `ApprovalPolicy::Never` ([ADR 0005](adr/0005-provider-adapters-and-permissions.md)). It adds no wire field: the choice rides in the existing
`LaunchSettings`, so the protocol version is unchanged. It is local-only.

**Shared settings.** `Query::Settings` answers
`Reply::Settings(SharedSettings)`; `Command::SetSetting { key: SettingKey, value: SettingValue }`
(human clients only) edits `config.toml` in place and reloads, and every attached local window
gets `ServerMsg::SettingsChanged`. Keys, values and limits are in
[ENVIRONMENT](ENVIRONMENT.md#project-specific-settings-both-apps-share). A value of the wrong kind or
out of range answers `ServerMsg::Error` and leaves the file as it was. A peer that predates the
variants cannot decode them (a test), and another machine's `SettingsChanged` is ignored.
Protocol 118 adds `SharedSettings.bypass_off` (defaulted, so an older reply reads as every agent on; a
test) and `SettingKey::BypassOff`, which a client sends only to a daemon at `BYPASS_SETTING_SINCE` or
later (`ClientMsg::introduced_in`), so `COMPATIBLE_SINCE` stays 115. It also adds `SharedSettings.update_machines`
(defaulted to true, the setting's default; a test) and `SettingKey::UpdateMachines`, sent only from
`UPDATE_MACHINES_SINCE`.
Protocol 123 adds `SharedSettings.helpers` (`HelpersMay`: `ask`, `always` or `never`; absent reads as `ask`) and
`SharedSettings.helpers_at_once` (a number; absent reads as 4, `HELPERS_AT_ONCE_UNSAID`, which a test holds equal to
the config default), both defaulted (a test decodes the shape from before them), and `SettingKey::Helpers` and
`SettingKey::HelpersAtOnce`, each taking `SettingValue::Text` (`"always"`, `"8"`) that the daemon checks against
`HELPERS_MAY` and `HELPERS_AT_ONCE` before the file is opened. A client sends them only to a daemon at
`HELPER_SETTINGS_SINCE` (`ClientMsg::introduced_in`); the desktop app's `set_newer_shared_setting` reads the running
daemon's version first and refuses an older one in words, and `set_shared_setting` refuses those two keys. It also
adds the defaulted `TermInfo.waiting_for_slot` (a test decodes the pane from before it). `COMPATIBLE_SINCE` stays 122:
an older daemon is never sent the keys, and an older client reads a waiting helper as the working pane its status
says.

Protocol 119 adds four things, none of which an older peer was ever sent, so `COMPATIBLE_SINCE` stayed 115 then (test:
`what_118_sent_about_clones_and_sign_in_still_decodes`):

- `Reply::CloneProgress { tag, phase, percent }` (`CLONE_PROGRESS_SINCE`), sent any number of times before
  `Reply::Cloned`. The daemon now runs `git clone --progress` and reads git's stderr, which rewrites its progress
  lines with carriage returns: `phase` is `Counting`, `Compressing`, `Receiving`, `Resolving` or `CheckingOut` and
  `percent` (0 to 100) is of that phase. A step is sent only when it changed. The daemon does not send it to a client
  older than 119 (`ServerMsg::introduced_in`), which waits for `Cloned` as before. It is not an answer: the desktop host does not
  count it against the machine's reply allowance, and `vet` caps it at 100. The host raises a `clone-progress` event
  `{machine, tag, phase, percent}`; `cloneRepository(machine, address, parent, onProgress?)` filters it by tag.
- `SignInAgent::Github` and `SignInRequest::SignOut` on the existing `Query::AgentSignIn` (`GITHUB_SIGN_IN_SINCE`; a
  client does not send either to an older daemon, and an older client never asks for them, so the new enum values never
  reach a peer that cannot read them). `Start` runs `gh auth login --web`: `Waiting { link, code }` carries the
  address and one-time code `gh` printed; `SignedIn` is `gh auth status`'s exit. `SignOut` answers `Idle` or, when
  another account remains, `SignedIn`. This computer only, as for the agents. See
  [SECURITY](SECURITY.md#project-specific-signing-an-agent-in-from-the-desktop).
- `Query::FolderGit { folder, request, tag }` with `Reply::FolderGit { tag, outcome }` (`FOLDER_GIT_SINCE`), asked of
  a machine's own daemon so branches work for folders on another machine as for this computer. `request` is
  `Branches` (local and remote-tracking branches, each newest first, and the worktrees; `outcome` `NotARepo` when the
  folder is not in a repository), `Switch { branch }`, `Create { branch }` or `CheckoutRemote { remote_branch }` (a
  local branch named after the part past the first `/`, following the remote one; refused when that name is taken
  or the remote branch was never fetched). `outcome` is `Err(one line)` for a refusal, so the asker matches it by
  `tag`. Not safe to ask twice. The host raises a flat `folder-git` event `{machine, tag, state, why, listing,
  branch}`; `apps/gui/src/api/folderGit.ts` wraps it (`loadFolderBranches`, `switchFolderBranch`,
  `createFolderBranch`, `checkoutRemoteBranch`). The older `git_branches` host command still reads this computer's
  local branches directly. Rules: [SECURITY](SECURITY.md#project-specific-a-folders-branches-and-what-a-machine-is).
- `Query::MachineFacts { tag }` with `Reply::MachineFacts { tag, facts }` (`MACHINE_FACTS_SINCE`): host name, system,
  architecture, cores and the agent programs installed with their versions. Safe to ask twice. No client asks it
  now (the desktop app's "Machine added" page that showed it is gone); the daemon still answers it.

Protocol 76 adds `Provider::Gemini` (a conversation's provider on the wire). A Gemini CLI agent in a pane gets the same read-only, transcript-following conversation as Claude and Codex (`follow_transcript.rs`, `Format::Gemini`); the file is the one its hook's `transcript_path` names, and its name must start `session-` and end with the first 8 characters of the hook's session id. Gemini has no structured runtime: starting one is refused. A peer that predates the variant cannot decode it (a test decodes the old provider names).

Protocol 75 adds `Command::NewFleet { name, cwd, colors }` and `Command::NewShip { ws, cwd, cmd }`. A fleet is a
workspace on a machine's daemon: `NewFleet` names it (trimmed, 1 to 80 bytes, no control characters), starts it
with one shell and takes the first unused colour from the list the client wants; `NewShip` adds a shell to an
existing fleet. `SetWorkspaceColor` now answers an error for an index past the palette.

Protocol 74 adds `Command::CloseSession { term }` and `Command::UndoClose { term }`, the shared settings
messages above, and, without a bump of their own, the defaulted `TermInfo` fields `diff_added`,
`diff_removed` and `exit`. `CloseSession` hides a session from the snapshot and its layouts for six seconds
(`UNDO_WINDOW`) with its process still running, then closes it as `ClosePane` does; `UndoClose` inside the
window brings back the same session in the same place. `ClosePane` still closes at once. A session ids only
count up, so id order is creation order. `exit` is set from the shell's own exit mark when a command ends
non-zero, and is only a signal for the red "exited with error" mark.

Protocol 73 adds `Query::ListFolders { path, tag }` and `Reply::Folders { tag, listing }`: the folders
directly inside `path` on the daemon's computer (`FolderListing`, `FolderEntry` in
`crates/maitty-shared/src/protocol.rs`), for a client choosing where to start a session (the terminal
app's New session draft, the desktop app's folder dialog). `path` is absolute or starts with `~`
(the daemon's home folder), at most 4,096 bytes; anything else answers `exists: false`. Only folder
names are listed, never file names or contents. Each entry carries the git branch when it is a
checkout (read from `.git/HEAD`, no git run) and whether it holds a folder worth browsing into
(hidden folders do not count). At most 1,000 entries, with `truncated` set past that. Human
clients only; the reads run off the event loop. A listing from another machine is cleaned the way a
snapshot is (`remote_policy::vet`): control characters out, names that are paths dropped, the count
cut, and it is passed on only while a request to that machine is waiting.

Protocol 85 adds `Query::SavedConversations { agent, folder, tag }` and `Reply::SavedConversations { tag, found }`
(`daemon/conversation/saved.rs`): the conversations Claude or Codex saved for a folder on the daemon's computer, for a
client offering to resume one. `found` is `Listed` (at most 20, newest first: the agent's own id (letters, digits, `-` and `_`, at most 128, a letter or digit first so it is never read as a flag; any other is left out), the first thing the
person typed as one clean line of at most 200 characters, and when the file was last written, in unix seconds; empty
when the folder has none) or `NotSupported` for any other agent. Claude's come from its transcripts for that folder
(`$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`; the transcript's own `cwd` must be the folder), Codex's
from its session files (`$CODEX_HOME/sessions`) whose first line names the folder, subagents' sessions left out. The
first message skips what the agent wrote itself (Claude's meta lines, slash commands, reminders and tool results;
Codex's instructions and environment), with the same rules the transcript follower uses. `folder` is checked as
`ListFolders`' `path` is (absolute or `~`, at most 4,096 bytes; anything else answers `ServerMsg::Error`). Human
clients only; the files are read on a blocking task, at most 500 looked at, 1 MiB from the start of each, and an
unreadable one is skipped and logged by path only. Both came with their own `introduced_in` arms
(`SAVED_CONVERSATIONS_SINCE`); `COMPATIBLE_SINCE` stays 78, since an older daemon is never asked and an older client
never sent the reply. This computer only: another machine's answer is ignored (`remote_policy`). The desktop command
is `saved_conversations { agent, folder }` (`maitty_desktop_client::saved_conversations`), asked on a connection of its
own with `tag` 0; it answers `found` as serde writes it (`{"Listed": [...]}` or `"NotSupported"`), or null without
asking when the daemon running is older than 85, since that daemon would never answer.

Protocol 86 adds `Query::ClosedSessions` and `Reply::ClosedSessions`: the agent sessions that closed
for good or whose agent exited with an error, newest first, at most 50 (what is kept and when is in
[DATABASE](DATABASE.md#project-specific-closed-sessions)). Only a person's client may ask; a pane or a
structured runtime is refused, since the list names the folders of other work. A window may ask
another machine's daemon for its list over that machine's line; the answer is cleaned
(SECURITY, "remote daemon"). The query and the reply each have their own `introduced_in` arm
(`CLOSED_SESSIONS_SINCE`, in `ClientMsg::introduced_in` and `ServerMsg::introduced_in`);
`COMPATIBLE_SINCE` stays 78, since an older daemon is simply not asked. The desktop command is
`closed_sessions` (`maitty_desktop_client::closed_sessions`), asked of this computer's daemon only on a
connection of its own: it answers the list with each record's `folder_present` added (whether `cwd` is a
folder on this disk, looked at on blocking threads side by side, never on the UI thread), or null without asking
when the daemon running is older than 86. The folders get two seconds together: one that has not answered by then
(a network share that is gone) reads as not present, and the whole call, daemon included, is cut off at the
request timeout, which the list shows as a failed read.

Protocol 87 adds `Command::ReopenClosedSession { agent, session }` (`daemon/reopen.rs`): start again the closed
session the daemon keeps for that agent and conversation id, in a new session running the agent's resume command in
its folder. Its folder, branch and repository come from the kept entry, never the client. A worktree whose folder is
gone is made again first (DATABASE "closed sessions" has the rules: never over anything at the path, only from the
recorded branch, in the recorded repository), trusted like its repo, its setup hook run, and listed with the
checkouts the app made. The git and file work runs on a blocking task; the answer is `Reply::Ok` once the session is
started, else `ServerMsg::Error` (an entry not in the list, an id that is not plain, an agent with no resume template, a
folder that cannot be made again, a branch that is gone or checked out elsewhere, with the branch named). Human
clients only. `ClosedSession` gains the defaulted `worktree` and `repo`, which an older peer ignores and an older entry
lacks. The command has its own `introduced_in` arm (`REOPEN_CLOSED_SINCE`); `COMPATIBLE_SINCE` stays 78, since an
older daemon is simply not asked. The desktop command is `reopen_closed_session { agent, session }`
(`maitty_desktop_client::reopen_closed_session`), sent to this computer's daemon only on a connection of its own: true
once the session is started, the daemon's error message as the command's error, or false without asking when the
daemon running is older than 87. `closed_sessions` passes each record's `worktree` and `repo` through, so the list
knows which removed folders can be made again.

Protocol 88 adds `RepoRequest::RestoreCount { commit }` and `RepoReply::RestoreCount(n)`: how many files
`Command::RestoreSnapshot` of that snapshot would change now, counted the way the restore counts them (the
snapshot against a tree of the checkout as it is, untracked files included), with nothing kept and no file touched.
The commit must be one of the checkout's snapshots. The desktop app asks it before it offers a restore
(`snapshot_restore_count`, this computer's panes only). The request has its own `introduced_in` arm
(`RESTORE_COUNT_SINCE`), so an older daemon is not asked and the app says to restart it; `COMPATIBLE_SINCE` stays 78.

Protocol 116 adds saving a document from the desktop app's viewer with a conflict check: `RepoRequest::FileStamped { path }`
answers `RepoReply::FileStamped { text, version }` (the text and the file's *version*, its length and an FNV-1a hash of
its bytes as one opaque word: equal only for the same bytes, so a touch that changes none is not a change), and
`Command::SaveFile { term, tag, path, contents, version }` answers `RepoReply::Saved { version }`, or
`RepoReply::ChangedOnDisk` with nothing written when `version` is `Some` and the file on disk no longer has it (`None`
is the person's explicit Overwrite after that answer). The path rules, the 256 KiB cap, the refusal of links and
`.git`, "an existing file only" and the temporary-file-and-rename write are those of `WriteFile`; the version is
checked again just before the rename, and the permissions of the old file are kept. A save that cannot be written is an
error with the system's reason, never a quiet success. Only a human client can send it. Both are new messages: an
older peer is never sent them (`ClientMsg::introduced_in` answers `FILE_EDIT_SINCE`, 116), so `COMPATIBLE_SINCE` stays
115, and the window offers Edit only to a daemon that answers the stamped read; against an older one it shows Preview and
File. The pinned bytes of `Saved` and `ChangedOnDisk` are in `answers_keep_their_pinned_wire_shape`.
For a pane on another machine the window sends `Tree`, `FileStamped` (markdown names only) and `SaveFile` (markdown only) to
that machine's daemon on a request line (ADR 0014), each answer vetted to the kind that was asked
(`remote_repo::vet_repo_reply(&request, reply)`, `vet_save_reply`); no message is added or changed, so `PROTOCOL_VERSION`
stays 117 here and `COMPATIBLE_SINCE` as it is. The window dials machines newest-only, so an older daemon is turned away
at connect time and offered its update rather than asked. An empty `version` in a vetted `FileStamped` means the text was
cleaned and must not be saved.
Line endings are the window's business (`documents/lineEndings.ts`): the daemon stores and compares the bytes it is given.

Protocol 89 adds `RepoRequest::FindFiles { query, limit }` and `RepoReply::Files { paths, truncated }`: the files
under the pane's checkout (the repository top, or the pane's folder when it is not a repository, as for `Tree` and
`File`) whose path holds `query`, case-insensitive. The walk honours `.gitignore` inside a git repository (a folder
outside one gets no `.gitignore` filtering), skips hidden files and unreadable entries, neither follows nor lists
links, and stops after 50,000 files or 1.5 seconds; `truncated` says it stopped, so a file past that point was not
searched. One walk of a folder is reused for 5 seconds (16 folders kept), so the keystrokes of one search re-rank it
rather than walk again. The query is only matched against walked paths, never joined to a folder; one over 200
characters (`FIND_FILES_MAX_QUERY_CHARS`) is refused. An empty query matches every file. Ranking: a file name that
starts with the query, then a file name that holds it, then a folder that holds it; within each, shorter paths
first, then by path in byte order. At most `limit` paths come back, never more than 80 (`FIND_FILES_MAX_RESULTS`),
relative with `/`. It runs on a blocking thread like every `Query::Repo`, for human clients only (a pane's agent and
a structured client are refused), so a client connected to another machine's daemon can ask it of that machine's
panes. The request has its own `introduced_in` arm (`FIND_FILES_SINCE`); `COMPATIBLE_SINCE` stays 78. The desktop
message box's `@` file picker asks it through `repo_query`, which asks any repository question newer than
`COMPATIBLE_SINCE` only of a running daemon that reads it, and otherwise refuses in words ("older than this app …
restart it") rather than waiting out the request timeout.

Protocol 90 adds `Query::WorktreeStanding { repo, folder }` and `Reply::WorktreeStanding(Option<WorktreeStanding>)`:
where a linked worktree on the daemon's computer stands (uncommitted files, branch, whether its work is merged, its
last commit, and `inactive_days` from `worktree.inactive_days`), read by `tidy::standing` on a blocking thread, `gh`
check included. `repo` is a folder of its repository (the main checkout). Both are absolute, and `folder` must be a
linked worktree that `git worktree list` in `repo` names, and that worktree's top folder (not a subfolder, not a
folder with a hand-made `.git` file); anything else answers `ServerMsg::Error`. Only `git worktree list` (and `rev-parse`) run
in `repo`; the standing's git and `gh` run only in a worktree its repository lists. `None` means the repository lists it but its folder is gone. Human clients only. `WorktreeStanding` (with `safe` and
`says`) lives in `maitty_shared::protocol`; `maitty_core::tidy::Standing` is that type. The query and the reply each
have their own `introduced_in` arm (`WORKTREE_STANDING_SINCE`); `COMPATIBLE_SINCE` stays 78, since an older daemon
is simply not asked. The desktop command `worktree_standing { machine, repo, folder }` (this computer only) asks it through
`maitty_desktop_client::worktree_standing`, which adds `missing` to the JSON, or fails with a line saying to restart
the service when the daemon running is older than 90.

`Conversation.worktree_origin` (main checkout, worktree folder, branch) is a defaulted field of the saved conversation, not
of any message, so `PROTOCOL_VERSION` is unchanged; a test decodes the old shape. The daemon fills it when a chat opens
inside a linked worktree on a branch (never a detached HEAD), refreshing it from the folder on each reopen. When a send
resumes a chat whose folder was deleted, `Launch::validate` (a background task, one recreation at a time) runs
`git worktree prune` and `git worktree add -- <folder> <branch>`; a branch that is gone too fails the send with a message
naming it.

Protocol 94 adds `Command::ConversationSendNow { id, generation, operation }`: send a message waiting in the
daemon's queue now instead of when the turn ends (human clients only, write grant; it has its own `introduced_in`
arm, `SEND_NOW_SINCE`, and `COMPATIBLE_SINCE` stays 78, since an older daemon is simply not asked). The daemon looks
the message up by `operation` in the conversation's current generation; a stale generation, or a number that is not
waiting (sent, taken back or never queued), is refused with a reason, never ignored. It is refused too while the
conversation has an unanswered approval or question, whichever way it would have gone. Then:

- Codex whose own generated schema declares `turn/steer` (known to the daemon when the runtime is live, from the same
  inventory the compatibility check reads, kept with the live runtime): the message is steered into the running turn with
  `expectedTurnId` set to the acknowledged active turn. It stays in the queue until Codex answers, so nothing else
  delivers it meanwhile. An answer without an error takes it out of the queue and records its number as the
  conversation's acknowledged operation (a retry of the send answers `ConversationSent`); the reply is `Ok`. An error
  from Codex (the turn ended a moment ago, another turn runs) leaves the message waiting, answers the asker with a
  message saying so, and does not mark the conversation blocked; the ordinary delivery then sends it as the next turn,
  once.
- Otherwise (Claude, or Codex without `turn/steer`): the turn is interrupted exactly as `ConversationCancel` does, the
  message moves to the front of the queue, and the ordinary delivery sends it as the next turn when the turn ends. If
  the turn already ended, or an interrupt is already pending, the message just moves to the front and is delivered.

A refused steer leaves the message at its original place in the queue; an interrupt that only served to send a message
now is not a cancel by a person, so if the turn had just ended and the provider refuses it, the asker hears why, the
conversation's status is untouched, and the message (already moved to the front) goes out on the next tick.

Each conversation also remembers its last 64 acknowledged messages (`RECENT_OPERATIONS`; steered ones and delivered
ones; in memory, per generation), because the single receipt is overwritten by whichever message was acknowledged last.
`ConversationSend` for a remembered number answers `ConversationSent` with the same text and `stale or reused` with
other text, so a steered message is never sent a second time as a turn; `ConversationSendNow` for a remembered number
answers `Ok` (a retry after a lost reply) and does nothing; a number never queued is still refused.

The queue is in memory. A runtime that dies while a steer is in flight leaves the message queued, and Codex may have
taken it, so after recovery it can be delivered twice (at-least-once). A person can take it back with
`ConversationDequeue` first.

A retry with the same `operation` while the steer or interrupt is under way is answered `Ok` and does nothing more.
`ConversationDequeue` of a message being steered is refused (`being sent now`), since Codex is about to have it. A
message sent now out of turn can leave the conversation's receipt with a higher number than a message still waiting,
so `ConversationSend` looks at the waiting queue before it judges a number stale.

Protocol 104 adds `Query::SideAnswer { id, ask, tag }` and `Reply::SideAnswer { tag, answer }`
(`daemon/conversation/side.rs`): Claude Code's answer beside a conversation, for the chat's `/btw` and the commands
that only report, without adding to it. Both have their own `introduced_in` arm (`SIDE_ANSWER_SINCE`) and
`COMPATIBLE_SINCE` stays 78, since an older daemon is never asked and an older client never sent the reply. Human
clients only, read grant. `ask` is `Question(text)` (1 to `SIDE_QUESTION_MAX_CHARS` characters, no NUL) or
`Command(name)`, one of a fixed list that only reports and takes nothing (`context`, `usage`, `skill-doctor`, `goal`,
`advisor`, `config`, `mcp`). The client names nothing else: for a followed pane the daemon takes the session id the
hook gave, the pane's folder, the model the transcript last named and the `claude` on the login PATH, and answers only
the app the pane is shown in; for a structured chat it takes the binding's session, folder, program and config folder.
The desktop app asks the daemon of the machine the chat is on (a request line for another machine, never asked
twice); another machine's reply passes `remote_chat::vet_side_answer`. A session id that is not a UUID, another agent,
or an unknown conversation is answered at once (`Failed`,
`NotSupported`); otherwise the reply comes when Claude Code is done, from a background task. `answer` is
`Answered { text }` (control characters removed, cut at `SIDE_ANSWER_MAX_BYTES`), `NotSupported`, or
`Failed { reason }` in the daemon's words, never Claude Code's output. The desktop client waits 100 seconds.

Protocol 92 adds `Command::SnoozePane { term, until }` and the defaulted `TermInfo.snoozed_until` (unix seconds;
an older peer decodes it as `None`, and a test decodes the old shape). `until: None`, or a time already past, wakes the
pane; a time more than a week ahead is refused, and so is a snooze of a chat session's pane (`conversation_id`) or of a
pane that needs you (`Blocked`, asking to start helpers, asking for a secret, or a checkpoint that failed or waits for
approval). The daemon owns the snooze and keeps it across a restart (`SavedPane.snoozed_until`). It ends it on the
tick after its time (`TICK`, 250 ms, so within a second of `until`) or when it lies more than a week ahead (the clock
went back); and at once, through `Daemon::needs_you`, when the status becomes `Blocked`, the pane asks to start helpers
or for a secret, a checkpoint fails or waits for approval, or a command in the pane exits with an error (`exit`). A
plan limit does not end it: the daemon continues that agent itself. Snoozing never changes the status (ADR 0003);
clients display it. Only a person snoozes: an agent pane's connection is refused. The command has its own `introduced_in` arm
(`SNOOZE_SINCE`); `COMPATIBLE_SINCE` stays 78, since an older daemon is simply not asked and an older client reads
the pane without the field.
The desktop app does not snooze a pane.

Protocol 95 adds `Query::CloneRepo { address, parent, tag }` and `Reply::Cloned { tag, outcome }`
(`CLONE_SINCE`; `COMPATIBLE_SINCE` stays): `git clone` of `address` into a new folder, named after the
repository, inside `parent` on the daemon's computer (`crates/maitty-core/src/daemon/clone.rs`).
`outcome` is the new folder's path with `/` separators, or one line saying why nothing was cloned; a
refusal is an answer, not `ServerMsg::Error`, so the client that asked can match it by `tag`. The
address rules are in [SECURITY](SECURITY.md#project-specific-auth-and-permissions). `parent` follows the
rules of `ListFolders` and must be a folder that is there; a file or folder of the new name already
there is a refusal. Human clients only. git runs off the event loop, cannot ask a question
(`GIT_TERMINAL_PROMPT=0`, no input), and is stopped after ten minutes; a clone that fails or is stopped
leaves no folder. An answer from another machine is cut and cleaned to one line (`remote_policy::vet`).
The desktop host sends it through `clone_repository(machine, address, parent, tag)` and raises a
`repository-cloned` event with the tag and either `folder` or `refused` (`apps/gui/src/api/cloneRepository.ts`
waits on it). The host refuses only what could not be a request (empty, over-long, a control
character); the daemon is the judge of the address. A reply from another machine normally counts as an
answer for 30 seconds after a request; a clone's is expected for the daemon's limit plus 30 seconds
(`routing::answer_window`), and a quick answer to something else never uses up that wait.

Protocol 96 adds `Query::GitHubAccounts { tag }` and `Reply::GitHubAccounts { tag, report }`
(`GITHUB_ACCOUNTS_SINCE`; `COMPATIBLE_SINCE` stays): who is signed in to github.com on the daemon's
computer, as its GitHub command line says (`gh auth status --json hosts`,
`crates/maitty-core/src/daemon/github.rs`). `report` is `installed` (false when the machine has no
`gh`), `accounts` (login and whether it is the active one, active first, at most
`GITHUB_ACCOUNTS_MAX`, only sign-ins that still work) and `problem` (one line when `gh` could not be
read: too old to answer in JSON, or no answer in 15 seconds). Nobody signed in is an empty list, not a
problem. Human clients only; `gh` runs off the event loop and cannot ask a question. A report from
another machine keeps only logins GitHub could have given out and one clean `problem` line
(`remote_policy::vet`). A program run with a time limit goes through `proc::run_within`. The desktop
host sends it through `github_accounts(machine, tag)` and raises a `github-accounts` event with the tag
and the report (`apps/gui/src/api/githubAccounts.ts` waits on it for 20 seconds).

Protocol 111 adds `Query::AgentSignIn { agent, request, tag }` and `Reply::AgentSignIn { tag, agent,
state }` (`AGENT_SIGN_IN_SINCE`; `COMPATIBLE_SINCE` stays, since both messages are new and have their own
`introduced_in` arm). `agent` is `Claude`, `Codex` or `Gemini` (always `Failed(Unsupported)`); `request` is
`Start` (run the agent's own login in the background; one already running is answered, not doubled),
`Cancel` or `Read`. `state` is `Idle`, `Waiting { link, code }`, `SignedIn` or `Failed(NotInstalled |
Unsupported | CouldNotStart | TimedOut | Ended)`. The daemon (`daemon/agent_sign_in.rs`) keeps the first
`https://` address and the one-time code from the login's output, at most `SIGN_IN_LINK_MAX_BYTES` and
`SIGN_IN_CODE_MAX_CHARS`, and says `SignedIn` only when the agent's own status command does. Human clients
only; an answer from another machine is ignored (`remote_policy::allow`). The desktop host sends it through
`agent_sign_in(agent, request, tag)` and raises an `agent-sign-in` event with a flat `{machine, tag, agent,
state, link, code, failure}` (`apps/gui/src/api/agentSignIn.ts` re-checks the link is a plain `https`
address). Asking twice changes nothing, so it may go on a kept line. The spike and the behaviour:
[chat-sign-in spec](features/chat-sign-in/spec.md).

Protocol 110 adds `Query::Extensions { request, tag }` with `Reply::Extensions { tag, answer }` (`EXTENSIONS_SINCE`;
`COMPATIBLE_SINCE` stays at 78: both are new messages with their own `introduced_in` arm). It reads and changes the
skills, plugins, MCP servers and marketplaces of Claude Code and Codex on the daemon's computer (design:
[the spec](features/chat-extensions/spec.md); code: `maitty_shared::extensions`, `daemon/extensions/`). `request` is an
`ExtRequest`: `List { project }` (files only, never an agent; a project is an absolute folder that exists),
`PreviewAdd { add }`, `Add { token }`, `SetEnabled { target, enabled }` (plugins only) and `Remove { target }`.
`answer` is `Ok(ExtReply)` (`List`, `Preview` or `Done(line)`) or `Err(ExtError)`: `CliMissing(agent)`, `CliTooOld(agent)`
(the program does not know the command), `NotFound`, `AlreadyInstalled`, `NeedsConfirmation`, `NeedsTerminal(command)`,
`Invalid(why)` and `Failed(line)`. An add is two requests: `PreviewAdd` reads what would run from files, keeps the add
under a random 128-bit token and returns it; `Add` takes the add that token was given for, once, within 10 minutes (at
most 16 are kept). No other path installs, so a client cannot skip the confirmation. A change names only an item the
daemon lists (`NotFound` otherwise), and a name is plain characters (`is_ext_name`), never a path or a flag. Human
clients only: a pane or a structured runtime gets `ServerMsg::Error`. The desktop host sends it through
`extensions(request, tag)` and raises an `extensions` event `{ machine, tag, answer }`; the window waits 95 seconds
(a command gets 60). `NeedsTerminal` is not produced yet: signing in to an MCP server stays terminal-only and the
window says so with the exact command.

Protocol 112 (`AGENT_COMMANDS_SINCE`; `COMPATIBLE_SINCE` stays at 78: the two messages are new with their own
`introduced_in` arm; 110 and 111 belong to changes that landed beside it) adds
`Query::AgentCommands { agent, folder, tag }` with `Reply::AgentCommands { tag, answer }`, where `answer` is
`Ok(Vec<AgentCommand { name, description, hint, aliases }>)` or `Err(one line)`. The daemon asks the agent's own
program on its machine (`maitty-agent-ask`: Claude Code's `initialize` reply for its commands and skills, Codex's
`skills/list` for its skills; Gemini answers an empty list), started in `folder` when that is an absolute path to a
folder that exists and in the home folder otherwise, off the event loop and within the asker's own limit (20
seconds for Claude Code, 15 for Codex). The program is the one on the daemon's login PATH; one that is not there
is `Err("<agent> is not installed on this machine")`, never an empty list. Human clients only. The commands belong
to the machine that runs the chat: the window asks this computer in place (`agent_commands`) and another machine's
daemon through `agent_commands_on(machine, agent, folder, tag)`, whose answer is an `agent-commands` event
`{ machine, tag, answer }` with `answer` as `{ Ok }` or `{ Err }` (`apps/gui/src/api/agentCommands.ts`). A machine
that is offline (a daemon older than the window is one that needs its update, ADR 0007) is refused by name by the host
and shown in the picker; nothing falls back to this computer's list. Names and lines from another machine are cleaned and capped again
(`remote_policy::vet`, `maitty_shared::agent_commands`).

Protocol 117 (`FOLDER_CREATE_SINCE`; `COMPATIBLE_SINCE` stays at 115: the question is new and has its own
`introduced_in` arm) adds `Query::CreateFolder { parent, name, tag }` with `Reply::FolderCreated { tag, outcome }`,
where `outcome` is `FolderCreated::Created { path }` (absolute, `/` separators), `Exists`, `NotAllowed { reason }` (the
name or the parent is not accepted) or `Failed { reason }` (the disk refused). `FolderListing` gains
`can_create: bool` (`#[serde(default)]`: a daemon from before it reads as false), which is how a window knows a machine
can make folders without asking it in vain: an older daemon passes over an unknown question and never answers. The rules
are in [SECURITY](SECURITY.md#project-specific-auth-and-permissions). The desktop host sends it through
`create_folder(machine, parent, name, tag)` and raises a `folder-created` event `{ machine, tag, outcome }`
(`apps/gui/src/api/folders.ts` `createFolder` waits 10 seconds on it); a daemon's reply is not safe to ask twice
(`safe_to_ask_twice`).

Protocol 114 (`REPOSITORIES_SINCE`; `COMPATIBLE_SINCE` stays at 78: the two messages are new with their own
`introduced_in` arm) adds `Query::Repositories { rescan, tag }` with `Reply::Repositories { tag, found }`, where
`found` is `RepositoryIndex { repos, indexed_at, more }` and each repo is `IndexedRepository { path, branch,
last_used }` (`maitty_shared::repositories`; `path` absolute with `/`, `last_used` unix seconds, 0 when unknown). The
daemon keeps the list in memory (`daemon::repo_index`): a search walks the home folder on a blocking thread, breadth
first, at most 5 folders deep, 100,000 folders and 15 seconds (`REPOSITORY_SEARCH_LIMIT_SECS`), skipping hidden folders,
build and package folders (`node_modules`, `target`, ...), the system's media and app folders, links (never followed),
network mounts (Linux: nfs, cifs, sshfs, ...) and linked worktrees; a repository is listed and not entered. It runs no
git: the branch is `HEAD`, the use is the time of `.git/logs/HEAD`. The first search starts with the daemon; the answer
to a question counts the repositories panes run in (found or not, outside the home folder too) as used when a pane there
last had output or input. Without `rescan` the list is answered at once, except that a daemon that has not finished one
search yet waits for it; with `rescan` a search starts (one at a time; a question during one joins it) and every
waiting question is answered when it ends. The list is cut at 300, most recently used first, and `more` says it was cut
or a search ran out of time. Human clients only. The desktop host asks through `repositories(machine, rescan, tag)`
(this computer when `machine` is left out) and raises a `repositories` event `{ machine, tag, answer }`; the window
(no longer asked by the desktop window, whose folder picker only browses; the host command remains) would wait 50 seconds, the host expects the
answer for the search limit plus the clone margin (`routing::REPOSITORIES_ANSWER_WINDOW`). Another machine's list is
cleaned and capped again (`remote_policy::vet`, `RepositoryIndex::cleaned`). A daemon from before 114 never answers, so
the window's wait ends with its own words.

Protocol 102 adds `Query::GitIdentityRule { change, tag }` with `Reply::GitIdentityRuleDone { tag, outcome }`
(`GIT_RULES_SINCE`; `COMPATIBLE_SINCE` stays). `change` is a `GitRuleChange`: `Preview { folder, identity }`
answers the lines `Apply` would write and writes nothing; `Apply { folder, identity }` writes them;
`Remove { folder }` takes away the rule Maiker wrote for a folder (named as the report names it). `outcome`
is the lines by file (`GitConfigWrite { file, lines }`, each line `key = value`) or one line saying why not.
A rule is a file `<data dir>/git-identities/<16 hex digits of the folder's SHA-256>.gitconfig` holding
`user.name`, `user.email`, `credential.https://github.com.username`, an empty
`credential.https://github.com.helper` (which drops earlier helpers), a helper that answers `get` with
`gh auth token --hostname github.com --user <login>`, and `maiker.folder`; plus one
`includeIf "gitdir:<folder>/"` entry in the global config (`gitdir/i:` on Windows and macOS) pointing at
it. `gh auth git-credential` is not used because it only answers for the active account. The folder must
exist, is made absolute with `/` separators, and may not hold `* ? [ \ "`; the name and email are one
line each; the login must be signed in on the machine (`gh auth status`). A folder whose entry points
anywhere else (a rule set outside Maiker) is refused, both to write and to remove. Applying twice leaves
one entry. Everything is written with `git config --global` and `--file`, never as text; the desktop host
sends it with `git_identity_rule(machine, change)`, and an answer from another machine is cleaned and cut
to 4 files of 16 lines (`remote_policy::vet_rule_reply`). Human clients only.

Protocol 101 adds `Query::GitIdentities { tag }` with `Reply::GitIdentities { tag, report }`
(`GIT_IDENTITIES_SINCE`; `COMPATIBLE_SINCE` stays). The report is the machine's global `user.name`
and `user.email` (each absent when not set) and its folder rules: every
`includeIf "gitdir:<folder>/"` (or `gitdir/i:`) entry of the global git config, in git's order, the
last one for a folder standing for it, at most `GIT_IDENTITY_RULES_MAX` (100). A rule Maiker wrote
has an `identity` (`name`, `email`, GitHub `login`): its entry points at a file directly inside
`<data dir>/git-identities/` whose `maiker.folder` names that folder (a file from before the rename names it under `maitty.folder`, which is read, and copied to the new key on first read), and the login is that file's
`credential.https://github.com.username`. Any other rule has `identity: None` and only its folder is
read. A machine without git answers `installed: false`; a config git cannot read answers `problem`.
The daemon asks git (`git config --global --get`, `--get-regexp`, `--file … --get`) and never reads
or writes the file itself. Human clients only; git runs off the event loop, five seconds a question.
The desktop host asks with `git_identities(machine)`, which answers the report as JSON
(`apps/gui/src/api/gitIdentities.ts`); from another machine only that report is taken, cleaned
(`remote_policy::vet_identities_reply`).

Protocol 100 adds `GitRequest::PullRequest` to `Query::Git` (`GIT_PULL_REQUEST_SINCE`;
`COMPATIBLE_SINCE` stays). The daemon pushes the branch as `Push` does, then runs
`gh pr create --fill --head <branch>` in the checkout. The answer's line is the pull request's
address, kept only when it is `https://github.com/<owner>/<repo>/pull/<number>` (`pr::pull_request_url`,
which also drops anything after the number); a pull request that is already open for the branch is
answered with its address. Without `gh` the line says the branch was pushed and to get it from
cli.github.com; any other failure is the first line `gh` said, cleaned and cut to 300 characters
(nobody signed in reads "To get started with GitHub CLI, please run:  gh auth login"). No token is
read. git and `gh` together are stopped after `GIT_SYNC_LIMIT_SECS` (60).

Protocol 99 adds `GitRequest::Commit { message, paths }` to `Query::Git` (`GIT_COMMIT_SINCE`;
`COMPATIBLE_SINCE` stays). With `paths` the daemon stages and commits those files only (`git add -A --`
then `git commit --only --`), and whatever else is staged stays staged and out of the commit; with none
it commits everything that changed. The answer's line is the new commit's short id, a space and its
subject. A path is a file's name relative to the checkout: one that is empty, absolute, starts with
`-`, holds `..`, a `.git` part or a control character is refused, and git is told to read every path
literally (`--literal-pathspecs`), so a `*` or a `:(…)` is a name, not a pattern. The message is trimmed
and may be at most `GIT_COMMIT_MESSAGE_MAX_BYTES` (16 KiB) with no control character but a line break
or a tab; an empty one is refused. The paths together may be at most `GIT_COMMIT_PATHS_MAX_BYTES`
(24 KiB). The repository's hooks run and signing is as the repository has it; nothing is amended. The
request is stopped after `GIT_COMMIT_LIMIT_SECS` (120).

Protocol 98 adds `Query::Git { term, request, tag }` with `Reply::GitDone { tag, outcome }`
(`GIT_SYNC_SINCE`; `COMPATIBLE_SINCE` stays). `request` is a `GitRequest`: `Fetch` (`git fetch --prune`),
`Pull` (`git pull --ff-only`) or `Push` (`git push`, or `git push -u origin <branch>` for a branch with
no upstream yet), run in the folder pane `term` is in. `outcome` is one line either way: `Fetched`,
`Pulled`, `Already up to date` or `Pushed <branch>`, or why nothing happened. A checkout on no branch
and a pull with no upstream are refused before git runs; a branch that is both ahead of and behind
its upstream is not pulled and stays as it was. Nothing merges, rebases or forces. Human clients only,
with the same pane checks as `Query::Repo` (an unknown pane is `ServerMsg::Error`); git runs off the
event loop with `GIT_TERMINAL_PROMPT=0` and the whole request is stopped after `GIT_SYNC_LIMIT_SECS`
(60). An answer from another machine is cut and cleaned to one line (`remote_policy::vet`).

Protocol 97 adds `Query::GitHubRepos { owner, search, tag }` with `Reply::GitHubRepos { tag, answer }`,
and `Query::GitHubOwners { tag }` with `Reply::GitHubOwners { tag, answer }` (`GITHUB_REPOS_SINCE`;
`COMPATIBLE_SINCE` stays). Each `answer` is a `GitHubAnswer`: `NotInstalled`, `NotSignedIn`,
`Failed(one line)` or `Listed(…)`; having no `gh` and nobody signed in are answers, not
`ServerMsg::Error`. Repositories are `owner`'s, or the signed-in account's when none is named
(`gh repo list`), narrowed by `search` when there is one (`gh search repos --owner`): at most
`GITHUB_REPOS_MAX` (200), each with `name` (`owner/name`), a one-line `description` cut at 300
characters, `private`, `pushed_at` and `clone_url`, and `more` when there were more. Owners are the
signed-in login, then its organisations (`gh org list`), at most `GITHUB_OWNERS_MAX`. Human clients
only; `gh` runs off the event loop and is stopped after `GITHUB_LIST_LIMIT_SECS` (30). What a login,
a repository name and a time may look like is in `maitty_shared::github`; `clone_url` is always built
from the checked name (`clone_address`), by the daemon and again when the answer comes from another
machine (`remote_policy::vet`), never copied from what was printed or sent. The desktop host sends
them through `github_repos(machine, owner, search, tag)` and `github_owners(machine, tag)` and raises
`github-repos` and `github-owners` events: the tag, a `state` (`listed`, `not-installed`,
`not-signed-in` or `failed`), `why` for a failure and `listed` for a list
(`apps/gui/src/api/githubRepos.ts`). Their answers are expected for 75 seconds
(`routing::answer_window`), which covers the daemon's two `gh` runs. In the window, a question whose
answer is an event with the same tag goes through `apps/gui/src/api/taggedAnswers.ts`.

Protocol 127 adds `Command::SaveWorkspace { project, sessions }`, `Query::Workspace { project }` and
`Reply::Workspace(Vec<ClosedSession>)` (`WORKSPACE_SINCE`, with an arm in both `introduced_in`; `COMPATIBLE_SINCE` stays
122, since an older daemon is never sent the command or the question and an older client is never sent the reply). The
daemon keeps, per project (an absolute folder), the sessions that were open when it was parked or closed, so they can
be opened again; a save replaces the project's set and an empty set forgets the project. Records are `ClosedSession`s,
cleaned as the closed list cleans them, and the daemon keeps at most `WORKSPACE_SESSIONS_MAX` (50) per project and
`WORKSPACE_PROJECTS_MAX` (50) projects, the oldest first to go (what is kept and where is in
[DATABASE](DATABASE.md#project-specific-saved-workspaces)). Human clients only; a pane is refused both. A relative or
control-character project is refused with an error. `Reply::Workspace` is the set in the order saved, empty when none;
another machine's answer is ignored (`remote_policy`). The desktop client sends them through `save_workspace` (false
without asking from an older daemon) and `workspace` (null from an older daemon); tests:
`a_peer_from_before_the_open_set_still_talks_and_is_never_sent_one`,
`the_open_set_is_never_sent_to_a_service_from_before_it`. The window saves through the host's `save_workspace` command
(`saveWorkspace` in `api/daemon.ts`) when a project is closed, and reads through `saved_workspace { project }`
(`savedWorkspace`, `maitty_desktop_client::workspace`: the list, or null without asking from a daemon older than 127)
for the project's Workspace panel; both ask this computer's daemon only, each on a connection of its own. The daemon
matches the folder exactly, so both name a project by its opened project's `folder` as the sidebar spells it. The window
builds each saved record itself (`model/openSet.ts`): a terminal's agent conversation id is its pane's
`TermInfo.session`, and a chat's is `ConversationSummary.session` (`#[serde(default)]`, written only when known, so it
needs no bump: the 126 shape decodes in `conversation_summary_from_an_older_daemon_defaults_to_structured_execution`),
the chat's `binding.session_id`, set for a chat session only, since a pane's conversation has its pane to say it.

Protocol 126 adds `SavedConversation.title` (`#[serde(default)]`, so it needs no bump of its own: a test decodes the
125 shape) and `Command::ConversationActiveAt { id, at }` (`CHAT_ACTIVE_AT_SINCE`, with an arm in `ClientMsg::introduced_in`;
`COMPATIBLE_SINCE` stays 122, since an older daemon is never sent the command). `title` is the name the agent gave the
chat, one clean line cut at `SAVED_FIRST_MESSAGE_MAX_CHARS`: for Claude the person's `custom-title`, else the latest
`ai-title`, read from the first 1 MiB of the transcript and, for a longer file, its last 256 KiB; for Codex the latest
`thread_name` in `session_index.jsonl` (its last 1 MiB). None when the agent gave none, and a client shows `title`, else
`first_message`. Both `SavedConversations` and `ImportableChats` carry it. `ConversationActiveAt` (human clients only)
sets a chat's status time to `at`, never later than now, so a chat opened on a saved session shows its real last use
instead of the time it was opened; the next status change stamps now as for any chat. The window sends it after a resume
start (`conversation_active_at`) and a daemon before 126 is not asked. The name itself goes through the existing
`ConversationRename`.

Protocol 125 adds `Query::ImportableChats { tag }` with `Reply::ImportableChats { tag, chats }`
(`IMPORTABLE_CHATS_SINCE`, with an arm in both `introduced_in`; `COMPATIBLE_SINCE` stays 122, since an older daemon is
never asked and an older client never asks). `chats` are the conversations Claude and Codex saved in any folder of the
daemon's computer, read as `SavedConversations` reads them (the same stores, limits, first-message rules and id
check), each with its `agent` and the `folder` it recorded, newest first: at most 60, and 5 of one folder. Left out are
the ones the daemon already holds (a chat's session, a pending start's thread, a pane's agent session:
`held_agent_sessions`) and the ones whose folder is gone. Human clients only; read on a blocking task. The desktop
client asks through `importable_chats` and reads null from an older daemon; another machine's answer is ignored
(SECURITY).

Protocol 124 adds `Command::ConversationMarkSeen { id }`, `Command::ConversationSetPermissions { id, generation,
permissions }` and `BranchWorktree.base` (`CHAT_CONTROLS_SINCE`, with an arm in `ClientMsg::introduced_in` for the two
commands and for a `BranchWorktree` that carries a base; `COMPATIBLE_SINCE` stays 122). `ConversationSetPermissions`
(ADR 0005) sets a running Claude or Codex chat's `LaunchSettings` approval policy and sandbox again; `Permissions` is
that pair and refuses full access with anything but `Never`. Human clients with the admin grant only; a stale
generation, another provider or a chat with no settings is refused in words. The new pair is saved at once and rides on
the next `Rpc::Send` (`State::new_permissions`): Claude's per-message process starts with them, Codex gets
`approvalPolicy` and a `sandboxPolicy` matching `thread/start`'s on `turn/start`. The desktop client sends it through
`set_conversation_permissions` and refuses an older daemon in words (`ask_running_daemon_if_it_reads`).
A chat's Reconnect is `resume_conversation`: `ConversationStart` with `StartTarget::Conversation` at the chat's
generation, which starts its agent again; a Claude chat is read back from its transcript before the start is answered,
with a turn that was cut marked interrupted. After a daemon restart a chat is asleep until a client's first
`ConversationRead` of it, which is answered at once (from what was kept, or as loading, never refused) and then starts
it. A chat cut mid-turn is not started by a read: `ConversationSummary.interrupted` (absent when false, so an older
client reads the same) lists it until a person resumes it; the desktop client's **Resume N chats** is that person.
A service restart (`KillServer`) saves the sessions first, then ends every agent on purpose: a turn in progress stops
and is listed `interrupted` afterwards, and the agent's ending is told to no client as a failure while the daemon is
stopping. Agents do not outlive the daemon.
A chat whose saved history cannot be read back (a missing or unreadable transcript, one past the 16 MiB first read, a
`restore.output` that is off) is not left half-alive: the daemon drops its agent, marks the record stopped and keeps the
real reason (`The saved conversation could not be read: …`) as the chat's error, which a later read never replaces with
the generic wording. A wake that failed this way is put back to sleep once (`wake_retried`), so the next read tries
again; after that only a person's Reconnect does. Reconnect is a recovery start: while the chat's start or its saved
history read is under way (`saved_reads`) it is refused as "already reconnecting"; a runtime that is up with its history
not ready and nothing under way is dropped and started again; a healthy one is refused ("already owns a runtime"). No
message shape changed, so `PROTOCOL_VERSION` and `COMPATIBLE_SINCE` stay as they are.
The seen is the window opening a finished chat: the daemon turns its done to idle, as `MarkSeen` does for a pane, and
leaves every other status alone; human clients with the write grant only. A daemon before 124 is not asked
(`mark_conversation_seen`, through `ask_if_known`) and the chat keeps its done. With `base`, `branch` is a new branch cut
from `base` (its `origin/` ref when it is only on the remote), even when `base` is free to check out, so a worktree of a
picked branch is a copy of it and never the branch itself; without it the message is the older one, which a daemon on
123 reads unchanged. A client asks a daemon before 124 for a base not at all: the desktop client refuses in words
(test: `a_daemon_from_before_chat_controls_reads_the_old_worktree_and_is_never_sent_the_new`).

Protocol 123 adds `Query::PullRequests { folder, fresh, tag }` with `Reply::PullRequests { tag, answer }`
(`PULL_REQUESTS_SINCE`, with an arm in both `introduced_in`; `COMPATIBLE_SINCE` stays 122, since an
older daemon is never asked and an older client never asks). `folder` is absolute or starts with `~`,
like `Query::FolderGit`, and needs no pane. `answer` is a `GitHubAnswer<ProjectPulls>`: `NotInstalled`,
`NotSignedIn`, `Failed(one line)`, or `Listed` of `ProjectPulls::NotOnGitHub` (the folder is in no
repository, or in one with no remote on github.com: not a failure) or `ProjectPulls::Open(PullRequestList)`.
A `PullRequestList` is the signed-in `login`, at most `PULL_REQUESTS_MAX` (50) `items` in `gh`'s order
and `more`; each `ProjectPr` has `number`, `url`, `title`, `author`, `branch`, `draft`, `checks`
(`PrChecksState`: `None`, `Running`, `Failed`, `Passed`), `review` (`PrReview`), `conflicting`, `mine`,
`review_requested`, `needs_you` and `updated_at`. **The daemon decides `needs_you`**
(`daemon/pr_list.rs`): a review is asked of the signed-in account itself, or the pull request is its
own and a check failed or a reviewer asked for changes. A client shows and counts it and never works it
out. Human clients only. The daemon runs `gh auth status`, then one `gh pr list --state open --limit 51
--json …` in the folder, off the event loop, stopped after `PULL_REQUESTS_LIMIT_SECS` (30). It asks only
when a client does, keeps each folder's list for 60 seconds (`fresh` asks past it, for a client that has
just opened a pull request), answers every ask made while `gh` is listing a folder from that one call,
keeps only lists (so a machine that has just signed in is asked again at once), and after a rate limit
answers `Failed` without calling `gh` for 10 minutes, doubling up to 30. From another machine the
answer is cleaned (`remote_policy::vet_pull_requests_reply`, and `vet` on the long line). The desktop
host asks through `pull_requests(machine, folder, fresh)`, on a request line
(`maitty_desktop_client::pull_requests`): this computer's daemon is refused in words when it is older
than the question, and another machine's is on this version or not used. The window reads one flat
answer (`state`: `listed`, `not-installed`, `not-signed-in`, `not-on-github` or `failed`; `why`;
`listed`) in `apps/gui/src/api/pullRequests.ts`. When the window asks is in UI.md, *Pull requests*.

Protocol 70 adds `Query::UsageReport { period }` (`day`, `week` or `month`; rolling windows
ending today, UTC) and `Reply::UsageReport`, answered from the daemon's usage store
([ADR 0009](adr/0009-usage-is-provider-reported-never-estimated.md)): totals, one entry per
session and one per day with usage, as `UsageReport` in `crates/maitty-shared/src/usage_report.rs`
(camelCase when it reaches the desktop app as JSON). Human clients only. A figure no provider
reported is `null`, never zero. `Usage` also gains the defaulted `tokens_in` and `tokens_out`
(the halves of `tokens`), so older peers still decode it. The desktop app calls it through the
`usage_report` command.

Protocol 67 adds, for the desktop app's Inspect panel, find, quick-look links and worktrees:

- `Query::Repo { term, tag, request }` and `Reply::Repo { tag, reply }`: read-only looks at the
  repository a pane is in (`RepoRequest`: status, tree, file, `Locate`, working-tree diff, range
  diff, branches, log, worktrees, snapshots, references; `crates/maitty-shared/src/repo.rs`,
  answered by `daemon/repo.rs`). Human clients only, with the pane's read grant. The daemon roots
  every path at the top of the repository the pane's folder is in, refuses symbolic links and
  paths that climb out, refuses a revision that starts with `-`, and runs git on a blocking
  thread. `Locate` turns a path seen in the pane's output (absolute, or relative to the pane's
  folder) into a repository-relative one, and refuses anything that is not a file inside the
  repository. The answer echoes `tag`, so a client can have several in flight.
- `Command::RestoreSnapshot { term, tag, commit }`: put the pane's checkout back as it was in one
  of the daemon's own snapshots (the commit must be one `RepoRequest::Snapshots` lists), after
  saving what is there now. Only a human can, and not while the pane's agent works or a structured conversation whose folder is in the same checkout is Working. It answers
  `Reply::Repo { Restored(n) }`. This is the one request that changes the repository; every other
  change stays in the pane's PTY.
- `Snapshot.daemon_id` (`Option<String>`, `#[serde(default)]`) is the daemon's random id, kept
  across its restarts. A daemon built before it sends none, and a window still connects to it. A
  window records the id per machine name the first time it sees one and refuses a connection
  whose id differs (see [SECURITY](SECURITY.md)). Added without a `PROTOCOL_VERSION` bump; a
  test decodes the old shape.
- `TermInfo` carries four more fields, each defaulted so an older peer's snapshot still reads:
  `asking` (what a stopped agent is waiting on, read off its screen: the exact command or file
  and its numbered choices; empty unless the pane needs you), `interrupted` (an agent that was
  mid-turn when the daemon restarted, with the command that resumes it), `timeline` (the latest
  turn events, oldest first, from status reports and the shell's OSC 133 prompt marks, 60 kept in
  memory) and `usage.tokens` (what the provider reported, never an estimate). The daemon never
  resumes an `interrupted` agent: a pane saved mid-turn, or asking a question, comes back as a plain
  shell, whichever app owns it, and the window offers the command. The offer is saved with the shell
  (`SavedPane::interrupted`), so a second restart before anyone resumes it still offers it.
- `Query::PaneSearch { query }` and `Reply::Search`: where a word appears in what the app's own
  panes printed recently, case-insensitively, at most 100 hits and 20 from one pane. Human clients
  only, over the panes the client may use. The text is the pane's replay with escape sequences
  removed, so it is what was printed, not what is on screen now.

`NewWorktree` also carries `agent` and `prompt` (`Option<String>`, `#[serde(default)]`; added without
a `PROTOCOL_VERSION` bump, and a test decodes the old shape): the desktop app's "New agent on a
branch", which the revised v18 removed from the window; the daemon keeps accepting them. When either is set the daemon, before anything is made, refuses
a `cmd` beside them, checks `branch` (`[A-Za-z0-9_./-]+` plus git's ref rules, at most 200
characters; `daemon/branch_agent.rs`), requires `from` to be a project the app shows (a repository some
workspace or pane is in), requires the agent to be a configured preset or built-in agent, and bounds the
prompt (8000 characters, no control characters but line breaks and tabs, no leading dash so the agent
cannot read it as an option). The prompt goes in the agent's command line quoted for the pane's shell
(`Config::agent_command`), as the MCP `start` tool does, never interpolated. The worktree itself is the
usual one (`create_trusted_worktree`, the repo's setup hook, the `[worktree] dir` naming, clean-up when
its last session closes). Local projects only: the window refuses another machine's project.

`ConversationSummary.helpers` lists the helpers a chat session's provider reported starting, at its
current generation (ADR 0010; Codex's `subAgentActivity` items). It is display only and never
status. It is a defaulted field, empty from an older daemon, so it needs no `PROTOCOL_VERSION` bump;
a test decodes the old shape.

`ConversationSummary.capabilities` is what the conversation's provider can do, for a chat the
daemon runs. Each adapter states its own once (`maitty_provider_codex::capabilities`,
`maitty_provider_claude::capabilities`) and the daemon's registry reports it; `steer` is true only
while the running Codex says it takes a message into a turn. It is absent for a conversation
the daemon only follows and from an older daemon, and a client then falls back to what it knows
about the agent (the window: `agentAbilities.ts`). It is a defaulted field that is left out when
absent, so it needs no `PROTOCOL_VERSION` bump; a test decodes the old shape. The window reads
`steer` to say what Send now does, and treats a shape it cannot read as no report.

Protocol 65 removes the handoff between chat and terminal
(`ConversationHandoffToNative`, `ConversationHandoffToChat`): a session is a chat
or a terminal session from the moment it starts. It adds the human-only
`ConversationRename` and `ConversationArchive` commands, and `title` and `archived` on
`ConversationSummary` and the saved conversation record (both defaulted, so older files
still load). A name and a closed flag belong to the conversation, so every client reads the
same ones: a rename in the terminal app shows in the desktop app and back, and closing a
chat in either puts it away in both. Closing a chat is not stopping it: an archived
conversation keeps running in the daemon, and a client lists it only under its own
"archived" view. A title is trimmed, stripped of control characters and capped at 80
characters (`clean_title`); an empty one clears it, and each client then words the session
itself. Clients keep no copy of either in browser or file storage.
It also adds terminal access keyed by the pane, for terminal sessions that have no
conversation: the human-only `TerminalInput` and `TerminalResize` commands and the
`TerminalScreen` and `TerminalReplay` queries. They follow the same limits as the
conversation-bound ones (16 KiB of input per message, sizes from 2x2 to 500x300, write
and respond grants, and read for the queries) and resolve nothing but the pane number
they are given.
Protocol 59 adds the human-only `ConversationTerminalResize` command. It
requires the exact conversation generation, validates bounded terminal
dimensions, and resizes only the daemon-resolved native pane. Terminal replay
queries return the pane's bounded raw output history for initial scrollback;
screen queries return a formatted ANSI snapshot for terminal emulation.
Protocol 56 added conversation-bound native terminal screen and input messages.
They require the exact conversation generation and resolve the attached pane
inside the daemon; input is human-only, requires write (and respond while the
pane is blocked), and is limited to 16 KiB per message. Protocol 55 added a
read-only conversation diff query. Protocol 54 added Codex permission approval
requests. Protocol 53 added file-change approval requests. Protocol 52 added
`ConversationStart`, `ConversationSend`, `ConversationApprove`,
`ConversationCancel` and `ConversationRead` over the existing authenticated
socket. Start needs the start grant, send and cancel the write grant, approval
answers the respond grant and read the read grant. Conversation IDs grant no
pane self-exemption.
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

Command execution, file-change, permission and user-input requests retain the exact provider request ID, method,
generation and connection. File-change approval is enabled only after the
matching patch notification arrives, so the GUI can show the requested files and
diff before a decision. A human with the respond grant may answer only the
currently pending request with `accept`, `acceptForSession`, `decline` or `cancel`.
The request ID is removed only after its response is queued on the owning runtime;
stale generations, duplicate answers, and structured runtime callers are refused.
Only the command, requested write root, permission profile and reason needed for a decision are exposed to the client;
invisible Unicode characters are displayed as `\\u{...}` escapes. Raw provider
params are not retained in conversation history or the metadata ledger.
User-input answers must cover each displayed question, use offered choices or an
explicit free-form option, and contain no hidden Unicode. Secret answers are
forwarded only in the live provider response and are not stored in conversation
history or metadata. Permission requests show the exact requested profile and
allow only that profile for the current turn; declining returns an empty profile.
Session-wide grants are not offered. Other provider request kinds remain visibly
blocked and unanswered. Turn
Cancellation names only the acknowledged active turn ID and exact native thread;
uncertain submissions cannot be canceled by guessing. The interrupt response
means the request was accepted, not that the turn stopped; the GUI waits for the
matching `turn/completed` event. Only human clients can cancel. Native ownership
transfer remains a later ticket contract. A completed
native turn enters the existing checkpoint resolver/approval/worker path once;
generation/run fences reject obsolete results. Provider completion cannot turn a
failed or pending checkpoint into a pass.

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
Explicit read replies carry the same checkpoint-gated status and checkpoint
summaries. Provider error notifications and failed/interrupted native turns stay
blocked with an explicit error reason; they cannot report successful completion.
Failures answer the owning pending request and notify attached observers, without
injecting unrelated errors into other one-shot clients.

Revision advances use checked arithmetic before changing content, order or
completeness. Exhaustion returns typed `RevisionExhausted`, preserves the prior
view/cursor revision and surfaces at the daemon boundary. Cache loading/preparing
rejects an exhausted manifest/projection revision; imported attachment revisions
are checked before replacing the existing view. Revisions never wrap or saturate.

## Project-specific: connections to other machines

One supervisor task per `[[machines]]` entry (`link/` in `maitty-machines`) keeps that machine's line up.
It talks to the window only through `LinkEvent`s (a new line; a new state) and `LinkControl`
commands (line ended, refuse, retry), so a dead machine cannot hold a lock or block drawing.
With no `[[machines]]` entry nothing starts. `--remote host` is unchanged: the window's one
machine, `MachineId::LOCAL`, connected by `open_or_spawn`.

**Ids.** `MachineId` 0 is this computer. Configured machines get 1, 2, ... in name order
(case-insensitive), so a run's ids follow from its config. Ids are never saved (layout is kept
under the machine's name), so adding a machine renumbers the ones after it without harm.

**States** (`ConnectionState`; `link::next(state, event, now)` is pure and takes the time):

| State | Meaning | Left by |
| --- | --- | --- |
| `Connecting` | first dial of this run | success, or a classified failure |
| `Connected` | a line is up | the line dropping (`LineDropped`, `WatchdogFired`) |
| `Reconnecting { attempt, since }` | a line that was up dropped; the first `RECONNECT_DIALS` (3) failed dials still read as this | success, or a failure that needs a person, or the dials running out |
| `NeedsLogin { why }` | ssh could not log in without a prompt | success |
| `NeedsUpdate { why }` | the far side runs another protocol version, or has no app | success |
| `Unreachable { since, why }` | no answer (also: no daemon running there; refused) | success; `Retry` shows `Reconnecting` |

A failed dial in `NeedsLogin`, `NeedsUpdate` or `Unreachable` changes nothing a person sees
except `why`: retries are quiet. `Retry` (a person asks, or the machine's config entry changed)
dials at once. A machine's agents stay in the sidebar model through every state (the snapshot
is kept, not cleared), and the next `State` replaces it.

**Backoff** (`Backoff::DEFAULT`): no wait before the first dial and before the redial of a line
that held; after `n` failures in a row, 250 ms doubled `n - 1` times, never more than 30 s
(250, 500, 1000, ..., 16000, 30000, 30000). A line that held for 30 s (`STEADY_LINE`) resets it; one
that ends sooner counts as a failure, so a line turned away as soon as it is made is not redialled
as fast as it ends.

**Failure classes** come from `link_failure::classify`, from structured signals: the error's
type (`OtherVersion` is `Update`, or `UpdateHere` when the far side is newer), ssh's exit status, and
whether the far side ever sent its stream marker or a frame. Exit 127 is `Install`. Exit
`NO_DAEMON_EXIT` (74) is `NoDaemon`. Exit 255 with nothing received is read for a few fixed tokens,
the only place ssh's words are read: `REMOTE HOST IDENTIFICATION HAS CHANGED` is `HostKeyChanged`
(with the host as `known_hosts` names it, from ssh's own `ssh-keygen -R` line when it is a plain
host), and only that banner means the key changed; `Host key verification failed` without it is
`HostKeyUnknown`, a key ssh has never seen that the person's own `StrictHostKeyChecking=yes` (kept,
ADR 0017) or an ssh too old for `accept-new` refused (ssh adds `No <type> host key is known for
<host>`). Both are logins (`is_login`): the machine waits for a person. `Permission denied` or `Too many authentication
failures` is `NeedsPerson` when the key already worked (`partial success`) or the methods ssh lists
hold no `publickey`, else `KeyRefused`. Everything else is `Unreachable` with ssh's last stderr
line, control characters removed and cut to 200 characters. The connection state carries the class
itself (`ConnectionState::NeedsLogin`, `NeedsUpdate` and `Unreachable` hold a `FailureClass`;
`ConnectionState::failure`), and a refusal by daemon id is `Refused`.

**Failure sentences.** `link_failure::sentence(failure, subject, os)` is the only place a failure is
worded: one sentence that names the machine and gives the exact fix, never an internal part of the
app (no helper, probe or daemon), and never an offer to accept a changed host key. `Subject` is the
machine's name, target and port (`Subject::of` a `Machine`, `Subject::of_def` a `MachineDef`);
`ClientOs` picks the fix for the system the person types on (`ssh-copy-id` on Linux and macOS, the
PowerShell line that does the same on Windows). `HostKeyChanged` gives `ssh-keygen -R '<host>'` after
confirming the change; `HostKeyUnknown` gives `ssh -o StrictHostKeyChecking=ask [-p <port>] <target>`
to run once in a terminal, check the fingerprint and answer yes (the same on Windows; on the command
line the option comes before the person's config, so ssh asks where their config would refuse), and
never names `ssh-keygen` or a changed key. `RefusingConnections` is a machine that took the
connection and hung up before ssh could sign in: ssh's last line is `Connection closed by <host> port
<n>` or `Connection reset by <host> port <n>`, with nothing before it but ssh's
`kex_exchange_identification:` line, which is how sshd's `MaxStartups` and `PerSourcePenalties`
(OpenSSH 9.8+) read from the client. Its sentence says the machine may be refusing new connections for a
while, after failed sign-ins or too many at once, to wait a few minutes and try again, and to check its
sshd and fail2ban settings if it lasts. What can't be told apart stays `Unreachable`: a firewall ban (how
fail2ban usually bans) refuses or drops the connection like a machine that is off; a hang-up named
`UNKNOWN port 65535` is a proxy's or jump host's, which also hangs up when the machine behind it is down;
and a hang-up after other lines (a host key added) got past the door. Its dials carry on like an
unreachable machine's (a redial that meets it counts as a reconnect blip), and adding a machine that
refuses adds nothing, like one that can't be reached. `fix_command` is the one command a sentence names,
for a Copy button. The terminal app (the Machines list, its toasts, the CLI's connect errors,
`doctor`) and the desktop app (`MachineState.why` with `failure` and `fix_command`; the add outcomes'
`message`) show these sentences and write none of their own; `doctor` only puts the two numbers before
the sentence for a version or protocol that differs (`0.58.1 there, 0.60.0 here. …`). `is_failure_sentence` tells such a
sentence from a machine's other words, for MCP's `unreachable` error code.

**Custom transport.** A machine with `via` is reached by running the user's program
(`Route::Command`, `ssh_command::command_argv`, both in `maitty-machines`) in place of ssh: the same pipes, stream marker skipping,
handshake and `SshEnd` (with `custom` set) as ssh. Text before the marker with no marker is the same login
error. Its failures classify without ssh's words: exit 127 is `NeedsInstall`, `NO_DAEMON_EXIT` is
`NoDaemon`, anything else is `Unreachable` with the program's last stderr line, never `NeedsLogin`. On
Windows connecting fails with `a custom transport (via) is not supported on Windows in v1; use ssh`.

**Attach only, and when the daemon may start.** A daemon exits ~30 s after it has no session and
no attached window, so a fresh machine has nothing to attach to. The supervisor therefore decides
per dial (`MayStart` in `maitty-machines`' `link/supervisor.rs`): the dial runs `<remote_cmd> proxy` (the daemon is
started if none runs, as `--remote host` does; `Machine::starting`) on the machine's first dial,
on every retry of a failed first dial, and after an explicit `Command::Retry` (the Machines
dialog's retry, also after a refusal). The redials after an established line ended (stalled or
closed) run `<remote_cmd> proxy --attach-only` (built in `maitty-machines`' `ssh_command.rs`): if no daemon runs
there, the proxy exits `NO_DAEMON_EXIT` before writing anything, and the machine is `Unreachable`
with `NoDaemon` ("try again to start it there") until a person retries, so a dropped link never
brings back a daemon the user stopped. `Machine::from_def` is attach-only by default, which is
what the CLI's `--on`, MCP and `doctor` use: none of them starts a remote daemon.

**Liveness.** An idle line is kept honest by ssh itself (`ServerAliveInterval=15`,
`ServerAliveCountMax=3`: ssh exits after 45 s of silence, which closes the line). The client's
own watchdog is for the other failure: a frame that began and stopped arriving. The reader waits
`STALL` (15 s) per window for a whole frame; two windows in a row with the same non-zero part of
a frame buffered, and nothing more received, drop the line (`Burst.stalled`). A frame that
trickles in grows the buffer every window, so a big frame on a slow link is never dropped; an
idle line has no part of a frame buffered, so it is never dropped by this. (A line that stops
right after a frame's four length bytes has nothing buffered; ssh's ServerAlive ends it.) A dial
that never answers is dropped after `CONNECT_BUDGET` (ssh's connect timeout plus 5 s).

**Teardown.** A line's ssh child is owned by a background task that kills it when the writing
half is dropped and reaps it there; nothing awaits ssh's end on the way out. Ending a lost line
drops its tasks at once, so a stalled line's ssh does not linger.

**On reconnect** the daemon sends `State` and a `Replay` per pane on attach: `State` replaces
the machine's snapshot and each `Replay` replaces that pane's screen. Typing sent while the
machine was down is dropped, never queued: replaying keystrokes into a pane that moved on could
run commands the person no longer meant. The window counts it and says, once the machine is
back, "N keystrokes to <name> were not sent while it was disconnected".

**Refusal.** A different daemon answering at a machine's name (`machine_ids`) parks the
supervisor (`Refuse`): no dial until a person asks. A new line re-checks the id, so the same
wrong daemon is refused again and a fixed one is let in; editing or removing the machine's
`[[machines]]` entry and reloading the config clears the refusal and dials. A running
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

| Outgoing path | Machine before | Machine after |
| --- | --- | --- |
| `Input` (typing, paste, mouse and focus reports, `send_input`) | `term.machine` | `term.machine` |
| `Resize` (`sync_sizes`) | `term.machine` | `term.machine` |
| `Hook`, `Usage` | sent by the CLI, never the window | unchanged |
| `FocusPane` from pane clicks (`input.rs`), `MarkSeen` in the Inbox, `ConversationArchive` when a pane ends | this computer | `term.machine` |
| `FocusPane`, `ClosePane`, `RenamePane`, `SetTabOf`, `SwapPanes`, `TeachAgent`, `ClearQueue`, check commands, `AnswerHelpers`, `AnswerSecret` | `term.machine` | unchanged |
| `Query::CheckOutput` | `term.machine` | `term.machine`; the reply is taken only for an open sheet or waiting failure on that machine |
| `Query::Worktrees` | this computer | focus machine (worktrees are local-only for other machines) |
| `NewWorkspace` from new session, shell here, split, recipes, new-agent dialog | this computer | `target_machine()`, or `Proj.machine` for a project's own |
| `NewWorkspace` from a split menu | this computer | `term.machine` of the pane split |
| `NewTab` (`SpawnTab`) | this computer | `target_machine()` with that machine's active workspace |
| `RenameTab`, `CloseWorkspace` (prompts carrying `WsId` / `TabId`) | this computer | `focus_machine()` (the ids came from its active workspace) |
| `ConversationRename`, `ConversationArchive` | this computer | `conversation_machine(id)`: the selected session's machine if it lists the chat, else the first machine that does |
| `NewWorktree` (also with `agent` and `prompt`), `BranchWorktree`, `RemoveWorktree`, `TidyWorktrees`, `CloseWorktree`, `AgentWorktree`, `ReopenClosedSession` | this computer | this computer; refused for another machine's project or pane |
| `ForgetCheckApproval`, `ReloadConfig`, `KillServer`, first-state `SelectWorkspace` / `NewWorkspace` | this computer | this computer (no owning machine) |

**Local-only features.** `Feature` (Files, Changes, Find, Branches, References, image paste, agent
status setup, Worktrees) names what reads or writes a pane's files or runs git there. One gate,
`App::guard_local(machine, feature)`, decides per pane: allowed when the pane's files are on this
computer, otherwise a toast and nothing else. Every entry point calls it: `act()` for actions
(with the selected pane's machine), the project menu for worktrees, `open_path_from`,
`paste_image`, the Inbox's Changes / merge / discard keys, and new worktrees. A window attached
to one remote daemon (`--remote`) keeps its own worktrees; every other feature there is gated too.
The message is one format, `routing::local_only_message`: "<Feature> is local-only in v1: the
files are on <machine>, not on this computer."

A pane's folder becomes a path on this computer only through `App::local_cwd(term)`, which is
`None` for a pane on another machine. Git runs only in `local_git_projects` (overlap and
changed-line counters), never in a project whose machine is not this one.

**Replies.** The wire is unchanged. For each `Command` or `Query` sent to another machine the
window keeps a timestamp (`Routing::asked`); a `Reply` or `Error` from that machine is applied
only while one is waiting (`awaiting`), and consumes the oldest (`answered`). A timestamp older
than 30 s is dropped and at most 64 are kept, because most commands are never answered. An
unsolicited reply or error is ignored (`remote_policy::Verdict::Answer`). This computer's own
daemon is not subject to it.

**A machine that is down.** `App::deliver` hands a message to `Connections::send`. On
`NotConnected`, typing is counted (`unsent_input`, told when the machine is back); any other
command or query raises one toast, "<machine> is disconnected; <what> was not sent."; resizes and
the rest are dropped silently. Nothing blocks and nothing is queued.

**One-shot commands.** `cli/target.rs` picks the machine of a command once, before it runs: a
pane address `machine/id`, else `--on`, else the `--remote` adapter (`ipc::Machine::current()`),
else this computer. Each command is handed that `Target` and opens its connection with
`ipc::open_to` (for another machine, `maitty_machines::open_remote`); nothing reads the environment for the machine after that. A configured machine only
attaches. The pane a command runs in (`$AGENT_TERM_ID`) is a pane of this computer's daemon, so it is
the default pane only when the target is this computer or the ad-hoc `--remote` route; a command
aimed at a named machine needs an explicit `--pane machine/id`. `ls` is unchanged for this computer;
named at a machine it heads the list with `machine <name>`, writes panes as `name/id`, and
`ls --json` adds `"machine"` to each workspace. `ls --all` asks this computer and every configured
machine at the same time and prints those that answer; each that does not gets a line
`<name>: unreachable (<why>)` (or `needs a login`, `is another version`, ...) on stderr, and the command
fails only when none answered.

**MCP tools.** `maiker_list`, `_read`, `_send`, `_wait` and `_start` take an optional `machine`; a
session of another machine is written `machine/id` in a list and accepted as an `id` by every pane
tool (the `machine` argument may then be left out; if both are given and differ, the call is an
error). Omitted, a call is exactly as before. `machine = "all"` is for the list only. Errors that
name a machine are typed, with `structuredContent.error.code` and the text `code: message`:
`machine_not_enabled`, `unknown_machine`, `permission_denied`, `unsupported_for_remote`,
`unreachable`. Answering, interrupting and starting are `unsupported_for_remote`. See SECURITY "MCP
across machines" for who may reach what.
