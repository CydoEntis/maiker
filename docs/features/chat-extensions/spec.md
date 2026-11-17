# Spec: skills, plugins, MCP servers and marketplaces in the app

Type: feature · Status: proposed · Decision from MAITTY-414 (spike) · Date: 2026-11-16

Can the desktop app list, add, enable, disable and remove skills, plugins, MCP servers and
marketplaces for Claude Code and Codex without a terminal? Yes for almost all of it. The app runs
the agents' own non-interactive commands; it does not rewrite their files itself. Every claim below
was run with an isolated config (`CLAUDE_CONFIG_DIR` and `CODEX_HOME` pointing at a temp folder,
plus a local marketplace folder). Nothing was installed from the internet and the real `~/.claude`
and `~/.codex` were not changed. Tested with Claude Code 2.1.326 and codex-cli 0.166.0.

## What the app can do itself

| Action | Claude Code | Codex |
| --- | --- | --- |
| List plugins | `claude plugin list --json` (`--available` adds marketplace plugins) | `codex plugin list --json` |
| Install plugin | `claude plugin install <name>@<market> --scope user\|project\|local --json` | `codex plugin add <name>@<market> --json` |
| Enable / disable | `claude plugin enable\|disable <id> --scope .. --json` | no command: set `enabled` under `[plugins."<id>"]` in `config.toml` |
| Update | `claude plugin update <id> --json` | `codex plugin marketplace upgrade` (git markets); no per-plugin update |
| Remove plugin | `claude plugin uninstall <id> --scope .. --json` | `codex plugin remove <id>` |
| List marketplaces | `claude plugin marketplace list --json` | `codex plugin marketplace list` (text table only) |
| Add / remove marketplace | `claude plugin marketplace add <path\|url\|owner/repo> --json`, `... remove <name> --json` | `codex plugin marketplace add <src>` (`--json`), `... remove <name>` |
| MCP list / get | `claude mcp list`, `claude mcp get <name>` (text only) | `codex mcp list --json`, `codex mcp get <name> --json` |
| MCP add | `claude mcp add [-s local\|user\|project] [-t http\|sse] [-e K=V] [-H ..] <name> <cmd\|url> -- args`, or `claude mcp add-json <name> '<json>'` | `codex mcp add <name> -- <cmd> args`, or `--url <url>`, `--env K=V`, `--bearer-token-env-var` |
| MCP remove | `claude mcp remove <name> [-s scope]` | `codex mcp remove <name>` |
| Validate before install | `claude plugin validate <path> --json` | none |
| Plugin options / secrets | `claude plugin configure <id> --json`, `--values-stdin` | none seen |

What worked, as run:

- **Claude plugins and marketplaces** return one JSON line (`{"command","outcome":"ok|failed",
  "plugin","scope","message","failureCode"}`) and a real exit code (0 ok, 1 failed). A failure
  also prints a human line on stderr, so the app reads stdout only. `failureCode` is stable
  (`not_found`, `ambiguous_marketplace`). Install, disable, enable, update, uninstall and
  marketplace add/remove all passed, at user and project scope.
- **`claude plugin details` has no `--json`** in this version (it errors, exit 1). Use
  `plugin list --json`, which already carries the plugin's `mcpServers`, scope, `enabled` and paths.
- **`claude mcp list/get` print text only**, and `claude mcp list` health-checks every server by
  starting it (see risks). There is no `--json` in 2.1.326. To show servers the app should read
  the files below, and only call `mcp get` for one status check the user asked for.
- **Claude `mcp add -e K=V` takes several values**, so it swallowed the server name until the name
  came first. The app must put `<name>` first and `--` before the server's own arguments.
- **Codex** `mcp list/get/add` and `plugin list/add` return JSON. `codex plugin remove` returns
  exit 0 for a plugin that was never installed, and `codex mcp remove` exits 0 for an unknown
  server, so the app must check the list afterwards instead of trusting the exit code.
  `codex plugin marketplace remove` of an unknown name does exit 1.
- Codex prints a `WARNING: ... PATH aliases` line on stderr when its home is under `/tmp`; stdout
  stays clean JSON.

### Skills (SKILL.md folders)

