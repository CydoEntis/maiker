<h1 align="center">Maitty</h1>

<p align="center"><strong>All agents on deck.</strong><br>
Run your coding agents side by side, and always know which one needs you.</p>

<p align="center"><a href="#install">Install</a> · <a href="#quick-start">Quick start</a> · <a href="#set-up">Set up</a> · <a href="#shortcuts">Shortcuts</a> · <a href="docs/guide.md">Guide</a> · <a href="https://github.com/CydoEntis/maitty/releases">Releases</a></p>

Maitty is a workspace for Claude Code, Codex, Gemini, OpenCode and other command-line agents.
Start as many as you like, see at a glance which are working, which are waiting for you and which
have finished, and jump to any of them in a keystroke. Close the window and they keep running;
open it again and everything is where you left it.

It is built for developers who run several agents across several projects, and it runs natively
on Windows, macOS and Linux.

**Two apps, one set of sessions.** A background service owns every session. Two apps show them,
and you can use either one, or both at once:

- **The terminal app** (`maitty`) runs in any terminal, also over ssh.
- **The desktop app** shows each agent as a chat beside its terminal, with a side panel for the code.

## Highlights

- **Status you can trust.** Every session shows whether its agent is working, needs you, has
  finished or is idle. Status comes from the agent's own hooks where available, and otherwise
  from its process and screen. An agent that has gone quiet for ten minutes is flagged, and so is
  one calling the same tool over and over.
- **Nothing is lost.** Closing the window doesn't stop your agents. After a crash or a reboot,
  Maitty reopens them in the right folders and resumes their conversations. A session you closed
  can be reopened from **Recent sessions**.
- **Chat with any agent.** In the desktop app an agent opens as a chat: answer its questions with
  buttons, queue messages while it works, name files with `@`, review what each turn changed, and
  undo a turn's file changes with **Edit from here**. Its terminal is one click away.
- **See its helpers work.** When an agent starts a subagent, such as a reviewer or a builder, it
  shows under its session with its own steps, live. A workflow (a "software factory") can show
  its steps and ticket too, with one command. See [Specialists and workflows](docs/workflows.md).
- **Each agent in its own branch.** New agents get their own Git worktree, so they never edit the
  same files. Review the diff, commit, merge or open a pull request without leaving.
- **A side panel for the code.** Files, Changes and the agent's terminals open beside your panes.
- **Checks you can rely on.** Name a command, such as your tests, and Maitty runs it after each
  agent turn. A session whose check fails reads *failed*, not *done*.
- **Other machines.** Add a computer you reach over ssh, and its sessions show beside your own.
- **Agents that work together.** Agents can list, read, message and start other sessions through
  MCP tools, within limits you set.
- **Your look.** 50 themes (25 dark and 25 light) with every colour configurable, floating or
  tiled panes, and rebindable shortcuts.

## Install

**Terminal app, Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/CydoEntis/maitty/main/install.ps1 | iex
```

**Terminal app, macOS and Linux:**

```sh
curl -fsSL https://raw.githubusercontent.com/CydoEntis/maitty/main/install.sh | sh
```

The installer picks the build for your machine, verifies its checksum and needs no administrator
rights. It then runs `maitty integrate`, which connects every agent installed on the machine (see
[Connect your agents](#connect-your-agents)); set `MAITTY_NO_INTEGRATE=1` to skip that. You can
also download an archive from [Releases](https://github.com/CydoEntis/maitty/releases), or build
from source with `cargo install --git https://github.com/CydoEntis/maitty maitty`.

