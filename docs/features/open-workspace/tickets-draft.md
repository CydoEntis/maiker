# Open workspace — ticket drafts (Plane project MAITTY)

File these in order. Module: "Open workspace" (a new module is a tracker change; create it first).
State: Backlog. Labels: `feature` plus the area shown. Blockers: use Plane's "blocked by" relation
(each body also repeats it as a `Blocked by` line). All tickets link the intent:
`docs/features/open-workspace/intent.md`.

Every ticket's verify line is the repo gate (AGENTS.md): `cargo build`, `cargo test`,
`cargo clippy --all-targets -- -D warnings`, `scripts/check-gui-deps.sh`,
`cargo check --target x86_64-unknown-linux-gnu`, `cargo check --target aarch64-apple-darwin`; GUI
tickets add `pnpm typecheck`, `pnpm lint`, `pnpm test` in `apps/gui`. (The full macOS check cannot
run on Linux; the partial form `-p maitty-shared -p maitty-core -p maitty-settings
-p maitty-terminal-client -p maiker` can. Say which ran.)

Shared design assumption (stated, not open): the daemon keeps the saved set, per project, as full
session records in a new file, because it owns sessions (ADR 0001) and the closed-sessions list is
capped at 50 across all projects and would evict them. Removing a worktree stays permanent, as in
the existing tidy flow; there is no archive step in this feature.

---

## 1. feat(protocol): save and read a project's open set
Labels: feature, daemon

### Goal
The daemon can store, per project, the set of sessions that were open when the project was parked
or closed, and return it after a restart.

Intent: docs/features/open-workspace/intent.md

### Acceptance criteria
- [ ] A new `Command::SaveWorkspace { project, sessions }` replaces that project's saved set, and a
  new `Query::Workspace { project }` returns it — checked by a daemon test.
- [ ] The set survives a daemon restart in a new versioned file `workspaces-<socket>.json`, written
  atomically; an unreadable file is set aside as `.bak` and the list starts empty — checked by a
  test modelled on `closed_sessions_tests.rs`.
- [ ] Each saved session keeps what a reopen needs (agent, session, cwd, branch, title, worktree,
  repo, as `ClosedSession` does), cleaned like `cleaned` in `closed_sessions.rs`, and the store is
  capped (50 sessions per project, 50 projects) — checked by a test.
- [ ] `PROTOCOL_VERSION` becomes 127 and `COMPATIBLE_SINCE` stays 122; both messages have
  `introduced_in` arms (`WORKSPACE_SINCE = 127`); the desktop client skips them on an older daemon
  — checked by tests, including an old-shape decode test.
- [ ] The verify gate passes.

### Non-goals
- No GUI. No history view. No remote machines. Do not change `closed-sessions-<socket>.json`.

### Context
- Copy the pattern in: `crates/maitty-core/src/daemon/closed_sessions.rs` — `Stored{version,sessions}`,
  `FORMAT_VERSION`, atomic `write_file`/`set_aside`, `cleaned`; tests in `closed_sessions_tests.rs`.
- Record shape: `ClosedSession` at `crates/maitty-shared/src/protocol.rs:139`.
- Gating pattern: `ServerMsg`/`ClientMsg` `introduced_in` arms near `protocol.rs:2828-2841`
  (`IMPORTABLE_CHATS_SINCE`, `CHAT_ACTIVE_AT_SINCE`); desktop client `ask_if_known` /
  `refuse_unless_daemon_reads` in `crates/maitty-desktop-client/src/lib.rs`.
- Human-clients-only commands: see `ReopenClosedSession` handling near `daemon/mod.rs:1167`.
- Watch out: `docs/API_PATTERNS.md` owns the protocol rules; update it in this change.

### Impact
- Protocol: version 126 → 127, `COMPATIBLE_SINCE` unchanged.
- Docs: `docs/API_PATTERNS.md`.

---

## 2. feat(ui): save a project's open set when it is closed
Labels: feature, client
Blocked by 1

### Goal
Closing a project saves what was open in it.

Intent: docs/features/open-workspace/intent.md

### Acceptance criteria
- [ ] After the confirm and before the sessions end, the app sends `SaveWorkspace` with the
  project's agent and chat sessions (plain terminals are left out) — checked by a test in
  `useProjectActions.test.ts`.
- [ ] A failed save does not stop the close and shows one toast saying the set was not saved —
  checked by a test.
