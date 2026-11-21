# Does one provider trait fit Claude's process-per-message model?

Checked 2026-11-20 against `crates/maitty-core/src/daemon/conversation/claude.rs` and
`maitty-provider-claude`. The prototype is
`crates/adapters/maitty-provider-claude/src/dialect_spike.rs`: test-only, about 290 lines, with
ten tests. Nothing in the daemon uses it.

## Result: go

A dialect with no I/O can drive a Claude chat that starts a new process for every message. The
prototype wraps the existing `TurnProjector` and covers: opening a conversation without a
process, the first message, a resumed message, a picked model, streamed text, an approval, an
interrupt, a message refused during a turn, an uncertain delivery and a process that exits
mid-turn.

The trait in the provider plan needs four changes to fit. None is large.

## Changes to the sketched trait

1. **The dialect asks for a process; it does not declare a process model.** The plan had
   `process_model()` and one `launch()`. Claude's arguments depend on the message (first or
   resumed, picked model and effort), so the launch cannot be decided once. In the prototype the
   dialect returns `Step::Spawn(LaunchPlan)` when it needs a process and `Step::CloseInput` when
   it is done with it. Claude returns them for every message. Codex would return `Spawn` once,
   when the conversation opens. `ProcessModel` is not needed.
2. **`next_launch()` covers the process started ahead.** After a turn the dialect says which
   process the next message most likely needs. Core starts it and writes the plan's `preamble`
   (the initialize request). When the message comes, core compares the plan the dialect asks for
   with the one it started: equal plans mean the waiting process is used, anything else means it
   is stopped. The dialect cannot tell which happened, so the warm path adds no dialect state.
3. **`on_exit()` is needed.** A process that ends mid-turn has to be reported, and one that ends
   after `CloseInput` must not be.
4. **Core supplies ids and times.** `Send` carries the turn id and the user item id. Events
   carry no times; core stamps them. Today `TurnProjector` reads the clock and `claude.rs` makes
   ids from random bytes, which is why neither can be tested without them.

## Error classes

`claude.rs` has two kinds of failure, and the trait can keep both without an error enum:

- an error from `on_command` refuses that command and the conversation lives on (today's
  `TurnFailure::BeforeStart`);
- an error from `on_line` means the provider's output cannot be trusted and core ends the
  conversation (today's `TurnFailure::Active`).

One difference to decide in MAITTY-484: a stale approval answer or a stale interrupt ends the
conversation today. In the prototype they are refused commands.

## What stays in core

- Spawning, the process tree, stdin and stdout framing, stderr, and stopping (`OwnedChild`).
- Timeouts. The 30 second initialize limit and the 10 minute idle limit of a waiting process
  belong on `LaunchPlan` as values, with core doing the waiting.
- The transcript check before a waiting process is used. `LaunchPlan` needs an optional file
  whose length must not have changed; core reads the length.
- Answering the pending `Send`: core treats the first `TurnStarted` as the acknowledgement.

## What moves into the Claude adapter (MAITTY-484)

- The turn loop of `claude.rs` (`run_turn`): the approval map, the interrupt bookkeeping, the
  `AskUserQuestion` refusal, the late `init` check and the delivery check. All of it is in the
  prototype as plain state.
- `claude_folder_name` (now in core's `saved.rs`), to name the transcript for the check above.
- `approval_command` and `file_change_previews` (now in core's `tool_input.rs`). They know
  Claude's tool names. The prototype emits the tool name and input and leaves the wording open.
- The environment rules (`CLAUDE_CONFIG_DIR`, dropping `CODEX_HOME` and `CLAUDECODE`), as fields
  of `LaunchPlan`.
- `TurnProjector` should emit provider events itself. The prototype reads its Codex-named
  notifications back by name in one function, `provider_event`, which is the part to delete.

## Not covered

- The `--version` check runs a second, short process before the conversation is ready. It needs
  its own step or a call before `Open`. Not prototyped.
- Codex was not run through the trait. `Spawn` on `Open` is a reading of `runtime.rs`, not a
  test.
- Items are raw JSON in the prototype. MAITTY-482 defines the typed item.
- Helper (subagent) frames are dropped by the parser today and are tracked from the transcript
  elsewhere. The trait does not carry them.
