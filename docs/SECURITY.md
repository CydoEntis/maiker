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

Assets: the user's shells and agent sessions (which can run any command as the user), their source
code, and API keys in `config.local.toml`. Threats: another local user or process driving the
daemon's socket; a process in one pane forging status for another; command injection through names,
branches or paths; secrets leaking through config sync or logs; an SSH remote being someone else's
machine; phone alerts leaking what agents work on (ntfy is off by default and names only the agent and
folder unless `phone_text` is on; the topic name is the only secret on the public server).

Words used below: a program is always run with an argument list, never a shell line. **Cleaned**
means control, hidden and direction characters removed (`hidden::sanitize`) and cut short. **Bounded**
means capped in size, count or time by a constant in the code that enforces it.

### The desktop webview and host

- The Tauri webview is an untrusted client. Capabilities stay limited to the app's own windows
  (`capabilities/default.json`: window controls, the folder dialog, notifications, the updater,
  restart; no shell, file system or network plugin). Validate command inputs in Rust. Expose no
  generic filesystem, process or shell bridge. Conversation authority and credentials stay in the
  daemon and its authenticated IPC. Title, badge and zoom take only a counted number or a value from a
  fixed list.
- The host starts only the bundled CLI sidecar with the fixed `daemon` argument, resolved from the app
  bundle. It removes inherited pane, structured-conversation and remote-route variables first and keeps
  the user's config, data and socket overrides.
- `prewarm_agent_session` is checked exactly as `start_agent_session`; the daemon keeps one hidden
  prewarmed agent and stops it when it is not taken.

Host commands that run or write something take only the agent's name, a machine, or the values listed:

- **`save_export`**: a plain file name with a text extension, bounded size, an existing folder; an
  existing file is never replaced. Residual: a compromised webview can add such a file to any folder
  the user can write, but cannot overwrite or write a program.
- **`agent_models`**, **`agent_commands`** (`maitty-agent-ask`): run the installed `claude` the host
  finds, with constant arguments and one fixed request, then stop it; no session is kept. For Codex,
  `codex app-server` with `initialize` and `skills/list` only. `agent_commands` takes a folder, which
  must be an existing full path (else home). Residual: that folder's settings and start-up hooks run,
  as starting a session there already would. Model names pass `is_model_name`; command names and
  descriptions pass `command_name` and `one_line` before the webview sees them, since a picked name is
  typed into a terminal.
- **`open_link`**: only `http(s)` with a host, as one argument to the system opener, only on a click.
  The webview never navigates.
- **`agent_auth_status`, `agent_sign_out`**: constant arguments to the agent's own CLI. The host reads
  and keeps no credential file. The account email and plan are shown only in Settings, never logged.
  Signing in is the agent's own command in a terminal session.
- **`start_github_sign_in(machine)`**: a terminal session whose first command is the constant
  `GITHUB_SIGN_IN_COMMAND`. The host reads no code, password or token.
- **`export_daemon_log`**, **`prepare_diagnostics`/`save_diagnostics`**: the webview supplies nothing.
  Diagnostics read only files the host names and never sessions, conversations, settings,
  `config.local.toml` or the environment; everything passes `diagnostics/redact.rs`. Redaction is
  heuristic and the log names folders and sessions, so both settings say to look before sharing. Save
  goes to a path from the host's own dialog; an export never replaces a file.
- **Image paste** (`image_paste.rs`) and **chat attachments** (`attachment.rs`): bytes and paths from
  the webview are untrusted. The type comes from the first bytes, size is capped, a path is followed
  only to a regular file, the copy is owner-only in the app's cache with a cleaned name, a zip is never
  unpacked, and only the app's own prefixed files are swept. `attachments_exist` answers only for its
  own folders. A message stores a path, never bytes. Sending a file is the person's act and is not
  scanned (ADR 0006).

### Processes the daemon starts

- **Agent launchers** (`shim.rs`) sit first on `PATH` in shell panes. `maiker agent-dir` sends only the
  pane's own `AGENT_TERM_ID` and `AGENT_PANE_TOKEN`; a wrong token gets nothing.
- **Login PATH** (`login_path.rs`, unix, daemon only): `$SHELL -ilc` only when `$SHELL` is an absolute
  path to a file (else `/bin/sh`), with no terminal, null stdin and no `AGENT_*` variables. Only output
  between marker words is read and used as PATH entries, never run or logged.
