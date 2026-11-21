# 0018. The chat view talks to the agent directly, never through a terminal

- **Status:** Proposed
- **Date:** 2026-11-21

## Context

The desktop app is in the Chat view or the Terminal view. A session started from New session in
the Chat view is the agent's own terminal program, and its chat is read from the agent's hooks
and files. Whatever the agent draws only on its terminal never reaches that chat: an update
menu, the trust-folder question, a sign-in. The chat then stays empty, says the agent is waiting
in the terminal, and sends the person to a terminal log they did not ask for. Hooks from another
installed version leave it empty too.

The daemon already owns structured conversations that have no terminal: Codex and Claude Code
through their own adapters (0005, 0016) and any other agent over ACP (0017). The Chat view
reaches them only from a shell's "Start a chat here".

## Decision

- **A session is a chat or a terminal for its whole life.** A chat is a structured conversation
  the daemon owns. A terminal is the agent's own program in a pane.
- **Everything the Chat view starts is a chat.** New session, resuming a saved conversation and
  a start on another machine open a structured conversation: Codex and Claude Code through
  their own adapters, every other agent over ACP. An agent with neither cannot be started from
  the Chat view, and the app says so.
- **The Terminal view is unchanged.** It starts the agent's own program and never a chat.
- **One setting chooses the view for the whole app.** It decides what a new session is. Sessions
  that are already open stay what they were started as and stay listed: a chat is shown as a
  chat and a terminal as a terminal in either view. No control on a session moves it between
  the two.
- **A chat has no terminal log.** What an agent needs from the person (an approval, a sign-in, a
  question) arrives as a structured event and is shown in the chat, or the chat says plainly
  what to do outside it.

## Alternatives considered

- **Keep the terminal and show its menus in the chat**: read the agent's screen and draw its
  update and trust questions as buttons. It lost because it means recognising each agent's
  screens by their text, which breaks with every release of every agent.
- **Run every agent over ACP in the Chat view**: one path. It lost for the reasons in 0017: the
  native adapters carry more and are the ones verified here.
- **Keep one session with two views**: the same session shown as a chat or its terminal. It lost
  because the chat half is only as good as what hooks report, and the person cannot tell which
  half they are relying on.
- **Hide the other kind when the setting changes**: a tidier list. It lost because a running
  agent must never drop out of sight (the mission: never lose or misreport an agent).

## Consequences

- No update menu, trust question or "waiting in the terminal" line in a chat, and no dependence
  on hooks for a session started in the Chat view.
- A chat cannot be opened as a terminal later, and a terminal session cannot become a chat. A
  saved conversation can still be resumed as either, from the view that is on.
- The structured start has to carry what the New session draft offers: a first message, a
  model, an effort, a permission mode, a name, a branch or worktree, and another machine.
- Showing a terminal agent as a chat from its hooks stays only for sessions started in the
  Terminal view or outside the app; whether that stays at all is a later decision.
- Gemini gets a chat only over ACP, so it starts from the Chat view only where the config has
  an ACP entry for it. Installing ACP agents for the person is a later change.
- `docs/UI.md` changes with each ticket that lands: it still describes a session with a chat and
  a terminal log.