- [ ] On an older daemon the save is skipped with no toast — checked by a test.
- [ ] Close project's confirm and six-second undo behave as before; existing tests pass unedited.
- [ ] The verify gate passes.

### Non-goals
- No panel. No saving on any other action. No change to what Close project asks.

### Context
- Change: `apps/gui/src/features/workspace/useProjectActions.ts` — `onClose` (collects `listed`,
  `running`, calls `endSessions` then `closeOnceEmpty`).
- Menu item: `apps/gui/src/features/workspace/components/projectMenu.tsx` ("Close project…").
- Session ending: `useClosing.ts` — `endSessionsNow`.
- Copy the wrapper pattern in: `apps/gui/src/api/daemon.ts` — `closedSessions`,
  `reopenClosedSession` (and the Tauri command in `maitty-desktop-client`).
- After 1 lands: `SaveWorkspace` and `WORKSPACE_SINCE` exist; call them rather than a second path.

---

## 3. feat(ui): add a workspace panel listing a project's sessions
Labels: feature, client
Blocked by 1

### Goal
**Workspace…** in a project's menu and the palette opens a panel listing that project's sessions,
with nothing ticked.

Intent: docs/features/open-workspace/intent.md

### Acceptance criteria
- [ ] The project's context menu and the command palette each have a "Workspace…" entry that opens
  the panel — checked by tests in `Sidebar.test.tsx`/`CommandPalette.test.tsx`.
- [ ] Rows show name, agent, branch, running or closed, and last time, from the project's live
  sessions plus `Query::Workspace`; nothing is ticked; Select all and Select none work — checked by
  a component test.
- [ ] An empty project shows one sentence; an older daemon shows its restart sentence — checked by
  tests.
- [ ] `docs/UI.md` describes the panel; Visual check below is done or reported as not done.
- [ ] The verify gate passes.

### Visual check
The panel at its default size, with running and closed rows, ticked and unticked; it must match the
other `mx-recent` dialogs (`docs/DESIGN.md`). Manual step if screenshots are not possible.

### Non-goals
- No actions yet (open, close, remove), no worktrees, no stale badges.

### Context
- Copy the pattern in: `ImportChatsDialog.tsx` (presentational checklist: ticked state, `onCancel`,
  primary button disabled when nothing is chosen) and its wrapper `ImportChats.tsx`; dialog chrome in
  `RecentSessionsDialog.tsx` (`Dialog`/`ModalHead`/`ModalBody`/`ModalFoot`, `mx-recent`).
- Open state lives in `useRecentSessions.ts`; mounted in `WorkspaceDialogs.tsx`; palette items in
  `usePaletteItems.ts`.
- Project identity: `OpenedProject = {machineName, folder}`, `model/openedProjects.ts`.
- After 1 lands: `Query::Workspace` exists; read it through a wrapper like `closedSessions`.

---

## 4. feat(ui): show a project's worktrees in its workspace panel
Labels: feature, client
Blocked by 3

### Goal
The panel lists the project's worktrees with their standing.

Intent: docs/features/open-workspace/intent.md

### Acceptance criteria
- [ ] Each worktree row shows branch, uncommitted changes, whether it is merged, and "inactive N
  days", from `Query::WorktreeStanding` — checked by a component test.
- [ ] The main checkout is listed but cannot be ticked for removal — checked by a test.
- [ ] Standing loads in the background and each row says "checking" until it arrives — checked by
  a test.
- [ ] The verify gate passes.

### Non-goals
- No removal yet. No change to the daemon's standing rules.

### Context
- Listing: `git::list_worktrees` (`crates/maitty-core/src/daemon/git.rs`), exposed to the app as
  `FolderWorktree{path,branch,main,when}` through `loadFolderBranches` / `folder_git.rs`.
- Standing: `crate::tidy::standing` (`crates/maitty-core/src/tidy.rs`) →
  `WorktreeStanding{dirty,branch,merged,last_commit,inactive_days}` (`protocol.rs:~2030`).
- Watch out: `safe()` is "clean and merged"; there is no unpushed-commit check beyond `merged`.
- After 3 lands: the panel component exists; add a section to it.

---

## 5. feat(ui): open the ticked sessions and open everything
Labels: feature, client
Blocked by 3

### Goal
**Open** reopens the ticked closed sessions, and **Open everything** reopens all of them in one
click.

