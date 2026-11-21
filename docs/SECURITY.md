# Security

This doc covers how the project handles untrusted input, secrets,
authentication, authorization, and dependencies. `AGENTS.md` is the operating
contract; this doc holds the security practices in depth.

## Per-change checklist

Ask these questions for every change. If any answer is yes, add validation, a
least-privilege control, safe failure behaviour, and a targeted test. Then call
it out in the handoff.

- Does it accept input from a user, file, URL, network, IPC, webhook, or
  environment?
- Does it add or widen a permission, scope, role, CORS rule, CSP rule, or
  storage policy?
- Does it add an endpoint, a route, or a way to reach data?
- Does it read, store, or log credentials, tokens, or personal data?
- Does it render user-controlled content, or open or redirect to a URL?
- Does it run a command, build a file path, or build a query from input?
- Does it add a dependency or a build step that runs code?
- Does it read or act on something another machine's daemon sent (a `ServerMsg` from a
  `[[machines]]` entry)? Decide it in the remote-daemon table under *Project-specific: threat
  model*, clean what it carries, and test the ignored path.

## Input and output

- **Validate at the boundary** with a schema. Reject anything unknown. Don't
  just strip it and continue.
- **Injection.** Parameterize queries. Never build shell commands, file paths,
  SQL, or regexes from input by concatenation. Use allowlists for identifiers,
  such as sort fields or file names.
- **Path traversal.** Resolve paths and confirm they stay inside the intended
  directory.
- **XSS.** Rely on the framework's escaping. Never render raw HTML from input
  (`dangerouslySetInnerHTML`, `innerHTML`, `v-html`). If rich content is
  required, sanitize it with a maintained library.
- **Open redirects.** Redirect only to relative paths or an allowlist of
  hosts.
- **SSRF.** Server-side fetches of user-supplied URLs go through an allowlist,
  and never reach internal addresses.
- **Uploads.** Check size, type by content rather than extension, and
  filename. Store uploads outside the web root, or in object storage with
  private access by default.
- **Errors.** Return safe messages. Stack traces, SQL, and internal paths stay
  in server logs.

## Authentication

- Use a proven provider or library. Never write your own password hashing,
  token signing, or session handling.
- Tokens and session cookies are `HttpOnly`, `Secure`, and `SameSite`. Don't
  keep long-lived tokens in `localStorage`.
- Expire sessions, rotate refresh tokens, and invalidate sessions on logout and
  on password change.
- Rate-limit login, signup, password reset, and any endpoint that sends email
  or SMS.
- Keep responses generic, so they don't reveal whether an account exists.

## Authorization

- **Deny by default.** Every route, action, and query needs an explicit rule.
- Check authorization on the server, against the specific resource, on every
  request. Hidden UI is not access control.
- Never trust a user id, role, tenant id, or price sent by the client. Derive
  each one from the authenticated identity or from the server's own data.
- **IDOR.** Every lookup by id also checks ownership or permission.
- Test the denied path. Every protected operation has a test that shows an
  unauthorized caller is refused.

## Secrets

- Secrets live in the environment or a secret manager, never in source,
  fixtures, snapshots, docs, or examples. See [ENVIRONMENT](ENVIRONMENT.md).
- `.env.example` has keys and placeholder values only.
- Anything shipped to a browser or client bundle is public. That includes
  build-time public env vars. Never put a secret there.
- If a secret is committed, rotate it first, then remove it. Rewriting history
  alone doesn't revoke it.
- Never print secrets in logs, errors, or command output, including during
  debugging.

## Dependencies and supply chain

- Commit the lockfile. CI installs with a frozen lockfile.
- Before adding a package, check that it is maintained, check its download
  count and publisher, check for typosquats, and check any install scripts.
  Prefer fewer, well-known packages.
- Run the audit command in CI (see *Project-specific: tooling*). Fix or
  consciously accept high and critical findings, and record any accepted risk
  with a reason.
- Update dependencies deliberately and regularly, in their own commits.
- Pin CI actions and container base images to a version or digest.

## Data and privacy

- Collect the minimum data the feature needs.
- Never log personal data, tokens, passwords, or request bodies that contain
  them. Redact them in structured logs.
- Add no analytics, telemetry, or third-party scripts without an approved task
  and a documented privacy behaviour.

## Headers and transport

- Serve everything over HTTPS only.
- Set a Content Security Policy, and avoid `unsafe-inline` or `unsafe-eval`
  unless there is a recorded reason.
- Keep the CORS allowlist explicit. Never combine `*` with credentials.

## Project-specific: threat model

The Tauri webview is an untrusted client. Keep capabilities limited to the
application's own windows; validate command inputs in Rust; expose no generic
filesystem, process or shell bridge. Conversation authority and credentials
remain in the daemon and its authenticated IPC. `prewarm_agent_session`, which starts a
chat's agent while its first message is written, takes what `start_agent_session` takes and
checks it the same way (one of the known agent names, flags that are single plain words, a
folder that exists), so it can start nothing a start could not; the daemon keeps one such
agent, hidden, and stops it when it is not taken. The window's own permissions include setting its title and
its icon's count (`core:window:allow-set-title`, `core:window:allow-set-badge-count`), which show how many sessions
need you; they take a number the window counted, never text from a session.

The native host may start only the bundled CLI sidecar with the fixed `daemon`
argument. Resolve its path from the application bundle; never accept a program
path or argument list from the webview. Remove inherited pane, structured
conversation and remote-route variables before starting it, while preserving
the user's local config, data and socket overrides.

`save_export` (`apps/gui/src-tauri/src/export.rs`) writes a block of a chat as a file, and is not a
filesystem bridge: the name must be a plain file name ending in `.md`, `.html`, `.csv`, `.txt` or
`.json`, the text is at most 5 MB, the folder must already exist, and a file that exists is never
replaced (the new one is numbered). The folder is the person's choice from Settings, which the
webview holds, so a compromised webview could add a text file of those types to any existing folder
the user can write; it cannot overwrite, and cannot write a program.

`agent_models` (`apps/gui/src-tauri/src/claude_models.rs`) starts the installed Claude Code to read
its model list, and is not a process bridge: the program is the `claude` found on `PATH` by the host
(on Windows `claude.exe` on `PATH`, else in `~/.local/bin`, else npm's `claude.cmd`, which Windows runs
through cmd; the constant arguments hold no character cmd reads specially), the arguments are a constant, the folder is the home folder, and the webview supplies only the
agent's name. One fixed request is written to it, nothing the webview sent; it is stopped as soon as
it replies or after 20 seconds, and it keeps no session. Each model name it returns is checked
(`is_model_name`) before it can reach a launch line. It runs as the user with the user's own Claude
Code settings, so the person's start-up hooks run, as they do for any Claude Code session.