- **Side answers** (`daemon/conversation/side.rs`): only the daemon starts the forked, unsaved
  `claude -p` copy. The session id, folder, program and model come from the daemon's own records (a
  UUID; never a script wrapper; a plain model name). The ask goes on stdin. A question runs with no
  tools or MCP servers; a command comes from a fixed list that takes no argument. Pane and chat
  variables are removed. A followed pane is answered only for the app it is shown in. Concurrency and
  run time are bounded; a failure is reported in the daemon's words.
- **Providers** run in their own process group (a job object on Windows) and are stopped by
  `kill-server`. Groups are recorded in `<socket id>.providers`; the next daemon stops recorded groups
  before restoring, never one whose leader's start time differs, and never ids 0, 1 or negatives.

### Checks

- A check runs as the user when a turn ends, through the user's shell in the worktree, with no stdin
  and no `AGENT_PANE_TOKEN`. Its whole tree is killed on timeout, and with the daemon on Windows (job)
  and Linux (parent-death signal plus `daemon/check/daemon_watch.rs`). Residual: a process that moved
  to its own group escapes; on macOS a check outlives a crashed daemon.
- Its output tail is served only by `Query::CheckOutput` under the read grant, never logged or in the
  snapshot, and may hold secrets. Its staleness tree uses a private index; the user's index is never
  touched.

A repo-supplied command (`.maiker/checks.toml`) never runs until you approve it:

- Your own `[[check]]` for a project wins whole; the repo's file is then not read.
- Approval is per exact command (sha256); a changed command asks again. Never holds whatever the
  command becomes. Once is never saved.
- Answers live in `check-approvals.json` in Maiker's data folder, written atomically. The daemon reads
  it at start and goes by its own copy. An answer is merged into the file as it is; a damaged file is
  left alone.
- `ApproveCheck` and `ForgetCheckApproval` are refused from every pane connection. `ApproveCheck`
  approves only a waiting checkpoint and the sha256 the modal showed. No key press approves alone.
- A repo command or name with a control character is refused. The modal shows the whole command with
  invisible characters spelled out; Once and Always are refused until all of it has been shown.
- An unreadable file runs nothing and reads as could-not-run.
- Overriding a failed check needs the write grant, records time and reason, shows as `Overridden`, and
  covers one result. A pane can never override or undo its own check.
- Residual: a same-user process can edit `check-approvals.json`, and one that hides its pane identity
  is treated as you.

### Consent, secrets and text between agents

- **Helpers.** An agent starts helpers only if you say so. The asker is proven by its pane token.
  `AnswerHelpers` is refused from any pane and accepted only for a held request; the desktop commands
  take only `allow`, `always` or `no`. "Always in this project" lives in `helper-projects.json` in the
  data folder, never the repo. A helper's own prompts still come to you.
- **Chat helpers** (ADR 0016, proposed): the asker is the chat's runtime identity, checked per request;
  `AnswerChatHelpers` is refused from any pane and chat runtime. This consent is cooperative, not a
  sandbox.
- **A chat's Always in this project** (`ConversationAllowAlways`, ADR 0005) is kept in
  `chat-allowed-commands.json` as the project and the hash of the exact command the provider sent.
  Only a human client may send it or `ForgetAllowedCommand`, and only for a command request.
- **Secrets** an agent needs go through `RequestSecret`, answered only by you
  ([ADR 0006](adr/0006-secrets-never-enter-chat.md)). The value stays in memory; a delivered file is
  owner-only and removed within a day or at daemon start. The agent gets a single-use reference that
  expires and works only for the asking pane. The value is never in the snapshot or a log
  (`SecretText` prints `<hidden>`). The label and reason are checked for hidden characters.
- **`maiker handoff`** copies a pane's screen into another agent's prompt, secrets included. It needs
  the read grant on the source and the start grant for the new pane. The brief is quoted with
  `Config::quote_for_shell`.
- **Text sent to an agent** (`maiker send`, MCP `maiker_send`, a `maiker_start` task) is refused when it
  holds invisible or reordering characters (`hidden::is_invisible`). Your own typing is not checked.
