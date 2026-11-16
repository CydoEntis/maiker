# Specialists, subagents and workflows

How Maitty shows an agent's specialists at work, and how any workflow or "software factory" can show its
progress in Maitty. It is written for two readers: someone using a workflow, and someone writing one.

Maitty never runs a workflow and never defines an agent. Your agent tool does that (Claude Code, Codex, …),
and the workflow runs inside an agent session like any other work. Maitty watches and shows what happens.
The reasons are in [ADR 0010](adr/0010-workflows-and-specialist-agents-stay-outside-maitty.md).

## The three parts

| Part | What it is | What you set up |
| --- | --- | --- |
| **Specialists** | Agent files such as a reviewer or a builder: `.claude/agents/*.md` for Claude Code, `.codex/agents/` for Codex, in the project or your home folder. | Write them as your agent tool documents. Maitty only lists them. |
| **Subagents** | A specialist (or any helper) that an agent starts during its turn. | Nothing. Maitty shows them on its own. |
| **Workflow runs** | A workflow's job as a list of steps, such as plan → build → review → open PR, for one ticket. | The workflow sends its progress with `maitty workflow report`. |

## Subagents: nothing to set up

When an agent starts a subagent, Maitty hears it from the agent's own hooks (or from the service's own
connection for a chat it runs). The subagent then shows:

- **In the desktop app,** under its session in the sidebar, with a chat of its own that shows its steps as it
  works.
- **In the terminal app,** under its session in the sidebar; its row opens a view of its steps.

Its steps are read from the record Claude Code or Codex keeps for that subagent. For a session on another
machine only its task and result show. A subagent never changes its session's status: the session itself
says whether it is working, needs you or is done.

For this to work, connect the agent first: `maitty integrate` (see the [README](../README.md#connect-your-agents)).

## Specialists: see what a project has

In the desktop app, open the menu of a session on this computer and choose **Specialist agents…**. It lists the
Claude Code and Codex agent files in that project and in your home folder, and opens each one to read.
It is read-only. Make and edit specialists with the agent's own tools (Claude Code's `/agents`, or the files).

## Factories: handing tickets to a workflow

A **factory** is Maitty's word for any workflow that takes tickets: Maitty knows no factory by name. A factory is
any workflow that answers `/factory run <ticket> (<link>)` in an agent's chat and reports its runs with
`maitty workflow report` (below). Tickets' **Send to Factory** types that command, one line per ticket, into a chat
that already reports runs in the project, or into a new chat. Any chat that has reported a run of any workflow
counts as a factory chat, and a ticket's run is found by the ticket key the run reports.

## Workflow runs: how any workflow shows its steps

A workflow tells Maitty where it is with one command. Any workflow can, in any language, under any agent. There is nothing to install, register or configure in Maitty, and Maitty never
reads a workflow's own files.

```sh
maitty workflow report < run.json
```

The command reads one run as JSON on stdin. Send the whole run each time, every time something changes. A
report replaces the earlier one with the same `workflow` and `run`.

```json
{
  "workflow": "my-factory",
  "run": "job-42",
  "ticket": { "key": "ABC-7", "title": "Add login", "link": "https://tracker.example/ABC-7" },
  "steps": [
    { "name": "plan",   "state": "passed" },
    { "name": "build",  "state": "working", "helper": "builder" },
    { "name": "review", "state": "waiting", "helper": "reviewer", "note": "after the build" }
  ]
}
```

### Fields

| Field | Required | Limit | Meaning |
| --- | --- | --- | --- |
| `workflow` | yes | 64 characters | The workflow's name. |
| `run` | yes | 64 characters | This job's id. A new id is a new run. |
| `ticket.key` | if `ticket` is given | 64 characters | The ticket's key, shown instead of the run id. |
| `ticket.title` | no | 200 characters | The ticket's title. |
| `ticket.link` | no | 500 characters, `http://` or `https://` | Where the ticket is. |
| `steps` | yes | 1 to 32 steps | In the order they run. |
| `steps[].name` | yes | 64 characters, unique in the run | The step's name. |
| `steps[].state` | yes | see below | Where the step is. |
| `steps[].note` | no | 240 characters | One short line, such as why a step was sent back. |
| `steps[].helper` | no | 240 characters | The name of the subagent doing the step. |
| `steps[].choices` | no | up to 4, 60 characters each, one line, each once | What the person may answer a `needs_you` step. Dropped on any other state. |

`state` is one of `waiting`, `working`, `passed`, `failed`, `sent_back`, `needs_you` or `skipped`. Text is
trimmed and control characters are removed. A report that breaks a rule is refused, and the command says
which field and exits with an error.

### Linking a step to its subagent

Give a step's `helper` the same name the subagent runs under, and that step opens the subagent's chat. The
name is the description given to Claude Code's Agent tool, or Codex's task name. Case and punctuation do not
count, so `ABC-7 builder` matches Codex's `abc_7_builder`. A name that matches nothing is still shown, unlinked.

### Answering with a click

A `needs_you` step with `choices` shows each as a button in the run's drawer on the Work board. A click
sends `<ticket key or run> · <step>: <choice>` to the chat that reported the run, as the person's own
message, for example `ABC-7 · spec: Approve the spec`. Read that message in the workflow the same way
you would read a typed answer; the person can still type anything else. The drawer then says what was
sent until the run reports again.

```json
{ "name": "spec", "state": "needs_you", "note": "approve the spec", "choices": ["Approve the spec", "Send it back"] }
```

### Where to call it

Call it from anything that runs inside the session's terminal: a step of a Claude Code plugin or skill, a
hook, a Codex task, or a plain script. Maitty gives every pane the identity the command needs
(`MAITTY_TERM_ID` and `MAITTY_PANE_TOKEN`), and child processes inherit it. A report from outside that pane is
not accepted, so another program cannot write into your session.

It is safe to leave the call in a workflow that people also run without Maitty. Outside a Maitty pane it
prints one line saying nothing was reported, and exits successfully. If the service running is older than the
command, it says to restart the service.

From a shell script:

```sh
report() {
  command -v maitty >/dev/null 2>&1 || return 0
  maitty workflow report || echo "workflow report failed" >&2
}

report <<'JSON'
{ "workflow": "my-factory", "run": "job-42",
  "steps": [ { "name": "build", "state": "working", "helper": "builder" } ] }
JSON
```

From a Claude Code skill or plugin, tell the agent to run the same command with the Bash tool at the start
and end of each step.

### What you see

Both apps list a session's runs under it in the sidebar, with the step each run is on. Open a run to see all
its steps, their notes and the ticket. In the desktop app a step with a linked subagent opens its chat.
Maitty keeps each session's latest 20 runs, saved with the session.

A run is display only. It never changes the session's status and never raises an alert. A workflow that
needs you should stop its agent and ask: the agent's own status then says **needs you**, and the run shows
which step is waiting.

### What Maitty will not do

- Start, order, retry or stop a step. The workflow does that.
- Make or edit a specialist.
- Read a workflow's own files (for example `.factory/jobs/`).
- Install workflows. There is no plugin store; the command above is the whole contract.

A workflow that never calls the command still runs. Its subagents still show live, but its steps do not.

At most `[sessions] helpers_at_once` helpers that agents start through Maitty run at once per session (see
[Helpers](guide.md#helpers)).