`open_link` (`open_link.rs`) opens a web address in the person's default browser when they click a
link in a chat. A chat's text is the agent's, so the address is untrusted: only `http` and `https`
with a host are opened, with no whitespace or control character and at most 4096 characters, and
the address is one argument to the system's opener (`xdg-open`, `open`, `rundll32
url.dll,FileProtocolHandler`), never a shell line. Nothing is opened unless a link was clicked, and
the webview itself never navigates. What the page then does is the browser's to contain.

`agent_auth_status` and `agent_sign_out` (`agent_auth.rs`) ask an agent's own command line whether
its account is signed in (`claude auth status --json`, `codex login status`) and end the sign-in
(`claude auth logout`, `codex logout`), for Settings › Permissions. The program is the one the host finds
on PATH, the arguments are constants, the webview supplies only the agent's name (any other name is
refused), and each run is stopped after 15 seconds. The host reads no credential file and keeps
none: the window is told who is signed in (the account's email and plan, as the agent prints them),
which is the person's own, shown only in Settings and never logged. Signing in is the agent's own
interactive command in an ordinary terminal session (`start_agent_session` with `auth login` or
`login`, each a plain word that `agent_command` allows).

`start_github_sign_in(machine)` starts GitHub's own sign-in for Settings › GitHub: a terminal session
in the home folder of this computer or of the machine named, whose first command is the constant
`GITHUB_SIGN_IN_COMMAND` (`gh auth login --web --git-protocol https`, in `maitty-desktop-client`). The
webview supplies the machine and nothing else, so it is not a way to run a program of the window's
choosing. The person finishes the sign-in in that terminal and their browser; the host reads no code,
password or token from it. SSH is set up outside Maiker for now: Add a remote machine has no key-install flow, runs no command and
has no terminal of its own, so Maiker never sees, asks for, reads, stores or logs a password. A refused key's one-line failure only says so and offers a
one-line key-copy command to copy and run in the person's own terminal. The command comes from the host
(`link_failure::fix_command`), which gives none for a target that is not one plain word (`check_target`). A changed host key is
refused and its sentence says how to check and remove the old key (`ssh-keygen -R`); nothing offers to accept it.

`export_daemon_log` (`daemon_log.rs`) saves a copy of the end of the service's log (4 MiB at most) as
`maiker-log.txt` in the Downloads folder, for a person to send when something went wrong (Settings ›
Daemon › Service log). The webview supplies nothing: the log, the folder and the name are the
host's, and an existing file is never replaced (`export::save_in`). The log names folders,
repositories and sessions, so the setting says to look before sharing it.

The repository index (`daemon::repo_index`, `Query::Repositories`) takes no input beyond a flag: its search starts at the
home folder, never follows a link, never enters a hidden folder or another computer's mount, is bounded in depth, folders
and time, and only reads `.git` files. It tells a window folder names and branches, which the window already reads through
`ListFolders`; another machine's names are cleaned again in `remote_policy` and a path with control characters is dropped.

Making a folder (`Query::CreateFolder { parent, name, tag }`, `daemon/folders.rs::create`) is the one place a window
makes a directory. The daemon is the judge: the name is checked again with `maitty_shared::folder_name::problem` and must
parse as one plain path component (so `..`, a separator or a drive prefix make nothing); `parent` follows the rules of
`ListFolders` (absolute or `~`, at most 4,096 bytes) and must already be a folder, and nothing above it is made
(`create_dir`, never `create_dir_all`). A link with the new name is never followed or replaced: `create_dir` fails on
anything already called that, and the answer is `Exists`. The answers are typed (`Created`, `Exists`, `NotAllowed`,
`Failed`), a disk refusal is reported in words and never swallowed, human clients only, and another machine's answer
is cleaned to one line again in `remote_policy`. The host sends it once and never retries on a kept line, because a
second ask would read as `Exists`.

`agent_commands` (`maitty-agent-ask`, started by the host for this computer and by a daemon for its own machine on `Query::AgentCommands`; another machine's answer is cleaned again in `remote_policy`) asks the same way for the slash commands Claude Code takes, for
the chat's command picker. It differs in one input: the webview names the folder the program is
started in, so the project's own commands and skills are listed. The host starts it only in a full
path to a folder that exists, and in the home folder otherwise; a compromised webview could thereby
have Claude Code load the settings and start-up hooks of any folder on the machine, which is what
starting an agent session there already does. What comes back is cleaned before the webview sees
it (`command_name`, `one_line`): a name is letters, digits and `- _ : .` only, since the window
types a picked name into a terminal, and descriptions are one line cut to 240 characters.

For Codex the same command asks for its skills instead (`codex_skills.rs`): it starts `codex
app-server` with that one fixed argument in the same checked folder, sends `initialize` and
`skills/list` for that folder, reads the answer and stops it. No message is sent. The names and
descriptions are cleaned the same way before the webview sees them.

Side answers (`Query::SideAnswer`, `daemon/conversation/side.rs`) are the one place the daemon starts Claude Code
outside a pane or a structured chat: for the chat's `/btw` and the commands that only report, it runs `claude -p
--resume <session> --fork-session --no-session-persistence`, a copy of the session that is never saved. Only the
daemon starts it (ADR 0001); the webview and the host name only the conversation and the ask. The session id is the
daemon's own record (the hook's for a followed pane, the binding's for a structured chat) and must be a UUID; the
folder is the pane's or the binding's; the program is the binding's, or for a pane `claude` (`claude.exe` on Windows)
found on the login PATH, or else in the installers' own folders under the user's home (`~/.local/bin`, then
`~/.claude/local`), never a script wrapper; the model is one the transcript named, kept only if it is a plain model name. The arguments
are an array, never a shell line, and the ask goes on standard input, so a question that starts with a dash is never
read as an option. A question runs with no tools and no MCP servers (`--tools "" --strict-mcp-config`), so the copy can
only answer; a command keeps the session's tools and servers, which it reports on, and is one of a fixed list that
takes nothing after its name, so none changes a setting (`/config key=value` and `/goal <condition>` are sent to the
conversation as typed instead). The pane and structured-chat variables are removed from its environment, so its hooks
report for no pane. A followed pane is answered only for the app it is shown in, as its history is. Three run at most
at once; each is killed after 90 seconds or when the daemon drops it (`kill_on_drop`). Standard error is discarded; the
answer is cut at 64 KiB with control characters removed, and a failure is reported in the daemon's words, never
Claude Code's output. It runs as the user with the user's Claude Code settings, so start-up hooks run as for any
session, and it uses the person's plan like any message.

Assets: the user's shells and agent sessions (which can run any command as the
user), their source code, and API keys in `config.local.toml`. Threats: another
local user or process driving the daemon's socket; a process inside one pane
forging status for another pane; command injection through names, branches or
paths that end up in shell commands; secrets leaking through config sync or logs;
an SSH remote being someone else's machine; what agents work on leaking through phone alerts
(ntfy, off by default: they name the agent and folder only, unless `phone_text` is on, and
the topic name is the only secret on the public server).

The agent launchers (`crates/maitty-core/src/shim.rs`) sit first on `PATH` in every plain shell pane. They are
files in maiker's own data folder, written by the daemon as the user; a process that can write
there can already run as the user through the shell startup files maiker writes beside them.
A launcher asks for a worktree with `maiker agent-dir`, which sends the pane's own
`AGENT_TERM_ID` and `AGENT_PANE_TOKEN` and nothing from its arguments; a wrong or missing token
makes the caller "from a pane" but not that pane, and the daemon answers with nothing (worktrees,
like status reports, are trusted only from the pane itself). A launcher passes the agent's
arguments on as an argument vector, never through a shell, and the paths it embeds are
single-quoted.

The daemon runs the user's own `$SHELL -ilc` once at start to learn the login PATH
(`crates/maitty-core/src/login_path.rs`; unix only). It is as safe as the user's shell
startup files already are, and bounded further: the shell is started by path as an argument
vector, never through a shell, and only when `$SHELL` is an absolute path to an existing file
(else `/bin/sh`); it has no terminal (its own session) and null stdin, its error output is
discarded, and the `AGENT_*` variables (pane id and token, socket, routing) are removed from its
environment; a timeout kills its whole process group; its output is read only between two
marker words, capped in size, and used as PATH entries, never executed or logged. It runs in
the daemon, on the machine the daemon serves, never on a client.

A project's check is a command the daemon runs as the user when an agent's turn ends. It
comes from the user's own `config.toml` (`[[check]]`) or, for a project with none there, from
the repo's `.maiker/checks.toml` under the approval rules below. It runs through the user's shell in the
session's worktree with no stdin and without `AGENT_PANE_TOKEN`, so it cannot report status
as the pane. On timeout its whole process tree is killed (process group on unix, job object
on Windows). If the daemon dies, a check dies with it on Windows (the job closes) and on
Linux (a parent-death signal kills the shell; a descendant the shell already started is
left to finish or to fail on its closed pipes). On macOS there is no such call, so a check
running when the daemon crashes lasts until it ends or writes to its closed pipes. Its output is a capped tail held by the daemon, saved beside the pane's output
files and served only by `Query::CheckOutput` under the read grant; it is never logged and
never in the state snapshot. It may contain secrets the command printed, like any pane's
output.

A structured conversation's provider (Codex app-server, Claude) is a process the daemon owns,
started in its own process group (a job object on Windows). `kill-server` stops every provider's
process tree before the daemon exits and waits up to five seconds for each to be stopped. If the
daemon dies without that, a provider dies with it on Windows (the job closes). On Linux and macOS
it and the processes it started keep running until the next daemon starts: the parent-death signal
that ends a check cannot be used, because a provider is started from a thread that does not live as
long as the daemon. Each provider's process group is recorded in `<socket id>.providers`, and a
daemon that holds the socket stops every recorded group that still has processes before it restores
anything. A group whose leader's start time differs from the recorded one is left alone, so an id
that has been given to another process is never signalled; ids 0 and 1 and negatives never are.

An agent can start helpers only if you say so. Who is asking is proven the way status reports are
(the pane's `AGENT_PANE_TOKEN` on the connection); the answer is `AnswerHelpers`, which the daemon
refuses from any pane and accepts only for a request it holds. The desktop app sends it through its own command (`answer_helpers`, and `answer_chat_helpers` for a chat, which takes the chat's number and is refused in words by a service too old to read it), which takes one of three words (`allow`, `always`, `no`) and refuses anything else. "Always in this project" is kept in
`helper-projects.json` in Maiker's data folder, never in the repo, so an agent that can write the
repo cannot grant itself helpers. A helper's own permission prompts still come to you.

A chat asks the same way (ADR 0016, proposed): who is asking is the chat's runtime identity on the
connection, checked again for every request, and the answer is `AnswerChatHelpers`, refused from any
pane and from any chat's runtime. The consent is cooperative, as a pane's is: a process of the same
user that connects with no identity is read as that user, so this stops an agent that follows the
rules from spending the machine unasked and is not a sandbox.

A chat's **Always in this project** (`ConversationAllowAlways`, ADR 0005) is kept the same way, in
`chat-allowed-commands.json` in Maiker's data folder: the project and the hash of the exact command as the
provider sent it (not the text shown, which has secrets hidden). Only a human client can send it; the daemon
refuses it from a pane or a structured client, and for anything but a command request. Residual risk: a process
running as the same OS user can edit that file, as with `check-approvals.json`. A person takes a rule back with `ForgetAllowedCommand` (Settings → Permissions), refused from a pane; the daemon drops it from memory and the file at once.

What a pull request's reviewers and bots wrote reaches the pane's agent as a queued message
(`sessions.pr_wake`, on by default), so it is untrusted text: it is cut short, flattened to one
line, withheld when it holds hidden characters, framed as other people's words and not
instructions, and capped at ten messages per commit. `gh` is run with prompts off and is given
only a branch's checkout or a validated GitHub pull request address.

An agent that needs a secret asks you for it (`RequestSecret`, proven the same way) instead of
asking in chat. Only you answer (`AnswerSecret`, refused from any pane). The daemon keeps what
you type in memory only (a delivered file is `0600` in a `0700` folder on unix; on Windows it
sits in your own app data, which only you and administrators can read, and is removed within a
day or when the daemon starts), and gives the agent a single-use reference that runs out after 24 hours
and works only for the pane that asked ([ADR 0006](adr/0006-secrets-never-enter-chat.md)). The
value is never in the snapshot or a log line (`SecretText` prints as `<hidden>`), and the label
and reason an agent supplies are checked for control and hidden characters before you read them.
A project may name several check commands. Each one runs under the same rules, one after
another in one background task, and each keeps its own output tail. A command the
resolver holds for approval or that you said never to is not started at all. To tell when
a pass goes stale, the daemon writes a tree of the worktree (tracked and untracked files,
`.gitignore` respected) when a run starts and again on the git poll, through a private
index file in the git directory, as snapshots do. It never touches the user's index; the
tree's blobs go into the repo's object store, where `git gc` drops them.

A repo-supplied command never runs until you approve it, so cloning a repo, or an agent
editing `.maiker/checks.toml`, cannot make Maiker run anything. The rules:

- Your own `[[check]]` for a project wins whole; the repo's file is then not read.
- Approval is per exact command: Always is kept with the command's sha256, and a changed
  command asks again. Never holds whatever the command becomes. Once lets one run of that
  pane's checkpoint go and is never saved.
- Answers live in `check-approvals.json` in Maiker's data folder, outside every repo, written
  atomically (synced, then renamed). The daemon reads the file once at start and goes by its
  own copy, so writing the file changes nothing while it runs. Every daemon shares the file,
  so an answer is written into the file as it is then, never as the daemon's whole copy, and
  a damaged file is left alone.
- Only you approve: `ApproveCheck` and `ForgetCheckApproval` are refused from every pane
  connection whatever its grants, and approve only a checkpoint waiting for approval with
  the command it waits with. `ApproveCheck` carries the sha256 of the command the modal
  showed, and the daemon refuses it for any other. No key press approves on its own; the
  client sends the choice.
- You approve what you read: a repo's `command` or `name` holding a line break, tab or other
  control character is refused with the file. The modal shows the whole command, wrapped,
  with invisible characters spelled out and a run of spaces shown by its length; until a
  frame has shown all of it, Once and Always are refused.
- A file that cannot be read or parsed runs nothing and reads as could-not-run with the reason.

Residual risk: a process running as the same OS user can edit `check-approvals.json`, which
counts after the next daemon restart, and a process that hides its pane identity (no
`AGENT_TERM_ID`) is treated as you, as for grants. Both need code already running as you.

Overriding a failed check is a recorded, visible action: the time and the reason stay on the
result and its `Overridden` state shows wherever the check does. It needs the write grant on
the target pane, and a pane can never override or undo its own check, so an agent's claim
cannot turn its failure into done. An override covers one result; the next run replaces it.

`maiker handoff` copies the tail of a pane's screen, its prompts and its changed file names into
another agent's first prompt, so whatever the screen showed (secrets included) reaches that
agent. It adds no permission of its own: the screen read needs the read grant on the pane and
the new pane needs the start grant, both checked by the daemon as for `maiker read` and
`maiker split`. The brief is quoted with `Config::quote_for_shell` like any first prompt; for
PowerShell that escapes the curly single quotes as well as `'`, since PowerShell ends a
single-quoted string at either.