- **Pull request comments** reach an agent (`sessions.pr_wake`) as untrusted text: cut, one line,
  withheld if it holds hidden characters, framed as other people's words, capped per commit. `gh` gets
  only a checkout or a validated GitHub pull request address.

### Files on this computer

- Saved pane output and check tails can hold on-screen secrets. They are owner-only
  (`persist::private_dir`, `create_private`; the user's profile on Windows). `[restore] output = false`
  stops saving and deletes them.
- **References** (`references.rs`): MCP `maiker_references` returns paths, never contents. An agent's
  `path` must name a folder in its own project unless `[mcp] scope = "all"`, and is checked by its words
  before the disk is touched; network paths and `..` are refused. Nothing outside the folder is listed
  or removed, a link out is refused, and a link is never written through. A paste that is not one line
  naming a file is not echoed. The folder is kept out of git through `info/exclude`.

### Machines and ssh

- **Config.** `[[machines]]` (with `via`) is read only from `config.local.toml` and refused in the
  synced `config.toml`. Machine-only settings and secrets belong in `config.local.toml`, which config
  sync never uploads. The load refuses a `target` that starts with `-` or holds whitespace or control
  characters, a bad `ssh_args` entry, and a bad `remote_cmd`. `ssh_args` is a list, never split.
- **The ssh line** is built only in `ssh_command.rs`. `BatchMode=yes`, `ForwardAgent=no` and `-a` come
  before `ssh_args` (ssh's first value wins); the host follows `--`. The remote command is POSIX
  single-quoted word by word.
- **Identity stays home.** The pane id and token go only to this computer's daemon. `AGENT_REMOTE`,
  `AGENT_SSH` and `AGENT_REMOTE_CMD` are removed from every pane's environment.
- **`via`** is code the user wrote: an argv list, never a shell line, with the remote command as one
  argument and no ssh options added. Pipes only, its own session on unix, refused on Windows. Only its
  program name is shown and nothing of it is logged.
- **Machines dialog.** The probe and first login use the same checks and hardening. The first login
  (no `BatchMode`) runs in a pane on this computer, only for a login that needs a person (ADR 0017).
  Words it cannot write as a plain or single-quoted word are refused, not escaped. The dialog writes
  only `config.local.toml`, after `validate_machines`.
- **Sending a file or image** (`remote_image.rs`, `send_file.rs`, ADR 0007) runs the fixed
  `PASTE_SCRIPT` over the hardened line with the bytes on stdin. This computer chooses a cleaned name,
  checked again by the script. A file is read only when the person names it. Size and time are capped;
  the far copy is owner-only and expires; the returned path is taken only in the checked shape.
- **`maiker machine update`** runs the constant `INSTALL_SCRIPT`; arguments are positional, never part
  of the script text. The binary goes on stdin, is checked and run (`--version`) before it replaces the
  old one, and no process is signalled. A release fetched for another platform is checksum-checked and
  its archive listed before it is unpacked; nothing fetched runs here. Install, replace and downgrade
  each need an explicit yes. A Windows machine is refused as a remote.
- **`maiker update`** replaces the program only when `sha256sums.txt` is signed by the built-in release
  key, the download matches, and its `--version` names the release. Releases before 0.71.0, the
  installers and the fetch for another machine are checked by checksum only.
- **Reconnecting never starts a daemon** (`proxy --attach-only`); only the first connection and a
  person's retry may. `--on`, MCP and `doctor` are attach-only. Typing for a down machine is dropped.
- **ssh's words are untrusted.** They are cleaned and cut before display, and failures are classified
  by exit status and fixed tokens (`link_failure::classify`). Maiker never sees, asks for, stores or
  logs a password. Fix commands come from `link_failure::fix_command`, only for a plain target. A
  changed host key is refused, never accepted.
- **`maiker doctor`** uses the same lines plus `WHERE_SCRIPT`, cleans every answer, and shows no PATH
  and only a key's file name.
- **The daemon id** detects a different daemon at a saved name. It is not authentication or a secret.
  A daemon with no id at a name that had one is refused. Only an 8-character prefix is shown or logged.

### Messages from another machine

A remote daemon is someone else's computer, so everything it sends is untrusted
(`remote_policy.rs`, `remote_snapshot.rs`):

- **Clean on ingest.** Every string in a `State` or `TermsChanged` is cleaned (text blocks keep line
  breaks); lists, sizes and numbers are bounded; an oversized or non-finite snapshot is refused whole
  and the last good one stays. The walk is over the serialized value, so a new field is cleaned
  unlisted. A remote path is a label, never used on this computer's disk (`App::local_cwd` is `None`;
  `guard_local` refuses file and git features). A toast leads with `[machine]`. Nothing from a remote
  is logged above debug, and then only a fixed reason.
- **Decide every message.** `remote_policy::allow` names every `ServerMsg` variant with no wildcard,
  and a test table pins the verdicts. A variant nobody can justify is ignored. This computer's own
  daemon is not subject to it.

| Message from another machine | Verdict | Why |
| --- | --- | --- |
| `Welcome`, `Bye`, `Replay`, `Output` | apply | affect only that machine's connection and screens |
| `State`, `TermsChanged` | apply, cleaned | update only that machine's snapshot; this computer's first-state, restart and alert work never runs for it |
| `Attention` | apply | sound only with `sounds`, toast only with `notices` |
| `Clipboard` | gated by `clipboard` (on unless `false`) | bounded; the toast names the machine |
| `Notice`, `Raise` | gated by `notices` | a cleaned toast, never this computer's undo hint |
| `Error`, `Reply` | answer, cleaned | only while a request to that machine is unanswered; a `List` is checked like a `State`; a `Worktrees` reply never fills this computer's picker |
| `Reply::ClosedSessions`, `Reply::PullRequests` | answer, cleaned | bounded; a PR address must be exactly a GitHub pull request address |
| `Reply::SideAnswer` | ignore on the attached line | taken only on a request line through `remote_chat::vet_side_answer` |
| `AskRemoveWorktree`, `AutoWorkspace`, `Reply::SavedConversations`, `ImportableChats`, `ClosedFolderReady`, `WorktreesTidied` | ignore | local-only features; a remote folder would name this computer's disk (ADR 0007) |

The opt-ins are read from the machine's `[[machines]]` entry by name; a machine no entry names has
all of them off.

### The desktop app and other machines

The webview never connects to a machine or starts `ssh` ([ADR 0007](adr/0007-multiple-machines.md)).
The host holds every connection, runs the same `remote_policy` checks (`hub.rs`), and offers commands
that take a machine's name or a pane number, never a program or path; `target`, `ssh_args`,
`remote_cmd` and `via` stay in the host.

- Adding a machine runs the loader's checks, then the shared no-prompt probe; the entry is written only
  if that held.
- File and repository features are refused for a remote pane by the window and the host. A machine may
  be asked only for changes and a diff (`remote_repo::may_ask`, `vet_repo_reply`); the diff is shown as
  text, never run or written.
- Fetch, pull, push, commit, Create PR and discard take a word, a pane number and the commit's message,
  file names or one path. That daemon checks them and runs its own git and `gh`. Answers pass
  `vet_git_reply` or `vet_discard_reply`; a PR answer must be exactly a GitHub pull request address.
- Nothing installs, updates or restarts anything on a machine except a person's click or chosen step
  (`install_helper`, the same `maiker machine update --install`).
- A different daemon at a known name is refused.

## Project-specific: auth and permissions

No user accounts. Access to the daemon is access to its local socket (a named pipe on Windows, a
per-user Unix socket elsewhere, `maitty-<user>-<label>.sock`), which stays limited to the user who
started it. Status reports (`maiker hook`) are accepted only from a process inside the pane or one
carrying that pane's `AGENT_PANE_TOKEN`. Remote work goes over the user's own `ssh`.

With `restore.keep_running` on, the pane host's socket (`<socket_id>-panes`) is limited to the user
the same way. The host takes orders from whoever connects and does none of the daemon's per-pane
checks: it starts, writes to and ends panes on request. Only the daemon should connect, but a
program running as the user, a pane's included, can reach it, as it can reach the user's own files
and processes. The host passes no handle out, reads no config, and logs no pane input or output.

Every query below is for a person's client only; a pane, an agent or a structured runtime is refused.
git runs with `GIT_TERMINAL_PROMPT=0` and `gh` with prompts off, so neither asks for a credential; the
daemon reads, stores and logs no token.

- **Cloning** (`Query::CloneRepo`, `daemon/clone.rs`): only an `https://`, `ssh://`, `git://` or
  `user@host:path` address, bounded, with no whitespace, control character or leading `-`, passed after
  `--`. Local paths, `file://`, `http://` and `ext::` are refused.
- **Git identities** (`Query::GitIdentities`, `Query::GitIdentityRule`): reading follows only Maiker's
  own `git-identities` files. A rule writes only one `includeIf` entry and one file of Maiker's, with a
  checked GitHub login (`is_login`) in its `gh auth token` helper and no token. The person sees the
  exact lines first. A rule set outside Maiker is never replaced or removed.
- **Changing a checkout** (`Query::Git`): fetch, fast-forward pull, push, commit, open a PR. Only a
  commit message and relative paths (no `..`, `.git` part, leading `-` or control character, read
  literally) come from the client. Nothing merges, rebases, forces or amends.
- **Discarding a file's changes** (`Query::DiscardFile`; `maitty_shared::discard`, used by
  `daemon/discard.rs` and the host's `changes.rs`) is the model for any git operation that removes or
  overwrites a file a client names:
  - It needs the pane checks and write grant of `Query::Git`.
  - `checked_path` refuses, by text alone, anything but one relative `/` path inside the repository: no
    `..`, `\`, `:`, control character or leading `-`, and no part that is `.git` in any spelling Windows
    accepts.
  - No folder on the way may be a link (`symlink_metadata`); a folder is refused; a link as the file is
    removed as a link.
  - git's own status decides the kind, never the client. One file only, never `git clean`. Anything but
    a plain change, new file, untracked file or staged rename is refused with a typed `DiscardError`.
  - git gets `--literal-pathspecs` and the path after `--`.
  - Not covered: the steps are not atomic, no lock is held against an agent, nothing is kept.
- **GitHub** (`Query::GitHubAccounts`, `GitHubRepos`, `GitHubOwners`, `PullRequests`): fixed `gh`
  arguments; `--show-token` is never passed. Only logins leave, checked by `is_login` here and again
  from a machine. An owner passes `is_login`; a search is plain characters with no `:` (so no qualifier
  widens it), after `--`. A clone address is rebuilt from a checked `owner/name` (`clone_address`). A
  project's folder is only where `gh` runs. A PR is kept only with an exact GitHub pull request address.
  Nothing `gh` prints is logged.
- **Extensions** (`Query::Extensions`, `daemon/extensions/`) install code that runs with the person's
  access, so the daemon asks first. An add needs the one-time token its preview returned. The preview
  shows source, scope and exactly what will run (read as data, never executed), with "This runs code on
  your computer with your access", Cancel focused, and no "trust always". Lists read files; `claude mcp
  list` is never called. Removals take only a listed item, never through a link; Codex's `config.toml`
  is edited in place with `toml_edit`. No keys, headers or bearer tokens are taken. Not yet run on
  Windows or against a live plugin from the internet.
- **Specialists** (`Query::Specialists`, ADR 0010) read only the fixed agent folders, need read access
  to the pane, write nothing, and are bounded and cleaned.
- **One-shot commands** (`--on`, `--pane`) clean what a machine answers; `read --raw` is the person's
  choice. The Hello to another machine carries no pane id or token. `kill-server --on` needs `--yes`.

**MCP across machines** (`cli/mcp/machines.rs`). The far machine cannot see which pane calls, so:
(1) a machine is reachable only with `mcp = true` (`machine_not_enabled`, never dialled);
(2) this computer's daemon first decides the calling pane's grant as for the same tool here
(`Reach::caller_may`), and anything unexpected, silence included, is `permission_denied`; (3) no pane
id or token is sent; (4) replies are cleaned, bounded and prefixed `[machine: name]`; (5) answering,
interrupting and starting are `unsupported_for_remote`. `[mcp] scope` limits only this computer.

## Project-specific: tooling

- Bundled Herdr detection rules are pinned to a reviewed commit (`vendor/herdr-detection/NOTICE.md`);
  no remote rules are downloaded or run. Native adapters call Maiker with an argument array and forward
  no prompt or answer text. Setup refuses non-regular owned-file targets and keeps unowned hooks.
- `maiker integrate` changes only Maiker's own entries in installed agents' configs, backs up a changed
  file once to `<file>.maitty-bak`, and only warns on failure. `AGENT_NO_INTEGRATE=1` skips it.
- `cargo audit` runs before releases; GitHub push protection guards secrets. The audit is not in CI.

## Project-specific: usage store

It holds counts, cost and time with agent, folder name and session id; no prompts, output, paths or
secrets. The file is owner-only. `Query::UsageReport` is human-only. A hook report never carries a
tool's input, only a one-way fingerprint (`call`) that is never logged.

## Project-specific: leftover ticket files

The daemon removes `<data dir>/ticket-keys/` and `<data dir>/ticket-links.json` on start
(`daemon/leftover_tickets.rs`, ADR 0013): only those two names in `config::data_dir()`, never through
a link (a link is left and logged), never stopping the daemon. A failure logs the path, never
contents. The keychain is never touched.

## Project-specific: saved workspaces

`Command::SaveWorkspace` and `Query::Workspace` are human-only. A save is untrusted: folders absolute
and bounded, names cleaned, worktree pairs consistent, counts capped. Saving runs nothing; reopening
follows the closed-session rules. The file is owner-only. Another machine's answer is ignored.

## Project-specific: closed sessions

- The list holds agent, conversation id, folder, branch, name and time; no prompts, output or secrets.
  Owner-only. `Query::ClosedSessions` is human-only.
- `ReopenClosedSession` and `ReadyClosedFolder` are human-only, go to this computer's daemon only, and
  name an entry the daemon keeps, never a path, branch or command. The command is the agent's own
  resume template with a plain conversation id (checked again by `resumeWords`). A remade worktree
  never overwrites anything.
- On another machine only `BranchWorktree` and a bare `NewWorktree` make a worktree; both need that
  daemon's `Start` grant and take back only a plain folder or a cleaned `List`
  (`vet_worktree_reply`, `vet_new_worktree_reply`).
- A remote chat start names a provider or ACP agent name, a plain absolute folder and a posture, never
  a program, argument or variable; only its number and generation come back (`vet_chat_start`). An ACP
  saved session loads on this computer only.

## Project-specific: followed transcripts

A transcript path comes from a hook report, so it is input
([ADR 0003](adr/0003-status-and-conversation-trust.md)):

- It is read only if its real path is a regular `.jsonl` file in the home folder named for the reported
  session.
- Only a hook-verified, desktop-owned pane running `claude` or `codex` is followed; a new session needs
  the verified hook again.
- Reads are bounded, off the event loop, read-only, cleaned like structured history, and never change a
  status. The text is never cached, logged or put in a fixture.
- A helper's record (`Query::HelperRead`) is human-only, for a shown pane and a helper its verified
  reports listed. Its file is derived from the checked transcript, never from the request.

## Project-specific: chat sessions started from the desktop

- **Posture.** `start_chat_session` takes one boolean, `full_access`, sent explicitly by a labelled,
  warned checkbox. Default: workspace write with approval on request and no auto-approve; full access
  is the provider's skip-permissions mode (ADR 0005), default on while the agent's **Bypass
  Permissions** switch is on. A full-access chat always shows it. `ConversationSetPermissions` is
  human-only with the admin grant and only the start postures. Maiker never widens a session itself.
- **Bypass flag.** The switch adds the agent's plain `-` flag to agents Maiker starts in a terminal; a
  resume keeps it only when the session had it and the switch is still on.
- **Where it runs.** A project the app shows or a person picked (`may_name_checkout`). A branch start
  needs a valid branch, and the daemon makes the worktree. The window builds no path and runs no git.
- **An ACP agent's program** comes only from the user's config (`[[agents]]` with `acp = true`); its
  `env` cannot set identity variables and is never logged ([stack/acp.md](stack/acp.md)).
- Status comes only from current-generation daemon events. Answers are human-only and bound to the
  exact request. User-input answers are relayed once, typed hidden, never recorded. Closing stops the
  agent first. Secret masking is the daemon's.

## Project-specific: cloning a repository from the desktop

- A pasted link is read as an owner and repo of plain characters (`repoAddress.ts`, `repoUrl.ts`) and
  the address is rebuilt from them, so a user name or token is refused, never cloned or shown. The
  daemon's own check decides.
- The target is a new folder inside an existing one; only `~/Projects` is created if missing.
- Git uses the machine's existing credentials. Maiker stores no GitHub token.
- Folders are listed and made only by that machine's daemon (`Query::ListFolders`).

## Project-specific: signing an agent in from the desktop

`Query::AgentSignIn` (`daemon/agent_sign_in.rs`) runs the agent's own login with constant arguments:

- The window sends only the agent and `Start`, `Cancel` or `Read`. Nothing printed is run or written.
- Only a link (`https://`, a host, no user name) and a short code leave; anything else is dropped. The
  link opens through `open_link`.
- No credential passes through Maiker. Output is scanned once and dropped; nothing is logged.
- One login per agent, bounded, killed on cancel. Human-only; another machine's reply is ignored.
- Claude's paste-a-code flow is not supported: a code in a text box would be a credential (ADR 0006).
- GitHub runs `gh auth login --web` with `GH_PROMPT_DISABLED=1`; only the code and device address are
  kept, `gh` keeps the token, and `gh auth status`'s text is not read. Sign-out passes only a login `gh`
  reported and `is_login` checked.

## Project-specific: a folder's branches and what a machine is

`Query::FolderGit` and `Query::MachineFacts` are human-only; another machine's reply is cleaned.

- The folder must be absolute (or `~`) and exist. A branch passes `repo::is_branch_name`; a remote
  branch must already be fetched. Nothing fetches, pushes or deletes.
- Machine facts are system, architecture, cores, host name and version-like agent `--version` lines.
  No path, environment, account or token.

## Project-specific: installing an agent from the desktop

`install_agent` (`agent_install.rs`) runs an agent's documented install, which runs remote code as the
person:

- The window sends only an agent name. The command comes from an allowlist in code (fixed `https://`
  vendor scripts or two fixed npm packages), checked again before it runs. A new agent or host needs a
  code change and a line here.
- The exact command is shown before asking (`agent_install_command`).
- No shell line is built from input; nothing is interpolated.
- Never elevated. One at a time, bounded, no input; output is cleaned and never run or stored.
- Copilot is not supported (ADR 0005).
- Limits: vendor scripts are trusted as far as their domains; no checksum.

## Project-specific: installing an agent from the ACP registry

`maiker agents install <id>` (`acp_registry.rs`, ADR 0021) installs from a registry fetched at run
time, so the registry is untrusted:

- One `https://` index address, fixed in the source. Only an id comes in (`acp_agent_name`).
- Every entry is checked before listing (shapes, plain `https://` downloads, a program inside the
  agent's folder, bounded arguments, no identity variable); a failing entry is left out.
- A download installs only with a registry SHA-256, checked before unpacking.
- An archive with an absolute or `..` entry is refused whole.
- npm installs an exact version into the agent's folder and its `package.json` must match; its install
  scripts run.
- Never elevated; writes only under `acp-agents/`; bounded; staged and swapped in only when every
  check passed.
- Limits: the registry and publishers are trusted; the checksum proves identity, not safety.

## Project-specific: the message the daemon sends by itself

With `restore.continue_turn` on (off by default), the daemon sends a constant message
(`continue_turn.rs`) only to a structured conversation that was mid-turn when it stopped and that it
resumed this start, only after the resume succeeded, through the normal send path. It is rate-limited
per conversation, counted in the session file before sending. It answers no approval or question,
starts nothing and changes no posture.

## Project-specific: structured history cache boundary

- The cache is owner-only and keeps native ids out of file names. Pages are sensitive, never
  diagnostics. Disabling it deletes only Maiker's socket-scoped history root, never native history.
  No credentials, real transcripts or model requests enter fixtures.
- Only current daemon-owned provider events enter history. Raw provider objects and params are not
  kept. Only the plain summary of reasoning or thinking is kept, masked; encrypted content is not.
- A tool call's `input` leaves only in an authorized read and the private cache, cleaned and bounded
  (`tool_input.rs`), with secrets masked. Answered approvals keep command and diff in memory only;
  user-input answers are not kept.
- Grants: start needs start, send and cancel need write, read needs read, approval answers need
  respond; no self exemption. Structured runtimes cannot answer approvals. An approval is bound to its
  exact request id, generation and connection; unknown kinds stay unanswered. File-change approval waits
  until the diff is shown. User-input answers must match the shown choices and hold no hidden
  characters. Cancel is human-only. Generation and connection fence every event.
- A queued message is in memory only and passes the same admission checks as a send. Native
  profile-v2 and ambiguous identity are refused. A permission request without controls stays
  unanswered. MCP references revalidate read authority before touching files.
- Persist metadata intent before submitting and the native acknowledgement before reporting success.
  Never retry a possibly delivered prompt. Prompt text and environment never enter the metadata ledger
  or diagnostics. An unpersisted acknowledgement reads as uncertain.
- Structured tools authenticate with a daemon-minted secret bound to conversation, generation and
  connection. Strip inherited credentials before launch. Never persist the secret, copy a pane token,
  accept a partial claim, or treat a rejected claim as a person. A runtime starts only helpers, after
  the person's answer (ADR 0016, proposed). Claude and Codex chats get the same four identity variables.
- Codex MCP allowlists get the four identity variable names appended (no values). Refuse custom
  environment policy and reserved-variable conflicts before a thread starts.

### Conversation history and secrets

Everything stored and served as history passes `redact_entry` (`maitty-provider/src/redact.rs`) on the
way into the store and when a cache loads. It changes only Maiker's copy; the agent sees what it sent.

- **Masked** (`[redacted]`): known token and key shapes, private key blocks, auth headers, URL
  passwords, and values of secret-named keys. Placeholders, paths and code references are left alone.
- **Omitted** (`[content of a secret file omitted]`, keeping path and size): contents and diffs of
  secret files (`.env*`, keys, credential files, anything under `.aws`, `.ssh` or `.gnupg`) and the
  output of commands that print them. The lists live in `redact.rs`.
- **Limits.** Masking is best-effort. It misses secrets with no known shape or telling name, split
  secrets and secret files with ordinary names, and may hide a non-secret. History stays sensitive: it
  reaches any client with a read grant. The functions never log or return what matched.

## Project-specific: terminal output socket

The desktop host sends terminal output to its window over a WebSocket
([ADR 0004](adr/0004-client-split-and-desktop-host.md)), treated like a credential:

- Loopback only. A one-time, short-lived 256-bit token (`open_terminal_socket`) is sent first and
  compared in constant time; it is never in the address or a log.
- `Origin` must be the app's own (plus the dev server in a debug build).
- Unproven connections and queued frames are bounded; one window at a time. CSP `connect-src` allows
  only `ws://127.0.0.1:*`.

## Project-specific: editing a project file (markdown viewer)

- Markdown is drawn by `features/chat/markdown.ts` as elements, never HTML; only `http(s)` links are
  kept; images are not loaded. A `.md` link is followed only inside the project (`documentPaths.ts`).
- `Command::SaveFile` goes through the pane's own daemon, which applies the read jail (relative, no
  `..`, no links, not under `.git`), writes only an existing plain file, bounded, atomically, and
  refuses with `ChangedOnDisk` when the file changed. Agent clients cannot send it.
- On another machine only markdown is saved (`remote_repo::may_save`, checked there too), and replies
  are vetted (`vet_save_reply`); a fetched document is read-only.
- The window skips the version check only after the person pressed Overwrite.
- Not covered: a change between the last check and the rename.

## Project-specific: remote machine logins from the desktop

Settings > Remote machines (`add_machine.rs`, `machine_target.rs`, `new_host_keys.rs`) takes no
account password; a login that needs one uses the terminal sign-in
([ADR 0017](adr/0017-remote-machines-rely-on-your-ssh-setup.md)).

- User, host and port are checked in the host (`machine_target`); the target is always after `--`.
- A key file is an existing absolute path, not `.pub`, passed as one `-i` argument, never opened by
  Maiker, and refused with `via`.
- Reach is a plain TCP connect; the key name is only the file name ssh reports.

Host keys:

- Unattended lines add `StrictHostKeyChecking=accept-new` after `ssh_args`, only when `ssh -G` shows
  the default `ask` and the client is OpenSSH 7.6 or later. Accepted risk: the first connection trusts
  whatever key answers. Maiker shows no fingerprint and never writes `known_hosts`.
- `StrictHostKeyChecking=no` is never used; tests pin this.
- A machine whose key was refused while adding is not written. A changed key is never offered for
  trust.
- An unknown key under a strict config (`HostKeyUnknown`) never suggests `ssh-keygen -R`; it gives
  `ssh -o StrictHostKeyChecking=ask <target>` for the person to run.
- The terminal sign-in line adds no host-key setting.