There is no `skill add` command in either agent. A skill is a folder with a `SKILL.md`, found by
the agent at start-up: Claude in `~/.claude/skills/<name>/` (user) and `<project>/.claude/skills/`
(project), plus every enabled plugin's `skills/`; Codex in `~/.codex/skills/` and the shared
`.agents/skills/` folders (strings in the binary; Codex's `.system` skills are its own). The app
lists skills by reading those folders (name and description from the SKILL.md front matter), adds
one by copying a folder after the user confirms, and removes one by deleting only a folder the
app shows. `claude plugin init <name>` scaffolds `~/.claude/skills/<name>/` if we want "new
skill". `claude plugin validate <path> --json` checks a skill folder before it is copied.

## Where each keeps its files

| What | Claude Code | Codex |
| --- | --- | --- |
| Home | `$CLAUDE_CONFIG_DIR`, default `~/.claude` (plus `~/.claude.json`) | `$CODEX_HOME`, default `~/.codex` |
| Plugins enabled | `settings.json` `enabledPlugins` (user), `<project>/.claude/settings.json` (project), `.claude/settings.local.json` (local) | `config.toml` `[plugins."id@market"]` |
| Plugin cache and record | `plugins/installed_plugins.json`, `plugins/cache/<market>/<plugin>/<ver>/` | `plugins/cache/<market>/<plugin>/<ver>/` |
| Marketplaces | `settings.json` `extraKnownMarketplaces`, `plugins/known_marketplaces.json` | `config.toml` `[marketplaces.<name>]` |
| MCP user | `~/.claude.json` `mcpServers` | `config.toml` `[mcp_servers.<name>]` |
| MCP project | `<project>/.mcp.json` (shared, needs per-user approval) | a trusted project's `.codex/config.toml` (from Codex docs; not run here) |
| MCP local (private) | `~/.claude.json` `projects.<path>.mcpServers` | none |
| OAuth tokens | Claude's own credential store | `mcp-oauth-locks` and its store under the home |

A local-directory marketplace is read in place (the plugin "loads in place from" the folder), so
editing that folder changes the plugin at the next session start.

## Windows

From the help and the paths above, not run (this machine is Linux). Both CLIs are the same
commands on Windows, with homes under `%USERPROFILE%\.claude` and `.codex`. Start them with an
argument list, never a shell string, so a path with spaces or a `&` needs no quoting
(`std::process::Command`, no `cmd /c`). `claude` and `codex` may be `.cmd` shims from npm: resolve
the binary the way the daemon already resolves agent binaries, and test with a path that has a
space. Pass `--json` output as UTF-8. Claude's `mcp add-json` takes JSON on the command line,
which is brittle on Windows quoting; prefer `mcp add` with arguments, or write the entry to the
documented file. Needs a Windows run before it ships (ADR 0008).

## What can run code, and how the app asks first

- **A plugin runs code as the user.** It can ship hooks (shell commands on session start or tool
  use), MCP servers (a command), and skills and agents that instruct the model to run tools. I
  confirmed a plugin with a `SessionStart` hook and an `mcpServers` command installs with no
  prompt and no `--yes`; `plugin install --json` simply does it. The CLI will not protect the user,
  so the app must.
- **An MCP server added by `mcp add` is a command** that starts when the agent starts, with the
  user's rights and environment. A remote (`--url`) server receives the user's prompts and tool
  results. `claude mcp list` and `get` start every server to health-check it, so listing is
  itself code execution for a server someone else added to a project `.mcp.json`. Claude holds
  project servers as "Pending approval" and does not start them until approved.
- **A marketplace is a source of plugins.** Adding one runs nothing by itself, but every plugin
  in it is then one click from running code, so adding a Git or URL marketplace gets its own
  confirmation. Marketplaces may also declare an install command; `plugin install --json` then
  refuses and reports `shownCommand.sha256`, to be passed back with `--accept-command` only after
  a person has seen the command.

The confirmation the app shows before any add or install:

1. The source (marketplace name and where it came from, the exact repository or folder) and the
   scope (user, this project, local).
2. What it will run, read from the files before installing: hook commands, MCP `command` and
   `args` or `url`, and the environment names it asks for (names only, never values).
3. The plain sentence "This runs code on your computer with your access" and, for remote
   servers, "your prompts and tool results are sent to <host>".
4. Two buttons, with Cancel the default. Never "trust always". For a plugin with a marketplace
   command, show the command text and pass its hash to `--accept-command`.

Treat a plugin folder and anything fetched as untrusted data: read manifests as JSON with size and
depth limits, never execute them to preview. Remove, disable and list need no confirmation beyond
a normal "Remove X?" prompt. Secrets (`-e API_KEY=..`, headers, bearer tokens) go through the
daemon's key store and stdin where a command takes it (`configure --values-stdin`,
`--bearer-token-env-var`), never in a log or in a process list where avoidable. Note that
`claude mcp add -e K=V` puts the value on the command line; prefer an env-var reference.