Text sent to an agent through `maiker send` (and `--wait`), MCP `maiker_send` and a
`maiker_start` task is refused when it holds characters that draw as nothing or reorder the text
(`hidden::is_invisible`: zero-width and direction marks, the BOM, Unicode tag characters), so
one agent cannot hide instructions to another from you. The error names each one and where it
is; nothing is sent. Your own typing and pastes in a pane are not checked.

References (`crates/maitty-terminal-client/src/references.rs`) are files the user puts in `.maiker/references/` at the repo's
main checkout; agents read them through MCP `maiker_references`, which returns paths and never
file contents. An agent's `path` must name an existing folder in its own project unless
`[mcp] scope = "all"`. Nothing outside that folder is listed or removed: a path with `..` is
refused, a link is listed only when it resolves inside the folder, and a references folder (or
`.maitty`) that is a link out of the project is refused; a link is never written through either,
since a new reference is made create-new. An agent's `path` is checked against its project by its
words before anything on disk is touched, so it cannot probe what exists elsewhere, and network
paths are refused outright (no SMB connection from a check). A paste into the References view is
added only when it is one line naming a file; anything else is not repeated in a toast, as it may
be a secret. The folder is kept out of git through `info/exclude`, since a reference is often a
screenshot not meant to be shared.

Saved pane output and check tails can hold secrets that were on screen. On unix their folders
are 0700 and their files 0600 (`persist::private_dir`, `create_private`); on Windows they sit
in your own profile. `[restore] output = false` stops saving pane output and deletes it.

A `[[machines]]` entry's `target` and `ssh_args` are user input that reaches `ssh`, so an option
smuggled into either runs code on this computer (`-oProxyCommand=...`). The config load refuses
a `target` that starts with `-` or holds whitespace or control characters, an empty or
control-character `ssh_args` entry, and a bad `remote_cmd`; `ssh_args` is a list and is never
split on spaces. The ssh command itself is built in one place (`ssh_command.rs` in `maitty-machines`, shared by the terminal app and the desktop app): ssh runs with
`-o BatchMode=yes` (no prompts) and `-o ForwardAgent=no` and `-a` (no agent forwarding), plus
`ConnectTimeout` and `ServerAlive*` defaults that `ssh_args` may override; `BatchMode` and
`ForwardAgent` come before `ssh_args` so ssh's first-value-wins rule keeps them. A line that never asks a
person also carries `StrictHostKeyChecking=accept-new` after `ssh_args`, only in place of ssh's own default
(see *remote machine logins from the desktop*, Host keys). The host follows
`--`, and a host that starts with `-` is refused there too, since `--remote host` never passes
the config load. The remote command is one string for the remote user's login shell, so each
word is POSIX single-quoted whatever the client runs (a Windows client to a Linux remote
included); `remote_cmd` is one program path, a control character or newline in it is refused,
and only a leading `~/` stays unquoted. A remote machine is untrusted, so the pane id and token
a command carries (`Hello.from`) are sent only to this computer's daemon, and `AGENT_REMOTE`,
`AGENT_SSH` and `AGENT_REMOTE_CMD` are removed from every pane's environment. The table is
read only from `config.local.toml` and refused in the synced
`config.toml`, so a shared config cannot point this computer at a host.

A machine's `via` is a program this app runs, so it is code: it is read only from
`config.local.toml` and a `via` in the synced `config.toml` is refused with the rest of the table, naming the
reason. It is an argv list and never a shell line: the program is `Command::new(via[0])` with the other
entries as arguments, no shell reads it, and the remote command (`remote_command`, the same quoting as for
ssh) is one argument, so a hostile `remote_cmd` stays inside it. The load refuses an empty list, a program
that is empty, starts with `-` or is `{command}`, a control character anywhere, and a `{command}` that is not
an entry of its own or appears twice. Nothing of ssh is added (no `-o`, `-a`, `--`): the transport is
trusted exactly as far as the user who wrote it. Its stdin and stdout are plain pipes (never a pty), stderr
is collected and cleaned before it is shown, and on unix it runs in its own session so it cannot read the
controlling terminal. It is refused on Windows, at load and at connect. Its arguments can hold tokens, so
only the program's name is shown (in `doctor`) and nothing of it is logged. Its failures are never read for
ssh's login words.

The Machines dialog adds two more ssh command lines, built beside the first in `ssh_command.rs` with the same
target check, hardening and `--`: a probe (`BatchMode`, `ConnectTimeout=8`, stdin closed, output read to
64 KiB and cleaned) and a first login (no `BatchMode`, so ssh can ask) that runs in a popup pane on this
computer, only for a login that needs a person (a password or a second code; ADR 0017). A person types or picks the host, so it is checked before anything runs: a target that starts with `-` or
holds whitespace or a control character is refused with the loader's message, and nothing is spawned or
written. A pane's shell reads the first-login line, so each word is a plain word (letters, digits and
`_./-~:=,+@`, with a Windows path's backslashes on Windows) or one single-quoted word; a word with a quote or a
control character, an unplain `remote_cmd` and a quoted program are refused rather than escaped, since each
shell escapes differently. The remote half of that line is never quoted for the remote shell. A target is a host name, so it
cannot become an option or a second command whichever shell reads the line. The dialog writes only to
`config.local.toml` (never the synced file), validates the entry with `validate_machines` first, and
changes nothing else; removing a machine does not touch the machine, only this computer's records of it.

Pasting an image into a pane of another machine (`client/remote_image.rs`, ADR 0007) is the same kind of
line: a fixed script (`maitty_core::remote_install::PASTE_SCRIPT`) run as `sh -c '<script>' sh <name> <bytes>`, the image
on stdin, over the hardened ssh line (`BatchMode`, no agent forwarding, the host after `--`). The file's name
is chosen by this computer from letters, digits, `.`, `_` and `-` and checked twice (before the line is
built and by the script); the byte count is checked by the script, which keeps nothing that arrives short.
The file is written under the app's folder in the far side's cache with `umask 077` and renamed into place,
and the script reads nothing of the far side's but its `HOME` and `XDG_CACHE_HOME` (to find the cache
folder, which it refuses unless the user running it owns it) and removes only its own stale files (pastes
older than a week, half-sent files older than a day). What comes back is untrusted: the path is taken only
from the line after the marker and only when it is absolute and free of control and invisible characters;
what ssh says when a send fails is cut to 200 characters and cleaned the same way. The image is
capped at 25 MB and the send at two minutes. A machine reached by a custom transport is not sent an image.

The desktop app's image paste (`image_paste.rs`, ticket 19) hands the host the bytes the webview read from the
clipboard, so the host trusts nothing about them: the type comes from the first bytes (PNG, JPEG, GIF, WebP;
anything else is refused), the size is capped at 25 MB before a byte is written, and the machine must be a known
ssh machine that is connected, all before anything is staged. The staged copy and the copy kept for a local pane
are created `create_new` and mode 600 in an owner-only folder of the app's cache, and nothing but this app's own
`paste-` and `staged-` files is ever swept. The far-side name is `paste-<ms>-<8 hex>-image.<ext>` with the
extension from the checked type, never from the webview. The image is the raw body of a command, not a logged
event, and is never written to a log. What the far side prints is checked as for any file.

A chat attachment (`attachment.rs`, ticket 20) is a path from a drop or the file picker, so it is a string
from outside: the host follows it only to a regular file (not a folder, device or pipe), refuses an empty file, caps an
image (by its first bytes, not its name) at 25 MB and any other file at 100 MB while copying (so a file that grows is
cut off and removed), and copies it `create_new`, mode 600, into an owner-only `attachments` folder of the app's
cache. The copy's name keeps only letters, digits, `.`, `_` and `-` (directory parts, spaces, control, direction and
invisible characters become `_`), so the path the agent is told never needs quoting and the name shown is the name
on disk. A zip is never unpacked. Nothing but `attach-` files of that folder is swept (after a week).
`attachments_exist` answers only for files directly inside the attachments or paste folder, so the window cannot use it
to probe the disk. The message stores the path and name, never the bytes; sending a file to the agent is the person's
own act and is not scanned (secrets stay out of chat, ADR 0006).

Sending any file to another machine (`client/send_file.rs`, ADR 0007) is the same line and the same script;
only the name, the cap and the trigger differ. A file is read from this computer only when the person
names it in the send prompt (a terminal cannot tell a drop from a paste, so a paste of text never
uploads a file, even when the text is a path); it must be a regular file, at most 100 MB, checked before ssh
starts and again by the script's byte count. The far-side name is `paste-<ms>-<8 hex>-<original>` with the
original reduced to letters, digits, `.`, `_` and `-` (anything else becomes `_`), leading dots dropped and
cut to 48 characters, so it cannot be a path, an option or shell syntax and two files never overwrite each
other; the line builder checks it again (at most 96 characters). Progress is the count of bytes written to
ssh; stopping ends the ssh process, and the script keeps nothing that arrives short. What comes back is
refused unless it is the checked path shape, exactly as for images. A sent file stays on the far machine
for a week, mode 600 in a folder only its owner can use; the guide tells people so. Directories are not sent.

`maiker machine update <name>` (`cli/machine_update.rs`) runs one fixed script on a machine and writes a
binary there, so it follows the same rules as every other ssh line, plus these. The script is a constant
in the app (`maitty_machines::INSTALL_SCRIPT`, re-exported by `remote_install`, passed to the remote shell as `sh -c '<script>' sh <args>`);
the destination and the byte count are positional arguments, each quoted once by `ssh_command`, and never
part of the script's text, so nothing a person or a machine supplies can become shell code (tests assert
the argv, and the script has no `{`/`}` and no process-signalling command). The binary travels on stdin,
not in a command. The script writes beside the destination with `umask 077`, checks the byte count, runs
`--version` (owner-only mode until it has run), makes it 755, and renames it over the old file; on any
failure it removes the temp file and leaves the destination as it was. It never signals a process: a
running daemon keeps its sessions. `maiker update` verifies a release twice before it
replaces the program: `sha256sums.txt` must carry a signature (`sha256sums.txt.sig`) made with the release
key built into the program, which is the desktop updater's, and the download must match its line in that
file; then the downloaded program is run (`--version`) and must name the release asked for. Releases are
signed from 0.71.0 on; an older one, reached only with `update --to`, is checked by checksum alone. The
installers (`install.sh`, `install.ps1`) and the fetch for another machine check the checksum only. A release fetched for another platform is verified against
`sha256sums.txt` (exact full sha256) before it is unpacked, the archive listing is checked before
extraction (no absolute path, no `..`, no link, only the release folder; only the one binary is taken),
and the archive and the binary are capped at 200 MB. Nothing fetched is ever run on this computer. The
machine never needs network access to GitHub. The platform answer (`uname -sm`) and the version line are
read as data and cleaned before they are shown. Asking is never silent: a first install needs `--install`
or a `y`, a replacement `--yes` or a `y`, a downgrade `--force`. A Windows machine is refused as a remote
in v1.

