# Specialists, subagents and workflows

How Maiker shows an agent's specialists at work, and what it shows of a workflow running in a session.

Maiker never runs a workflow and never defines an agent. Your agent tool does that (Claude Code, Codex, …),
and the workflow runs inside an agent session like any other work. Maiker watches and shows what happens.
The reasons are in [ADR 0010](adr/0010-workflows-and-specialist-agents-stay-outside-maitty.md) and
[ADR 0011](adr/0011-maitty-reads-tickets-and-shows-no-workflow-runs.md).

## The two parts

| Part | What it is | What you set up |
| --- | --- | --- |
| **Specialists** | Agent files such as a reviewer or a builder: `.claude/agents/*.md` for Claude Code, `.codex/agents/` for Codex, in the project or your home folder. | Write them as your agent tool documents. Maiker only lists them. |
| **Subagents** | A specialist (or any helper) that an agent starts during its turn. | Nothing. Maiker shows them on its own. |

## Subagents: nothing to set up

When an agent starts a subagent, Maiker hears it from the agent's own hooks (or from the service's own
connection for a chat it runs). The subagent then shows:

- **In the desktop app,** under its session in the sidebar, with a chat of its own that shows its steps as it
  works.
- **In the terminal app,** under its session in the sidebar; its row opens a view of its steps.

Its steps are read from the record Claude Code or Codex keeps for that subagent. For a session on another
machine only its task and result show. A subagent never changes its session's status: the session itself
says whether it is working, needs you or is done.

For this to work, connect the agent first: `maiker integrate` (see the [README](../README.md#connect-your-agents)).

## Specialists: see what a project has

In the desktop app, open the menu of a session on this computer and choose **Specialist agents…**. It lists the
Claude Code and Codex agent files in that project and in your home folder, and opens each one to read.
It is read-only. Make and edit specialists with the agent's own tools (Claude Code's `/agents`, or the files).

## Workflows

A workflow or "software factory" runs inside an agent session like any other work. Its helpers show as
subagents, above. Maiker shows nothing else of it: no runs, steps or board, and there is no command to report
them ([ADR 0011](adr/0011-maitty-reads-tickets-and-shows-no-workflow-runs.md)). Where a workflow stands is the
workflow's to show, in its own place.