Intent: docs/features/open-workspace/intent.md

### Acceptance criteria
- [ ] Ticked closed sessions start one after another; a result toast counts any that failed —
  checked by a test modelled on `useRecentSessions.test.ts`.
- [ ] A session whose worktree is gone is made again through the existing reopen path, or skipped
  with a note when it cannot be — checked by a test.
- [ ] Running sessions cannot be ticked for Open; Open is disabled while nothing is ticked and
  while one is already starting — checked by tests.
- [ ] **Open everything** opens every closed session without ticking — checked by a test.
- [ ] The verify gate passes.

### Non-goals
- No new reopen command. No auto-open on starting the app or opening the project.

### Context
- Copy the pattern in: `useRecentSessions.ts` `importChats` (awaits `startNewChat(request,
  {background: true})` one at a time, counts failures, toasts).
- Reopen rules: `reopenRequest` / `reopenRefusal` / `useReopenRemoved` in
  `model/recentSessions.ts`; daemon `Command::ReopenClosedSession` (`daemon/reopen.rs`) rebuilds a
  worktree only when worktree, repo and branch were recorded.
- Watch out: `useReopenRemoved` handles one session at a time and has a `busy` ref.

---

## 6. feat(ui): close the ticked sessions from the panel
Labels: feature, client
Blocked by 3

### Goal
**Close** ends the ticked running sessions the way Close project does.

Intent: docs/features/open-workspace/intent.md

### Acceptance criteria
- [ ] Close asks first, naming up to three running sessions and counting the rest (the wording
  `closingProjectCopy` uses) — checked by a test.
- [ ] Confirmed sessions end through `endSessions` (drafts guarded, six-second undo kept) — checked
  by a test.
- [ ] Closed-session rows cannot be ticked for Close; Close is disabled while nothing is ticked —
  checked by tests.
- [ ] The verify gate passes.

### Non-goals
- It does not close the project and does not save the open set (ticket 2 does, on Close project).

### Context
- Change: reuse `endSessions` / `endSessionsNow` in `useClosing.ts`; the confirm copy is
  `closingProjectCopy` in `apps/gui/src/features/confirm/confirm.ts`.

---

## 7. feat(ui): remove the ticked worktrees from the panel
Labels: feature, client
Blocked by 4

### Goal
**Remove worktree** deletes the ticked worktrees after a confirm that names exactly what goes.

Intent: docs/features/open-workspace/intent.md

### Acceptance criteria
- [ ] The confirm lists each path and branch with its standing; a worktree with uncommitted
  changes or unmerged commits needs its own extra confirm that says what would be lost — checked
  by a test.
- [ ] Removal sends `Command::TidyWorktrees` (`go_even_if_dirty` only for the extra-confirmed
  ones); the main checkout and any worktree with a running session cannot be ticked — checked by
  tests.
- [ ] A refusal from the daemon shows its reason on that row — checked by a test.
- [ ] The verify gate passes.

### Non-goals
- No archive or undo step; removal is permanent, as in the existing tidy flow. No change to the
  daemon's safety rules.

### Context
- Command and planning: `Command::TidyWorktrees{items:(path, go_even_if_dirty)}` (`protocol.rs`
  near 1102), `tidy_plan` and `runs_in` in `crates/maitty-core/src/daemon/worktrees.rs`;
  `git::remove_worktree` refuses the main folder.
- After 4 lands: the panel has worktree rows with standing; add ticking and the action to them.

---

## 8. feat(ui): switch from one project to another
Labels: feature, client
Blocked by 2, 5

### Goal
**Switch to…** parks the current project and opens another's workspace panel.

Intent: docs/features/open-workspace/intent.md

### Acceptance criteria
- [ ] The project menu has "Switch to…" listing the other opened projects — checked by a test.
- [ ] Choosing one asks first (same wording as Close project), saves the current project's open set
  (ticket 2's path), ends its sessions, and opens the target's workspace panel — checked by a test.
- [ ] If the save fails the switch stops before ending anything and says why — checked by a test.
- [ ] The verify gate passes; Visual check done or reported as not done.

### Visual check
The Switch menu and the panel it opens, at the default size.

### Non-goals
- It does not open the target's sessions on its own; the person ticks and presses Open.

### Context
- Reuse: the save call added by ticket 2 and the open actions added by ticket 5; the confirm path
  in `useProjectActions.ts` `onClose`.
