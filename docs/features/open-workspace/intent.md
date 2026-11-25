# Intent: project workspace — manage, park and reopen a project's work

Type: feature
Author: Cody · Status: accepted
Date: 2026-11-24 · Plan: none (planning lives in the Plane project `MAITTY`)

## Problem

In the author's words: "I think it should be like an option, you can open an existing
workspace… it would open the project folder, show you sessions, and have it auto open up
everything for you, so it's easier than setting up a ton of new sessions or resuming by
hand." It is also for managing: "closing open sessions, closing work trees associated with a
project", because "you work in the same project daily, or you work in a different program, you
want to be able to easily manage and/or bring over what you're working on, and also get up
and working faster." The author wants to choose what happens, not have everything reopen on
its own.

Today (read in the code on the base branch):

- Closing a project is a desktop-only action that ends each session. Nothing records the set
  of sessions that were closed together (`ClosedSession` has no project or batch id,
  `crates/maitty-shared/src/protocol.rs:139`).
- Recent sessions keeps the last 50 closed sessions across all projects, one at a time
  (`CLOSED_SESSIONS_MAX`), and reopens one per click.
- Worktree clean-up exists in the daemon (`crates/maitty-core/src/tidy.rs`,
  `crates/maitty-core/src/daemon/worktrees.rs`), with its list screen in the terminal app.
  It is not tied to a project in the desktop app.
- Switching to another program means closing one project's sessions and setting the other up
  again by hand.

## Proposed outcome

Each project has a workspace panel listing its sessions (running and recently closed) and its
worktrees, each worktree with its safe-to-remove status. The person ticks what they want and
chooses **Open**, **Close**, or **Remove worktree**. Nothing is ticked by default. There is
Select all, and an **Open everything** button for speed. **Switch** parks the current project
(saves its open set and closes it) and opens another project's saved set. Closing a project
saves its open set too.

## Affected users and systems

People who run agents across several projects in the desktop app. The project menu and command
palette, a new workspace panel, and the daemon, which owns the sessions and would keep each
project's saved set. A new message if the saved set is read or written through the daemon.

## Constraints

- The daemon owns every session ([ADR 0001](../../adr/0001-the-daemon-owns-every-session.md)).
- Nothing starts, closes or is deleted until the person ticks it and presses the button.
- Worktree removal uses the existing safety rules: only a clean, merged worktree is removed
  without asking, anything else asks, and a worktree with a session running in it is kept.
- Close project's confirm and its six-second undo do not change.
- A session whose folder is gone has its worktree made again, or is skipped with a note, as
  Recent sessions does today.
- A new message follows the protocol rules in `AGENTS.md` (project non-negotiable 2):
  `PROTOCOL_VERSION` and `COMPATIBLE_SINCE`, an `introduced_in` arm, and an old-shape decode
  test for an added field.
- No blocking work on the UI thread (`AGENTS.md`, project non-negotiable 6), and it must work
  on Windows.
- Assumed, to be confirmed by the author: the first slice covers this computer's projects, and
  a project keeps one saved set, replaced each time it is parked or closed.

## Out of scope

- Plain terminals and the pane layout.
- Named workspaces such as "Mechanicus".
- The browse-everything history view with badges and stale greying (the author's earlier
  idea; it needs a longer history store than the 50-entry list, so it is a later phase).
- Remote machines' projects.
- Moving work between machines or between projects.

## Open questions

None.

## Tickets

Eight tickets approved on 2026-11-24, in this order (each is blocked by the ones it builds on).
Not filed in Plane yet: the Plane project `MAITTY` was not reachable from the session that
planned them, so the author files them in a new module "Open workspace".

1. `feat(protocol)`: save and read a project's open set
2. `feat(ui)`: save a project's open set when it is closed (blocked by 1)
3. `feat(ui)`: add a workspace panel listing a project's sessions (blocked by 1)
4. `feat(ui)`: show a project's worktrees in its workspace panel (blocked by 3)
5. `feat(ui)`: open the ticked sessions and open everything (blocked by 3)
6. `feat(ui)`: close the ticked sessions from the panel (blocked by 3)
7. `feat(ui)`: remove the ticked worktrees from the panel (blocked by 4)
8. `feat(ui)`: switch from one project to another (blocked by 2 and 5)