Reconnecting never starts a daemon: after an established line ended, a configured machine's proxy
runs `proxy --attach-only` and exits when none is running, so a dead link cannot make this
computer launch processes on a server the user stopped. The first connection, and a retry a
person asks for, run plain `proxy`, which starts the daemon: it is the same command `--remote
host` already runs, and the person added that machine to use it. The CLI's `--on`, MCP and
`doctor` stay attach-only. What ssh
or the far side prints (its last stderr line) is untrusted: it is stripped of control characters,
so no escape sequence reaches the terminal, and cut to 200 characters before it is shown. The
failure is classified from ssh's exit status and the stream, not its wording, apart from a few
fixed tokens that mark a login ssh could not do without a person or a changed host key
(`link_failure::classify`). A host name taken from ssh's words for the `ssh-keygen -R` command is kept
only when it is a plain host. Typing
for a machine that is down is dropped, never queued and replayed.

A remote daemon is someone else's computer, so everything it sends is untrusted: it can forge
status, clipboard writes, toasts and prompts. Two rules hold for every message from a machine
that is not this one (`remote_policy.rs`, `remote_snapshot.rs` in `maitty-machines`):

- **Clean on ingest.** A `State`, and the panes of a `TermsChanged`, are made safe before they are kept: every string loses control
  characters (escape sequences included), hidden and direction-changing characters and line
  breaks (`hidden::sanitize`; only text blocks such as `said` and `asking` keep `\n`) and is
  cut (one-line fields 512 characters, paths 4096, text blocks 8192); every list and map is
  capped at 10,000 entries and a snapshot of more than 250,000 values in all, or with a number
  that is not finite, is refused whole and the last good one stays; pane sizes are held to
  1-1000 columns and rows, `cpu` to 0-100. The walk is over the serialized snapshot, so a string
  field added to the protocol is cleaned without being listed. A `TermsChanged` is cleaned with the
  same walk, refused whole when it names more than 10,000 panes to change or drop or gives more
  than 10,000 removal reasons, keeps a reason only for a pane it drops, and is then
  merged into that machine's held snapshot, which goes through the same checks as a `State`
  (daemon id, caps) before it is kept. A path in a remote snapshot is a
  label: it is never used to touch this computer's disk (`App::local_cwd` is `None` for a pane on
  another machine, and `guard_local` refuses every feature that reads files or runs git there;
  see API_PATTERNS "client routing"). A toast it causes leads with
  `[machine]` and is one clean line of at most 300 characters. Nothing from a remote is logged
  above debug, and then only a fixed reason, never its text.
- **Decide every message.** `remote_policy::allow` names every `ServerMsg` variant (no
  wildcard; verdicts are apply, answer, or ignore), so a new one cannot compile until someone
  decides it, and its test table fails if the decision changes unnoticed. The default for a variant nobody can justify is ignore. This
  computer's own daemon is not subject to it.

| Message from another machine | Verdict | Why |
| --- | --- | --- |
| `Welcome`, `Bye` | apply | no effect beyond that machine's own connection |
| `State` | apply, cleaned | updates only that machine's snapshot; first-state work, restart handling and saved-change alerts are this computer's own and never run for it |
| `TermsChanged` | apply, cleaned | the panes that changed, cleaned like a `State`'s, merged into only that machine's snapshot and then judged as a whole `State` (daemon-id check, caps); an unclean or oversized delta is dropped and the last good snapshot stays |
| `Replay`, `Output` | apply | feed that machine's own pane screens; a screen's size is held to 1-1000 |
| `Attention` | apply | queues that machine's alert; the sound plays only with `sounds`, the toast shows only with `notices` |
| `Clipboard` | gated by `clipboard` (on by default; `clipboard = false` refuses) | writes this computer's clipboard; cut to 64 KiB; the toast says which machine, and a refused copy says so. This computer's own daemon is not gated: a program in a local pane copies as it would in any terminal |
| `Notice` | gated by `notices` | a toast, cleaned and led by `[machine]`; it does not touch this computer's undo hint |
| `Raise` | gated by `notices` | brings the window to the front, the same "may get my attention" grant as a toast (there is no separate `raise` setting) |
| `Error`, `Reply` | answer, cleaned | applied only while this window has a command or query out to that machine that nothing has answered yet (client-side bookkeeping, see API_PATTERNS "client routing"; the wire is unchanged); otherwise ignored. An error's toast leads with `[machine]`; reply text is cleaned and cut to 256 KiB. A `List` reply is apart from that bookkeeping in the desktop host and the TUI: a pane delta the machine itself sends can make the window ask for its list, so that asking opens nothing for an error or any other reply, spends no other request's allowance, and one `List` is taken only while the window's asking for it is unanswered, then cleaned, capped and id-checked like a `State` (a different daemon's list turns the machine away). A `Worktrees` reply never fills this computer's picker, and a check's output is taken only when the open sheet or the failure waiting for it is on that machine |
| `Reply::ClosedSessions` | answer, cleaned | the closed sessions a window asked that machine for: at most 50, every field one clean line, cut short; the folder is a label for that machine and never touches this computer's disk |
| `AskRemoveWorktree` | ignore | names a folder on this computer's disk to delete; remote worktree management is out of scope (ADR 0007) |
| `Reply::SavedConversations` | ignore | saved conversations are listed for this computer's folders only; another machine's are out of scope |
| `Reply::SideAnswer` | ignore on the attached line | a side answer is asked on a request line to the chat's machine and taken only there, through `remote_chat::vet_side_answer`: nothing but a side answer passes, every string is cleaned like a chat's and the text is cut at `SIDE_ANSWER_MAX_BYTES` |
| `AutoWorkspace` | ignore | announces a workspace and arms this computer's undo |

The opt-ins are read from the machine's `[[machines]]` entry by name; a machine no entry names
has all of them off. `AskRemoveWorktree` from this computer's own daemon still shows its path
as the daemon sent it; the folder is removed by that daemon when you answer.

**The desktop app and other machines** ([ADR 0007](adr/0007-multiple-machines.md)). The web view
never connects to a machine and never starts `ssh`: the Rust host holds every connection, runs the same
`remote_policy` and `remote_snapshot` checks as the terminal app on everything that arrives (`hub.rs`,
before anything is kept or shown), and hands the web view cleaned data only. The Tauri capabilities did not
grow for machines (`capabilities/default.json` still holds window controls, the folder dialog, notifications,
the updater and restart; no shell, file system or network plugin). What the web view can ask of a machine
is a fixed set of host commands that take a machine's name or number, never a program or a path to run:

- **Names only.** The window knows a machine by name; where it points (`target`, `ssh_args`, `remote_cmd`,
  `via`) stays in the host.
- **Adding** a machine runs the loader's checks on the target and name first (an option-like or
  whitespace target is refused before anything runs), then looks at it with the shared probe: no prompt
  (`BatchMode`, stdin closed), ended by a 12 s limit or Cancel, and the entry is written only when that held
  up. The one time ssh may ask a person is the first login, which runs as a session on this computer, with
  the probe's hardening and a command line that refuses a word it cannot quote.
- **Grants.** `clipboard` is on for a machine until its entry in `config.local.toml` says `false`, and
  `notices` is off until it says `true`. The Machines page writes either through the shared editor before
  the host changes what it lets through. A notice is one clean line led by `[machine]` and a copy is cut to 64 KiB. `sounds` is read but
  never acted on: the desktop app plays none.
- **Files stay on their machine.** Features that read a pane's files or repository are refused for another
  machine's pane by the window and again by the host's commands, in the terminal app's words, so a pane
  number from another machine can never reach a pane of this computer.
- **A machine's changes are the one repository answer taken.** `repo_query` asks another machine's daemon
  only what changed and its diff (`remote_repo::may_ask`); a file's text, a folder listing, branches,
  history and writes are refused by the host before anything is sent. The answer passes
  `remote_repo::vet_repo_reply`: anything but a status or a diff is dropped, every string loses its
  escapes and control characters, a path or branch is one line of at most 4,096 characters, and the lists
  are cut to the sizes a daemon's own answer may have. The diff is shown as text and never run or written
  to this computer's disk.
- **Fetch, pull, push, commit and Create PR on a machine** take one of those five words and a pane number
  from the window, plus a commit's message and file names; never a command, an address or a folder. That
  machine's daemon checks the message and names and runs its own git and `gh` in the pane's folder
  (`Query::Git`). The one-line answer passes `remote_repo::vet_git_reply`: cleaned, one line, at most 512
  characters, and checked against what was asked. A commit's answer must open with a commit id, and a
  pull request's must be exactly `https://github.com/<owner>/<repo>/pull/<number>`
  (`maitty_shared::github::is_pull_request_address`), so a machine cannot hand the window any other
  address to show. Any other answer is dropped.
- **Install and restart only on a click or a step the person chose.** The owner approved installing the
  helper from the app: adding a machine whose app is missing runs the same `maiker machine update <name>
  --install` as the Fix flow, as a step of the add flow (`install_helper`), with the fixed install script
  and the checks above. The window asks for it by passing `installHelper`; nothing else installs, updates or
  restarts anything on a machine.
- **A different daemon at a known name** is refused (the shared daemon-id store) and says so; Remove then
  adding the machine again is the way out.

## Project-specific: auth and permissions

- **Cloning a repository** (`Query::CloneRepo`, `daemon/clone.rs`) takes an address from a client, so the
  daemon checks it before git sees it: at most 2,048 bytes, no whitespace or control character, not
  starting with `-` (git would read an option), and only an `https://`, `ssh://` or `git://` address or
  the `user@host:path` form. A local path, `file://`, `http://` and git's `ext::` transport are refused:
  they would read this computer's own disk, send credentials in the clear, or run a program. The address
  is passed after `--` as one argument, never through a shell. The new folder's name comes from the
  address and may hold no path separator or other character a folder name cannot. Only a person's
  client may ask; a pane's or an agent's connection is refused. The daemon reads no credential: git uses
  whatever the machine already has, and fails when it would have to ask.
- **Reading who commits** (`Query::GitIdentities`, `daemon/git_identity.rs`): the daemon reads the
  machine's global git config through git itself: the default `user.name` and `user.email`, and the
  folder of every `includeIf "gitdir:…"` entry. It reads further only into files that sit directly in
  its own `git-identities` folder and name the folder they are for; what a rule set outside Maiker
  points at is never opened. No credential is read (a rule holds a GitHub login, never a token), nothing
  is written, and only a person's client may ask.