**Desktop app:** download the installer for your system from
[Releases](https://github.com/CydoEntis/maitty/releases). It includes its own copy of the
background service. To use both apps with the same sessions, install both from the same release.

Maitty tells you when an update is out; one click installs it and restarts without losing your
sessions. **Settings › General › UPDATES** shows the version you have. If an update goes wrong,
`maitty update --to 0.70.0` puts a named release back.

<details>
<summary><strong>Windows says it found a virus</strong></summary>

Maitty's Windows builds are not code-signed, and Microsoft Defender sometimes flags a new unsigned
program it has not seen before as a threat. That is a false positive: the installer checks each
download against the checksum published with the release, and every build is made by the public
release workflow in this repository.

If Defender removes `maitty.exe` or blocks it:

1. Open **Windows Security › Virus & threat protection › Protection history**, find the item and
   choose **Restore**, then **Allow on device**. Or, from an administrator PowerShell, exclude the
   install folder: `Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\Programs\maitty"`
2. Run the installer again.
3. Optionally tell Microsoft it is safe at <https://www.microsoft.com/en-us/wdsi/filesubmission>,
   which helps other people on the same version.

</details>

<details>
<summary><strong>Uninstall</strong></summary>

```sh
maitty uninstall           # says what it will do, then asks
maitty uninstall --purge   # also deletes your settings and saved sessions
```

It stops the service, takes Maitty's hooks and MCP entry out of your agents' config and removes the
program (on Windows, its folder and PATH entry too). Without `--purge` your settings and saved
sessions stay, so installing again picks up where you left off. The desktop app has its own
uninstaller: Windows' **Installed apps**, the Applications folder on macOS, or your package manager.

</details>

<details>
<summary><strong>Coming from Vibecasso or Seshi?</strong></summary>

Maitty is the new name. Install Maitty as above. The first time it starts, it brings over your
config, saved sessions and history, and points your Claude hooks at Maitty. Run `maitty doctor`:
it names anything still set up under the old name, such as the MCP server (`maitty integrate mcp`
renames it) or another agent's integration (`maitty integrate <agent>`). Projects keep working with
their `.vibecasso.toml` or `.seshi.toml` and checks files until you rename them. Uninstall the old
app when you're happy.

</details>

## Quick start

<details open>
<summary><strong>Terminal app</strong></summary>

1. Open a terminal in your project and run `maitty`.
2. Press `Ctrl+T` (or click a machine's **+** in the sidebar) and a shell opens at once where you
   are; type `claude` (or any agent) in it. `Ctrl+Space` then `n` opens **New session** for another
   folder or machine.
3. Watch the sidebar. Each machine lists its sessions with a status mark: teal spinner working,
   yellow needs you, green finished, red stopped, grey idle. Click a row to go to that session.
4. Press `Ctrl+Space`, then `q` to step away. Your agents keep running; run `maitty` to come back.
5. Run `maitty doctor` to check your setup and connect agents for exact status.

</details>

<details>
<summary><strong>Desktop app</strong></summary>

1. Open Maitty. Click **New chat** at the top of the sidebar (`Ctrl+Shift+T`, `⌘T` on a Mac).
2. Pick a project, write what you want done and press Enter. With **Own copy** on (the default)
   the agent works in its own worktree and branch. **Also start with** sends the same message to
   other agents too, each in its own worktree.
3. The sidebar groups sessions by status: **Needs you**, **Working**, **Finished** and **Idle**.
   When an agent asks something, its chat shows a card with the answers as buttons.
4. Open the side panel from the pane header to see **Changes**, **Files** and the agent's
   **Terminal**. Commit and open a pull request from Changes.
5. Close the window whenever you like. The agents keep running.

More in [the desktop chat](docs/guide.md#the-desktop-chat).

</details>

## Set up

### Connect your agents

Maitty recognises common agents with no setup, from their process and screen. For exact status,
the installer connects every agent it finds on the machine. To do it again (say, after installing a
new agent):

```sh
maitty integrate            # status hooks for every installed agent, plus MCP
maitty integrate claude     # just one: codex, gemini, qwen, opencode, pi, omp, kilo, kimi, mastracode
maitty integrate mcp        # lets Claude, Codex, Qwen and Gemini see and steer other sessions
maitty integrate --uninstall  # removes every one
maitty doctor               # checks what's connected
```

Agents that were already running load it when they restart. `maitty reload-agents` restarts the
ones that missed it, in place and in the same conversation, and leaves any that are working or
waiting for you alone (`--all` restarts those too, `--dry-run` only lists them). Or use
**Settings › Agents › Connect agents…**. See [agent status](docs/agent-status.md) for what each
integration reports.

### Everything else

Each of these is optional. Open the one you need.

<details>
<summary><strong>Specialists, subagents and your own workflow</strong></summary>

- **Specialists** are your agent tool's own agent files (`.claude/agents/`, `.codex/agents/`).
  The desktop app's session menu lists a project's under **Specialist agents…**.
- **Subagents** show under their session, live, with their own steps. Nothing to set up beyond
  [connecting your agents](#connect-your-agents).
- **Workflows** (any factory, such as Maiker Factory, or a pipeline of your own) show their steps and ticket by sending their
  progress to one command, from anywhere inside the session:

```sh
echo '{ "workflow": "my-factory", "run": "job-42",
        "steps": [ { "name": "build", "state": "working", "helper": "builder" },
                   { "name": "review", "state": "waiting", "helper": "reviewer" } ] }' \
  | maitty workflow report
```

Maitty never runs a workflow or reads its files; the workflow tells Maitty where it is. Every
field, the step states, and how a step links to its subagent are in
[Specialists and workflows](docs/workflows.md).

</details>

<details>
<summary><strong>Checks</strong> (run your tests after every turn)</summary>

Add a check to your config, and Maitty runs it each time an agent's turn ends in that project. A
session whose check fails reads **failed** until it passes.

```toml
[[check]]
project = "/home/me/code/my-app"   # the repo's main checkout
name = "test"
command = "cargo test"
```

A repo can also ship its own in `.maitty/checks.toml`; those never run until you approve them. See
[Checks](docs/guide.md#checks).

</details>

<details>
<summary><strong>Worktrees and setup hooks</strong></summary>

Every new Claude or Codex session gets its own worktree, at
`{repo_parent}/{repo}-worktrees/{branch}` (`[worktree] dir` changes it). To prepare each new
worktree, put a `.maitty.toml` in the repo:

```toml
[hooks]
on_create = "npm install"   # runs in each new worktree before anything starts there
on_remove = ""              # runs before a worktree is removed
```

A repo's hook runs only once you allow it. See [Worktrees](docs/guide.md#worktrees).

</details>

<details>
<summary><strong>Other machines</strong> (over ssh)</summary>

In the terminal app press `Ctrl+Space` then `w` (or choose **Machines** in the command palette),
and pick a host from your `~/.ssh/config` or type `user@host`. The desktop app uses the same list.
Maitty is started on the machine if it isn't running, and offers to install it there if it is
missing. See [Machines](docs/guide.md#machines).

</details>

<details>
<summary><strong>Phone alerts</strong></summary>

Install the free [ntfy](https://ntfy.sh) app (no account), subscribe to a topic name nobody would
guess, and put it in **Settings › Phone alerts** (`[notify] phone_topic`). An alert goes once an
agent has needed you for a minute with nobody answering. See [Alerts](docs/guide.md#alerts).

</details>

<details>
<summary><strong>References</strong> (screenshots and designs for UI work)</summary>

Put the screenshots and design files your agents should build from in `.maitty/references/` at the
repo's main checkout, or use the References view in the terminal app (`Ctrl+Space` then `e`). Every
worktree of the repo sees the same set, and they stay out of git. Agents connected through MCP are
told to look at them before UI work. See [References](docs/guide.md#references).

</details>

<details>
<summary><strong>Agents that steer agents</strong> (MCP)</summary>

`maitty integrate mcp` gives your agents tools to list, read, message, wait on and start other
sessions, and to ask you for a secret without it going into the chat. `[mcp] scope` and
`[mcp] approve` set how far they reach, and **Settings › Sessions** sets whether an agent may start
helpers and how many at once. See [Agents that steer agents](docs/guide.md#agents-that-steer-agents-mcp).

</details>

<details>
<summary><strong>Pull requests</strong></summary>

With the GitHub CLI (`gh`) installed and logged in, each session shows the pull request open on its
branch (`#7 2 failing`, `#7 approved`, …), and the agent hears about failed checks and review
remarks once its turn is over. See [Secrets and pull requests](docs/guide.md#secrets-and-pull-requests).

</details>

## Shortcuts

**Terminal app.** The bar along the bottom always shows the mode. Press `Ctrl+Space` for **key
mode**: the chip turns to a yellow ` KEYS ` and each key runs an action until you press `Esc`. Every
key is a single key, and only `?`, `S` and `_` need Shift. Press `?` to see them.

| | |
|---|---|
| **Sessions** | `n` new session · `t` new shell · `j` / `k` next / previous · `1`–`9` jump to session · `r` rename · `/` filter · `i` inbox |
| **Panes** | `s` split right · `S` split down · `tab` focus next pane · `z` zoom · `x` close · `m` move · `Ctrl`+arrows resize |
| **Window** | `f` files · `c` changes · `u` usage and cost · `,` settings · `b` toggle the sidebar · `?` keys help |
| **Maitty** | `Space` search commands · `.` menu · `h` history · `Ctrl+V` paste an image · `q` step away |

**Desktop app.** `Ctrl+Shift+T` new chat (`⌘T` on a Mac) · `Ctrl+Shift+A` new chat at once with
the default agent · `Ctrl+Shift+N` new worktree (`⌘⇧N`).

Every screen's own keys are in [shortcuts](docs/shortcuts.md).

## From the command line

Everything works from any shell, including from an agent running inside Maitty:

```sh
maitty ~/code/my-app                   # open a project
maitty new ~/code/my-app -- claude     # start an agent there
maitty worktree feat/login -- codex    # a new branch in its own worktree, with codex
maitty ls --json                       # every session and its status
maitty send -p 3 "run the tests"       # message a session
maitty read 3                          # read its screen
maitty handoff 3 --to codex            # hand a task to another agent
maitty workflow report < run.json      # show a workflow's steps (docs/workflows.md)
```

## Configure

Open **Settings** (`Ctrl+Space`, then `,` in the terminal app). Changes save to your config file
with its comments kept.

```sh
maitty config init    # write a commented config file
maitty config path    # where it lives
```

```toml
theme = "tokyo-night"

[ui]
rounded = true             # rounded card corners
padding = "small"          # small | medium | large: space round the screen

[keys.prefix]
"ctrl+l" = "spawn-tab:lazygit"   # any command, in a split or a new tab
```

Every option is described in [`config.example.toml`](config.example.toml).

## Requirements

- Windows, macOS or Linux.
- For the terminal app, a terminal with true colour. A [Nerd Font](https://www.nerdfonts.com) adds icons.
- Optional: `git` for worktrees, branches and changes; the GitHub CLI (`gh`) for pull requests.

## Learn more

- [Guide](docs/guide.md): sessions, panes, alerts, checks, worktrees, machines, the desktop chat and more.
- [Specialists and workflows](docs/workflows.md): subagents, and showing any workflow's steps.
- [Shortcuts](docs/shortcuts.md): every key, by screen.
- [Agent status](docs/agent-status.md): how status is detected and what each integration adds.
- [Features](docs/FEATURES.md): what Maitty has, and what it leaves out on purpose.
- [Architecture](docs/ARCHITECTURE.md) and [testing](docs/TESTING.md), for contributors.

Inspired by [herdr](https://github.com/ogulcancelik/herdr),
[nebula](https://github.com/agentSystemLabs/nebula) and [fut](https://github.com/mikker/fut).

## License

MIT.