## What still needs a terminal

- **OAuth for an MCP server.** `claude mcp login <name>` and `codex mcp login <name>` open a
  browser and wait for a redirect (`--no-browser` prints the URL and asks the user to paste the
  redirect back). The app can open the system browser and run it, but the paste-back variant needs
  an interactive prompt, so offer a terminal pane for that case. Not run here, as it needs a real
  server.
- **Agent login** (`claude`, `codex login`): a browser flow; out of scope for this feature.
- **Trust and approval inside the agent**: Claude's "approve this project's `.mcp.json` server"
  and Codex's trusted-project prompt happen in the agent's own UI on first use. The app can show
  "pending approval" but cannot approve for the user.
- **Applying changes.** Both say a restart or `/reload-plugins` applies a change. A running chat
  keeps its old set; the app shows "takes effect in the next chat" and does not restart sessions.
- **Codex enable/disable and any app-side Codex file edit**: no command exists, so the app edits
  `config.toml` itself. That is a file write, not a terminal need, but it is the weakest part (see
  risks).

## Proposed design

Follows [API_PATTERNS](../../API_PATTERNS.md) and [ARCHITECTURE](../../ARCHITECTURE.md); the
agent process and file work live in `crates/maitty-core/src/daemon/`, and the GUI links neither.

- One new `Query` per action, in `maitty-shared`: `ExtensionsList { agent, project }`,
  `ExtensionAdd { agent, kind, source, scope, confirmed }`, `ExtensionSetEnabled`,
  `ExtensionRemove`, `MarketplaceAdd`/`MarketplaceRemove`. Each is for human clients only
  (a pane's agent must not install plugins into its own host), needs the write grant, and carries
  its own `introduced_in` so an older peer refuses it instead of misreading it. Bump
  `PROTOCOL_VERSION`; `COMPATIBLE_SINCE` stays because these are new messages.
- A daemon module `extensions.rs` runs the CLI on a background task (`spawn_bg`), never on the
  event loop: an argument list, a 60 s timeout, a 1 MiB output cap, an isolated working directory,
  stdout parsed as JSON. It reports back as a message. Listing reads the files and `plugin list
  --json`; it never calls `mcp list` unless asked, because that starts servers.
- The confirm step is two calls: the first returns a `Preview` (source, scope, commands, hosts) and
  a one-time token; the add only runs with that token, so a client cannot skip the prompt.
- Typed errors, stable codes: `CliMissing`, `CliTooOld` (command not found in this version),
  `NotFound`, `AlreadyInstalled`, `NeedsConfirmation`, `NeedsTerminal` (OAuth), `Failed{code}`
  mapped from Claude's `failureCode`. No raw stderr to the UI beyond a trimmed, secret-scrubbed line.
- The agent version is read once (`--version`) and each action is gated on it, since Claude's
  `plugin` commands are newer than its `mcp` commands.
- The GUI gets a Settings view per agent with tabs for skills, plugins, MCP servers and
  marketplaces; the TUI can reuse the same queries later.

## Open risks

- **Output formats are not a contract.** Claude's JSON fields and Codex's `--json` are not
  versioned; tolerate unknown and missing fields, and keep a test that decodes a recorded sample of
  each (including the failure line) so an upgrade that breaks them shows up.
- **`mcp list` and `mcp get` execute servers**; no machine-readable mode in 2.1.326. Parsing the
  text is fragile, so read the files for the list.
- **Codex enable/disable and project MCP are file edits** with no CLI; a hand-written TOML edit
  must preserve comments and unknown keys (use a format-preserving editor, not a rewrite). The
  Codex project-config and skills paths were taken from the binary and docs, not exercised.
- **Codex exit codes are loose** (remove of a missing plugin or server exits 0); verify by
  listing afterwards.
- **Plugins are code from strangers.** The confirm step lowers the risk but the user may still
  accept; no scanning is promised. Prefer showing the commands over a "trust score".
- **Windows is untested here** (shims, quoting, `.json` with `\` paths). Do it before shipping.
- **Both CLIs are moving fast** (new `plugin` subcommands appear between releases). Gate by
  version and degrade to "open a terminal" with the exact command shown.
- **Auto-added catalogs.** Claude fetched its own official plugin directory into the isolated
  config on the first `--available` call (a network read the user did not ask for); the app should
  say so and only call `--available` on the user's request.