- **Writing a folder's rule** (`Query::GitIdentityRule`, `daemon/git_rule.rs`): the daemon writes the
  machine's global git config, and only this: one `includeIf "gitdir:<folder>/".path` entry and one file
  of its own in `<data dir>/git-identities/`. The file sets the folder's commit name and email, the GitHub
  login, and a credential helper that runs `gh auth token --user <login>` when git needs github.com's
  password inside that folder. The login is checked to be a GitHub login (letters, digits, dashes, no
  leading dash) before it is put in the helper's command, and must be signed in on the machine; the name
  and email may hold no control character; the folder must exist and may hold no pattern character or
  quote. No token is written: `gh` keeps it and hands it to git when asked. The person sees the exact
  lines before they are written (`Preview`). A rule set outside Maiker is never replaced or removed, and a
  removal takes out only Maiker's entry and file. Only a person's client may ask.
- **Changing a checkout on request** (`Query::Git`, `daemon/sync.rs`, `commit.rs`, `pull_request.rs`):
  fetch, fast-forward pull, push, commit and open a pull request for the checkout a pane is in. Only a
  person's client may ask, with the pane checks of `Query::Repo`. The request is one of five words; the
  only text taken from the client is a commit message (trimmed, at most 16 KiB, no control character but
  a line break or tab) and the commit's paths (relative, no `..`, no `.git` part, no leading `-`, no
  control character, read literally by git). Everything is passed as arguments, never through a shell.
  git runs with `GIT_TERMINAL_PROMPT=0` and `gh` with its prompts off, so neither can ask for a
  credential, and each request is stopped at its limit. Nothing merges, rebases, forces or amends. A
  pull request answers only a `https://github.com/<owner>/<repo>/pull/<number>` address.
- **Who is signed in to GitHub** (`Query::GitHubAccounts`, `daemon/github.rs`) runs the machine's own
  `gh auth status --json hosts` with fixed arguments and nothing from the client in them. Only the
  logins and which one is active leave the daemon; a token is never asked for (`--show-token` is never
  passed), read from `gh`'s files, logged or sent. A login is kept only when it is letters, digits and
  dashes, at most 39 long, both where it is read and again when it arrives from another machine. Only a
  person's client may ask.
- **Listing GitHub repositories** (`Query::GitHubRepos`, `Query::GitHubOwners`, `daemon/github.rs`) puts
  two things from a client on `gh`'s command line, so both are checked first: an owner must be a login
  (`maitty_shared::github::is_login`: letters, digits and dashes, no dash at either end, so it can never
  be read as an option), and a search may hold only letters, digits, spaces, dots, underscores and
  dashes, at most 100 characters, and is passed after `--`. A `:` is refused, so a search cannot carry a
  GitHub qualifier that widens it past the owner. Each is one argument, never a shell line. A repository
  is passed on only when its name is `owner/name` in GitHub's own characters, and the address to clone
  is built from that name (`clone_address`), so text from `gh` or from another machine never becomes an
  address by itself. Only a person's client may ask.
