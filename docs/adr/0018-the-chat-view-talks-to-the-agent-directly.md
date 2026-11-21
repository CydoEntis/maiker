# 0018. Every chat in the chat view runs over ACP, never through a terminal

- **Status:** Proposed
- **Date:** 2026-11-21

## Context

The desktop app is in the Chat view or the Terminal view. A session started from New session in
the Chat view was the agent's own terminal program, and its chat was read from the agent's hooks
and files. Whatever the agent draws only on its terminal never reached that chat: an update
menu, the trust-folder question, a sign-in. The chat then stayed empty, said the agent was
waiting in the terminal, and sent the person to a terminal log they did not ask for.

The daemon runs an agent as a chat with no terminal in two ways: Codex and Claude Code through
adapters written for each (0005, 0016), and any agent over ACP (0017). Two ways meant two sets
of behaviour in one view: a feature worked in one agent's chat and not in another's, and each
agent's own commands had to be rebuilt by hand. The owner decided the Chat view has one way.

## Decision

- **A session is a chat or a terminal for its whole life.** A chat is a structured conversation
  the daemon owns. A terminal is the agent's own program in a pane.
- **Everything the Chat view starts is a chat over ACP.** Every agent, Claude Code and Codex
  included. This replaces the first rule of 0017 ("ACP only where there is no native adapter").
  An agent with no ACP mode of its own (Claude Code, Codex) is run through its ACP helper
  program; the daemon knows each helper by name and the config can name another.
- **The Terminal view is unchanged.** It starts the agent's own program and never a chat.
- **One setting chooses the view for the whole app.** It decides what a new session is. Sessions
  that are already open stay what they were started as and stay listed: a chat is shown as a
  chat and a terminal as a terminal in either view. No control on a session moves it between
  the two.
- **A chat has no terminal log.** What an agent needs from the person (an approval, a sign-in, a
  question) arrives as a structured event and is shown in the chat, or the chat says plainly
  what to do outside it.
- **The agent's own settings decide its model and what it may do.** Maiker sends neither when it
  starts a chat over ACP, and never moves a session to a wider mode (0005, 0017).

## Alternatives considered

- **Keep the terminal and show its menus in the chat**: read the agent's screen and draw its
  update and trust questions as buttons. It lost because it means recognising each agent's
  screens by their text, which breaks with every release of every agent.
- **Claude Code and Codex through their own adapters, the rest over ACP**: the native adapters
  carry more (steering, remembered approvals, file previews) and are verified here. It lost
  because the owner wants one behaviour for every agent in the Chat view, and each native
  feature had to be rebuilt for the others or hidden.
- **Keep one session with two views**: the same session shown as a chat or its terminal. It lost
  because the chat half is only as good as what hooks report, and the person cannot tell which
  half they are relying on.
- **Hide the other kind when the setting changes**: a tidier list. It lost because a running
  agent must never drop out of sight (the mission: never lose or misreport an agent).

## Consequences

- No update menu, trust question or "waiting in the terminal" line in a chat, and no dependence
  on hooks for a session started in the Chat view.
- Claude Code and Codex chats need their ACP helper installed (a Node program each). Without it
  the start fails and says which program is missing.
- A chat over ACP has what the agent offers over ACP and no more: no steering, no remembered
  approvals, no side question, and no model, effort or permission picker until the daemon reads
  and sets the agent's ACP options.
- The native Claude Code and Codex adapters stay in the daemon for chats already started with
  them and for the CLI; whether they are removed is a later decision.
- A chat cannot be opened as a terminal later, and a terminal session cannot become a chat.
- Resuming a saved conversation and starting on another machine still open the agent's own
  session until the ACP start carries them.
- Showing a terminal agent as a chat from its hooks stays only for sessions started in the
  Terminal view or outside the app; whether that stays at all is a later decision.
