# 0010. Workflows and specialist agents stay outside Maiker; Maiker shows the specialists

- **Status:** Accepted
- **Date:** 2026-11-13

## Context

Users want two ways of working with specialist agents (a reviewer, a builder, a security
checker), and the same result from both:

- **While they work:** they chat with one agent, and it calls a specialist when the task fits.
- **While they are away:** a workflow such as Kitchen (a Claude Code plugin in its own repository)
  takes tickets through fixed steps, each done by a specialist, until each is a reviewed pull request.

Claude Code and Codex both ship this natively. Specialists are agent files (`.claude/agents/`,
`.codex/agents/`) chosen by their description or called by name, and both report subagent start
and stop through hooks. Maiker already receives those reports for both providers and lists a
session's subagents, but it shows only their task and result, not their work. It has no view of a
workflow's steps, and it does not know which ticket a subagent is working on.

A Maiker-run workflow runner and saved role profiles were removed on 2026-10-18
([FEATURES](../FEATURES.md)): a runner inside Maiker copies what the providers do, ties Maiker to
one way of working, and makes every stalled stage Maiker's fault. Status must stay right
([0003](0003-status-and-conversation-trust.md)).

## Decision

1. **Maiker does not run workflows or define agents.** It never starts, orders, retries or stops a
   workflow step, and never creates or edits a specialist's definition. Specialists live with the
   provider (agent files, skills, plugins). Workflows such as Kitchen live in their own projects
   and run inside an agent session like any other work. Neither is built into Maiker.
2. **Maiker shows specialists working, live, for every provider that reports them.** Their start
   and stop come only from the owning runtime (hooks verified as in 0003, or the daemon-owned
   connection). Their work comes from the provider's own record of that subagent, read only when
   the daemon has tied it to the pane's session: Claude's per-subagent transcript beside the
   session's transcript, Codex's child thread named by its parent thread, and Codex app-server
   collab items for structured conversations. This is history, so it is display only and never
   changes status.
3. **Maiker shows no workflow's own progress** ([0011](0011-maitty-reads-tickets-and-shows-no-workflow-runs.md)).
   A workflow's helpers show as subagents (point 2); its steps, runs and tickets are the
   workflow's own business.
4. **Maiker never reads a workflow's own files** (for example `.kitchen/jobs/`). A file in a
   repository is not tied to a session and holds one tool's format.
5. **No plugin system or marketplace for now.** Maiker lists a project's specialist files read-only
   (the desktop app's *Specialist agents…*, `Query::Specialists`); it never makes, edits or runs one.

## Alternatives considered

- **Build Kitchen into Maiker**: it ties Maiker to one workflow that runs only under Claude Code,
  ships every workflow change as a Maiker release, and repeats the runner cut on 2026-10-18.
- **Maiker reads each workflow's state files from the repository**: the file is not tied to a
  session, so tickets could not be placed under the session working them. Each tool's format would
  need its own reader, and 0003 forbids reading unverified files.
- **A plugin system and extension marketplace**: installing, sandboxing, updating and supporting
  third-party code on three platforms is a product of its own.
- **A report command that shows a workflow's steps in Maiker** (`maiker workflow report` and a Work
  board): built, then removed by [0011](0011-maitty-reads-tickets-and-shows-no-workflow-runs.md)
  because it pulled Maiker away from showing which agents need you.
- **Maiker's own agent editor**: Claude Code's `/agents` and Codex's files already do this, and the
  two formats differ and keep changing.

## Consequences

- Specialists and workflows change without a Maiker release.
- Maiker maintains two readers of provider subagent records.
- A workflow's helpers show live; where the workflow itself stands, it says in its own place.
- Revisit point 5 when several independent workflows ask to be installed from inside Maiker.