- **Extensions** (`Query::Extensions`, `daemon/extensions/`, `maitty_shared::extensions`) install code that runs with
  the person's access: a plugin ships hooks and servers, an MCP server is a command (or a remote address that hears
  the person's prompts), and neither agent asks first (`plugin install --json` simply does it). So the daemon asks.
  *Who:* human clients only; a pane or a structured runtime is refused. *Confirm:* an add runs only with the
  one-time token a preview returned (random, 128 bits, single use, 10 minutes, at most 16 kept), so a client cannot
  skip the preview; the window shows the source, the scope, exactly what will run (hook commands, server commands
  and addresses, read from the plugin's own files as data with a 256 KiB limit and never executed) and "This runs
  code on your computer with your access", with Cancel focused and no "trust always". A plugin that is fetched on
  install says its commands cannot be listed first. *Commands:* an argument list, never a shell string (a `&`, quote
  or space is one argument; a name cannot start with `-`, a path cannot leave its folder, a source has no control
  characters), 60 seconds, 1 MiB of each stream, no terminal to ask anything of, the login PATH, run in the project
  folder only for a project scope. A server address is `https://` (or `http://` for this computer) with no sign-in in it.
  *Never listed by running:* a list reads files; `claude mcp list` is never called because it starts every server.
  *Removals:* only an item the list shows; a skill is a folder under the agent's skills folder named by a plain name,
  a link is removed and never what it points at, and Codex's `config.toml` is edited with `toml_edit` so its comments
  and other keys stay (written beside and moved into place, with the old file's rights); Codex's removals are checked
  against the listing because it exits 0 for what was never there. *Secrets:* none are taken yet. A server's keys,
  headers and bearer tokens are not accepted by the page (`mcp add -e K=V` would put the value on a command line);
  the page says to use the agent's own terminal. What an agent says is shown as one cleaned line with words that
  look like a key (`key=…`, a bearer, a 32-character token) hidden; a typed error is the contract, not stderr.
  *Not run on Windows or against a live plugin from the internet.*

No user accounts. Access to the daemon is access to its local socket: a named
pipe on Windows, a Unix socket in the temp directory elsewhere, named per user
(`maitty-<user>-<label>.sock`). Socket access must stay limited to the user who
started the daemon. Status reports (`maiker hook`) are accepted only from a
process inside the pane (traced through its process tree) or carrying that
pane's `AGENT_PANE_TOKEN`, a random secret set only in that pane's environment.
Listing specialist agents (`Query::Specialists`, ADR 0010) reads only the fixed agent folders of the
pane's repository and the user's home, never a path a client names; it is for human clients with read
access to the pane, writes nothing, and bounds the count and size of what it returns. Names,
descriptions and file text lose control and hidden characters before they leave the daemon.
Remote work goes over the user's own `ssh`, so SSH's authentication applies.
The one-shot commands (`--on build ...`, `--pane build/4`) treat the machine they reach the same way.
What it answers is untrusted: a list (`ls`, `wait`) is cleaned like a window's snapshot
(`remote_snapshot::sanitize_snapshot`), an error or notice and a line a `wait --regex` matched lose
control characters and hidden characters (`hidden::sanitize`), and a failure to connect is shown as
one cleaned line with its fix (`link_failure::sentence`). `read` prints another machine's screen
without escape sequences or other control characters (newlines stay); `read --raw` prints it exactly
as sent, which is the person's choice to make and can move the cursor or retitle the terminal. The
pane a command runs in belongs to this computer's daemon, so `$AGENT_TERM_ID` is never the default
pane on another machine and the Hello to it carries no pane id or token. `kill-server --on` stops all
of that machine's sessions and needs `--yes`.

**MCP across machines.** An MCP tool call is made by an agent, a model in a pane here, and the
machine it names never learns which pane that is (the Hello to it carries no pane id), so that
machine's daemon would take the caller for you and enforce no grant. The rules that close this,
in `cli/mcp/machines.rs`: (1) a machine is reachable from MCP only if its `[[machines]]` entry says
`mcp = true`; any other call naming it (a `machine` argument or a `machine/id` id) returns
`machine_not_enabled` and is never dialled, and one naming no entry returns `unknown_machine`;
(2) before dialling, this computer's daemon decides whether the calling pane may do it, with the
table it uses for the same tool here: `read` to list, read and wait, `write` to send (and `read` too
with `wait`). The server asks by reading, and writing to, a pane that does not exist
(`Reach::caller_may`; the daemon test `the_grant_probes_the_mcp_server_uses_are_decided_by_the_panes_grants`
pins the answers) and takes anything but the expected answer, a daemon that does not answer included,
as a refusal. A refusal is `permission_denied` with the daemon's own message and the machine's name;
(3) a call to a machine never carries the pane's id or token; (4) whatever the machine returns is
untrusted text that can try to steer the model: a list is cleaned like a window's snapshot, a screen,
a reply and an error lose control and hidden characters (`hidden::sanitize`), a reply is cut at 32,768
characters, and every reply and error from a machine begins `[machine: name]` so the model can tell
where text came from; (5) answering a prompt, interrupting and starting agents or worktrees are
`unsupported_for_remote`, so a remote pane's prompt is never answered by an agent here and no
worktree or folder is chosen from a machine's paths. `[mcp] scope` limits the sessions of this
computer only; opening a machine opens all of its sessions to every pane here that holds the grant.

`maiker doctor` checks each configured machine with the same ssh lines as everything else
(`ssh_command.rs`: `BatchMode`, no agent forwarding, `--` before the host), plus one fixed script,
`command -v maiker` (`maitty_machines::WHERE_SCRIPT`), which carries no user data. Every step has a time
limit and the ssh it started is ended when the limit passes. What a machine answers (the version line, the
program's path, ssh's last line) is cleaned of control and hidden characters and cut short before it is
printed, and only the program's path is shown from the login shell, never its PATH, which can name users.
The `ssh_args` line shows your own arguments without control characters and only the file name of a key
given with `-i`.
The daemon id (`Snapshot.daemon_id`) detects that a different machine now answers at a saved
machine name, so its saved layout is not reused and the window says what happened. It is not
authentication and not a secret: anyone who can talk to a daemon can read its id, so it never
grants access. A daemon with no id answering at a name that has a recorded id is refused too.
Only an 8-character prefix of an id is shown or logged.
Machine-only settings and secrets belong in `config.local.toml`, which config sync
never uploads.

## Project-specific: tooling

Bundled Herdr detection rules and adapted integration code are pinned to a
reviewed source commit; provenance and Apache terms live in
`vendor/herdr-detection/NOTICE.md` and LICENSE. No remote rules are executed or
downloaded. Native JavaScript adapters invoke the installed Maiker executable with
an argument array and inherited pane authentication; they do not forward prompt
or answer text. Setup rejects non-regular owned-file targets and preserves
unowned extensions/hooks. OpenCode's JSONC editor uses pinned jsonc-parser 0.33.1
to retain native comments/settings, with invalid-config preflight tests.

The installers (`install.sh`, `install.ps1`) and `maiker update` run `maiker integrate`, which
edits the config of every agent installed on the machine: Claude Code's `settings.json` and
`~/.claude.json` (through `claude mcp add`), Codex's `config.toml`, Gemini CLI's and Qwen Code's
`settings.json`, Kimi's `config.toml`, Mastra Code's `hooks.json`, and adapter files for OpenCode,
Pi, OMP and Kilo. Only Maiker's own entries change; a changed config file is first copied to
`<file>.maitty-bak` (once). Agents that aren't installed get no folder or file. A failure
warns and leaves the install in place. `AGENT_NO_INTEGRATE=1` skips the step.

`cargo audit` (install with `cargo install cargo-audit`) before releases; GitHub
push protection for secrets. Not yet in CI (there is no CI yet).

## Project-specific: usage store

The usage store holds token counts, cost, turn counts and working seconds, with the agent name,
the folder's name and the agent's session id. It holds no prompts, output, paths or secrets. The
file is private to the user (0600 in a 0700 folder on Unix). `Query::UsageReport` is for human
clients only: an agent pane or a structured runtime cannot read what other sessions cost.

A hook report never carries what a tool was asked to do. A tool-start report carries `call`, a
fingerprint (the first 8 bytes of SHA-256 over the tool's name and input, as 16 hex characters),
which cannot be turned back into the input and is never logged. The name and input stay in the
agent.

## Project-specific: leftover ticket files

The removed Tickets feature (ADR 0013) kept Plane and Linear keys as plain files in
`<data dir>/ticket-keys/` on machines with no system keychain. The daemon removes that folder and
`<data dir>/ticket-links.json` on start (`daemon/leftover_tickets.rs`, off the startup path), and only
those two names, directly inside the data folder it already resolves (`config::data_dir()`, which
honours the data-folder override); no path comes from input. It looks with `symlink_metadata` and
never follows a link: a link, or something of the wrong kind, is left in place and logged. A failure is
logged once with the path and the error, never a file's contents, and never stops the daemon. The
system keychain is never touched.

## Project-specific: closed sessions

The closed-sessions list (`closed-sessions-<socket>.json`, DATABASE "closed sessions") holds each
agent session's agent name, conversation id, folder (with its worktree and repository when it
was in one), branch, name and time. It holds no prompts,
output or secrets, and the name is the one you or the agent gave it, never a prompt. The file is
private to the user (0600 in a 0700 folder on Unix). `Query::ClosedSessions` is for human clients
only: an agent pane or a structured runtime cannot read where other work was done.

`Command::ReopenClosedSession { agent, session }` is for human clients only, the same way: a pane,
a structured runtime or a rejected client is refused. It names an entry the daemon keeps, never a
path, branch or command: the folder, branch and repository come from that entry, and the command
typed is the agent's own resume template with the entry's conversation id, which must start with a
letter or digit and hold only letters, digits, `_` and `-`, at most 128. Making a worktree again
follows DATABASE "closed sessions": nothing at the path is ever overwritten. Another machine: the
command is a worktree command, so a window sends it to this computer's daemon only (API_PATTERNS
"client routing"; remote worktree management is out of scope, ADR 0007). Two requests make a worktree
on another machine, and nothing else manages one there. `BranchWorktree`: the desktop app asks that machine's
daemon to make a new chat's worktree in its own checkout, and takes back only the folder, one plain absolute
path (`remote_chat::vet_worktree_reply`), which becomes the folder a session starts in there.
`NewWorktree` off a pane (a project heading's New worktree, `new_worktree_session`): the host asks that
daemon for its `List`, reads only the workspace holding the pane, and sends `NewWorktree` with no command,
agent, split or `from`, so the daemon decides the folder from its own workspace and starts there what its
own `[worktree] command` (else its shell) says; it takes back only that `List`, cleaned like a snapshot, and `Ok` (`remote_chat::vet_new_worktree_reply`),
and the new session arrives in that machine's list like any other. Both need the remote daemon's own
`Start` grant, and a machine that takes no requests (down, needing an update or turned away) is refused
before anything is sent. Its answer is `Reply::Ok` or `Error`, which `remote_policy` already treats as an answer.

## Project-specific: followed transcripts

The daemon reads an agent's own transcript for a pane it follows ([ADR 0003](adr/0003-status-and-conversation-trust.md)).
The path comes from a hook report, so it is input, not trust:

- It is read only if its real path (links followed) is a regular `.jsonl` file inside the user's home folder
  and its name carries the session id the hook reported (Claude `<session>.jsonl`; Codex
  `rollout-…<session>.jsonl`). Anything else is refused with a reason that names no content.
- Only a pane that is hook-verified, owned by the desktop app and running `claude` or `codex` is followed; a
  pane cannot make the daemon read a file for another session. Once followed, the pane keeps its follower (the same
  file, the same session) while it still runs that agent, even if the hook goes unverified or its session or file is
  briefly unknown; a new session, or following again after the agent leaves, needs the verified hook again.
- Reads are incremental and bounded (4 MiB per poll, a 16 MiB tail first, lines over 1 MiB dropped), run off the
  event loop, never write, and are cleaned and bounded like structured history (`tool_input.rs`). The text is
  held in daemon memory for the conversation's life, never cached, logged or put in a fixture.
- A followed conversation is read-only, and reading never changes a status.

A helper's own record (`Query::HelperRead`, ADR 0010) is read the same way, once per ask, for human
clients only and only for a pane the client is shown. The helper must be one the pane's verified
reports listed, its id is letters, digits, `-` and `_` (at most 128), and its file is found from the
pane's reports, never from the request: Claude's must be exactly `<session>/subagents/agent-<id>.jsonl`
beside the transcript that passed the checks above (no link out of that folder), and Codex's must be a
rollout named for the helper whose parent chain reaches the pane's thread. The last 4 MiB is read and
the reply holds the newest entries within 256 KiB.

## Project-specific: chat sessions started from the desktop

A chat session is a Claude or Codex run the daemon starts itself ([ADR 0003](adr/0003-status-and-conversation-trust.md)).
The agent runs with the user's permissions, so the window's start path is narrow:

- **Posture.** `start_chat_session` takes one optional boolean, `full_access`, and no other permission argument. By
  default the daemon starts the provider with workspace write and approval on request (Claude `--permission-mode
  default` with the stdio permission prompt; Codex `workspace-write`, `on-request`). With `full_access` it starts
  the provider's own skip-permissions mode (ADR 0005: Claude `bypassPermissions` with
  `--allow-dangerously-skip-permissions`; Codex `danger-full-access` with approval `never`). The window always
  sends the choice explicitly: a labelled checkbox with a warning, ticked at first because **Bypass Permissions** is on
  by default (Settings › Permissions, one switch per agent, `[permissions.bypass]`), and unticked for one chat or for
  good by turning the agent's switch off. It is fixed for the session: Maiker never widens a running session, and a
  chat started with it always shows that it is: the message box's shield turns red in a mode that asks about nothing,
  and a chat whose shield does not show its mode carries a visible Bypass permissions tag instead. The same switch adds the agent's own flag
  (`AgentDef.bypass_flag`) to every agent the daemon or either app starts in a terminal: new sessions, branch agents,
  MCP `maiker_start`, CLI handoff and resume. A resume adds it only when the session started with it and the switch
  is still on (`restore::keeping_bypass`); a flag that is not a plain `-`option is ignored. Typing an agent's name in
  a shell yourself adds nothing. In the default posture every tool use the provider does not allow by itself becomes an approval
  that waits for a person's answer, and there is no auto-approve. There is no way to change a running session's
  posture, and no read-only-to-writable switch, in the window. Answers are human-only, bound to the current generation and the exact request id (unchanged
  from the structured runtime rules above).
- **Where it runs.** The folder is a project the app already shows, or one a person picked in their own window (a
  client that is not a pane's agent, a structured runtime or a rejected client: `may_name_checkout`); an agent cannot
  point a checkout at a repository the app has never been shown. A branch start also needs a git
  repository and a valid branch name (`branch_agent::branch_problem`), and the worktree is made by the daemon
  (`create_trusted_worktree`: the trust copy and the repo's allowed setup hook only). The window never builds a
  path or runs git. A start for another machine is refused in the window.
- **Status** comes only from the daemon's events for the current generation; a superseded generation's command
  changes nothing.
- **User-input answers** (including a question marked secret) are relayed once, typed hidden, and never recorded
  or logged.
- **Closing** a chat session stops its agent before it is put away, so a session the user closed is never left
  running out of sight; if the stop fails nothing is hidden.
- Secret masking in history is the daemon's (ticket 18), at the point where history is stored and served; the
  window adds no copy of a message.

## Project-specific: cloning a repository from the desktop

The New session draft's project list (a pasted link, **Clone from link…**, **My GitHub repos…**) clones through the
daemon (`Query::CloneRepo`, `crates/maitty-core/src/daemon/clone.rs`), on this computer or the chosen machine, off the
UI thread, with the user's permissions. The desktop host has no clone of its own. What was pasted never reaches git as
typed:

- The window reads it as a GitHub owner and repository name (owner/repo, a github.com page or HTTPS address, or
  `git@github.com:`; `model/repoAddress.ts`). Each name is checked: ASCII letters, digits, `-`, `_` and `.`, at most
  100 characters, not starting with `-` or `.`. Anything else, including another host, `file://` or `ext::`, is
  refused. An address carrying a user name or token is refused with a plain line, never cloned and never shown back.
- The address handed on is built again from the two checked names, so a pasted secret is dropped, not carried into a
  command line, a URL or a log. The daemon checks the address again (https, ssh or git, no spaces or leading dash,
  length limit) and passes it after `--`.
- The target is a new folder named after the repository inside an existing absolute folder; an existing folder is
  never written into. The one exception is the default `~/Projects` (the user's home plus `Projects`), which is made
  on first use; any other missing folder is refused.
- Git runs with `GIT_TERMINAL_PROMPT=0` and a time limit: it asks for no password, so a private repository uses the
  credentials git already has on that machine (`gh`'s, once the person has signed in through Open a project's GitHub
  tab). Maiker stores no GitHub token; the window says so when git needs a sign-in. Git's own words are matched to a
  plain sentence and shown without the address.

The **Open a project** dialog (`features/open-project/`) is the desktop's other way in, on this computer only:

- Its URL tab accepts any host, not only GitHub. `repoUrl.ts` reads `https://host/owner/repo`, `git@host:owner/repo.git` and
  `host/owner/repo`, requires a dotted host name and path parts in the same safe characters as above, and builds the
  https or ssh address again from them (a user name or token is refused, never carried on). The daemon's check on the
  address is unchanged and is the one that decides.
- GitHub sign-in is `gh auth login --web`, run by the daemon (`agentSignIn('github', …)`). The window shows the one-time
  code and an https link and never asks for, receives or displays a token; `gh` keeps it. Sign-out is `gh auth logout`.
- On this computer, the git projects offered come from `listFolders` on home and a fixed shortlist of folders under it,
  one level deep, each with a timeout; no walk of the disk.

## Project-specific: signing an agent in from the desktop

`Query::AgentSignIn` makes the daemon run `claude auth login` or `codex login --device-auth` and show the
person a link and a code (`daemon/agent_sign_in.rs`). What it may do:

- The program is the agent's own, found on the login PATH. Every argument is a constant; the window sends
  only which agent and `Start`, `Cancel` or `Read`, as enum values the daemon decodes. Nothing the command
  prints is ever run, passed to a command or written anywhere.
- Only a link and a code leave the process. The link must be `https://` with a host, no user name, no
  whitespace or control character, at most 2 KiB; anything else is dropped, not repaired. The code is letters,
  digits and dashes, at most 24 characters. The window shows the link's host beside Open link and opens it
  through the same `open_link` path as every other address. The host is not on a list: the command's own
  output is the source, so the check is the shape, and the person sees where it goes.
- No credential passes through Maiker. The tokens a login obtains go to the agent's own files, as when it is
  run in a terminal; the daemon reads none and logs none. The output is read up to 16 KiB, scanned once, and
  dropped; the rest is read and discarded so the command never stalls. Status text is never logged.
- One login per agent, a 15-minute limit, killed on cancel, on timeout and when the daemon drops it. Human
  clients only: an agent's connection is refused, and a reply from another machine is ignored, so another
  computer's output can never put a link in this window.
- Claude's paste-a-code flow is not supported on purpose: a code typed into the window would be a credential
  in a text box (ADR 0006).
- **GitHub** is one more `SignInAgent` (`Github`): the daemon runs the constant line `gh auth login --web
  --hostname github.com --git-protocol https` with nothing on its input and `GH_PROMPT_DISABLED=1`, so `gh` prints
  the one-time code and the `https://github.com/login/device` address instead of waiting for Enter and opening a
  browser. The same scan keeps that code (the text after the colon on the line that names it) and that address
  under the same checks, and drops everything else the command prints. `gh` keeps the token in its own store (the
  system keyring, or its hosts file); the daemon never reads it, never asks for it and never logs the code. `SignedIn`
  is the exit status of `gh auth status --hostname github.com`; its text, which names accounts and token sources,
  is not read. Who is signed in stays `Query::GitHubAccounts` (logins only).
- **GitHub sign-out** (`SignInRequest::SignOut`, GitHub only) runs `gh auth logout --hostname github.com --user
  <login>` for the active account only, the login being one `gh` itself reported and `is_login` checked, so it can
  never be an option on `gh`'s command line. It runs off the event loop with a 15-second limit and answers `Idle`, or
  `SignedIn` when another account remains. A login still waiting is cancelled first.

## Project-specific: a folder's branches and what a machine is

`Query::FolderGit` (`daemon/folder_git.rs`) and `Query::MachineFacts` (`daemon/machine_facts.rs`) are human-client
only; an agent's connection is refused. A reply from another machine is vetted like every other: names, paths and
lines cleaned and capped (`remote_policy`), and an answer to nothing asked is dropped.

- The folder is an absolute path or starts with `~`, at most 4 KiB, and must exist. Git runs as a program with
  arguments, never through a shell, with `GIT_TERMINAL_PROMPT=0`, and each command is stopped after 15 seconds.
- A branch name is checked before git sees it (`maitty_shared::repo::is_branch_name`): plain ref characters, no
  leading dash, no `..`, no `@{`, at most 200 bytes. A remote branch to check out must also be a ref git has already
  fetched (`refs/remotes/<name>` verifies); its local name is the part after the first `/` and is checked as well.
  Nothing fetches, pushes or deletes, and a switch over uncommitted changes is git's own refusal, shown as it says it.
- Machine facts are the system, architecture, core count, host name and, for each agent program on the login PATH,
  what its `--version` printed on the first line (kept only when it is version-like). No path, environment, account
  or token is read or sent. Each program runs once with a 5-second limit.

## Project-specific: installing an agent from the desktop

`install_agent` (`apps/gui/src-tauri/src/agent_install.rs`) runs an agent's own documented install on this
computer. The owner approved installing agents from the app; this replaces the earlier rule that the desktop
app installs nothing. Running a downloaded script is running remote code as the person, so:

- **An allowlist in code, not input.** The window sends only the agent's name (`claude`, `codex`, `gemini`
  or `opencode`; anything else is refused). The command comes from a table in the file: a script at an
  `https://` address on `claude.ai`, `chatgpt.com` or `opencode.ai` (no port, user name, query or fragment),
  or `npm install -g` of one of two fixed packages. The table is checked against the allowlist again before
  anything starts. A new agent or host needs a code change and a line here.
- **Shown before it runs.** `agent_install_command` returns the exact command for this system, and the
  window shows it before asking. The vendor pages the commands come from are listed in the file.
- **No shell line is built.** A script is `curl -fsSL <url>` with its output piped to `bash` or `sh` as
  two programs (on Windows, `powershell -NoProfile -Command "irm <url> | iex"` with a constant line). Nothing
  from the window or from the download is ever interpolated.
- **Never elevated.** It runs as the person who runs the app, never with `sudo`, `runas` or an administrator
  prompt. An install that needs more fails and says so.
- **Bounded and visible.** One install at a time, stopped after 10 minutes, no input. Its output is cleaned
  (control characters dropped, lines cut at 400 characters) and streamed to the window as `install-progress`;
  nothing it prints is run or stored. The version is read afterwards with `<agent> --version`, stopped after
  2 seconds.
- **No Copilot.** It is not a supported agent here (ADR 0005), so it has no row and no command.
- **Limits that remain.** The vendors' scripts are trusted as much as their domains; there is no checksum
  of the script here. npm and curl come from this computer's PATH.

## Project-specific: the message the daemon sends by itself

With `restore.continue_turn` on, the daemon sends one fixed message, `Continue where you left off.`,
to a chat conversation, with nobody asking at that moment. It is off by default and its reach is
narrow (`daemon/conversation/continue_turn.rs`):

- **Who gets it.** Only a structured conversation that was in a turn when the daemon stopped (the
  session file's `turns_in_flight`), that the daemon itself resumed at this start, on the generation
  that resume runs at. An idle chat, a start a client asked for, a superseded generation, a
  conversation that was mid-transfer and a terminal agent never do.
- **When.** After the resume has succeeded and the history is complete, never before; a resume that
  fails sends nothing. It goes through the same send path as a person's message (hidden-character
  check, receipt, queue while a turn runs) and carries no model, effort or permission choice.
- **How often.** Once per daemon start, and at most 3 times in 5 minutes per conversation. The count is
  in the session file and is written before the message leaves, so a daemon that restarts in a loop
  cannot send a fourth. A clock set back keeps the earlier sends counted.
- **What it cannot do.** It answers no approval or question (those stay human-only), starts or adopts
  no conversation, and changes no posture. The text is a constant; nothing from a client, a file or a
  provider is put into it.
- **How it looks.** The provider records it as a user message, and the chat shows it as one: the
  message model has no sender other than user and assistant.

## Project-specific: structured history cache boundary

The structured-history cache reuses private-directory/file helpers:
0700 directories and 0600 files on Unix, the user's private data location on
Windows. Binding fingerprints and numeric Maiker paths keep native identifiers
out of filenames; pages remain sensitive conversation content, never diagnostics.
Only current daemon-owned provider events may project into attached history.
Unsupported raw provider objects are not retained. Of a Codex reasoning item only the plain-text
summary is kept, masked like a message and never logged; its encrypted content is not read. The same holds for the thinking a followed Claude or Codex
transcript holds (a Claude block's signature is not kept). Cache disable serializes with
writes and deletes only Maiker's socket-scoped history root, never native history.
Without persistence, hydrated content belongs to an attachment and disappears on
its disconnect. No credentials, real transcripts or model requests enter fixtures.
Structured start/send/read/approval/cancel actions use the existing socket
authentication without a conversation-based self exemption. Start requires the
start grant, send and cancel require write, read requires read, and approval
answers require respond. Structured runtimes cannot answer provider approval
requests. A human approval is bound to its exact provider request ID,
conversation generation and daemon-owned connection; unknown request kinds stay
unanswered. Invisible characters are displayed as Unicode escapes. Only the
command and reason needed for the decision leave the daemon;
raw provider params are not retained in the conversation history or metadata.
A tool call's `input` is kept in history (it can hold file contents, commands and
environment), so it is held to the same boundary as the rest of the history: it
leaves only in an explicit authorized read and in the private cache. It is cleaned
of escape and control characters, invisible characters are spelled out as Unicode
escapes, every string is cut and the whole value is capped at 64 KiB, and an input
that cannot be bounded in shape is dropped (`tool_input.rs`). Secrets are
masked on the way in; see *Conversation history and secrets* below. Answered approvals
keep the request's command and diff in daemon memory only, never in the cache, and
the answers to user-input requests are not kept at all.
A message queued while a turn runs is held in daemon memory only, never in the session file or the history
cache, and goes through the same admission checks as a direct send (invisible characters, size, write grant)
when it is queued and the same durable-receipt path when it is delivered. Removing one needs a human client.
Prompts are checked for invisible characters at daemon admission. Launch inputs
are validated in background and explicit sandbox/approval posture is checked in
the provider response. Native profile-v2 and ambiguous identity are refused.
Command execution, file-change and user-input requests may be answered only by a
human through the exact live request ID. File-change approval stays disabled
until the matching diff is visible. User-input answers are validated against
the displayed questions and choices, reject hidden Unicode, and are not stored
in history or metadata. Permission requests stay blocked and unanswered until
their controls exist; no unsupported request can approve itself. Turn cancellation is human-only and carries the acknowledged active
turn ID through the owning provider connection; uncertain sends are never
guessed. Generation and connection identity fence every event; checkpoint
approvals retain separate typed owners.

Persist metadata intent before provider creation/submission and durable native
turn acknowledgement before returning success. A crash or transport ambiguity
never retries a possibly delivered prompt. Prompt text and effective environment
never enter the metadata ledger or diagnostics. Structured history appears only
in explicit authorized read replies and the optional private cache.

Outgoing structured tools authenticate with a daemon-minted runtime secret bound
to conversation, generation and connection. Strip inherited pane/structured
credentials before launch. Do not persist this secret, copy a pane token, accept
a partial environment claim, or treat rejected/revoked claims as human callers.
Every request uses configured MCP grants, with no logical-conversation self
exemption; human-only grant/check/helper answers remain human-only. A structured
runtime starts helpers only (an agent on a task, in a new session or worktree),
and only after the person's answer held on its conversation; a bare shell and
every other descendant start are refused, and a runtime that is no longer current
starts nothing and is never counted as a person (ADR 0016, proposed). A Claude chat's process is
given the same four variables as a Codex chat's and no other identity, so a tool server it loads
(`mcp`) reaches the daemon as that chat and never as a person.

Codex filters MCP child environments, so validated runtime overrides append the
four reserved identity variable names to existing stdio MCP allowlists. They
contain no secret values. Preserve the effective default/all shell policy and
refuse unsupported custom filtering, environment-set or profile policy and
reserved MCP environment conflicts before a thread starts. No credential
exposure switch is broadened. Explicit MCP references revalidate current read
authority before filesystem work. An in-memory native acknowledgement remains
uncertain in every read response until its persistence barrier succeeds.

### Conversation history and secrets

Everything the daemon stores and serves as conversation history passes one function,
`redact_entry` (`daemon/conversation/redact.rs`), when it enters the store (`History::apply`,
`hydrate`) and again when a cache is loaded. That covers the Claude and Codex adapters, both
followed-transcript parsers, message text, tool input, command output and approvals. It changes only
Maiker's copy: the agent still sees exactly what it sent and received, and nothing is blocked.

**Masked** (the secret part becomes `[redacted]`, the text around it stays):

- GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`), AWS access key ids (`AKIA`,
  `ASIA`), Anthropic (`sk-ant-`) and OpenAI (`sk-`, `sk-proj-`) keys, Slack (`xox*`, `xapp-`), Google
  (`AIza`), Stripe live (`sk_live_`, `rk_live_`), JSON Web Tokens.
- PEM private key blocks, from the `BEGIN ... PRIVATE KEY` line to the `END` line (or to the end of the
  text if it is cut or still streaming); the whole block becomes `[redacted private key]`.
- `Authorization: Bearer|Basic|Token ...` headers and bare `Bearer <token>`.
- The password in `scheme://user:password@host`.
- `NAME=value`, `name: value` and `"name": "value"` where the name has a secret, token, password,
  passwd, api key, private key, credential or auth part (`githubToken`, `AWS_SECRET_ACCESS_KEY`), and
  every value under such a key in a tool's input JSON. Placeholders (`$VAR`, `<your-key>`, `****`),
  URLs, paths, flags, short values and code references (`token = refresh_token`) are left alone.

**Omitted** (the text becomes `[content of a secret file omitted]`; the path, tool, kind and an
`omitted_bytes` count stay, so the chat still says "wrote .env"): the content, old/new text and diffs of
a tool input, an approval's `changes` and a Codex file change whose path is `.env` or `.env.*` (not
`.env.example`, `.sample`, `.template`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.kdbx`, `id_rsa`,
`id_ed25519` (and `id_ecdsa`, `id_dsa`), `.npmrc`, `.pypirc`, `.netrc`, `credentials`,
`.git-credentials`, `secrets` / `secrets.*`, or anything under `.aws`, `.ssh` or `.gnupg`. The output of
a shell command that prints such a file (`cat`, `head`, `tail`, `grep`, `sed`, ...) is omitted too.

**Limits.** Pattern masking is best-effort and is not a guarantee. It misses a secret with no known
shape and no telling name (a bare 40-character key, a password in prose, a custom token format), a
secret split by the provider across separate tool results, a file that holds secrets under an ordinary
name (`config.json`), and a command that reads a secret file in a way the command list does not know.
It can also hide something that was not a secret. The patterns lean towards missing a secret over
wrecking ordinary text: prose, git hashes, UUIDs and plain base64 are not touched. Treat history as
sensitive anyway: it still reaches any client with a read grant and the private cache. A person who
approves a command reads the masked text, so a command's masked part cannot be checked from the chat.
The functions never log or return what a pattern matched.

## Project-specific: terminal output socket

The desktop host listens on `127.0.0.1` (a port the system picks) and sends terminal output to its own
window as WebSocket messages ([ADR 0004](adr/0004-client-split-and-desktop-host.md)). Output
is what the panes show, so the rules are those of a credential:

- **Loopback only.** The listener binds the loopback address and nothing else.
- **A one-time token.** The window asks the host for a 256-bit random token (`open_terminal_socket`),
  valid for 60 seconds and one use, sends it as the first message, and gets nothing until the host
  says `ready`. At most 8 tokens are outstanding. The comparison does not stop at the first
  difference. The token is never in the address and never logged.
- **Origin allow-list.** The upgrade is refused unless the `Origin` header is the app's own
  (`tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`), plus the dev server's
  origin in a debug build. A web page in the user's browser cannot connect.
- **Bounded.** At most 4 connections may be waiting to prove a token, each has 5 seconds, and at most
  4,096 frames wait for a window that has stopped reading, after which the socket is dropped and the
  channel takes over.
- **One window.** A new connection replaces the old one.
- **CSP.** `connect-src` allows `ws://127.0.0.1:*` and no other socket.

## Project-specific: editing a project file (markdown viewer)

- **The text is untrusted.** A markdown file is drawn only by the chat's reader (`features/chat/markdown.ts`), which builds
  elements and never HTML: raw HTML is shown as text, a link is kept only when it is an `http(s)` address, an image is not
  loaded. A link to another `.md` file is handed to the reader as an address on `document.invalid` (a name that cannot be
  reached) and caught by the viewer before the reader's own handler; the target is resolved against the document and refused
  unless it stays inside the project and names a markdown file (`documents/documentPaths.ts`). Nothing is fetched for it.
- **The write path.** Saving is `Command::SaveFile`, through the daemon of the session's own pane (rule 1): the window
  never touches a disk. The daemon applies the read path's jail (relative, no `..`, no links at any step, not under
  `.git`), writes only a file that already exists and is a plain file, refuses text over 256 KiB, writes a temporary file
  beside it and renames it, keeps its permissions, and refuses with `ChangedOnDisk` when the bytes on disk are no longer the
  version that was read. An agent's client cannot send it. For a session on another machine the same request goes to that
  machine's own daemon over the request line (ADR 0014), for markdown files only (`remote_repo::may_save`, checked again
  by that daemon): nothing crosses between disks, the window carries text and a version word. What that untrusted daemon
  answers is vetted by kind (`vet_repo_reply`, `vet_save_reply`): a document keeps its tabs and line breaks and loses
  every other control or invisible character (and then carries the empty, read-only version, so the cleaned text is never
  saved back); a listing's names are one clean line each; a save's answer is a plausible version or `ChangedOnDisk`, no
  echoed path or text. Paths with a backslash, drive letter, stream colon, leading slash or `..` are refused before a
  line is opened. Other kinds of file stay local-only.
- **No silent overwrite.** The window sends no version only after the person pressed Overwrite on a `ChangedOnDisk` answer.
- Not covered: a change made in the instant between the daemon's last version check and the rename is not caught (no lock is
  held on files an agent edits).

