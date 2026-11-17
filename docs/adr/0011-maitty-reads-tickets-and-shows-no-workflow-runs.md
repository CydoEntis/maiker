# 0011. Maitty only reads tickets and shows no workflow runs

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

Maitty's job is to run many coding agents and say truthfully which ones need you
([AGENTS mission](../../AGENTS.md#project-specific-mission)). Around that job it had grown a
second product: a Work board of workflow runs reported with `maitty workflow report`
([0010](0010-workflows-and-specialist-agents-stay-outside-maitty.md) as first written), a
*Send to Factory* button, and a ticket tracker with a board view, a ticket page, comments and
closing. Each needed its own protocol messages, views in both apps, docs and tests, and none
of them helps tell which agent needs you. The app was losing focus.

## Decision

1. **Tickets are read, never changed.** Maitty reads GitHub, Plane and Linear tickets only to
   start an agent on one: pick a ticket, read it whole, start. It never comments on, closes or
   edits a ticket; that is done in the tracker. The keys and project links that reading needs stay.
2. **Maitty shows no workflow runs.** There is no `maitty workflow report`, no Work board and no
   run rows. A workflow (a factory, Kitchen, a script) runs inside an agent session like any other
   work; its helpers still show live as subagents ([0010](0010-workflows-and-specialist-agents-stay-outside-maitty.md)).
3. **Nothing sends work to a factory.** A factory is a separate tool; Maitty does not start one.
4. **Old peers are refused, never misread.** `Query::TicketWrite` and `Reply::TicketWrite` stay on
   the wire so a window from protocol 107 to 112 that still asks is answered with an error and keeps
   its connection. `ClientMsg::WorkflowReport` is gone: an older `maitty workflow report` is a
   one-shot call whose frame the daemon cannot read, so that call fails and nothing else does.
   `TermInfo.workflows` and a pane's saved runs are dropped; files saved with them still load.

## Alternatives considered

- **Hide the Work board and ticket writes behind a setting**: the code, protocol and docs would
  still have to be kept working on three platforms for a feature few use.
- **Keep `maitty workflow report` as a no-op**: a command that quietly does nothing misleads the
  workflow that calls it.
- **Close the compatibility window (`COMPATIBLE_SINCE` = 113)**: every running daemon would refuse
  updated windows until restarted, for messages only one-shot calls and old windows send.

## Consequences

- Fewer protocol messages, views and docs to keep in step, in the GUI and the TUI.
- A workflow that called `maitty workflow report` must stop calling it; the call now fails.
- Changing a ticket means opening it in its tracker (the ticket's link opens it).
- Bringing either back is a new decision: it would need its own place that does not pull Maitty
  away from its mission.
