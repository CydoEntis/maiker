# Spec: sign in to an agent from the chat

Type: feature · Status: built for Claude and Codex (protocol 111), Gemini declined · Ticket: MAITTY-417 · Date: 2026-11-16

`/login` in a Claude chat and Sign in in Settings › Accounts used to open an agent terminal
session. Now the daemon runs the agent's own login in the background and the window shows a card:
the link and one-time code the command printed, Open link, Copy code, Cancel, then Signed in or
why it did not end.

## Spike: what each command line does without a terminal

Run on 2026-11-16 in an isolated config (`CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `HOME` set to an
empty temp folder; the real `~/.claude`, `~/.codex` and `~/.gemini` were never touched). Stdin was
`/dev/null` and nothing was a TTY. No sign-in was completed and no token was read or stored.
Claude Code 2.1.326, Codex CLI 0.166.0.

| | `claude auth login` | `codex login --device-auth` | `codex login` (browser) |
| --- | --- | --- | --- |
| Works with no TTY | yes | yes | yes |
| Prints | `Opening browser to sign in…`, `If the browser didn't open, visit: <https URL>`, `Paste code here if prompted >` | a banner, `<https URL>`, then `Enter this one-time code (expires in 15 minutes)` and the code on the next line, with ANSI colours even into a pipe | `Starting local login server on http://localhost:1455.` and an https URL |
| Waits for the browser | yes, until the sign-in completes or it is killed | yes | yes |
| Opens the browser itself | yes (the opener, `BROWSER` on Linux, was given a different URL whose `redirect_uri` is `http://localhost:<port>/callback`; the command listens on that port) | no | yes, and listens on `127.0.0.1:1455` |
| Cancel | SIGINT or SIGTERM ends it (exit 143 for TERM); closing stdin does not | SIGINT ends it, exit 130 | killed |
| Exit code | not observed on success (a real sign-in was out of scope) | not observed on success | not observed on success |

Status commands, both fine with no TTY:

| | Command | Signed out | Signed in |
| --- | --- | --- | --- |
| Claude | `claude auth status --json` | exit 1, JSON `{"loggedIn": false, …}` | JSON with `loggedIn: true` (read by `agent_auth.rs` today; not seen signed in here) |
| Codex | `codex login status` | exit 1, `Not logged in` | a line starting `Logged in` (the existing host code relies on it; not seen here) |

Other facts: Codex writes a `WARNING` line to stderr when `CODEX_HOME` is under a temp folder.
`codex logout` signed out has exit 0. Gemini CLI is not installed on the machine used, so it was
not run.

### What this decides

- **Claude and Codex can be driven without a TTY.** No embedded terminal pane is needed.
- **Codex runs `--device-auth`**: it works on any computer, prints a code, and needs no callback
  server on port 1455. The browser flow is not used.
- **Claude's printed link is the paste-a-code one.** The address the command opens in the
  browser (callback to its own `localhost` port) is never printed. On the computer the daemon runs
  on, the command opens the browser and finishes on its own, which is the supported path. If a
  person opens the printed link instead, the page ends by showing a code to paste back into the
  command, and nothing in the window can send it. The card says so and Settings offers "Use a
  terminal". Passing a pasted code through the window would put a short-lived credential in a
  text box and is out of scope (ADR 0006).
- **Gemini is declined.** Its command line has no sign-in command (from its documentation, not
  verified here: it asks on first run inside its terminal, or reads an API key from the
  environment). The daemon answers `Failed(Unsupported)` and the card says to sign in in a
  terminal. Revisit if Gemini CLI gains `auth login`.
- Success is **never inferred from the login's exit code alone**. A login that exits 0 is followed
  by the agent's own status command; only that says signed in.

## Behaviour

- `Query::AgentSignIn { agent, request, tag }` with `request` one of `Start`, `Cancel`, `Read`;
  the answer is `Reply::AgentSignIn { tag, agent, state }`. The window polls `Read` every
  1.5 seconds while `state` is `Waiting`.
- `state` is `Idle`, `Waiting { link, code }`, `SignedIn` or `Failed(reason)`; the reasons are
  `NotInstalled`, `Unsupported`, `CouldNotStart`, `TimedOut` and `Ended`.
- One login at a time per agent: `Start` while one runs answers with that one. A login that is
  not finished in 15 minutes (Codex's code lifetime) is killed and ends `TimedOut`.
- The daemon owns the process (`daemon/agent_sign_in.rs`). Closing the window leaves the login
  to end at its limit; Cancel kills it and forgets it.
- Human clients only. An agent's connection is refused.
- Only the desktop uses it, and only for this computer's daemon; another machine's answer is
  ignored (`remote_policy`).

## What the window shows

`SignInCard` (`apps/gui/src/features/signin/`), above the message box in a Claude chat when
`/login` is typed or picked, and above the Accounts card in Settings › Permissions (Agents):

| State | Card |
| --- | --- |
| Waiting, nothing printed yet | "Starting Claude's sign-in…", Cancel |
| Waiting, link and/or code | The link's host, Open link, the code in a copyable box, Copy code, Cancel |
| Signed in | "Signed in to <agent>." Done. Settings re-checks the account |
| Failed | The reason in plain words, Try again (not for not installed or unsupported), Close |

`/logout` stays terminal-only; Settings still signs out with the agent's own command.

## Safety (ADR 0006)

See [SECURITY](../../SECURITY.md#project-specific-signing-an-agent-in-from-the-desktop).

## Not done

- GitHub's sign-in in the Tickets page still says "Open terminal" (`gh auth login`); it is not
  an agent and has its own path (`start_github_sign_in`).
- Signing in on another machine over SSH.
- Passing a pasted code to Claude's command.
- Checked against a real sign-in: no. The fake-CLI tests cover the daemon logic; the printed
  formats above were captured from the real commands.