## Project-specific: remote machine logins from the desktop

The Settings > Remote machines screens (`apps/gui/src-tauri/src/machine_access.rs`, `add_machine.rs`;
logic in `crates/maitty-machines/src/{key_login,machine_target,new_host_keys}.rs`) let a person add a
machine and fix one that will not log in without a terminal. They run ssh tools on this computer on
input from the window, so each is bounded as follows.

| Command | What it takes | Rule |
| --- | --- | --- |
| `add_machine`, `set_machine_user` | user, host, port | Checked at the host as well as in the window (`machine_target`): a user or host starts with no `-`, has no whitespace, quotes or shell characters; a port is 1-65535 and becomes `-p N` in `ssh_args`. Every ssh line puts the target after `--`. The entry stays `user@host` in `config.local.toml`; entries written before still load. |
| `add_machine` key file | a path | Optional `identity_file` on the entry, passed as `-i <path>` (one argv entry). It must be an absolute path (a leading `~/` is expanded), exist and be a file; a path that starts with `-`, has a control character or ends in `.pub` is refused. The file is never opened by Maiker (only ssh reads it) and a path with `via` is refused. Entries without it still load. |
| `add_machine` reach and key name | none | The reached time is a plain TCP connect to the host and port `ssh -G` resolves (no login). The key name is read from a second `BatchMode` login that runs only `true` with `ssh -v`; only the file name of the key that signed in is kept, and only when it passes a character check. |
| `inspect_key_login`, `set_up_key_login` | machine name, account password, "create a key" | See below. |

Host keys ([ADR 0017](adr/0017-remote-machines-rely-on-your-ssh-setup.md), `new_host_keys.rs`):

- **No question, no key written by Maiker.** Every line Maiker runs to a machine without a person
  (the add probe, the dial, the file, folder, paste and install lines) carries
  `-o StrictHostKeyChecking=accept-new` after the person's own `ssh_args`. ssh itself records a key it
  has not seen in the person's `known_hosts` and refuses one that differs from the key on record.
  Maiker shows no fingerprint and never writes `known_hosts`. Risk accepted: the first connection to a
  new host trusts whatever key answers, as plain ssh with `accept-new` does.
- **Only ssh's default is replaced.** When `ssh -G` for the target shows `StrictHostKeyChecking` set
  to anything but `ask` (by the person's `~/.ssh/config` or `ssh_args`), nothing is added. Nothing is
  added either for a client that is not OpenSSH 7.6 or later (`ssh -V`, asked once per program), which
  would refuse the option. ssh then behaves as it did before.
- **Never off.** No ssh option that turns host-key checking off (`StrictHostKeyChecking=no`) is used
  anywhere; tests pin this.
- **A refused key adds nothing.** A machine whose host key ssh refused while it was being added is not
  written, from the desktop app or the terminal app (`machine_probe` yields
  `FailureClass::HostKeyChanged`). A refused key, while adding or on a configured machine, is said in
  the shared sentence (above: how to check it and the `ssh-keygen -R` that clears the old key) with Try
  again; nothing offers to trust it.
- The terminal sign-in line (`first_login_command`) carries no setting: a person is there to answer
  ssh, and the probe before it has already had ssh record a new key.

Key login with a password once (`key_login`):

> [ADR 0017](adr/0017-remote-machines-rely-on-your-ssh-setup.md) removes this flow (Maiker relies on your
> own ssh keys and agent); the rules below describe the code until that lands.

- **The password.** It arrives as one argument, is moved into a `Secret` (no `Debug`, `Clone` or
  `Serialize`; its bytes are overwritten on drop), and lives only for that call. It is not written
  to disk, config, logs, ssh arguments or events, never sent to the daemon, and never returned to the
  window. It reaches ssh only through `SSH_ASKPASS` with `SSH_ASKPASS_REQUIRE=force`: a helper script
  with no secret in it, in a mode-0700 folder that is removed afterwards, prints it from an
  environment variable set on that one short-lived ssh process. Every text shown from ssh is scrubbed
  of the password first. Limits that remain: the window's webview and the IPC string cannot be wiped,
  and the environment of the ssh child (readable by the same user while it runs) holds it briefly.
- **Where it can be used.** Never before the machine's host key is on record (its first connection
  records it): the steps run with `StrictHostKeyChecking=yes`, and the command refuses when the key is
  not on record. Not offered when
  this computer is Windows (the helper is a shell script); the card says so and offers the terminal.
- **What is installed.** Only the public key. A key with a passphrase stops the flow. A new key
  (ed25519, no passphrase) is made only after the person agrees, only where no key file exists.
- **The far side.** OpenSSH on Linux and macOS: `~/.ssh` 700, `authorized_keys` 600, no duplicate.
  Windows: an administrator's key goes to `ProgramData\ssh\administrators_authorized_keys` with
  only Administrators and SYSTEM allowed; anyone else's to their own `.ssh\authorized_keys`. The
  system is told with fixed commands (`uname -s`, then one fixed `cmd` line); when it cannot be told,
  or the machine does not confirm, the exact steps are shown and nothing is guessed.
- **Attempts.** One password prompt per ssh run, a wrong password stops at once, and three wrong
  passwords for a machine in a row stop further tries until Maiker restarts.
- **After.** The key is checked by a `BatchMode` login with passwords off; the machine is dialled
  again only on success.
