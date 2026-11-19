# UI

This doc covers how the user interface is structured and built.
`AGENTS.md` is the operating contract; this doc holds the UI practices in depth.

**Delete this doc if the project has no user interface,** and remove its row
from `AGENTS.md`. Game menus and HUDs count as a user interface.

## Component structure

```text
components/ui/           primitives: button, input, dialog (design-system level, no domain knowledge)
components/              shared composites used by 2+ features
features/<f>/components/ feature components that know the domain
app/ or routes/          pages/screens: compose features, own layout and routing
```

- Primitives know nothing about the domain. Feature components know nothing
  about routing.
- Keep components small and focused. When one component fetches, transforms,
  and renders, move the fetching and transforming into a hook or service and
  keep the component for rendering.
- Pass data down and events up. Avoid prop drilling deeper than about three
  levels. Composition (`children`, slots) usually solves it before context does.
- Keep business rules out of components. They call feature hooks and services.

## State

| Kind | Examples | Where it lives |
| --- | --- | --- |
| Server state | records from the API or database | a query and cache layer, not a global store |
| URL state | filters, tabs, selected id, pagination | the URL, so it survives reload and can be shared |
| Form state | field values, touched, errors | the form library |
| Local UI state | open/closed, hover, draft text | component state |
| Shared UI state | theme, sidebar, current modal | a small store, only when several distant components need it |

- Derive values during render. Don't copy them into state and sync them with
  effects.
- Put state in the lowest component that needs it.

## Async states

Every view that loads data deliberately renders each state that applies:

- **Loading:** a skeleton or spinner that holds the layout, with no content
  jumping when data arrives.
- **Empty:** says what would appear here and, where there is one, the action
  that creates it.
- **Error:** says what failed in plain language and offers a retry. It never
  shows a raw error message.
- **Success.**
- **Partial or stale**, where it applies: refetching and optimistic states.

A mutation shows that it is pending, blocks double submission, and reports the
outcome.

## Forms

- Validate with the same schema the API uses, where possible.
- Show errors next to the field they belong to, after the user interacts with
  it. Show a form-level error for server failures.
- Disable submit while the form is submitting. Keep the user's input when a
  submission fails.

## Accessibility checklist

- The feature works with the keyboard alone, and focus order follows visual
  order.
- Focus is always visible. Dialogs trap focus and return it to the trigger when
  they close.
- Use semantic elements: a `button` for actions and an `a` for navigation. A
  clickable `div` is a defect.
- Every control has an accessible name. Every input has a label.
- Color is never the only signal, and text contrast meets WCAG AA.
- Status and errors are announced without stealing focus.
- Honour `prefers-reduced-motion`, and the in-app Reduce motion setting through
  `:root[data-reduced-motion="true"]` (never `:root:has(...)`, which is re-evaluated on every DOM change).
- Motion is cheap on a software painter ([PERFORMANCE](PERFORMANCE.md)): transform and opacity only, no blurred
  shadow on what comes and goes with the pointer (use `--pop-sh-flat`), infinite loops pause under
  `:root[data-window="inactive"]`, and a hover that only shows something (the sidebar's card) lives in a store outside
  React state (`HoverController`), so it never draws the rows. Under `data-gpu="software"` popovers fade and slide
  rather than scale and scrims appear at once.
- The layout works at 200% zoom and at the smallest supported width.

## Styling

- Use design tokens (color, spacing, radius, type scale) rather than hard-coded
  values. A hex color or pixel value in a component is a magic value.
- Build mobile-first, with the project's breakpoints.
- Support light and dark themes through tokens, if the project supports both.

## Performance

- Split code by route. Lazy-load heavy, rarely used views.
- Virtualize long lists.
- Memoize only when there is a measured problem or a clear structural reason.
- Give images explicit dimensions and use modern formats.

## Project-specific: every-surface check

A UI change is not done until it has been seen working on each place it shows. Tests
passing is not that. Before the handoff, go through this list on a running build of the
worktree (how to run one is in `AGENTS.md`, *verification gate*):

- **Every entry point.** Each way in: the key, the menu row, the click, the command
  search, the right-click menu, the CLI.
- **Both clients.** The TUI and the desktop app, where the feature exists in both.
- **Each agent.** Every agent it applies to (Claude Code, Codex, Gemini, OpenCode, a
  plain shell), not only the one it was built with.
- **The way back.** Each state it can reach has a way out, and the way out was used:
  Esc, close, cancel, undo, an error, an empty list.
- **This computer and another machine.** A local session and one on another machine,
  or the refusal a local-only feature shows there.

Leave out a line that does not apply, and say why. The handoff then carries the line
`Seen on screen: yes/no, where`: `yes` names the surfaces looked at, by a person or
through a rendered frame; `no` names what was not looked at and why. A surface nobody
looked at is reported as not seen, never as passing.

## Project-specific: design system

The optional desktop GUI is a separate React application in `apps/gui/`. Its
components, state and styling follow the TypeScript, React and shadcn/Tailwind
stack docs. It shares session and conversation contracts with the TUI, while
its visual design is owned by the GUI roadmap phases.

A chat (a conversation the desktop app runs) is a row in the TUI sidebar like any
session. Its name and whether it is closed are the daemon's, shared with the desktop
app: **Rename** (the rename key, or Rename in its menu) names it for both, and
**Close** puts it away in both while it keeps running (closing a chat's terminal does
the same). A chat has no terminal, so Enter or → on its row says it opens in the desktop
app instead of showing an error; a terminal session opens in both apps. A session is a
chat or a terminal session from the moment it starts,
and nothing switches a live session between them. The desktop app shows terminal sessions
only: a new session there is a plain shell, closing a pane or tab detaches, and ending a
session is its own action (its look is in [DESIGN](DESIGN.md#desktop-app)).

The desktop app also shows other machines' terminal sessions (ADR 0007).
Its host holds one supervised connection per machine and the web view only renders: it knows a machine by
name, never by where it points. A session of another machine has the id `build/t12` (the machine's name, so a
saved layout survives a restart; this computer's stay `t12`). **Settings › GitHub** (`GitHubSection`, key
`H`) has one row for this computer and one for each connected machine, saying what that machine's own `gh`
says (`github_accounts`): "Signed in as <login>" (with "(also …)" for its other accounts), "Not signed in",
"The GitHub command line (gh) is not installed. Get it from cli.github.com", "Checking…" until it answers,
or "Could not check: <why>" for a machine that did not answer, which leaves the other rows as they are.
**Check again** asks every row again. A machine that is not connected has no row. A row with somebody
signed in has **Details** (`GitHubDetails`, `aria-expanded`; **Hide** when open), which opens under the
row: the accounts with `active` beside the active one, **Add another account** (the same sign-in as
**Sign in**), then what that machine's git says (`git_identities`, asked when the row opens and on
**Check again**): "Commits as <name> <<email>>" (or which of the two is not set, or "No name or email is
set for commits"), and the folder rules, each a folder with `<login> · <name> <<email>>` or "set outside
Maiker". With no rules it says "Every folder uses <active login>", or "No folder has a rule of its own" when no account is active. git missing says "git is not installed
on this machine."; a failure says "Could not read git's settings: <why>" and leaves the accounts showing.
Once git's settings are read, a rule Maiker wrote has **Change** and **Remove**, and **Add a folder rule**
sits under the list; a rule set outside Maiker has neither. **Remove** asks once in the row ("Remove this
rule" or "Keep") before sending `git_identity_rule` with `Remove`; a refusal shows the machine's reason
under the list and leaves the rule shown. Add and Change open `GitRuleDialog` ("Add a folder rule on
<machine>" or "Change the folder rule on <machine>"): the folder (typed, or **Choose…** with the system's
picker here and `PickFolderDialog` on another machine; fixed when changing), the account (one of the logins
signed in there), the commit name and the commit email. **Show the lines** asks the machine for a `Preview`
and lists each git config file with the lines it would write; nothing is written until **Write these
lines** sends `Apply`. Editing any field takes the preview away, so only what was shown can be written. A
refusal is shown in the machine's words and nothing is written; after a write the rules are read again. A
row that says "Not
signed in" has **Sign in**: it closes Settings and opens a terminal session on that machine running GitHub's
own sign-in (`start_github_sign_in`); when that session ends the page asks every row again
(`useSessionsEnded`). A machine without `gh`, or one that could not be read, has no Sign in. **Settings › Remote machines** (a list with one line per machine, a page for each, and Add a machine; DESIGN.md) retries, updates, renames (a local label), removes and
adds machines (the behaviour is the terminal app's [Machines dialog](#project-specific-machines-dialog),
with the host list read off the UI thread, the look at the machine ended by a 12 s limit or Cancel, and a
login that needs a person run in a session named `ssh <name>`); **New session** (⌘T, Ctrl+Shift+T, the sidebar's **New session** `+`, the empty state's button, the collapsed rail's button, the palette's "New session…" and "New session on <machine>…", a machine's "New session here") is the one door to an agent: it opens the **New session draft** (`NewChatPage`): a chat that has not been sent, in the main area over the panes, on this computer or the machine asked for. It is never a modal dialog. With no session at all it is the window's home screen (no Close button, since there is nothing to go back to); the empty state ("No tab open") shows only when sessions exist but no tab is open. No other label starts an agent (a test fails if "New chat" or "New agent chat" comes back). The draft keeps the chat's own layout and asks in this order: **Where** in its header, **What** as its message box, **Who** in the box's foot. Esc or × discards it and returns to the session that was in front. A draft with text keeps that text when you switch to another session and come back during this run (`model/newSessionDraft.ts`, in memory only, nothing stored; an empty draft is never kept), and its sidebar row, "New session draft", opens it again. **Where** is one line of four controls in the header, each a button that opens a searchable list under it (`ChipMenu variant="token"`): **Machine** (This computer first, a status dot per machine, **Add a machine…** at the foot; a machine that is down is listed but cannot be picked, with the reason under its name and a "not reachable" tag; when the machine the draft opened on is down its chip says so, an alert gives the reason and Start stays off), **Project**, **Branch** and **Work in**. Branch and Work in are always there, never silently absent: **Project** (its list ends in the hint "Type a path starting with ~ or / to open any folder."; the folder that was read and is no repository carries "· not a git repo"), **Branch** (each branch with the age of its last commit, **in use** in the warning colour with "Open in “<chat>”" under it when another chat works on it here, and "N behind" on the checked-out branch once `git_sync_state` has said so; a typed name offers "+ Create <name> from <current>", or, when git would refuse it, a red line under the search box in its place: "Branch names can't have spaces. Try x-y." or "That isn't a valid branch name." (`branchNameError`); the search box ends in a **Fetch** button: the page asks origin once when it opens and when the folder changes (`useFolderSync`, `git_sync_state` with `fetch`), and the button reads "Fetching…", then "Fetched just now"; offline leaves what was already fetched; outside a git repository the chip is dimmed and reads "no git repo", while the folder is read "reading…", and on another machine "not read here", each with the reason in its tooltip: "<folder> is not a git repository, so there is no branch to pick. Pick a project folder that is, or clone one.") and **Work in** (a token with two rows and no search: **This folder**, "Edits your checkout of <branch> directly.", and **New worktree**, "Its own copy on a new branch. Your checkout stays untouched."; with neither picked it works in the checkout unless another chat is on that branch here, which makes a worktree and says so under the box; dimmed as "n/a" with the reason in its tooltip when the folder is no git repository; on another machine it is available and makes the worktree there). When the session would edit the checkout (This folder, on the branch it is on) and that branch is behind origin, a banner under the box says "<branch> is N behind origin." with **Update first** (`git_pull`, a fast-forward only: "Updating <branch>…", then "<branch> is up to date with origin."; a refusal shows as the error line); when it is behind and also holds uncommitted tracked files it says "has changes that aren't committed, so it can't be updated cleanly." and **Use a worktree** turns New worktree on (`git_sync_state` has no count of changed files, so the line gives none). A start that fails because the worktree's folder is already there (also a background start) says "Could not make a worktree for branch <b>", "Its folder <path> is already there. Remove that folder, or pick another branch name.", with **Pick another branch** (opens the Branch list) and Copy details for git's own line (`explainStartFailure`). A chip that cannot be used uses `aria-disabled` and not `disabled`, so its tooltip still shows. Defaults: the focused session's machine, the last project, the current branch. The **Project** list is the one place a folder comes from: **Recent** (the folders sessions ran in), then at the foot **Open folder…** (the folder picker, `PickFolderDialog`, below), **Clone from link…** and **My GitHub repos…** (both open `CloneRepoDialog`, the second on the account's repository list). Its search box doubles as a paste target: a path shows as "Use <path>"; text that reads as a GitHub repository (`model/repoAddress.ts`: a github.com link, `git@github.com:` or a bare `owner/name`, which counts only when no listed project matches) makes the top row "Clone owner/name to <folder>/name", and a click clones in place, shows "Cloning…" and opens on the new folder. The address is rebuilt from the checked names, so a pasted user name or token is never sent: a link carrying one gets a disabled row saying to remove it first. The destination is the last folder cloned into on that machine, else `~/Projects`, which the daemon makes on first use (no other missing folder is made). A failure is a plain sentence from git's words (`explainCloneFailure`): not a repository link; a folder already there, with **Use it** and **Pick another folder**; a repository that is missing or private, saying Maiker cannot sign you in to GitHub yet (it uses the sign-in git already has on that machine), with **Open GitHub settings**; a server that cannot be reached. **What** is the message box ("What should we work on?", focused when the draft opens; **Enter starts**, Shift+Enter is a new line; attach at its top right on this computer, files named by path in the first message) holding the slash picker, which keeps Enter while it is open. **Who** is the agent dropdown in the box's foot (the agent's mark, name, model and effort in one button; see *New session draft: nothing jumps*; the last agent used is the default, then Settings' default agent) and the **permission chip** (`Permissions: Bypass permissions`, Full access for Codex, or the mode the agent starts in). **More options** is a small button after them that opens a popover with **Skip permission prompts**, which changes the chip for this session only. There is no "Opens as" control: a session is one daemon-owned session with a Chat and a Terminal view, and Settings › Chat › **Open sessions in** (Chat by default) decides which one it opens in, and changing it moves every open session to that view; the pane header's Chat · Terminal switch still changes one session. Gemini has no chat view, so it always opens in its terminal and the draft says so in one line. When Enter is pressed the same view stays: it shows the message sent and the "Starting <agent>…" card while the start runs, and the window closes it in the same update that opens the session's pane (`afterPlace` in `useSessionStarts`), so nothing blinks or goes blank in between; if the start fails the message is back in the box. While a Chat-view session has not heard from its agent the pane shows a "Starting <agent>…" card (`StartingChat`), not a blank screen. A plain shell is a separate door, **New terminal**. **Open folder…** and **Clone from link…** open the folder picker or the clone dialog over the draft, which stays where it is and takes the folder filled in; a folder chosen on another machine moves the draft to that machine. The Settings default is `openSessionsIn`; the start passes `view`, and the choice of bypass as `bypass`, down to `startNewChat`. Clone a repository opens `CloneRepoDialog` ("Clone a repository to this computer" or to the machine's name): a repository address and the folder the clone goes inside, which starts as the folder last cloned into on that machine (kept in this window's storage) or else the start folder, with **Choose…** for the same folder picker. Under the address is the machine's own GitHub repositories (`GitHubRepoPicker`, `github_repos` and `github_owners`): a search box that asks again 300 ms after typing stops, an owner menu when the account has organisations, and a list, newest pushed first, with `· private` on a private one; Up and Down move, Enter or a click fills the address and does not start the clone. A list of 200 says "Showing the first 200 repositories. Search to find the others." A machine that is not signed in says "Sign in to GitHub on <machine> to pick from your repositories." with **Open GitHub settings** (which closes the dialog and opens Settings › GitHub); one without `gh` says where to get it; a list that could not be loaded says why. Pasting an address works in every case. The machine's daemon runs git (`clone_repository`); when a folder rule Maiker wrote on that machine covers the destination folder, "Will use <login>" shows under it (the rules are read as the dialog opens; a machine that cannot say shows no line); while it runs the dialog says "Cloning…" and cannot be closed, a refusal is shown in the machine's own words with the address kept, and the new folder becomes the dialog's project. No folder is chosen for the person: Start stays off until one is. Picking an existing branch that is already checked out (`dev` in the main checkout, or another chat's worktree) with New worktree makes a new branch cut from it under a made-up name, since git checks a branch out in one place only, so any number of chats can work off `dev` (`worktrees::branch_worktree`). New worktree takes a new branch under a random two-word name (`suggestBranchName` in `model/worktreeName.ts`, like `quiet-otter`, with `-2`, `-3`, … when it is in use), which the branch crumb then shows; the message is never copied into it, and a typed name replaces it. The agent, its model and its effort are on the agent dropdown in the foot (see *The agent dropdown*); an agent that is not installed says so under the message box, with **set it up** opening the agent's official page (`open_agent_docs`, a fixed list, never a caller's address). The permission mode the chat starts in is the shield beside it (`PermissionMenu`); while the agent's **Bypass Permissions** switch is on (Settings › Permissions; on by default) it starts on Claude's Bypass permissions, and any other mode can still be picked; with it off Claude starts in its usual mode and Bypass permissions is not offered: Claude's modes, or for Codex **Read only**,
**Auto** (nothing is sent, so Codex's own settings stand) and **Full access** in red, which go on the launch line as
`--sandbox` and `--ask-for-approval`. While Bypass Permissions is on for Codex the page says Full access and offers no menu, since
that setting already starts it so. A running Codex chat has the same three modes on its permission button: a pick types
Codex's own `/permissions` command with a built-in profile (`CODEX_MODE_COMMAND`; the command is typed and its Enter pressed 400 ms later, `COMMAND_SUBMIT_GAP_MS`, because Codex takes an Enter that arrives with the text for a line break and leaves the command unsent; checked against Codex 0.166), and is put back, with a toast, when
Codex's screen says it refused the command. Codex has no file that says its mode, so the button shows what the chat was
started in or last moved to, and "Permissions" where neither is known. It starts the agent in a terminal the daemon owns, shown as its chat (`startAgentSession`, ADR 0003), so the Chat · Terminal tabs work for every agent; the picked model and effort go on the launch line (`launchFlags`: Claude `--model` and `--effort`; Codex `-m` and `-c model_reasoning_effort=`) and the first message waits under the session until the agent takes input. **The agent is started while the message is written** (`useWarmAgent`): once a folder is picked, and 400 ms after the last change of agent, model, effort or mode, the draft asks the daemon to keep that agent warm (`prewarm_agent_session`, API_PATTERNS), asks again every four minutes while it is open, and says none is wanted when it closes; the start then takes the warm agent, because it asks for the same words (`startWords`). It is a head start only: with a branch to switch to or a worktree to make, on a daemon from before it, or when it fails, the agent starts on send as before. With This folder (or Work in left alone, in the checkout) a branch pick runs `git switch` (`git_switch_branch`); with New worktree the daemon makes a worktree (`add_branch_worktree`, `Command::BranchWorktree`: named by `worktree.dir`, trusted like its repo, the repo's setup run, listed for tidy-up) and the chat starts there. The branch is settled before the agent starts, and a failure stays on the page. **Ctrl+Shift+Enter (⇧⌘Enter on macOS) starts the chat in the background** (`startNewChat` with `background`, `useBackgroundStarts`): the session is made and listed in the sidebar but not opened, and the draft stays with the message box emptied and every other choice kept, so the next chat can be written and started while the first still starts. A new branch's name is taken for the page, so the next start in a new worktree gets another worktree. Starts from the page run alongside each other; each one's launch waits for the one before it, so a session is matched to the start that made it (`useSessionStarts`). Every other start (a shell, sign-in, handoff, Start a chat here, Recent sessions) still runs alone, refused while anything is starting. A start in the background that fails is an inline note under the box (`InlineNote`): "Could not start “<its first words>”", the reason in plain words (`explainError`), **Put back**, which returns its message and files after whatever was typed since (never over it), **Dismiss** (each labelled with that start's name) and **Copy details** when the tool's text says more; once the page is closed it is a toast and its files are let go. The line carries the start's own reason, with no toast beside it; one refused because a start that runs alone is under way says "Another start is running. Try again in a moment." A start in the background opens no pane, so it keeps no session off the sidebar while it runs (only a start that opens a pane does, until its pane is there). **Enter (or Ctrl+Enter, ⌘Enter on macOS)** starts and opens the chat; Shift+Enter is a new line. On another machine, and for a terminal, Ctrl+Shift+Enter is a plain start, because that chat is typed into a shell there and opened to do it. **On another machine** the same draft opens, with that machine in its Machine token (`machine` prop; a machine's New session here, and a focused remote session's machine, choose it; the project menu's Machine switch changes it). It lists that machine's projects (`machineProjects`), takes a pasted path, and **Open folder…** opens the folder picker on that machine; its slash picker lists that machine's own commands and skills, asked of its daemon in the folder typed (`agent_commands_on`), and says why when the machine cannot (a chat running on a machine does the same, and a machine this window has not been told of offers none); it has no branch or warm-agent controls, and Work in offers this folder or a new worktree, which that machine's daemon makes (`add_branch_worktree` with the machine, `Command::BranchWorktree`) on a new two-word branch before the shell starts in it; its branches are not read, so auto is this folder and a name a start took is not suggested again; and the model button offers the agent, the models every install takes by name and the effort (`AgentPicker fixedModels`), not the account's extra models read from this computer, which that machine may not have; this computer's branches say nothing of the other machine. A worktree is that machine's daemon's `worktree.per_agent` setting. The window starts a shell there (`startSessionOnMachine`), holds the first message under the new session (`firstMessage.ts`) and types the agent's command into the shell; the line is built by `launchFlags` from the agent, a permission mode from the fixed list, a fixed model alias (`everywhereModel`; any other model starts the default) and an effort level only, so no free text reaches the remote shell. For a terminal session the
message is also handed to the session's daemon (`send_when_agent_ready`), which types it in, so it is delivered when
the window closes first; the window keeps showing it until the history has it, and sends it itself only when the
daemon does not take it. A chat running in the pane shows its one problem by what it blocks (`features/chat/problem.ts`, `ChatProblem.tsx`; DESIGN › *Errors*): a lost machine (Try again), a stopped agent (its exit code, Restart, or Show the terminal for a session that only has one) or agents interrupted by a service restart (Restart) is a dialog over the chat column only (`ScopedAlert` scope `chat`), whose **Not now** turns it into the dock's problem line with the same fix and **Copy details**; a context at 95% or more is only a caution line in the dock, with **Compact**, which types `/compact`, and **New chat with summary**, which opens the New session draft on the same machine and folder with a plain-text summary (`summaryOf`: the task it began with, the latest asks and the agent's last reply, written from the chat, not by a model) as the first message to edit. Every one comes from a daemon signal (the session's status, its exit, its machine's state, `TermInfo.interrupted`, the context the agent reports); the window never guesses one. A pane's header (`PaneCard`, layout 2h) reads its name, then `/` the project (its colour's square and a lock: the project is set when the chat starts) and `/` the branch; a double-click on the name renames it in place (it no longer maximizes; Maximize is in the ⋯ menu), the view switch has Chat and Terminal, and below 700px the project crumb goes, below 560px the branch's name. The header's branch crumb opens **Branch in <project>** (`BranchMenu`: switch the folder's branch, or **Move to a new worktree…**, which makes the worktree, types `/exit` to the idle Claude or Codex agent, waits up to 15 s for the pane to be a shell, then types `cd "<worktree>" && claude --resume <id>` (Codex: `codex resume <id> -C "<worktree>"`; `;` on Windows) into the same pane: the pane and daemon session stay, only the agent restarts, uncommitted edits stay in the old folder, and the row is off with the reason while the agent works or asks, has no saved conversation id (`TermInfo.session`, checked against a strict pattern) or is another agent; a folder name with quotes, `$`, `` ` `` or `%` is refused rather than typed; `useMoveToWorktree`), and usage reads as square rings, Ctx, 5h and Wk, in the theme's four meter colours by quarter, each a button that opens Settings › Usage & cost (DESIGN.md). A chat started from the New session draft begins on **Medium** effort (`START_REASONING`; launched with `--effort medium`, or Codex's `model_reasoning_effort=medium`), and the model button names the level beside the model; pressing the picked level again lets go and the agent keeps its own ("Default"). With no level picked, the button shows the level the agent's own files say it runs at (`TermInfo.effort`: Codex always, Claude when its transcript names one) and the menu says "Medium" (its tooltip: the agent's own setting); where they say none it reads "Default". A chat is never claimed to be on a level its files do not show. A Markdown document the agent wrote (a finished Write of an `.md` file) is a row of its own in the chat, never folded into the run around it, and **Read** opens its text in place (the file may be outside the project, where no panel shows it). A machine's name is the one its owner gave it (**Rename…** on the machine heading, or **Rename machine…** on any of its rows) in every text that names it: the row's machine, the status bar, notices, toasts and dialogs (`machineLabel`, `data/machineNicknames.ts`); its own name stays the key everything is addressed by. A row's place line keeps the project name at least seven characters wide, and the branch and machine give way first. The working badge shows the spinner Settings picked (`StatusBadge`), in the working colour on the tile's own background. A session the daemon's list stops naming leaves the sidebar at once when this window closed it, its daemon gave a removal reason (`Snapshot.removed`, `Unknown` included; another machine's reasons count for its own sessions) or its machine was taken off the list in this window; with no reason it stays, shown as unknown, and the window logs one line with its id and the revisions of the list that named it and the one that did not, until a full list confirms it is gone (`trackMissing`). For this computer that is a read of the daemon's list (`list_sessions`, `confirmGone`), ten seconds after the miss and every ten seconds after; a failed read is logged once, and once more when one works. For another machine it is a list from that machine that comes at least ten seconds after the miss (`confirmGoneOnMachines`): every list the host sends of a machine is its whole list, and at each check the window asks each machine that is up and holds such a row for one (`ask_machine_list`). This computer's list never confirms another machine's session, and while a machine is down its rows stay as they are, unknown, until it is back. A pushed list, a whole `State` too, never confirms it: after a daemon restart the first `State` names no reasons. ⌘J (Ctrl+Shift+J elsewhere, since a bare Ctrl+J is a terminal key) jumps to the next session that needs you or stopped, and the Needs you heading shows the key. **New session** (⌘T,
Ctrl+Shift+T) opens the New session draft above, and **New terminal** (⌘⇧T, Ctrl+Alt+T, the sidebar's terminal button, a
machine's New terminal here) starts a plain shell in the start folder with no dialog; another machine asks for a folder there first, so it opens the dialog. A screen reader is told when a machine goes down (`build disconnected: unreachable`) and when it is back, once each and not for every retry, through a polite live region; every state is a word as well as a shape and a colour, nothing about machines animates, and the Machines page works with the keyboard alone (Tab, Enter, Esc ends a look in progress without closing Settings). Features that read a pane's files (Inspect, worktrees, opening a file from the output, dropping files, the screen text) are for this computer's panes only: each says `<Feature> is local-only in v1: the files are on <machine>, not on this computer.` and the Repository button shows disabled with that text.

**Resume a saved chat…** (the palette's Actions; `ResumeSavedDialog`, `ResumeList`, `useSavedConversations`) lists the conversations Claude or Codex saved for a folder on this computer (`saved_conversations`, API_PATTERNS), with an agent switch and a folder menu of this computer's projects: each its first message and how long ago it was active, newest first. A pick starts the agent in that folder, as it is, with that conversation (`resumeWords`, through the new chat's resume start); a failed read and a service that does not answer the query each say so in one line.

**Recent sessions** (`RecentSessionsDialog`, `model/recentSessions.ts`, `useRecentSessions`; the clock in the rail's
foot and **Recent sessions…** in the command palette) lists the agent sessions that closed on this
computer, newest first (`closed_sessions`, API_PATTERNS; read when the list opens, off the UI thread): each its title
(else "Claude session"), the agent's mark and name, the folder, the branch and "closed 3h ago". Picking one closes the
list and starts that agent in that folder with its conversation, through the new chat's resume start (`startNewChat`
with `resume`; the id held to `resumeWords`' rule, model, effort and mode left to the agent); while another start is
under way the list stays open and a toast says "A session is already starting". A row whose folder is gone but was a
worktree with a known repository and branch reads "folder removed · closed 1d ago" and can be picked: the service makes
the worktree again and starts the agent itself (`reopen_closed_session`, API_PATTERNS; never `startNewChat`), while a
line over the list says "Making the folder again and starting the session…" and every row is `aria-disabled` until
it answers, so no second session starts meanwhile; an answer that comes after the list was closed changes nothing. Once it has, the
list closes; a refusal (a branch that is gone is named) shows as an alert line over the list, which stays usable, and a
service that does not take the request says "Restart the Maiker service to reopen it." A row cannot be picked
(`aria-disabled`, not `disabled`, so it can still be reached and read), and says why in place of the time, when its
folder is gone and was not such a worktree, ("folder removed;
cannot be made again"), when its agent is not Claude or Codex ("cannot be reopened here"), or when its id fails the
rule ("no conversation to resume").
It says "Looking for closed sessions…" while it reads, "No closed sessions yet. A chat you close shows here once its
Undo has passed." when there are none, "Could not read the closed sessions." with **Try again** when the read fails,
and "Restart the Maiker service to see closed sessions." for a service that does not answer the query. Esc, Close or a click
outside closes it. Only this computer's daemon is asked: another machine's closed sessions are not listed.

**Desktop service states** (`ServiceStatus.tsx`, `useServiceStage.ts`, `model/serviceState.ts`; DESIGN › *Errors*). While the service does not answer, every status reads Unknown, spinners stop and input waits. For the first 3 seconds (`OFFLINE_AFTER_MS`) it is a blip: only the title bar's chip says **Reconnecting…**, and nothing dims. After that the whole window dims under one dialog, **Maiker can’t reach its background service** ("Nothing works until it is back, but your chats are safe and will reconnect on their own…"), with **Start service**, **Not now**, **Copy details** (the connection's own error) and "Trying again in Ns"; the window tries again after 2, 4, 8, then every 15 seconds (`RETRY_DELAYS_MS`). The desktop's connection starts the service itself on every try (`open_or_spawn_for_user`), so Start service is a try now, showing "Starting…" while it runs. **Not now** leaves a red **× Offline** chip in the title bar that opens the dialog again. When the service answers after an outage the dialog (or the chip) turns green, "Reconnecting…" / "Found the service. Picking your chats back up.", for 1.2 s (`FOUND_FOR_MS`), then a **Back online** toast says "All chats reconnected. Nothing was lost.", or, when agents were mid-turn, a caution toast "Back online, but N chats were interrupted" with **Restart it / both / all**. Back after a blip says nothing. Toasts raised while the window is offline are held and show once it is back (`holdToasts`). A running service of another protocol gets the same window dialog in caution, **Restart Maiker to finish updating**, "The app updated, but the service behind it is still the older one.", the list of what a restart keeps and stops (sessions that reopen, agents that will offer Resume, shells that stop; a line with a count of 0 is left out) and a restart button that asks for a second click (`restart_mismatched_daemon`, then "Service restarted · N sessions back"), with `protocol 75 → 76` beside it (protocol numbers are never written as app versions); a service newer than the app asks **Update Maiker to reconnect**. **Later** leaves a caution **Restart needed** (or **Update needed**) chip in the title bar. The sidebar foot never repeats any of this. No needs-you toast shows while the service is not connected, and a failed action whose only reason is that the window has no line to the service (`lib/serviceLine.ts`) shows no error toast either (`lib/toast.ts`): the chip and the dialog already say it. Agents that were mid-turn offer Restart in their chat and in the Back online toast; nothing resumes by itself.

**Errors in the desktop app** (DESIGN › *Errors*; `lib/toast.ts`, `components/ui/toaster.tsx`, `components/ui/feedback.tsx`). A failure shows where it happened and only as loud as what it blocks: a field's value that will not do is a `FieldError` under the field (`role="alert"`, the field has `aria-invalid` and `aria-describedby` from `fieldErrorProps`, keeps its value, and says it once the field is left or the form sent, never while typing; sending moves focus to the first such field); a failure on the page you came to read (a start that failed, a clone, a git rule) is an `InlineNote` on that page with its own actions and Copy details; a chat's problem is its dialog or dock line; the service is the window dialog and the chip; anything else is a toast from `toast` in `lib/toast.ts`, never a banner. `toast.failed(what, error)` names what failed in the title and puts the error's own words as the reason and behind Copy details. Errors, warnings, needs-you and progress toasts stay until dismissed or replaced by id; success and notes go after 4 s (`TOAST_HIDE_MS`) and pause while the pointer or focus is on the stack; the same failure again merges into one toast with a count; at most 3 show. The stack is a polite live region (an error is assertive), every toast and action is reachable by Tab, Esc on a toast dismisses it, and reduced motion drops the slide. `src/errorSystem.test.ts` fails on another toast library, a banner component or class, or a raw error message in `toast.error`.

A terminal UI (ratatui). Colours come only from the theme (`theme.rs`): semantic
slots `bg`, `card`, `card2`, `hov`, `accent`/`acc_ink`, `text`/`strong`/`muted`,
and status colours (`working`, `blocked` = needs you, `done`, `idle`, `err`).
A working row is one colour, `accent`, across its glyph and its name (shimmering with motion on). Needs you (`blocked`) is amber and failed (`err`) red in every theme, so they never read alike. `dark` sets its amber by hand; `mono` uses named yellow and red; every other theme keeps an amber of its own that stands apart from its other statuses, or gets one derived from its yellow (`with_distinct_needs` in `theme.rs`, darker on light themes). The audit in `theme.rs` asserts needs you looks unlike every other status, on the row and lit. A theme's amber `working` slot stays out of the sidebar. Chips on the check sheet, the Inbox's group heads and the approval tint use the same slots (`client/reference_frames_tests.rs` asserts the roles).
Every built-in theme passes a WCAG contrast audit test. Shared primitives in
`client/design.rs` and `client/screen/`: `panel()` (popup), `fill`, `put`/`seg`
(text runs), `keycap`/`keycaps`, `hints`, `button`, `dim_all`. Icons come from
config (`[icons]`), with Nerd Font glyphs where present.

## Project-specific: GUI design system rules

Rules for `apps/gui/`. Owner-approved 2026-11-04.

1. Every colour, radius and shadow comes from a theme token (a CSS variable),
   mapped into Tailwind by the `@theme inline` block in `apps/gui/src/index.css`.
   No raw hex, `rgb()` or `hsl()` in components.
2. Every popup (menu, dropdown, dialog, tooltip, popover, listbox) is a
   shadcn/Radix primitive from `src/components/ui/`. No hand-rolled focus, Esc
   or arrow-key handling.
   The same goes for the controls inside a page: a switch, a segmented or radio
   choice, a select or picker, a dialog. Each one exists once in `components/ui/`
   and every feature uses it ([shadcn-tailwind](stack/shadcn-tailwind.md#primitives),
   "One component per control").
3. New components use Tailwind utilities on those tokens. Heavy animation and
   per-look rules (the Square corners rule, `data-gpu`) stay in `material.css` and `workspace.css`; the design's
   role, spacing, type, radius and motion tokens are in `tokens.css` ([DESIGN](DESIGN.md#desktop-app)).
   Folded is the default corner style and needs two drawings: `corner-shape: bevel` where it exists, and a `clip-path`
   fallback under `@supports not (corner-shape: bevel)` for WebKit, the engine the app ships in on Linux and macOS
   ([DESIGN](DESIGN.md#desktop-app), Corners). A new surface with a cut is added to both, with its size, and its border,
   shadow are checked in the fallback, where a clip-path clips them, and a surface whose edge is not a plain
   border (an inset shadow, a themed colour) sets `--fold-line` to that colour so the cut keeps its line. Look at the
   fallback in the real engine, not in Chromium with `corner-shape` switched off: WebKitGTK renders it headless under
   `cage` (`GtkOffscreenWindow`, `WEBKIT_DISABLE_COMPOSITING_MODE=1`, see `apps/gui/scripts/perf/webkit-harness.py`).
4. Old CSS moves to these rules only when a ticket touches that area. There is
   no big-bang rewrite.

`pnpm lint` enforces rule 1 in TS and TSX: `eslint.config.ts` rejects a hex,
`rgb()` or `hsl()` literal in `apps/gui/src`. Exempt: test files, the theme
files in `features/workspace/theme/`, and `TerminalView.tsx` (the xterm.js
palette takes literal colours). Don't widen the exemptions to pass a change.

`pnpm lint` also enforces the one-component-per-control rule: a hand-built
`role="switch"`, `radiogroup`, `radio`, `dialog`, `alertdialog`, `menu`, `menuitem`,
`menuitemradio`, `listbox` or `option`, or a `createPortal` import, outside `components/ui/` is an
error. There are no exempt files.

**One segmented control.** Every row of choices with one picked (Chat | Terminal, the agent switch, Appearance, Group
and Sort, the dock position) is `Segmented` / `SegmentedItem` from `components/ui/radio-group.tsx`, drawn by
`components/ui/segmented.css` and by nothing else. A caller gives the choices and, as props, an `icon` (a mark before the
word, or alone for an icon-only choice with an `aria-label`), `compact` (a choice shows its mark alone until it is
picked) and `full` (the row fills the width it is given). It does not set a size, padding, colour or picked look; a
class on it places it (a margin, `align-self`) and nothing more. A look that is missing is added to the one stylesheet,
for every instance. `src/segmented.test.ts` fails on a stylesheet or source file outside `components/ui/` that styles a
`.mx-seg*` class or paints a picked `--m-sel` pill, or that builds a `radiogroup` by hand.

**Reserve the space; reveal with opacity, never by growing.** A tab, row, chip, menu item or button never changes its
width, height or place to show a close ×, a pin, a count, a shortcut or a label when the pointer, the focus, the
selection or a state reaches it. The part owns its slot at all times (the terminal dock's tab holds its 18px × whether or
not it shows) and only its `opacity` changes; it stays focusable while hidden, and focus shows it. A part that must appear
over a row without a slot is `position: absolute` (the sidebar row's ×). A selected tab that turns bold keeps its width with
a hidden bold twin of its label. Panels that open (a drawer, a disclosure) are the exception: growing
is what they are for. `src/revealSpace.test.ts` fails on a hover, focus or selection rule that sets `display: none` or
`width: 0`, and on a close-button rule that sets `width: 0`; the few deliberate cases are listed in it with the reason.

**Focus is one style: a 2px accent underline, drawn inside the control.** The token is `--focus-underline`
(`inset 0 -2px 0 var(--focus-line)`, `tokens.css`; `--focus-line` is the accent, and the one place to point at `--fg` if a
theme's accent falls under 3:1 on its ground). `.mx-app :focus-visible` sets it on everything, so a new control needs no
rule; a field whose input sits inside a bordered wrapper puts it on the wrapper (`:focus-within`) and lists the input in
the exclusion beside that rule, and a control that rests with a hairline border in `box-shadow` writes
`inset 0 0 0 1px <its edge>, var(--focus-underline)` so the border stays whole on the cut corners too. No `outline`, no
ring (`0 0 0 Npx`), no glow, no `outline-offset`, no growing border. The design's explicit exceptions are bordered, and
only these: the message box (`.mx-box`, border to accent), the commit message (`.mx-commit-message`, border to
`--accent-line`) and the legacy composer. A menu item or option shows the item the keys are on with its highlight.
`src/focusStyle.test.ts` fails on a focus rule that breaks this; its allowlist gives each exception its reason.

**A hover, focus or press changes colour and opacity, nothing else, and does it at once.**

- *No delay.* A part that a pointer or the keys reveal (a close ×, a row action, a copy button, a hover reply) is there
  within one `--t-fast` fade. Only a tooltip (`HoverTips`) and the sidebar's hover card (`HoverController`: 450ms the
  first time, a 250ms warm window) wait, and they wait in code, never with a CSS `transition-delay`.
- *No jump.* A state never changes a control's size, place, border width, padding, line height, weight or what it says:
  no `translate` or `scale` lift or press, no bold on pick (a picked item is a colour, a fill or a mark; a tab that must be
  bold keeps its width with a hidden bold twin of its label), no `filter`. Hover on a filled button is a flat tint
  (`color-mix` toward white), press a deeper one toward `--bg`. A ring that must not shift the box is an inset `box-shadow`
  or a border that is always there in `transparent`.
- *No abrupt flip.* Every interactive element fades `background-color`, `color`, `border-color` and `opacity` over the one
  fast token (`--t-fast`, `--ease`). `workspace.css` gives that to every button, link and role by default through a
  zero-weight `:where()` rule, so a control needs no transition of its own; a new class that is not a button or role
  is added to that list. Rules that name their own transition use the tokens too (`--t-fast`, `--t-base` for a turn or a
  slide, `--t-slow` for a theme fade), never a raw time. Only `opacity`, `transform`, `background-color`, `color` and
  `border-color` animate on a state; a width, height, shadow or filter does not ([PERFORMANCE](PERFORMANCE.md)).
- *Reduce motion.* The tokens go to 0, so all of it is instant with no per-rule work.

`src/hoverMotion.test.ts` fails on a transition delay, a raw transition time, a font weight, a `translate`/`scale`, a
`filter` or a `will-change` in a hover, focus, press or selected rule, and on a part that starts at `opacity: 0` with no
fade; the few deliberate cases (a switch's knob, the skip link, the plan's current step) are listed in it with the reason.
To see a change on the real web view, hover the element and compare its box and its siblings' before and after
(`getBoundingClientRect`, see [PERFORMANCE](PERFORMANCE.md#hover-popovers-and-every-animation-on-webkitgtk-2026-11-17)).

**The terminal is edge to edge.** A terminal (the dock, a pane's Terminal view) sits on one opaque `--term` ground that
fills its card, with a text inset from a token and no frame, ring or card of its own inside the card that holds it. The
card carries the focus; the terminal never draws a second box (see [DESIGN](DESIGN.md#desktop-app), the terminal dock).

## Project-specific: desktop window sizes and sidebar order

Rules for `apps/gui/` (the look is in [DESIGN](DESIGN.md#desktop-app)).

1. The window is at least 720px wide. Under 1100px the sidebar is the 52px rail ([DESIGN](DESIGN.md#desktop-app), the rail) and
   expanding it opens the full sidebar as an overlay; under 800px panes stack in one
   column. The widths are constants in `features/workspace/model/windowSize.ts`; change
   them there and in DESIGN, nowhere else.
2. The sidebar lists **agents and shells only**, grouped by **Group by** (`sidebarGroup`): Status (the default:
   Needs you, Working, Finished, Idle), Project or Machine (this computer first), and in all three the terminals
   (no agent in them) are one **Terminals** section stuck at the bottom over the foot, at most a third of the height
   (`TerminalsSection`; its rows scroll inside), with a count and a fold (no `+`; the section is not drawn while no terminal is open, and the header's terminal button starts one); the 52px rail shows one
   terminal glyph with the count instead. The section is outside the scrolling list, so it never scrolls away. In Status the session
   on screen stays in the section it was picked in until another is picked (`statusSections`' `held`), so looking at a
   finished agent, which makes it idle, does not move its row from under the pointer. Until the daemon's first list
   arrives the sidebar says "Looking for your sessions…" and the main area the same, never "No agents running".
   Within a machine the order is the **Session order** setting (`sidebarOrder`): `creation` (the default; the daemon's pane number) so a row
   never moves when its state changes, or `priority`, where a session that needs you goes to the top and the rest keep
   creation order (`model/sidebar.ts`, `bySidebarOrder`). The command palette still lists the most urgent first. A machine can
   be grouped by project and folded. There are no fleets, ships, tabs or tab bar: choosing a session shows the layout it
   is in (`model/layout.ts`), else one of its own. A session's **subagents** are the daemon's `TermInfo.subagent_activity`
   (`model/subagents.ts`), shown, while they run, in the dock above the chat's message box (`HelpersDock`, fed by the chat's own agents row and these activities; see DESIGN.md *The dock*); **Open its chat** on a helper's opened row in the dock or the record block (`OpenSubagentContext`, matched by title or task in `subagentNamed`), shows its own chat in the pane until you pick a session or **‹ Main session**.
   Maiker shows no workflow runs (ADR 0011). Rename is
   in place (double-click, F2 or the menu). Right-click menus share `MenuPopup` (focus, arrow keys, Esc, kept inside the
   window). Picking a session shows it at once, with no glide; panes that move (a split, a swap, a close) glide
   (`movePanes`). Split layouts are this window's own state, up to four panes, mixed right and down with draggable dividers; a
   session closes with a 6 second Undo. **Put away** (the row menu of a finished or idle session in a daemon terminal,
   shells too) sets the pane's `archived` flag (`Command::ArchivePane`) with a 6 second Undo; it closes, stops and moves
   nothing, so the session keeps running, stays in the daemon's list and keeps its worktree in use. Put-away sessions are
   listed only under the folded **Put away** section at the foot of the list (`model/sidebar.ts`, `splitPutAway`), each
   with **Bring back** (its hover button and its menu). The rail shows no trace of put-away sessions (one that needs you
   still shows), and the tray menu still lists a put-away finished session. While Needs you would list one it is
   listed there instead, still put away on the daemon; once it no longer needs you it goes back under Put away. A chat
   cannot be put away: its daemon archive is how a chat is closed. **Snooze** (the row menu of a finished, idle or
   limited session in a daemon terminal; not a chat, which the daemon refuses) is `Command::SnoozePane`: **Snooze 1 hour**,
   **Snooze until tomorrow 9:00** (the next calendar day on this computer's clock, built from date parts so a clock change
   keeps it at 9:00; `model/snooze.ts`) and, only while the daemon's `resume_at` is ahead and within a week,
   **Snooze until the limit resets**. A snoozed session (`TermInfo.snoozed_until`, `SessionView.snoozedUntil`) is listed under
   **Put away** with `until 14:05` (`until Thu 09:00` on another day) and **Unsnooze** (its hover button and its menu); a
   toast offers Undo for 6 seconds. The daemon owns the snooze: it ends it at its time, or at once when the session needs you,
   and the session then returns to its section on the next list. While Needs you would list it, it is listed there instead.
   A snooze of a pane on another machine is sent without waiting for the answer (as Put away is), so its toast says `Asked to snooze …` and a refusal there is not shown. Bring back also wakes a snooze. There is no date picker. There is no Crewmates mode in the desktop app (`features/crew/` is gone).
3. A terminal sits on the workspace card's own ground (`--main`, xterm's background and ANSI black), so a pane reads as
   part of the card and not as a box inside it.
4. The window's state is put together once, in `features/workspace/useWorkspaceState.ts`, and `DesktopApp` hands it to
   the window's parts (`WorkspaceSidebars`, `WorkspaceMain`, `WorkspacePane`, `WorkspaceDialogs`) through
   `useWorkspace()` (`workspaceContext.ts`). A part of the window reads what it needs from there and is not passed the
   window's state as props; a component used outside the window (`Sidebar`, `PaneCard`, a dialog) still takes props.
   New window state goes in a hook of its own that `useWorkspaceState` calls, not in `DesktopApp`.

## Project-specific: usage and cost page (desktop)

The Usage and cost page, a section of Settings (`apps/gui/src/features/usage/`, look in [DESIGN](DESIGN.md#desktop-app)) shows only
what providers reported through the daemon's usage store ([ADR 0009](adr/0009-usage-is-provider-reported-never-estimated.md)).
A figure nobody reported is a dash in the UI, never zero and never computed from tokens. The monthly
budget is a client preference (`monthlyBudget`, validated in `preferences.ts`); the ring needs a budget, a
known cost and the Month window. The report is fetched with a query (no polling faster than 60 s), and
the page never blocks the UI thread.

## Project-specific: layout and navigation

<!-- local: user requested sidebar-bottom controls and no global footer; on 2026-10-24 they chose one exception, the mode bar along the bottom. -->

Maiker has one terminal interface, drawn to the TUI redesign: two separate frames with a one-column gap, the **sidebar** (each machine with its sessions; see *the sidebar*) and the **workspace** (one pane in a box with its title chip, or up to four boxes; see *the frame*), and the status bar along the bottom. `ui.gap` is the space between the frames. `ui.rounded` (`full`, `corners` or `off`) rounds the corners of every box (`╭╮╰╯`) with `full` or `corners` (the default); with `corners` chips, buttons and rows keep square ends, and with `full` they end in half-circle pills (a Nerd Font glyph). `ui.padding` is the blank space inside the terminal round both frames (`draw.rs` `padded`): `small` none, `medium` (the default) 1 row and 2 columns, `large` 2 rows and 4 columns; `framed` is that room less the mode bar's row. Older config values still load (`Ui::fold_retired_layout`, the file not rewritten): `tiled` (and `cards` with `panes = "tiled"`) as Floating with `gap = 0`, `grid` as Floating, and `compact`, `flat` and `hairline` as Floating. The first start with such a file says so once in a toast (`RetiredLayout::note`) and writes what stands for it into the file (`client/mod.rs` `settle_retired_layout`). Tab, Shift+Tab and Esc go to the program in the pane; the leader's Focus the sidebar moves focus to the sidebar. There is no application-wide footer bar but the mode bar (see *Mode bar*). The sidebar's foot holds the release chip and the **menu** chip, and the sidebar hides as *hiding the sidebar* says. A pane's title is separate chips on its top border: the status mark and name (the accent while it has the keys), then the folder, then the branch, a line cell between them (`workspace.rs` `title_segs`); the terminal sits inside `PANE_PAD_X` by `PANE_PAD_Y` of blank space. The first time it starts with Claude Code installed and its hooks missing, it asks once to connect them (`App::offer_claude_hooks`, remembered in `saved.hooks_offered`); `<APP>_NO_INTEGRATE=1`, a side server and a source-checkout build never ask. The mode bar along the bottom always shows the mode, then where the keys go (`keys go to claude`).

The prefix is `Ctrl+Space` by default; it starts key mode (`Ctrl+A` still works for one release unless it is bound to something or the prefix was set on purpose). Usage and cost (`u`, `screen/usage.rs`) is a modal of what each agent reported using (context, tokens, cost) and the plan limits, as the providers reported them (ADR 0009); it estimates nothing. Its tabs are chips under the title (Tab, Shift+Tab or ←→ step them): `now` (the open sessions and the plan limits) and `today`, `7 days`, `30 days`, each asked of this computer's usage store (`Query::UsageReport`, local only; a service older than the request is not asked and the tab says `Restart the service to see usage by day.`): the period's totals (cost, tokens in and out, turns, working time, only what was reported), the session count with how many reported no cost and the UTC days it covers, for a week or a month a three-row bar per day scaled to the busiest (cost when any was reported, else tokens; a day without usage is a faint `·`) with its first and last day under it and the top figure at the right, then SESSIONS, most cost first. A report kept from before shows while it is asked again (` updating… ` on the border). ↑↓ choose a session and Enter goes to it while its pane is open (a closed one reads `agent · folder` and Enter says `that session is closed`); Esc, `u` or `q` closes. Inbox (`Alt+J`, prefix `i`), Changes (`c` or `g`), Files (`f`), Branch (`v`) and References (`e`) use the right-hand sheet. Settings (`,`, or `Ctrl+,` from the sidebar) is a full window of its own (see below). The key overlay (the prefix; Search commands is leader `k` or `Space`, `?` lists all), the branch switcher and new agents use popups. Narrow windows (`render.rs` `draw`, `screen/draw.rs` `start_for_width`, `sheet.rs` `split_for_sheet`): a window under 80 by 24 draws one line, `make the window bigger: 80×24 at least`, and nothing else; under 110 columns the first frame starts with the sidebar collapsed to its rail (decided once, the user opens it again); under 140 columns Changes and the other docked sheets take the pane's place instead of sitting beside it (52 columns beside it from 140). Popups clamp to the screen. Mouse users can reach every visible control; support click, right-click menus, drag dividers, scrolling and Ctrl+click paths. A click on a toast (a finished session's note, the Restart now button) is the toast's even where it covers a pane whose program asked for the mouse; the program never sees it (`Screen::toast_rect`). A right-click menu answers each item's key while it is open and shows it only when it is a leader key (see *Menus*): the leader key bound to the same action in the live keymap (`menu.rs` `menu_keys`: split `s` / `S`, close `x`, Changes `c`), else a letter of its own, clear of those keys. A bound key the menu answers itself (`j` / `k` and the arrows, Enter, Esc, Delete, a check's `r` `o` `O` `u`, or the `x` that closes) goes to the menu, and that item takes a letter instead. Prefer Maiker's retained history when it has lines; when an agent has no retained history, pass wheel and Page Up/Down input to the agent so its own transcript can scroll. Branch (`v`, `client/screen/branch_sheet.rs`) uses the right-hand sheet: the session's branch, ahead/behind its upstream and its base branch (the main checkout's, else `main`, else `master`), the last 10 commits, the session's last check and its snapshots, all read by git in a background task. Its first row, **Switch branch…**, opens the switcher popup; Enter on a snapshot starts the row menu's restore (asked first). A folder outside git says so instead of the lists; an upstream whose remote branch is gone reads `gone from the remote`, and a git error shows in the place of what it was reading. References (`e`, `client/screen/references_sheet.rs`, files through `crates/maitty-terminal-client/src/references.rs`) lists the project's screenshots and design files from `.maiker/references/` at the repo's main checkout (a folder outside git keeps its own), so agents in every worktree see one set: name, kind, size and age per row, newest first, the selected row a neutral tint with an accent `▎`. Enter (or `o`) opens one in the system viewer as a Ctrl+click path does, `p` (or Ctrl+V) adds the clipboard image as `screenshot-<UTC time>.png`, `n` asks for a file's path (typed or pasted; a drop's quotes come off) and copies it in, `d` (or Delete) removes the chosen one after a danger confirm, `y` copies its absolute path; `e` again or Esc closes it. A paste while it has the keys stays in it: one line naming a file (a file dropped on the terminal) is added, an empty paste adds the clipboard image, and anything else gets the toast "References has the keys: …", which never repeats what was pasted. A name starting with a dot is refused. Entries the listing left out (unreadable, or links out of the folder) are counted on the list's last row in `err`, with the first reason. Empty, it reads "No references yet · paste an image or add a file", where they are kept and that agents find them through MCP, and its action bar holds only the ways to add one. Every file step runs in `spawn_bg`; the first time Maiker makes the folder in a repo it adds `.maiker/references/` to the repo's `info/exclude`. Over `--remote` it is refused with a toast, like Files. The minimum supported size is about 80 by 24; popups clamp to the screen. Mouse users can reach every visible control; support click, right-click menus, drag dividers, scrolling and Ctrl+click paths. Prefer Maiker's retained history when it has lines; when an agent has no retained history, pass wheel and Page Up/Down input to the agent so its own transcript can scroll.

**Send a file** (`client/send_file.rs`, ADR 0007). In a pane on another machine the leader key `d` opens the prompt `Send a file to this machine: its path` (mode bar `SEND FILE`; a paste or a drop puts its first line in the box, a drop's quotes come off). Enter starts the upload in `spawn_bg`; a toast reads `sending <file> to <machine>… <n>% · press the send key again to stop` and is refreshed once a second from the byte count, without adding to the notification history. `d` again, or a click on the toast's close mark, stops it (`stopping the send to <machine>…`, then `stopped sending the file to <machine>`); Esc only dismisses the toast and does not stop it, because Esc also belongs to the program in the pane. One file is sent at a time. On success the far-side path is typed into the pane like a local paste, and the toast says `sent <file> to <machine>`; every failure is an error toast (not a file, over 100 MB, no ssh to the machine, a login that needs a prompt, the machine could not keep it). On a local pane the key says there is nothing to send.

The sidebar's **+ New** chip and `n` start a shell at once (see *New session*). A project row's **+**, the empty project row's new action and leader + `t` are one action (`Action::ShellHere`): a plain shell where you are, whose tab opens with focus. Leader + `n` (New session, `Action::PickSession`) does the same. You type your agent in it (see *Agent launchers* below). The Menu has no Session... row and there is no New session dialog or instant agent session: New session is a plain shell too. **Menu** is in the sidebar footer. Every row of the key overlay and the Menu is clickable and wheel-scrollable. Include configured commands and retain existing confirmations.

When an update is available, show **Update <version>** at the right end of the mode bar and open the existing confirmation flow when clicked. Do not show the control when Maiker is current. Keep status icons and pane status tags clickable to open the evidence explanation. Terminal bells do not add sidebar indicators or history entries.

Mark one selected sidebar row independently from hover: the keyboard selection stays selected when the mouse moves; hover is a separate, quieter tint. The open session keeps a dim selection bar while another row is under the keyboard. Preserve agent status icons and colors in each state.

Settings is a full window, not a modal (`screen/settings_page.rs` `draw_settings_screen`; the status line stays below it). A title row (`Settings`, and `saved to <the real config path>` at the right, `config::config_path`) and a rule, then a 20-column list of pages at the left (`modal::Cat::ALL`) and the chosen page's rows at the right. The design's six pages come first: General, Appearance, Notifications (`Cat::Alerts`), Machines, Agents and About. Under a short rule come the pages the design does not list, kept so no setting becomes unreachable: Sessions, Check and Keys. The chosen page is bold on `selection_bg` with an accent `▎` while the page list has the keys, and on `hov` while the rows do.

A row is two or more lines: the label, then its dim description (`Setting::help`) word-wrapped under it, with its control at the right of the label line. The selected row has the `hov` ground. A switch reads `━━● on` in the strong text colour and bold, or `●━━ off` dim (`design.rs` `switch`). A choice of four or fewer values that fit in 44 columns is drawn as segments (`segmented`): the chosen one filled with the border colour and bold, each segment its own click target. A longer choice, a number, a key or a text row keeps `‹ value ›` or its own control. Words that differ from the stored value: Corners shows `Square`, `Rounded` and `Pills` for `off`, `corners` and `full` (`option_label`); Reduce motion is the stored `ui.motion` read the other way (`Kind::BoolOff`); Working spinner shows Blocks, Braille, Dots and Line with the live frame in front of them, and Enter opens the full list.

The design's own rows lead each page under no heading (`design.rs` `FEATURED`): General: Own worktree for new chats, Restore chats when Maiker starts, Default agent. Appearance: Theme (Dark or Light: there is no System choice yet), Corners, Working spinner, Reduce motion, Mouse. Every other setting follows under the heading it always had (`GROUP_ORDER`), rows keeping their `SETTINGS` order within a group. Machines lists This computer, then each configured machine: `ssh <target> · Maiker <version>` and `older than this computer` when its app needs an update, its connection at the right and `u update <machine>` when `machine_fix` says so; Enter opens the Machines dialog on it. No wake action exists, so none is drawn. Agents leads with Claude Code and Codex (their config folder and what the hooks report), then Connect agents and Approved commands. About is the only page that shows the version: `maiker <version> · <new> is ready · i install` or `restart to finish · r restart`, or `up to date · u check now`, with the installed, daemon and restart-pending notes under the page's top.

Keys: while the page list has them, up and down choose a page, and Enter, right or Tab go into its rows; in the rows, up and down move, Space or Enter toggles a switch or steps a choice, left and right change a choice, Tab and Shift+Tab change page, and Esc goes back to the page list, where Esc closes. `o` opens the config file, `u` looks for an update (on a machine's row, updates that machine), `i` installs what was found and `r` restarts to finish (`R` also asks for the restart). A click on a page opens it, on a row selects it, on a segment or switch sets it. Settings opens with leader `,` and, while the sidebar has the keys, `Ctrl+,`. A window too narrow or too short for the rows says `Make the window wider` or `taller`.

There is no Team tab; `[team]` in `config.toml` still loads and is no longer shown. When a newer release is out, About says so in the accent with an **Update now** button. Keep release notes and confirmation in the existing flow.

**Settings › Sessions** opens on NEW SESSIONS (`[sessions]`: `Agent` last used, claude, codex or gemini, `Where` new worktree or this folder) and HELPERS (`Sessions may start helpers` ask, always or never; `Helpers at once` 2, 3 or 4), then the older alert, restart and history settings. Values outside those lists are refused when the config loads. `Agent` and `Where` are read only by the worktree and agent flows that remain (an old `plus_starts` key is read and ignored); the helpers settings are read by the daemon when an agent starts a session (see *helpers*). `[mcp] helpers_at_once` is not a setting any more: it is read only as a fallback for `[sessions] helpers_at_once`. **Settings › Agents** opens on AGENT STATUS: Claude Code reads `✓ hooks installed` (read once in the background when the page first shows, `checking…` until then, `hooks not installed` otherwise; the same test as `maiker doctor`), Codex reads `✓ read from the process and screen` until its lifecycle hooks are installed, then `hooks installed · trust them in Codex /hooks` until Codex has recorded trusting each, then `✓ hooks installed and trusted` (read once in the background; its help says Connect agents installs them and you review them once in Codex's `/hooks`), and `Connect agents…` opens the Connect agents list (`Action::AgentStatusSetup`), which offers exactly the agents `maiker integrate` sets up (`STATUS_AGENTS` in `crates/maitty-agent-integrations/src/lib.rs`, re-exported by `cli/integrations.rs`). An agent that started before its hooks were installed never reports through them (`TermInfo.hooked` stays false) until it restarts: the palette's **Reload agents that missed their hooks** (`Action::ReloadAgents`) and `maiker reload-agents` restart each one in place and resume its conversation (`Command::ReloadAgent`, `reload_agent` in `restore.rs`). One working or waiting for you is left alone; `maiker reload-agents --all` restarts it too, and `--dry-run` only lists (`cli/reload.rs`). PERMISSIONS has **Approved commands…** (`screen/approved.rs`): Enter opens a modal listing the commands a chat was let run "always in this project", as this computer's daemon keeps them (`Query::AllowedCommands`; a service older than the request is not asked and the modal says to restart it), grouped by project (the folder as a muted heading), newest first, each with `approved 3d ago`. The command is drawn as text, cleaned of control characters. `x` (or Delete) on one asks `Forget this command? The chat asks again before it runs it.` in red with Enter forget it / Esc keep it; only Enter sends `Command::ForgetAllowedCommand`, then the list is asked again. Nothing is approved from here. SUBAGENTS has `Subagents in the sidebar` (`ui.subagent_count`, on by default): off leaves the subagent rows out of the sidebar. The `mcp.*` and worktree settings follow. General's `Leader waits for next key` (`ui.which_key`, off by default) shows every key if you pause after the leader.

**Status log** (`client/screen/status_log.rs`, Search commands' **Status log**, the row menu's **Status log** while the session has events). A modal titled `status log · <session>`: `Now` and the reason the daemon gave for the status it set last (`TermInfo::status_why`), then what the agent's own reports and the shell's prompt marks said happened (`TermInfo::timeline`), newest first: the local time, what happened (`Started working`, `Stopped for you` in amber, `Finished the turn` in green, `Command finished (exit 1)` in red for a non-zero exit), `ran 3m 12s` on a turn that ended, and the event's detail. It explains the status; it never sets one (ADR 0003).

**Broadcast** (leader `a`, Search commands' **Broadcast typing to this tab**; `client/screen/broadcast.rs`). While the tab on screen broadcasts, each key typed into its focused pane is typed into every pane of that tab too, and a paste is pasted into each the way that pane takes one (bracketed or not). The mode bar's chip reads `BROADCAST · N PANES` in red instead of `PANE`, with `<leader> a stop` first among its hints. A tab with one pane refuses it with a toast. It belongs to the tab and is not saved. **Reset pane widths** (Search commands) gives the tab's panes equal room: each split shares its room by how many panes lie along it on each side, so three side by side get a third each; the layout is saved as a drag saves it.

**Recent sessions…** (Search commands; `client/recent.rs`). Asks this computer's daemon for the agent sessions that closed or crashed (`Query::ClosedSessions`); a menu by the focused pane opens with `looking for closed sessions…` and fills with the twelve newest: `Claude · 2h ago · <its name> · <folder> ⑂ <branch>`. Picking one sends `Command::ReopenClosedSession` (the daemon starts it again with its conversation, making a removed worktree again from what it recorded) and toasts `reopening the session…`; an agent other than Claude or Codex reads `· can't be reopened` and its row does nothing. With none kept, one toast says `no closed sessions to reopen`. A reply after the menu closed opens nothing; a daemon older than the request is not asked (`restart the daemon to list recent sessions`). Another machine's closed sessions are not listed.

**Subagents are rows, not chats.** The sidebar lists the subagents of an agent's current turn under its row (see *the sidebar*), from what the daemon tracks (`TermInfo::subagent_activity`), and nothing more: a click opens the parent's pane, where the agent shows them in its own terminal. There is no chat view in the TUI and no inspector. `ui.subagent_count` turns the rows off.

**Secret requests open by themselves** (`client/screen/secret_ask.rs` `auto_open_secret`, called after each state update). A request not yet offered opens its prompt beside the row when the mode is Normal or Side and no side view is open; otherwise it waits and the row's `asks for a secret` line stands. Each request id is offered once, so Esc is final. A prompt opened this way ignores keys and pastes for 1.5 s (Esc still declines), so a line being typed in a pane is not given away as the secret; one opened by Enter or a click on the row has no wait. Closing returns to the mode it opened from.

**Helpers are not a mode** (`client/screen/helpers_ask.rs`). Any session may start helpers (other agents it starts through `maiker mcp`); `[sessions] helpers` (ask, always, never) decides. When a session asks and the setting is `ask`, its row is **needs you** (amber, as for any question) and its second line reads `wants to start N helpers` (`wants N helpers` on a narrow sidebar). Enter on the row with the sidebar focused, Enter (or a digit) on its row in the Inbox, or a click on that line, opens a popover beside the row (from the Inbox, Esc or an answer goes back to the Inbox on that row): the screen dimmed except that row, a full accent border, a `◂` on the row, the title `START HELPERS? · <session>` and `Esc later` at the right. It says which agent wants to split the work into N helpers, lists the tasks (five, then `+ n more`), then "Their permission prompts come to your Inbox. Nothing merges." Buttons and keys: `1` Allow, `2` Always in <project> (`Always here` when narrow), `3` No, do it alone, each clickable; Esc decides later and the row keeps asking. Enter, `y` and Space do nothing there, and `1`/`2`/`3` act only inside the popover: no bare key answers from the sidebar or the collapsed strip. The answer is a command the daemon accepts only from you and only while it holds the request (`docs/API_PATTERNS.md`).

Keep update indicators until the installed program, window and daemon versions agree. Installing an update leaves open sessions running until **Restart now**. For a local daemon, when no panes are open, restart it automatically (see below). For a remote daemon, explain that it must be updated on its host after its sessions are closed. The one `↑ Update` pill sits at the sidebar's foot above its divider, or on the mode bar when the sidebar is collapsed, hidden or short, and becomes `↻ Restart` once a newer maiker is installed (here, or from outside maiker) and the server or this window still runs the old one; it clicks through to the same restart. The splash carries the matching line; there is no second notice in the working area.

**Restart now** is one step: it restarts the server onto the installed maiker **and** replaces this window with the installed one in the same terminal. It shows in Settings' restart-pending line (`R`), on the toast after an install (it stays 12 s), on the `↻ Restart` pill, and as the palette action *Restart maiker* (`Action::Restart`, `restart`); none show for a remote daemon or while a restart is under way. It asks only when a session is working or waiting for you (or when `restore.enabled` is off, since then sessions close for good): a confirm (`menu::Confirm`, danger) reading "4 sessions stop and resume, 2 are working, 1 waiting for you" with Restart (Enter) and Cancel. Otherwise it restarts at once. The server saves its session and every pane's output first (`KillServer`), then the window closes and the installed maiker opens in its place (`restart::relaunch`: exec on Unix, spawn-and-exit on Windows, same arguments and `AGENT_SOCKET`), which starts the new server and restores the sessions. A window that is already current (only the server is old) reconnects in place; a current server with an old window swaps only the window and leaves every session running. An agent mid-turn is stopped when the server stops. A terminal agent cut mid-turn is not started again: its pane comes back as a shell with a Resume banner that offers its resume command (`TermInfo.interrupted`; see *After a restart*). A chat conversation resumes by itself on the same provider session (`restore.conversations`); the turn in flight is not replayed, and only with `restore.continue_turn` on is it sent `Continue where you left off.` once.

A new `maiker` that finds a server of another version replaces it on the way in. A server of an older release whose protocol this one speaks, and which holds no session, is stopped at once (`restart::replace_older_idle_server`, from the activity file the server keeps beside its pid file: `restart::Activity`). A server whose protocol this one cannot speak (`ipc::OtherVersion`) is judged by that file, or for a server too old to write one by the agents in the saved session (`restart::plan_for_mismatch`): when it holds no session, the terminal says `Updating maiker…`, the server is stopped by its process as `maiker kill-server` does across versions, and the window opens, with no prompt. When it holds sessions (a restart ends whatever runs in them: a build, a dev server, an agent's turn), the full-screen prompt (`client/restart_prompt.rs`) shows the protocols, how many sessions resume and how many are mid-turn, and **Restart service** (Enter, `r`) and **Not now** (Esc, Ctrl+C), each clickable; Not now prints the usual error and exits 1. A server newer than this maiker is never replaced by it, asked or not: that would be a downgrade. The prompt then offers **Update this app** (Enter, `u`) and **Not now**; the update installs the newest release over this maiker and starts it in this one's place, and the server and its sessions are not touched. When this maiker is already the newest release, it says a newer copy started the server and exits 1. Without a terminal on stdin and stdout, or with `--remote`, there is no automatic step or prompt: the error text and exit code are unchanged, and a remote server is never restarted this way. A same-protocol older server that holds sessions is left running; the `↻ Restart` pill offers the restart.

**One key overlay** replaces the command palette, the long shortcuts reference and the old leader overview (`client/screen/keyoverlay.rs`). It has three faces in one card with one typing row: Its card has no fill (its lifted rows are flattened to the ground), a red `×` close on the top border, and its key hints are chips on the bottom border.

- **Key map** (the prefix, or the pause after it). A banner, "Every key goes after the leader: `Ctrl+Space` then `s` = split", then Sessions, Panes, Sidebar, Tools and Maiker, each key a keycap followed by its name, from `key_groups()` and the real bindings. A pressed key runs its command; `Tab`, or an unbound letter, switches to the search. Three columns when the card is 100 or more wide, else two; each group's key column is as wide as its widest key. A key marked `›` opens a second step (Worktrees). Action bar: `key` run it, `Tab` search, `?` show all, `Esc` close.
- **Search** (leader `k` or `Space`, the sidebar's `⌕`, or the Menu's Search commands; `client/screen/search.rs`). A box near the top, up to 76 columns, titled `Search`, with `⌕` and the typing on its first row (`Search chats and commands` while empty). Under it two groups. **Chats**: the status mark, the name, `project / branch · machine` and the age, at most 8; Enter goes to the chat. **Commands**: with nothing typed, New chat, Show changes, Compact this chat (only while the chat in front has used 80% of its context or more), Settings, Collapse or Expand sidebar, Group by machine or by status (it names what the next press does), Light or Dark theme, Install update (only while an update is available) and Keys, each with its key as caps at the right (`Ctrl+Space k`; none for a command without one). Typing narrows the Chats and the Commands and also reaches every other command, as a case-blind in-order subsequence with names that begin with the text first (`spld` finds Split down); a set of keys (the arrows) is searched one key at a time. From three typed characters, **In chats** follows: the newest line each chat printed that holds the words, at most ten, as `>_`, the line cut round the match and the chat's name (see *Find in every session*); Enter goes to that line. `↑ ↓` move the lit row, and so does pointing at one; `Enter` opens; `Esc` closes. When nothing matches the box says `Nothing matches.`
- **Keys help** (`?`, the sidebar's menu → Keys; `keyoverlay.rs` `draw_keys_help`). An accent box on the panel ground, up to 104 by 40: `keys` on its top border at the left and `esc close` at the right (with `↑↓ more` beside it when the list is longer than the box). It lists every bound key with what it does, read from the keymap (`leader_entries`, `direct_entries`), so a rebound key shows where it is now: the key map's groups (sessions, panes, sidebar, tools, maiker) with the keys after the leader, then the keys that need no leader. Two columns from 90 columns wide, else one; a key's column is as wide as the widest key, 12 at most. Under it: "Keys only work in key mode (Ctrl+Space). Everything else goes to the pane." Esc, `?` or a click anywhere closes it; the arrows and Page keys scroll; any other letter starts a search.

Rules for keys and their labels: one key per action (no alias keys; a user's own `[keys.prefix]` entries still load), no default needing Shift, keys other apps use, sentence case, no bracketed explanations (the group gives the context). Every action has a leader key or is search only; while the sidebar has the keys, bare `n` (New session), `g` (group by status or machine), `s` (sort), `f` (group and sort menu), `m` (sidebar menu) and `?` act on its rows, with F2 (rename), Delete (close) and Shift+F10 (menu) (`screen/side_keys.rs` `on_side_shortcut`; listed under IN THE SIDEBAR in the key overlay). `docs/shortcuts.md` documents the other screens' keys and is not embedded in the app.

**Project tools** (`client/screen/sheet.rs`, `menu.rs` `project_items`). A click on a pane's folder and branch chips on its bottom border, its right-click menu's Project…, or the key of each tool (leader `f` Files, `c` or `g` Changes, `v` Branch, `h` History, `e` References) open Files, Changes, Branch, History and References. Files, Branch and References slide in as a panel from the pane's right edge, over its box including the pane's top line and its own close (`draw.rs` `grid`, `sheet.rs` `draw_panel_frame`): Files 96 columns and at most 80% of the panes, the others 60 and at most 80%, until you size it (one saved width, `Saved::sheet_w["drawer"]`, drag its left edge or `[` `]`), so the panes are never resized by them. Changes is the exception and docks (see *Changes panel*). A panel's title chip names the tool and ` ✕ ` closes it, and Tab / Shift+Tab step along the tools while it has the keys. Files shows the tree and the open file side by side from 60 columns, and by turns under that. Under the tools the menu also keeps what the folder offers that the flat design has no place for: New / Open / Tidy worktrees, Rename and Close project, Snapshots and the check's output, re-run and override. The check sheets stay docked beside the panes (`PANES_KEEP` columns kept for them); the Inbox floats (see *the frame*). There is no tool rail. A draggable edge (the sidebar's, the panel's) lights in the accent while pointed at or dragged.

**Changes panel** (see *Project tools*). `client/screen/changes_panel.rs` draws it, `client/changes_more.rs` holds its keys and git steps. It opens with leader `c` or `g`, `Ctrl+G` while the sidebar or the panel has the keys (a pane gets `Ctrl+G` itself), or the pane's `± changes N` button, and closes with its `✕`, `Esc` or the same key. It docks 52 columns wide beside the pane (the pane reflows), and below 140 columns it takes the pane's place. `[` `]` size it, `=` resets it (saved as `Saved::sheet_w["changes"]`).

Top to bottom, over the whole panel's width:

- `⑂ branch from main · ↑2 to push` (`nothing to push` at 0; the `from` part is left out on the base branch and `on <machine>` follows the branch for another machine's pane), then `2 of 3 in the next commit` (and `· ✎ N` while comments wait for the agent).
- The files, one row each, with the box `[x]` / `[ ]`, the letter `A` (new, green), `M` (changed, `warning`) or `D` (deleted, red), the path and `+N −N`. The chosen file has the selected fill. Every changed file starts in the commit (`ChangesExtra::unticked` holds the ones left out), so a file the agent changes next is in without a key. `Space` or a click on the box flips it; a click elsewhere on the row chooses it. The list gives way first when the diff would have fewer than 4 rows.
- The chosen file's diff: `+` lines in green on a 9% green tint across the row, `−` lines in red on a 9% red tint, the rest in `muted`; `PgUp` `PgDn` and the wheel scroll it; `l` puts a cursor on its lines for a comment (`Enter`, then `s` sends them to the agent).
- The commit message in a bordered box (the agent's summary, else a line made from the picked files), and under it `Message written by Claude. Click it to edit.` A click or `m` edits it: `Enter` is a new line, `Esc` stops editing and keeps the text.
- `[ctrl+enter] Commit 2 of 3` and `p Create PR`. A commit takes only the picked files and says `Committed 2 files on <branch>`; with none picked it says `Pick at least one file to commit` in the warning colour and commits nothing. `p` asks, then pushes the branch and opens the pull request: `Opened PR #301 · branch → main`.

With no changes it says `No changes on <branch>.` The review is what is not committed yet (against `HEAD`), so a committed file leaves the list. The other keys stay: `x` mark reviewed, `e` editor, `r` the agent, `f` `u` `P` fetch, pull, push, `M` merge the pull request, and on a linked worktree `B` merge it into its base and `d` throw it away.

**Cursor.** The focused pane shows the cursor its program asked for (DECSCUSR, read from its output); where it asks for none, or for the default, Settings › Appearance › Cursor (`ui.cursor`: `block` by default, `underline` or `line`; an older `terminal` reads as `block` and `bar` as `line`) and Cursor blink (`ui.cursor_blink`) decide (`client/mod.rs` `cursor_code`). An unknown `ui.cursor` is refused when the config loads.

**Background.** Settings › Appearance › Background (`ui.background`): `solid`, the default, paints every cell the theme's `bg` and sets the terminal's own background to it (OSC 11, given back with OSC 111 on exit) so a plain terminal shows the whole theme; `terminal` leaves the chrome on the terminal's background (SGR 49) for transparent or image backgrounds (`client/render.rs` `draw`).

**Keycaps.** Every key the UI shows is a keycap from `design::keycap`: ` key ` on `btn`, `strong` and bold, with the ends round when `ui.rounded` is `full`. A combo splits on `+` into one cap per part joined by a dim `+`. The map, the search, hint rows, Settings key rows, dialogs and the copy hint all use it.

**Action bars.** A panel's key hints sit in their own one-row bar (`action_bar`, `panel_bar` in `popups.rs`) on a ground one step above the panel's: `card` for a sheet on the app background (Inbox, check evidence) and `card2` inside a modal (Settings, the key overlay, confirms, pickers). It spans the panel's width with one column of padding, shows keycaps and labels, and is always the panel's last row. When the hints do not fit they close their gaps, then give up the ones before `Esc`.

**Menu.** Sections a blank row apart, each under a `muted` title that says what its rows are for, labels capitalised, no letter lit: `NEW` (Shell here, Pane beside this, Clone a repository…); `TOOLS` (Files, Changes, Branches, History, References); `FIND` (Inbox, Search commands, All keys); `SIDEBAR` (Collapse sidebar); then Settings, untitled. The arrows move over rows and skip the headers; the selected row has an accent `▌`. In a short window the blank rows give way first, then the titles, so every row that does something stays (`leader.rs` `MenuRoom`). No row shows a key (a bare letter reads as one that works anywhere), but the leader key that does the same runs the row inside the Menu too; there is no footer. "Shell here" is leader `t` (a plain shell where you are); New session (leader `n`) starts one too, and Ctrl+T goes to the program.

**Resume a conversation here** (Search commands only, `Action::ResumeConversation`, `resume-conversation`; `client/resume.rs`). It asks this computer's daemon for the conversations Claude and Codex saved for the selected pane's folder (`Query::SavedConversations`, one per agent; the answers arrive as messages). A menu by the pane opens at once with one row, `looking for saved conversations…` (picking it only closes the menu); once both answers are in, it shows the nine newest across both agents: `Claude · 3h ago · <the first message>`, cut to 44 columns. Answers that arrive after that menu was closed open nothing, and an error from this computer's daemon while it waits closes it under the error's toast. A daemon older than the request (`ClientMsg::introduced_in`, against the protocol it named when this window connected) is not asked: one error toast says `restart the daemon to list saved conversations`. Enter or a click starts that agent in a new pane in the folder with the agent's resume command from its `[[agents]]` definition (`claude --resume <id>`, `codex resume <id>`); an id that does not start with a letter or digit, or holds anything but letters, digits, `-` and `_`, is refused with an error toast. With none saved the menu closes and one toast line says `no saved Claude or Codex chats`. A pane on another machine gets the local-only toast (see *features that need a pane's files*).

**Changes: ticks, the message and comments** (`client/changes_more.rs`, both for a pane here and
on another machine). `Space` or `t` ticks the chosen file (the `[x]` / `[ ]` box before its name);
`m` edits the commit message in the panel's message box (`Message written by <agent>. Click it to edit.`) and
`Ctrl+Enter` (`Ctrl+J` on a terminal that cannot tell it apart) commits the picked files; the message is the agent's summary, else `Update a.rs, b.rs` or `Update N
files in <folder>`, as the desktop app writes it).
None picked says `Pick at least one file to commit` and an empty message `Write a message first`, and nothing is committed. Picked files are committed alone with `git add -A -- <paths>`
and `git commit -- <paths>`, so what else is staged stays out (`tasks::commit_with`).
`f`, `u`, `P` fetch, pull and push here too (`tasks::sync`). `l` (or →) gives
the diff the keys: a `▶` cursor on its lines (↑↓ / `j` `k`, PgUp/PgDn), Enter on an added, removed or
unchanged line writes a comment there (`Comment for <agent> on <file>, line N`, Enter keeps it, Esc
drops it), shown under its line as `✎ <comment>` and counted `· ✎ N`; `h`, ← or Esc gives the keys
back to the files. `s` hands every comment to the agent's message box (the follow-up popover) as
`About <file>, line N:` (`(removed)` for a removed line), the line quoted with `> `, a blank line and
the comment, comments a blank line apart: what is sent is read there first, and Enter sends it, Esc
keeps it as the session's draft. The comments leave the diff once handed over; a pane with no agent
says so instead.

**Find in every session** (Search commands only, `Action::FindSessions`, `find-sessions`; `client/screen/session_find.rs`). A box up to 110 by 30 titled `Find in every session` (`Find in this computer's sessions` while other machines are connected) with a typing row, then each line found: the session's status mark and name (24 columns), then the line cut to 60 columns round the match (16 before it, `…` where cut, control and invisible characters dropped) with every match in the accent. It asks this computer's daemon (`Query::PaneSearch` → `Reply::Search`, at most 100 lines, 20 a pane, newest first) once three characters are typed and typing has paused 300 ms; one search runs at a time (the answer carries no tag), the newest query goes when it returns, an answered query is not asked again, and one unanswered for 10 s is given up. Lines of panes the window does not show are left out. Under three characters it reads `Type at least 3 characters.`, then `searching…`, then the lines or `No session printed that recently.` (`No session on this computer printed that recently.` with other machines connected). Enter, or a click on a chosen row, focuses that session and opens copy mode on its history at the newest match of the words (`n` / `N` for the others; Esc leaves it). Esc closes the box.

**Agent launchers.** Typing an agent (`claude`, `codex`, `gemini`, `opencode`, a quick agent) in a Maiker shell in a git repo's main checkout starts it in a new worktree (`worktree.per_agent`); anywhere else, or in a folder that is not a git repo, it starts where you are, silently. It works from any shell because `<data>/shell/bin/` is first on the pane's `PATH`; see ARCHITECTURE › Agent launchers. No toast or warning is shown for main folders.

**New sessions** (`client/screen/newsession.rs`). Leader `n` and leader `t` start a plain shell with no form (`Action::PickSession` and `Action::ShellHere` both reach `new_ship`): in the folder you are working in in that workspace (else where it last was, else the workspace's own), with the toast `New shell · <folder>`; with no workspace it starts the Scratch one, and an offline machine says so. You type the agent in the shell (see *Agent launchers*); a just-started agent's row shows its name and idle mark with no words under it. A new tab (leader `t`) takes only the shell that answers it: it waits ten seconds at most, takes only a pane that did not exist when the tab was asked for and that no agent started (another pane taking the focus leaves it waiting), and starting any other session before it arrives cancels the tab, so that session gets its own row and tab bar rather than becoming a tab of the one you were in.

## Project-specific: pane focus

Only the area with the keyboard is lit: the focused pane's whole border, or the open sheet. Unfocused panes fade by the Dim setting (off, light, normal or heavy; normal by default, and an older config's "subtle", "30%" and "60%" read as light, normal and heavy). Do not reserve a full-width bottom row for global hints; the mode bar is the one exception. The pane has no status line: its branch is in the sidebar's folder header.

## Project-specific: UI conventions

<!-- local: user requested distinct active, keyboard and hover sidebar states, mouse-first sidebar controls and parent-owned child-agent visibility. -->

- Popups are centred `panel()`s (`panel_at()` for a given rectangle) framed like a
  pane, in every layout: a box in the `accent` (a modal holds the keys) with corners by
  `ui.rounded`, on the panel ground (`flatten_modals`), the title as an accent chip on the top border two in, and a × chip (`btn`)
  a cell of border before the top right corner (the whole chip closes it); with `ui.rounded = full`
  both chips have caps. There is no accent bar across the top: the user chose the
  pane-like frame over an accent title bar (2026-10-24).
  No shadow; the screen
  behind is left as it is, not dimmed: the modal fills its own area with the panel ground (`dim_all` only
  marks what is behind as taking no hover). Small explanations (why, a row's menu) are
  popovers (`screen/popover.rs` `frame_beside_row`): beside the sidebar row they belong to, the screen dimmed except that row, a full accent border on `card` and a `◂` on the row, no shadow
  Settings is a
  full window of its own (`screen/settings_page.rs`, see above) that keeps its pages (General,
  Appearance, Notifications, Machines, Agents, About, Sessions, Check, Keys), update controls, and keyboard
  and mouse editing available.
- The pointer's tint is one pass after drawing (`render.rs`): the topmost
  clickable region under it is tinted once, `mix(bg, text, 0.10)`, its ends round like every other shape when `ui.rounded` is `full` (`card.rs` `round_tinted`: an end cell holding only ground, or already a rounded end, becomes a cap or soft corner; an end with text stays square). Widgets do
  not tint themselves on hover. Only the top layer takes the pointer: `dim_all` marks every
  region drawn before it as under the overlay (`hits_under_overlay`), so behind a modal,
  popover or floating pane nothing tints and the pointer keeps its arrow, and an overlay's
  backdrop (its click-outside region) is never tinted. Inside the overlay hover works as
  anywhere.
- Shortcut mode ends on Esc, the leader again, a click, or an action that takes you into a
  pane to type (`n`, `s`, `t`, the splits, `spawn-*`, `o` once its
  dialog starts one, the worktree picker, opening a project). Each calls
  `leave_shortcut_mode`, which also sets an open side panel aside so the next key reaches the
  pane; `screen_new_session` and `screen_new_worktree` call it for you, and a new way to start
  a pane must too. `screen_start_pane` starts one without it, only for a pane nobody asked
  for (the home shell after the last session closes).
- Leader `x` closes what has the keys (`actions.rs` `ClosePane`): a side panel that has them
  (`view_has_keys`) closes with no question, so x never stops the program in the pane behind
  it; Files with unsaved edits stays open and says so. A click into a pane, or moving into the
  sidebar (`screen_side_set`), sets the panel aside: then x closes the focused pane, or in the
  sidebar the cursor's row, with its `Close pane` confirm. `f` or a click in the panel gives
  it the keys back.
- Selection is a neutral tint (`sel_on` of the surface it sits on) with an accent `▎` bar;
  never the accent colour as a row fill.
- Every popup row is clickable and keyboard-reachable; every key is shown as a
  keycap somewhere (hint bars, the key overlay, Settings).
- Short-lived notes are toasts above the pane content; destructive actions ask
  first (`Confirm`) and go last in menus.
- Anything filled that you click or read as a control (a button, a toggle, a tab, a tag,
  a key) is drawn with `button` / `btn`, `chip` or `pill`, so its ends follow the pill
  setting everywhere. Never a bare `seg` on a button colour.
- Copy is plain words ("Focus the sidebar", not "browse-tree").

## Project-specific: sign-in card

`SignInCard` (`features/signin/`) is the one surface for signing an agent in. In a Claude chat `/login` opens it
above the message box, in the place of the aside card (`windowCommands.ts`, route `signIn`); in Settings it sits
above the Accounts card, started by Sign in. It shows the link's host, Open link, the code in a monospace box
that selects whole, Copy code and Cancel while waiting; "Signed in to <agent>" with Done, or the reason with Try again and Close, when it ends. Escape cancels
a waiting sign-in and closes an ended one. A failed one in Settings also offers "Use a terminal", the older
path. The card never shows a token. Behaviour and limits: [chat-sign-in spec](features/chat-sign-in/spec.md).

## Project-specific: theme browser

Dark and light are two remembered slots and a switch. Appearance has three rows:
**Appearance** (`appearance`: `dark` or `light`, which slot shows), **Dark theme**
(`theme_dark`; the desktop app defaults to Maiker Dark and does not list Maiker Night, which only the terminal app ships and starts on) and **Light theme** (`theme_light`, `day` by default, shown as Maiker Day). Maiker Dark (`maitty-dark`) and Maiker Light (`maitty-light`) are the neutral black and white pair.
`theme` stays "the theme showing now": `Config::settle_theme` sets it from the slot
`appearance` picks, so once a file has slots a `theme` written by hand is overwritten.
A file with only an older `theme` is not rewritten: its theme fills the slot its ground
belongs to and decides the appearance, one slot at a time (a light pick written beside an
old dark `theme` leaves that dark theme showing).
Enter or clicking a theme row's value opens a searchable browser with two tabs, **Dark** and
**Light** (`Tab` / `Shift+Tab`, or a click on the chip at the foot), each listing only its
themes, opened on the tab of the row you came from and on that slot's theme. Which tab a
theme is on is read from its background (`theme::is_light`), not from a list. The browser
shows palette swatches, an applied marker for that slot, a result count, and a preview.
Themes are listed alphabetically by display name, ignoring case (`BUILTIN` in
`theme.rs` is kept in that order, and every list of themes follows it); there are
no user-defined themes, only overrides of a built-in's colours. **Fifty-five themes are built in**, twenty-nine dark and twenty-six light: Maiker's eleven (Night, Day, Dark, Light, the chat handoff's Abyss, Ember, Moss, Dusk and Paper, and Retro Dark and Retro Light) and a dark and a light of each of GitHub, One, Catppuccin (Mocha, Latte), Solarized, Gruvbox, Tokyo Night, Dracula (with Alucard), Nord, Ayu, Everforest, Rosé Pine, Kanagawa, Nightfox (with Dayfox), Flexoki, Gruvbox Material, One Half, PaperColor, Tomorrow, Melange, Cyberdream, Doom One and Zenbones. The list is `crates/maitty-settings/themes.json`, the same file the desktop app reads, and a test holds `BUILTIN`, the display names, each theme's side and each family's ground and text equal to it. A theme id from an older build, one of the 160 or so removed in the cut, still loads: `ALIASES` in `theme.rs` maps it to the nearest survivor on the same side (by the colour of its ground), so a config that says `dracula` shows One Dark.
On a theme row in Settings, Left and Right step through that slot's themes and apply each at
once (`themes.rs` `step_theme`), so the whole screen shows the change; Enter or Space opens the
browser below for searching.
Typing filters by name or flavor; arrows, Home/End, page keys, and the mouse wheel
move the selection. Click a row to preview; click it again or press Enter to
save that tab's slot, which changes the screen only if that slot is the one showing. Esc or
the close button returns to Appearance without changing anything.
Saving runs in a background task; failure keeps the selection and shows a toast.
The key overlay's search has **Switch dark or light theme** (`toggle-appearance`, no default
key), which flips `appearance` and changes the whole screen at once.
The preview shows built-in defaults; configured overrides still apply after saving.
See [theme sources](theme-credits.md) for upstream palettes and local UI adaptations.

## Project-specific: folder picker and loader

**Open a folder on <machine>** (`PickFolderDialog`, `useFolderPick`; the New session draft, the folder rule and the clone folder all use it) is a 580px float. Its title names the machine with a dropdown to change it (a status dot per machine; an asleep one is amber and says "<machine> is asleep. Wake it, or pick another machine."). There are no tabs: a repository is a folder, so it is found by browsing, and its git branch shows beside its name in the list. Under the filter input sit an up button, the path as clickable parts and **New folder**; the list has a row per folder (its branch, an enter chevron); the foot holds a **Hidden folders** switch. One input filters the list, or goes to the path when the text starts with `/`, `~` or a drive. Keys: ↑ ↓ move, Enter and → go into a folder, Backspace and ← go up, Ctrl+Enter chooses the folder shown, Ctrl+Shift+N opens New folder, Esc clears the input and then closes. The button reads "Open <name> ↵".

**New folder** (button at the end of the path, Ctrl+Shift+N) opens a field at the top of the list, in the folder shown, on the machine shown. Enter creates, Esc cancels it (and does not close the dialog); the field keeps its own keys (arrows and Backspace do not move the list). The name is checked while typing by `folderNameProblem` (`model/folderName.ts`, the same rule as `maitty_shared::folder_name`): not empty, at most 255 bytes, no `/ \ < > : " | ? *`, no control or hidden characters, not `.` or `..`, no leading or trailing space or trailing dot, no Windows device name (CON, NUL, COM1…), not a name already in the folder (case-insensitive). The reason shows as a line under the field (`role="alert"`, `aria-describedby`), never a toast, and a daemon refusal (`NotAllowed`, `Failed`, a folder that already exists, a machine that did not answer) shows in the same place with the field kept. The folder is made by that machine's daemon (`createFolder`, `api/folders.ts`), the folder is read again and the new one is selected, so Open picks it; a name starting with `.` turns Hidden folders on so it can be seen. A machine whose service predates this (its listing has no `can_create`) shows the button disabled and the line "This machine's service is older: restart it to create folders."; Ctrl+Shift+N does nothing there.

Why the picker is the app's own and not the system's: it lists folders on the machine the session will run on, through that machine's daemon, SSH machines included; the system dialog can only browse this computer. The repository index (`Query::Repositories`) is no longer asked for by the window.

The **M loader** (`MLoader`, `components/ui/m-loader.tsx`) is the one spinner for a wait of a second or more: the three strokes of the M icon drawn in turn over 2.4 s, with a word beside it ("Reading <machine>…"). A list shows it only after 160 ms, so a quick answer never flashes it; the working badge and row marks keep their own marks. Reduced motion draws the M still. There is no spinner choice in Settings: the preference is not shown, and the stored value is ignored.

## Project-specific: sidebar check result

A session's row carries no check line. A failed check, or a command that ended in failure (`TermInfo.exit`), is the **problem** state: the red status glyph on its row, on its pane's border and in the collapsed column. The check's words, its checkpoints and its output stay where they were: the Inbox, the evidence sheet (`o` on a check in the Project menu, or Enter on a row that wants a look) and the Project menu's re-run and override items.

## Project-specific: check evidence sheet

The check evidence sheet is part of the frame (see *the frame*). Enter on a sidebar row whose check failed, could not run, was overridden, went stale or is never run for its repo opens it (a row waiting for approval opens the approval; every other row still focuses its session), as does Output in the Inbox. It docks right (`split_for_sheet`) and takes the pane column below `NARROW`. Its title is `CHECK · <session> › <checkpoint>`; content starts one column into the card's inside.

- A result chip (` <glyph> <word> ` bold on the state's colour: `failed` on `err`, `failed · overridden` on `text`, `could not run` and `not checked` on `violet()`, `passed` on `done`, `stale pass` on `btn`), then what it came to in `strong` bold (`exit 1`, `exit 0 on older code`, `never for this repo`; `command not found` in `violet()` for exit 127).
- Command, Folder (the run's folder, home as `~`), Ran (`14:22:05 · took 14.2s · after turn 3 ended 14:21:51`, local clock; `did not run` when it never started) and Seen by (`Maiker ran this itself. The agent said "…".`), or Source (`.maiker/checks.toml · <commit> · you chose never`) for a repo's own command. Rows are clipped at the sheet's edge, not wrapped.
- A banner on a tint for a result that needs explaining: overridden (by whom, when, `u undo`, the reason), stale (how many files changed and when, then one `M path` row per file that fits), never, could not run.
- `OUTPUT`, then `all N lines`, `last N of 1,284 lines` (numbered as the whole output, from `CheckInfo.line_count`; `f full output` when the daemon kept only the tail) or `empty`, on a darker block with 5-column line numbers; `✓` lines `done`, failure lines `err`, `▲` when there is more above. Empty output says why: `(no output)`, `(the command printed nothing)` / `exit 0 is what passed it.`, or `(nothing ran)`.
- Buttons on the third row from the bottom, each a click of its key: `Check settings ,` for never, else `Re-run r` (primary when stale, absent while it runs), `Override… O` (failed only), `Send to agent m` (failed only), `Undo override u` (overridden only), and `Open session o` when it fits. The last row is always `Esc back   r re-run   f full output   i why`.
- Keys: Esc closes; `r`, `O`, `u` act as the buttons; `m` sends a failure (below); `f` and the arrows open all of the output and scroll it; `o` goes to the session; `,` opens `PROJECT · <name>` for the session's project. With several checkpoints it opens on the headline one, and Tab / Shift+Tab move to the next / previous; the title names the one shown, its output is fetched by name, and `r`, `O` and `u` act on it.

**Sending a failure** (`client/screen/failure_note.rs`). `m` on a failed check, from its Inbox item or its evidence sheet, opens the agent's message box (the Inbox row's, or the popover beside the session's row from the sheet) with the failure written in: ``The test check failed: `npm test` exited with 1.``, then the last 40 lines of its output in a fenced block (`Its output:` when there are fewer; `It printed nothing.` when there are none). Colour codes and control characters are stripped, from the name and command too, and a line past 400 characters is cut. A draft the box held stays, above the failure. Nothing is sent until Enter, which sends it as any message is (several lines go in as one bracketed paste, queued or not). From the Inbox the output is asked for first (`Query::CheckOutput`) and the box opens when it arrives, unless an open sheet on that checkpoint holds it; a daemon error stops the wait. The sheet already holds it. The mode bar reads `m send to agent` while a failure is selected in the Inbox or shown in the sheet.

The row menu of a session with a check adds Check output (any result), Re-run check (not while it runs), Override check… (failed only) and Undo override (overridden only); letters come from `menu_keys` like every item. Output comes from `Query::CheckOutput` and is fetched again when a new run replaces the result. Command output is not trusted: colour codes and control characters are stripped before drawing.

## Project-specific: check modals and settings

Deciding is a modal; nothing here pops up on its own. Each matches its reference frames inside the modal frame, cell for cell, in every layout at 160×45, 100×30 and 80×24 (`client/screen/check_modals_tests.rs`). Colours are existing slots: `blocked` for "needs you" amber, `done`, `err`, `violet()`, `sky()`, `card2` for fields.

**Override** (`client/screen/check_actions.rs`): `OVERRIDE A FAILED CHECK`, 70 wide and 15 tall. It says what the session will read (`done (overridden)`) though which checkpoint failed and when, what it hides and where the failure stays visible (⊘ on the row, in the Inbox history and in the evidence, for this result only), and takes an optional reason (at most `OVERRIDE_REASON_MAX_CHARS`; typing, paste, Backspace and Ctrl+U edit it). Enter overrides; `O` overrides only while the reason is empty, so a typed reason can hold an O; Esc or Cancel does not. Opened from the Inbox, the Inbox stays under it and Esc or Cancel goes back to it, on the same item. The sheet, Inbox, popover and row menu all open this one modal. After it the evidence sheet shows that checkpoint and a toast says `Overridden. <session> reads done (overridden); the failure stays in its evidence.` A re-run says `Re-running <cmd> in <session>'s worktree…` in a toast, or `re-run queued` while the agent works; a daemon error (`ServerMsg::Error`) is a toast. While a sheet takes the pane column, toasts show over the sheet.

**Approving a repo's command** (`client/screen/check_approve.rs`): opens only from its waiting item, by Enter on the Inbox item or the sidebar row of a session whose checkpoint needs approval. Several waiting: one modal per checkpoint, the next opening after a choice. It shows the command (`$ npm test`, or `- old` / `+ new` when the repo changed one you had said Always to) in full: wrapped over as many `card2` rows as it needs, the modal growing to fit; `\n`, `\r`, `\t` and other control or invisible characters spelled out (`\u{001b}`), and a run of spaces shown as `[N spaces]`. Where it runs, the file and commit it came from (`added in a1b2c3d, 3 days ago`, `changed in <sha>, 2h ago`, or `changed, not committed`), when it runs, and "Read it. It can do anything you can in that folder." `1` and `2` answer only once the last frame showed the whole command, and only for that command: one too long for the window ends its last row in `…`, says `The whole command doesn't fit. Make the window bigger and read it first.`, and 1 and 2 only say so; a command that changes disarms `2` (`The command changed. Read it again before you choose.`). There is no default: `1` runs once, `2` arms Always (a strip spells out what it means and the button reads `2 again`) and a second `2` sends it, `3` is Never and opens the evidence sheet, Esc leaves the item waiting (back in the Inbox, on the same item, when opened there). Enter, `y` and Space send nothing and say so; other keys and pastes do nothing. Clicking Always once arms it like `2`. Below 80 columns the buttons use short labels; below 30 rows the modal loses the blank line after the command.

**Settings › Check** (`client/screen/check_settings.rs`) is one renderer with two hosts: the `PROJECT · <name>` modal (`,` from the evidence sheet or an Inbox row, for that session's project) and the Check page of Settings (the workspace you are in). Empty, it explains what a check is and takes a first command. Set, it shows the selected checkpoint's command, where it runs, its timeout (`‹ ›`), its latest result by clock time (`✓ passed on fix-footer 14:22 · 14.2s`, `… never run`, `? could not run … pnpm: not found (exit 127)` with what to do) and its source, then `CHECKPOINTS`: `1 of 1`, or `N of M · ‹ › switch` for several (←/→ on that row, or a click). Your checkpoints are `[[check]]` tables in config.toml; Ctrl+S writes the shown one by name in place, keeping comments, off the UI thread (a failed save keeps the draft and toasts; `Saved. Runs after the next turn ends.` for a first command, else `Saved.`). Del removes its table. A repo's checkpoint is read-only here: its source reads `.maiker/checks.toml · <commit> · always | never | asks each time` and Del (`Forget choice`) sends `ForgetCheckApproval`. Further checkpoints are added in config.toml or the repo's file; there is no add screen. Run now (`r`, or its button) re-runs that checkpoint in the session with the latest result, else the focused or first agent of the project; a working agent queues it. Esc drops the draft.

## Project-specific: Inbox check groups

The Inbox (leader `i`, or Ctrl+J) is part of the frame. Its title is `INBOX <n>`, n counting
everything not just finished or exited. It lists, in this order: NEEDS YOU, FAILED CHECKS, COULD NOT RUN,
FINISHED, EXITED, then HEADS UP, each a chip head on its colour (`blocked`, `err`, `violet()`, `done`, `err`)
with its count. A question is never below a check. EXITED lists a session whose last command ended in
failure (`TermInfo.exit`, set by the daemon) that asks for nothing and has no check of its own to show:
its line reads `exited with code N`, Enter or `o` opens it, and `c` or Delete clears it until another
command fails (`Saved`-free: `screen.exit_seen`, by when the command ended). A session that is both
finished and exited is listed as exited only.

- A group with no rows is not drawn; with nothing at all it says "Nothing is waiting on you.".
  A project with no check has the groups it always had, FINISHED renamed from JUST FINISHED.
- NEEDS YOU holds questions, then repo check commands waiting for approval
  (`approve check command: npm test`), then quiet working agents (`no output for 12m · may be
  stuck`, no sound; Enter opens the session, Delete hides it until it next goes quiet).
- FINISHED lists sessions with a check result first, then the newest first.
- A Done session is finished (`check::finished`) when it has no check, or its check passed, was
  overridden, passed on older code (stale) or you chose never to run it. It is not finished while
  checking, failed, could not run or waiting for approval. The home screen counts finished by the
  same rule. A session whose agent is working or asking is not listed for its old result (see
  `check::shown`).
- A failed check stays listed until a later run replaces it, even after you have looked at the
  session. A could-not-run check is listed only until you look (`Del` marks it seen).
- An item is the session glyph (`glyphs::Kind`), name (`strong` bold), ` · <folder>` and an age;
  at +2 the question or the result (`failed: test · exit 1 · 14:22`, `test could not run: pnpm
  not found`, `passed: test · 14.2s`, `failed, overridden: test`, `stale pass: test · 3 files
  changed since`, `not checked: never for this repo`); a failure adds its
  first failing output line. A plain finish, and an item that waits on you without having asked
  through the app, say what the agent last said (`check_inbox.rs` `last_said`: `TermInfo.said`,
  else `TermInfo.last_lines`, the last lines of its screen for an agent whose hooks report no
  message): one line cut with `…`, and on the selected item up to four wrapped lines over its
  **Reply** `m` and **Open** `o` buttons. With nothing said, a finish is its head line alone (its
  heading already says finished) and a waiting item reads `waiting on you`. Several checkpoints read as one word first, then
  `build ✓ · test ✕`, or the glyph strip when that doesn't fit.
- The selected item is tinted across the sheet with `▎` (`err` for a failure, else `accent`); a
  failure keeps its red `▎` unselected. It grows its buttons, each a click of its key: question
  `Reply m` `Open o`; approval `Read the command ⏎`; failed `Output ⏎` `Re-run r` `Override… O`
  `Send to agent m` (the last, dropped where it doesn't fit);
  could not run `Output ⏎` `Settings ,`; stale `Re-run r` `Output ⏎`. Enter runs the first
  button (Read the command opens the approval); an item with no buttons opens its session. `o` opens the session of any item; `r`, `O`, `u`, `,` act on an
  item's check where they apply and are typed otherwise. 1–9 answer a question; d, M, x and m
  act on a finished item; d, m and k on a heads-up; m on a failure sends it (see *Sending a
  failure*); Delete marks seen.
- Typing finds any session; the `› query` row shows only once you type. The last row is
  `↑↓ select   ⏎ open   r re-run   O override   Esc close`.
- A session on another machine ends its head line with ` · on <machine>`, and a machine whose line
  is down has no items (*machines in the sidebar*).
- Existing theme slots only. Code lives in `client/screen/inbox.rs` (groups, drawing) and
  `client/screen/check_inbox.rs` (what each item says and its buttons).

## Project-specific: the frame

The layout and checkpoints are summed up in [DESIGN](DESIGN.md). `client/screen/flat_tests.rs` holds the sidebar, the status glyphs and the workspace to the TUI redesign; `client/screen/frame_tests.rs` holds the modal and popover frames.

- **Grid** (`draw.rs` `grid`): inside `ui.padding` (`framed`). The sidebar is `SIDE_DEFAULT` (34) columns, resizable between `SIDE_MIN` (24) and `SIDE_MAX` (60) (a width you dragged wins) and never more than half the screen, the full height, then `ui.gap` columns, then the workspace. Hidden, it collapses to the rail, `RAIL_W` (5) columns wide (`side.rs` `draw_rail`), with a `»` to open it again.
- **Chips** (`chips.rs`): every label on a border is a chip, its text with a cell each side on `btn` (`#15253A` in Night): title (accent with `acc_ink` when its frame has the keys, else `strong` bold), action (accent text) and quiet (`muted`). The ends follow `ui.rounded`.
- **Pane** (`workspace.rs` `draw_pane`): every pane is its own box, round corners by default (`ui.rounded = "corners"`). On its top border, at the left, the title chip: the status mark and the name bold (`acc_ink` on the accent while it has the keys, `strong` on `btn` otherwise), and at the right ` × `, which closes the pane (`menu_act(Act::End)`: with an undo, asking again for a running agent). On its bottom border, at the left, its folder and then its branch as quiet chips a cell of border apart (`where_segs`), cut with `…` from the right; a click on them opens the pane's Project menu (`ScreenHit::PaneProject`). Files and Changes are not chips: they are in that menu and on their keys. The program starts on the row under the top border.
- **Splits** (`workspace.rs` `draw_main`): up to four panes (`MAX_PANES`), side by side and stacked as the daemon's `Split` says, each a box of its own one column or row apart (`apart`). Split commands (leader `_` up, `S` down, `\` left, `s` right; `alt+s` and `alt+d` split right and down without the leader) put the new pane before the focused one for up and left and after it for down and right. Drag the gap between two boxes to resize them; it lights in the accent while pointed at. Exactly one box has the accent: the focused pane's; a pane being closed lights its box red. Zoom pane (`zoom-pane`) fills the view with the focused pane until run again.
- **No pane open** (`draw.rs` `draw_no_sessions`): a dashed box, `No pane open`, an ` n new session ` chip (a shell at once) and `or pick a session on the left`. Closing the last pane leaves it; nothing starts a shell by itself.
- **Focus**: a click on a pane's title or body focuses it. While the sidebar or a side panel has the keys, no pane is lit.
- **Swapping panes** (`input.rs` `Drag::Pane`, `behaviour.rs` `swap_panes`): a press on a split pane's top border starts a drag; let go on another pane of the view and the two trade places. While dragging, the pane under the pointer lights its lines in `accent` with a centred `⇄ swap here` pill, and a `btn` pill with the dragged pane's name follows the pointer.
- **Status bar** (`mode_bar.rs`): the bottom row of the room inside `ui.padding` (`draw.rs` `mode_bar_row`; `framed` is the room above it while the bar is shown), on the app ground (`bg`, no panel of its own), one blank row above it (`BAR_GAP`). Popups and their dimming sit above it (`above_bar`), so it is never covered or dimmed. At the left the mode chip; the session's name and folder are not repeated there, the pane's own title shows them (a line that just happened, `+ name started`, takes the space for a moment). **Its two rows are always kept** (`bar_shown` is always true: the bar and its gap), so opening a menu or key mode never moves the frames. **Never blank** (`bar_has_words` is always true): key mode also shows on the focused frame, which turns the KEYS yellow (`blocked`, `border_of`). While keys go to the pane the bar shows the mode and its hints: ` PANE ` (the accent, `acc_ink`, bold; a click starts key mode), and at the right `alt+↓/alt+↑ chats  ^space k search  ^space n new  ^space tab next pane  ^space keys  ? help` (`pane_hints`; the leader shown is the configured one), each key bold in the accent and its words `muted`, read from the keymap (`short_key`: `^space`, `tab`, `esc`), so a rebound key shows its new key and an unbound one is left out; a click on `^space keys` starts key mode too. Key mode: ` KEYS ` (`blocked` yellow with its ink; a click opens the key map) and `n new  s split  x close  tab pane  ? help  esc back`, each a click that presses its key, so it does what the key does: the mode stays, unless the key starts a pane. Who has the keys (anything but the panes, whether or not key mode is held: the sidebar, a popup or modal, a side-panel view with the keys, the key map's search; `keys_holder`): a calm chip (`strong` bold on `btn`: ` SIDEBAR `, ` SETTINGS `, ` FILES `, ` INBOX `, ` CHANGES `, ` BRANCH `, ` PALETTE `, ` MENU `, ` UPDATES `, ` USAGE `, ` CONFIRM `, ` NAME `, ` MESSAGE `, …), and at the right its main keys and the way out, keys in lower case: `↑↓ move  enter open  n new  esc back`, `y yes  n no`, `type  enter save  esc cancel`. The keys are the ones that thing's own handler reads in the state it is in (Files' tree, filter, preview or editor; Changes asking y/n; each step of Switch branch; Settings waiting for a key or editing a value; Settings' Check page by its row, while its command is typed, before the project has a checkpoint (a letter starts the command) and with no project open (only Tab and Esc), and the project check likewise; the Inbox asking to merge or throw away; copy mode's search and selection; the key map's second step; a folder picked for a setting, where Esc goes back); add a row there when a mode or view is added (the match is exhaustive). While key mode is held it adds `shortcut mode waits` before the way out. A narrow bar drops hints from the right, the way out last, then Update shortens and goes, then where the keys go; the chip stays. Under anything that has the keys the bar is only words: its chips take no click, and a click on its row does nothing (`only_says`), so it never closes the popup, runs a hint or drops typed text. **Update** or **Restart**, when waiting and the sidebar's foot is out of view, sits at the bar's right end. With `ui.rounded = "full"` each chip on the bar is capped on the bar's ground. In key mode a key with no action shows the toast `Shortcut mode — Esc to type` (`input.rs` `hint_dead_key`), marked with a sky `i` and bar since it is information, not a success: at most once every 6 s, never over a toast still showing, and not kept in the notification history; keys that act are unchanged.
- **Sheet** (`sheet.rs` `split_for_sheet`): the check sheets and both-diffs dock right from 140 columns, the layout's gap from the panes; below 140, or when the panes would keep fewer than 40 columns (`PANES_KEEP`), they take the pane column and Esc brings the panes back. They start at 72 columns.
- **Inbox** (`draw.rs` `grid`, `sheet.rs` `INBOX_W`): a panel 62 columns wide that floats over the workspace from the sidebar's side (the left edge of the pane column, or its right edge when the sidebar is on the right). The panes keep their column; the panel has a fixed width, so `[` `]` and its edge do nothing. Its cards are NEEDS YOU, FAILED CHECKS, COULD NOT RUN, FINISHED and EXITED.
- **Message popover** (`popover.rs` `draw_compose_pop`): the follow-up to an agent, opened from the sidebar row or the leader (`M`). The screen is dimmed except the popover and its row. A full `accent` border (corners by `ui.rounded`), `card` ground, the input on `bg`, no shadow.
- **Toast** (`draw_toast`): one component for every Maiker notice, bottom right, its bottom edge `TOAST_ABOVE_INPUT` (5) rows above the screen's so it sits over the agent's input area. It draws a `line` outline on `bg` with round corners whatever `ui.rounded` says, its left side a heavy `┃` in the notice's colour (error `err`, about a session that needs you `blocked`, about a finished one `done`, otherwise `accent`).
- **Selecting and copying**: a mouse drag or `v`/`V` in copy mode tints the selection sky (`blend(bg, sky, 0.38)`) with `strong` text; `y` copies and closes copy mode; the copied cells then glow accent for `copy::FLASH_FOR` while the toast reads `Copied to clipboard`.

## Project-specific: home screen check counters

The home screen's "while you were away" line counts a session as finished by the Inbox's rule
(`check::finished`: see Inbox check groups; a stale pass or a check never run here counts as
finished), and a check waiting for approval as needing you.
A `✕ N check failed` (`N checks failed`) count follows, in `err`, only when N is above zero.
When the line does not fit the width, the lead-in "while you were away" is dropped so no count
is cut; below 100 columns the lead-in goes too. A project with no check draws the line it always did.
Code lives in `client/screen/splash.rs`.

## Project-specific: splash

Centred, no bottom bar, in the
theme's colours (`Theme::splash()`: Night has its own wordmark, A-and-I, swell and deep colours;
other themes take them from their strongest text and accent). Top to bottom: the wordmark in 5-row
block letters as filled cell backgrounds (never `█`, which leaves seams), two cells per pixel from
110 columns, the first "AI" in the name in the second colour; a blank row; the swell, one rolling
`▁▂▃▄▅▄▃▂` line 4 cells wider than the wordmark on each side, fading into the ground over 6 cells
at each end; a blank row; the tagline from `Cargo.toml` in italic; the "while you were away" counts
when anything happened; the choice cards, 56 columns or the width less 8; the keycap hints; the
version faint at the bottom right, or in its place an available update or a pending restart.

Cards: **Resume where you left off** `r` (only while sessions run; its second row is project ›
session), **New session** `n` and **Open a project…** `o`. The chosen card is `card2` with an
accent `▌` down its edge, a bold strong label and an accent keycap. Arrows or `j` `k`, and a card's
key, choose; Enter opens the chosen one; a click chooses and a click on the chosen card opens it.
Below 30 rows Resume loses its second row and the gaps between and above the cards close.

**The splash** (`client/screen/splash_wide.rs`) is drawn on the plain ground, with no box round
the screen, no chips on its edge, no row of key hints and no version line. The wordmark, swell
and tagline as above; under them two boxes side by side, **START** (64 columns: the three choices
as 3-row highlights with the sub-text and a key chip on the middle row, then a `RECENT PROJECTS`
rule and up to five projects with a machine badge and `⎇ branch`) and **WHILE YOU WERE AWAY**
(72 columns: `●n ✻n ✓n` chips on its top edge, up to five agents, the ones that need you first,
each two rows: glyph, name, machine badge, project, `● you` or its age, then what it asks or does;
a `MACHINES` rule with each machine's badge and dot). The box that has the keys has the accent
border and title chip. Tab switches box, the arrows walk the one that has them, Enter opens: a
choice, a project (the splash goes, the project is unfolded and selected in the sidebar) or a
session. A waiting release is an accent chip at the right of START's top edge at every size (`u`
or a click acts).

It shows less as the terminal gets smaller, and is the splash at every size that holds the START
box (66 columns, 22 rows). Too narrow for both boxes (under 140 columns): START alone, and what
the away box would say is the counts line over it (`● 1 need you   ✻ 2 still working   ✓ 1
finished`), so who needs you is never dropped. Too short for the wordmark over the boxes: the
boxes alone; the wordmark gives way before the counts do. Only a terminal that cannot hold the
START box keeps the cards above.

The intro, at 50 ms a frame: letter k rises from the deep colour to its own from frame 3k over 8
frames (eased out), nothing moving; the swell fades in over 14 frames and rolls a step every 3; the
tagline fades in over frames 10–20. Cards and hints are drawn from the first frame and keys act at
once. `ui.splash_animation` (Settings › General): `cold start` (default: the first start of a
version, or nothing left running), `always`, `never`. Motion off, or a remote session, never plays
it and holds the swell still.

## Project-specific: hiding the sidebar

The sidebar shows or collapses (`App::sidebar`) to a narrow column (`side.rs` `draw_rail`, `RAIL_W` columns): a `»` button on top, `⌕` (search) and `+` (new menu) under it, one status mark per session (each a click that opens it) and a `≡` button at the foot that opens the menu. Leader `b` (`Action::ToggleSidebar`; Hide sidebar is the same), the `«` button in the sidebar's header collapses it; `»` brings it back. It slides as it goes and comes.

## Project-specific: the sidebar

(`client/screen/side.rs`.) **Sessions grouped by status (`Needs you`, `Working`, `Done`, `Idle`; the default) or by machine (`saved.group_machine`), agents and shells alike.** A box `SIDE_DEFAULT` (34) columns wide on the app ground (`bg`), resizable between 24 and 60. A blank row parts two groups. The daemon's workspaces are not shown: a new shell still starts in one (`screen/fleets.rs`: the pane you are on's workspace, else the machine's active one, else a new `Scratch`).

- **Header** (`side.rs` `draw_header`): the `Maiker` title with how the list is grouped and sorted in muted words (`status` or `machine`, then ` · oldest` or ` · a–z`), and buttons at the right, left to right `⌕` (search, the palette), `+` (the new menu), `≡` (the group and sort menu) and `«` (collapse the sidebar). There is no filter field: `/` (Filter sessions, also in the menu) opens a `Filter sessions` modal; it matches sessions by name, project, process, machine and branch, Enter keeps the match open and clears the filter, Esc cancels. The header's `≡` opens the `sidebar` menu (`menu.rs` `group_menu`): `Group by status` or `Group by machine` and `Newest first`, `Oldest first` or `A–Z`, the current ones ticked (`saved.group_machine`, `saved.side_sort`). There is no folder grouping. Add machine… is an item of the sidebar's `menu` chip. The Machines dialog has a button on each row (update or install, reconnect, edit, remove).
- **Machine heading**: (only when grouped by machine; by status each heading is the group's name in bold muted text and its count) a title chip with the machine's name (`This computer` for this one) and its number of sessions, muted, inside it; an accent ` + ` chip that starts a shell on that machine at once (`App::new_ship_on`; a warning, and nothing started, while it is offline), or in its place ` install ` (the app is not there) or ` update ` (another version is) while the machine `needs update`, which runs the install in a popup (see *Machines dialog*); a green `●` at the right while it is up, a dim `┆` while its line is down. A click on a remote heading opens Machines on it; a right-click opens its menu (*Machines dialog*). A blank row parts two machines.
- **Folding.** A machine heading starts with an arrow, `▾` open and `▸` folded, and a click on the arrow or the name folds it; a status heading (name and count, no arrow) folds on a click anywhere on its row; a second click opens it again. A folded heading hides its sessions (the cursor skips them) and keeps its count; a filter shows every match whatever is folded. The folds are kept in the saved state (`closed`, each keyed `m:<heading label>`: `machine_fold_key`). A machine heading's right-click menu stays on the name.
- **New `+` chip.** In the sidebar's header, left of the `≡` button: a menu with `New session` and `Add remote machine…` (the Machines dialog). There is no `Remote machines` heading: a machine reached over ssh is a heading like `This computer`, and with none added the `+` menu is the way to add one. A blank row parts two machines; none follows a heading.
- **Nesting.** A session sits under its status or machine heading: its mark two columns in from the sidebar's edge and its name four; a subagent's tree (`└`, `├`) starts at column six (`TREE_X`).
- **Splits.** Every session a pane of the current view shows has a `▎` in the row's left edge: the open one in `strong`, the others in `muted`, so the panes of a split are all marked in the list.
- **Session row** (two lines, and a third for the open session; within a group the rows follow the sort `s` steps, newest status change first by default, then oldest, then A–Z, so a row moves when its status changes group): the status mark, then the name (your name for it, else the process; a chat goes by its title), bold in `strong` for a session that is working, needs you or has failed, plain `text` otherwise, with its age muted at the right; the second line is `project / branch`, muted, with ` ⑂` for a worktree of its own and ` · <machine>` when it is not this computer. No status words anywhere, but one: a session that hit its plan limit (`TermInfo.resume_at` still ahead) says `limited 16:30`, the local time the daemon continues it (`limited Sun 16:30`, with the short weekday, when that is not today), in `blocked` amber after the project and branch (before the pull request). Its mark and its place in the list do not change, and a time that has passed shows nothing. The collapsed column does not show it. The session open in the workspace and the keyboard's row have the `sel_bg` ground; the open one also has a `strong` `▎` down its edge and a third line, `<agent> · <machine> · <what it is doing>` (`working 4m`, `waiting for you`, `finished 2m`, `stopped`, `idle`, `not answering`). A session whose machine is down is drawn in `idle`.
- **Subagents** (`side::session_subagents`, from `TermInfo::subagent_activity`, the daemon's record of what the agent's own hooks reported): those still running (a background helper stays listed after its parent's turn) and the ones that finished in the turn the agent is in, the rest folded into a count; a finished one clears 15 seconds after it reports (`FINISHED_LINGER_SECS`), so a long turn does not pile up rows that look stuck. One whose stop never reached the daemon clears when the agent's turn ends and its own list of background work (Claude's `background_tasks`, `Hook::background_reported`) names no helper still running: the agent's list outranks the daemon's count, so a lost stop neither leaves a row nor holds the session as working. Under any other session they are one row, `└` and a mark each; under the open session one row each, `├` / `└`, the mark and the name, then a `N done · show` / `hide` row for the folded finished ones, a click on which lists or folds them; `ui.subagent_count` turns the rows off. A click on one opens its parent's pane: the agent shows its subagents in its own terminal, and the TUI draws no chat of its own.
- **Foot** (the bottom border): a rule, then at the left `menu` with an accent mark beside it while a release is out or waits for a restart; it opens the sidebar menu upward (`menu.rs` `sidebar_menu`: Install update … or Restart to finish update first, then Filter sessions, Add machine…, Inbox, Put away…, Usage and cost, Updates and release notes, Settings, Keys). A build that is not a clean release shows its commit and age after `menu`; at the right `? keys`. The mode bar carries the release chip only while the sidebar is not drawn (`release_in_side`).
- **Row menu** (right-click on a session, or `.` with the cursor on one): see *Menus*. Anywhere else `.` is the Menu.
- **Put away** (`screen/put_away.rs`): the row menu of a finished or idle session in a daemon terminal (shells too; not a
  chat, whose daemon archive closes it, and not one held by its plan limit or whose last command failed) has **Put away**.
  It sends `Command::ArchivePane { archived: true }` and closes, stops and moves nothing; the closing banner offers Undo
  for 6 seconds (`Put away <name> · <leader> then Ctrl+Z undo 6s`), which sends `archived: false`. A close still in its
  undo window keeps that banner: the put-away says in a toast that the Put away list brings it back. A session with the
  flag (put away here or in the desktop app) is left out of the sidebar, the rail, the Inbox and the session search
  (`screen_model`, `put_away::hidden`), except while it needs you: it asks (`check::needs`), an agent's command failed,
  or its plan limit holds it (a plain shell stays put away whatever its last command did). Then it is listed as usual,
  still put away on the daemon, and its row menu has **Bring back** in place of Put away. The sidebar menu's
  **Put away…** and Search commands' **Sessions put away** (`Action::PutAway`, `put-away`, no default key) open a menu
  upward from the sidebar's foot, `Bring back <name> · <project>` per session in creation order; a pick sends
  `archived: false`. With none, a toast says `Nothing is put away`. On a machine that is down the row menu offers
  neither, the list keeps the row with `· offline` after it, and either action is refused with an error toast. **Close project** counts its put-away sessions
  (`2 panes, 1 put away`) and leaves them running.
- **Keys** (`screen/side_keys.rs`, only while the sidebar has the keys; a pane gets every key but the leader's). ↑ ↓ walk the sessions; → or Enter opens one; `1`–`9` open that row; `F2` renames the row; `del` closes the chat (it asks first, as every close does); `shift+F10` or the menu key opens its chat menu; `g` flips the grouping between status and machine; `s` steps the sort (newest, oldest, A–Z); `f` opens the group and sort menu; `m` the sidebar menu; `n` a new session; `?` all the keys; `/` filters.
- **Renaming in place.** `F2`, or Rename… in the chat menu, turns the row's name into the text being typed with a `▏` cursor (`side::typing_name`); Enter saves it through the existing rename (`submit_prompt`, shared by every client for a chat), Esc leaves the name as it was. It opens no box of its own while the sidebar is drawn open (`renames_in_place`); with the sidebar hidden or collapsed the usual Rename box shows.

**Status glyphs** (`screen/status_mark.rs`): working is the chosen spinner in the accent (Dots, the design's Braille, held 80 ms a frame, Snake 90 ms, Bars 85 ms, Blocks 120 ms, other spinners 90 ms; Reduce motion shows the first frame); by default (`ui.glyphs = "unicode"`) each state has its own shape, so colour is not the only cue: needs you is `!` in `blocked` amber, done `✓` in `done` green, problem (a failed command, a failed check) `×` in `err` red, idle `–` in `idle`; `┆` in `idle`, with the name dimmed, for a machine that cannot be reached. Settings › Appearance › **Status glyphs** `dots` (`ui.glyphs = "dots"`) draws the same coloured `●` for every state instead.

## Project-specific: New session

There is no New session dialog. `Action::PickSession` (leader `n`, palette `New session`, the splash's `n`, the empty workspace's ` n new session ` chip) does what **Shell here** does (`Action::ShellHere`: leader `t`, `Alt+N`): one plain shell at once in the folder you are in, or in the workspace's own when you are not in it, on the machine of the session you are on. A machine's ` + ` chip on its sidebar heading starts one on that machine. Every session this starts is a **shell**: agents start inside it. The Menu has no `Session...` row.

## Project-specific: tray item (desktop)

The desktop app keeps one item in the Windows tray or the macOS menu bar (`useTrayItem.ts`,
`model/traySessions.ts`, the host's `tray.rs`). Its menu lists every session that needs you or finished: **Needs you (N)**, then **Finished (N)**, at most ten of each with a `and N more` line after them, each session as
`agent: name`, or **Nothing needs you**; then **Show Maiker** and **Quit Maiker**. Choosing a
session brings the window forward on it. Hovering says how many need you (`Maiker: 2 sessions need you`); a left click shows the window. The menu is the
system's, so it takes no theme. Closing the window still closes the app; the item goes with it.

The window says the same count from outside it (`useAttentionBadge`): its title is "Maiker · N need you" (what the
taskbar and the window switcher show; "Maiker" when nothing does), and the app icon carries the count where the system
has one (macOS, Linux launchers with a count; Windows has none). The count is the sessions the sidebar lists under Needs
you. A chat session that starts needing you or finishes rings the same tone a terminal session does (the daemon rings
for those; the window rings for a chat session), when **Notification sound** is on.

The window opens on its theme's ground: the page and the native window start on the default dark theme's ground, and
`public/boot-ground.js` paints the ground of the theme last shown before the app's code loads (`data/bootGround.ts`
keeps it), so starting never flashes white or another theme's colour.

## Project-specific: closing, service and update states

- **Closing a session** (`client/screen/closing.rs`): closing always asks first, by whatever route: the pane's `×`, the pane
  menu, the row menu, leader `x` or Alt+`x`, a middle click on a tab, or putting a chat away. The question is one dialog
  (`menu.rs` `menu_act`; a working agent's says closing stops it). Accept it with Enter, `y`, `x` or Delete, or click
  Close; decline with Esc, `n` or `q`, or click Cancel. Only then does a single session send `Command::CloseSession`; the daemon hides it
  and keeps its process for six seconds (`UNDO_WINDOW`), `Command::UndoClose` brings it back. A banner on the first row of the
  focused pane reads `Closed <name> · Ctrl+Space then Ctrl+Z undo 6s`, counting down; leader `Ctrl+Z` undoes. Closing several
  panes at once (a tab's `✕`) asks in its own dialog and has no undo.
- **Menus** (`menu.rs` `draw_menu`): a box in the accent on the panel ground, no title, one row per item
  with its leader key at the right in the accent when it has one (letters a menu gives items of its own run
  them while it is open but are not shown), the chosen row on `hov`, and the item that ends something last,
  in red, after a line. It opens under its point, or above it with no room below (the sidebar foot's chips).
  **Chat menu** (`.`, `shift+F10` or right-click on a session row; one menu, `menu.rs` `session_items`): Open, Open in split
  (not for the session on screen), Rename… `F2` (in place), Show changes and, when they apply, Snapshots, Copy folder path,
  **Compact the context** (only from 80% of the context, `COMPACT_OFFERED_AT`; it types the agent's own `/compact`, as the pane's
  context bar does), the check items, queued follow-ups and Put away; then, after a line and in red, **Stop the agent** (only
  while it works or needs you; sends Ctrl+C like the Stop agent action) and **Close chat** `del` (an agent) or Close shell.
  Closing a chat says `Closed the chat. Its branch and history are kept.` **Pane menu**: Rename `r`, Split right `s`,
  Split down `S`, Find, the right-click toggle, Project… (worktrees, snapshots, the check), **Close pane** `x`
  last. **Sidebar menu** (the ` menu ` chip): Filter sessions `/`, Add machine…, Inbox `i`, Put away…, Usage and cost `u`,
  Settings `,`, Keys `?`; the full Menu is the leader's `.`.
- **Toasts** (`client/screen/toasts.rs`, look in DESIGN › Toasts). News about a chat you are not looking at, and the update;
  plain notices (`App::notify`) are separate. One at a time, newest first, `+N` in the title for the rest. Kinds: needs you
  (`<chat> needs you`, the agent's question; a remote agent's own words never show, only `Waiting for your answer.`; stays
  until the question is answered), failed (`<machine> stopped answering` or `<Agent> stopped`, `<chat> is paused there. Nothing is
  lost.`; once per stop, stays until dismissed), finished (`<chat> finished`, `Ready for you to review.`, 6 s) and update
  (12 s). They fire only for chats off screen (`machine_opts.notices` allows it) and opening the chat removes its toast. Keys:
  the jump key (`alt+j`) or a click on the title goes to the chat (for the update toast, to the menu), `esc` or `×` dismisses
  (Esc goes no further, so it never reaches the agent); `i` installs from the update toast, only with the keys on the sidebar,
  never while typing in a pane. Hidden while the service is down, during the start-up screen, and while any dialog, menu or
  settings screen is open (`toast_visible`).
- **Update** (`client/screen/release.rs`). A release found by the periodic check shows the update toast once: `Maiker X is ready`,
  the first line of what changed, and `It installs when you restart, never while an agent is working.`; `i` install now, `esc`
  later. While it downloads the status bar's chip (the service chip's slot) shows the spinner and `Downloading X…`. Restart with
  chats working does not stop them: the chip says `N chats are working · Maiker restarts when they finish` and the restart goes
  once none works (`release_tick`); with only chats waiting for you it still asks first. After the window reconnects to the new
  daemon the chip says `✓ Updated to X · all chats reconnected` for 4 s.
- **A chat stopped** (`client/screen/stopped.rs`). The client derives it from signals the daemon already reports and adds no
  status: an agent's pane whose last command failed (`TermInfo.exit`) while the agent is neither working nor asking, or an agent
  on a machine whose line is `Unreachable`. The row stays under Needs you with `×` (`State::Problem`). Only that pane is
  affected: its inside fades to about 35% (`dim_inside`) and a box sits in its middle with a red edge: `<Agent> stopped`, `It exited
  with code N. Your messages and changes are safe. Restart to carry on from the last message.` and `[r] Restart`, `esc Not now`,
  `c Copy details`; for a machine, `<machine> stopped answering`, its own words and `[r] Try again`. `r` restarts, which is the
  existing resume (the interrupted agent's command, else the newest closed session of that agent in that folder through
  `Command::ReopenClosedSession`) or, for a machine, the Machines retry; the box turns teal with the spinner (`Restarting
  <Agent>…` or `Reconnecting to <machine>…`, `Picking up from your last message.`) for up to 12 s. `esc` (Not now) leaves a red bar on
  the pane's bottom row, `× <Agent> stopped` with `r restart`, `c details` and `enter more` at the right, each clickable; `enter`
  brings the box back. These bare keys go to Maiker, not the program, only while the focused pane's chat is stopped; clicks work
  in any state.
- **Reconnecting** (`client/screen/service.rs`): when the window loses its own daemon without being told to
  quit, it stays. For the first 3 s (`BLIP`) only a status-bar chip says `Reconnecting…` with the spinner; then a red box titled `Maiker can't reach its background service` says
  that chats are safe and reconnect on their own, with `[s] Start service`, `esc Not now`, `c Copy details` and `retry Ns` at its right; tries wait 2, 4, 8 and then 15 s each
  (`BACKOFF`, the last wait holds). Typing goes nowhere; `r` tries now, `s` starts the service (the box turns green with `Reconnecting…` until it answers), `Esc` puts the box away and leaves a red chip `× Offline · retrying in Ns` that `Enter` or a click reopens, `Ctrl+C` leaves. When it answers the chip says `✓ Back online · nothing was lost` for 4 s.
- **Service down.** The box above is the down state; there is no try limit, and it says chats are safe.
  `s` starts the service (`ipc::open_or_spawn_installed_knowing_version`) and `r` tries again at once.
  The window still tries by itself every 15 s (the last `BACKOFF` step) and the box shows `retry Ns`, so a service that another window or
  an update brought back is found without a key.
- **Service came back as another version** (another copy of the app updated and restarted it): no try can work, so the
  first try that hears the other version ends them (`service_changed_version`). When a newer maiker is installed here it
  opens in this window's place; otherwise the window closes into the *Service update needed* screen below. A connect
  waits at most 3 s for the daemon's pipe (`ipc::CONNECT_WITHIN`), so a try never holds the keys.
- **Service update needed** is `restart_prompt.rs`, shown before the window opens when the running daemon is another
  protocol version: an amber title, SURVIVES (shells and their scrollback), STOPS (agents), `r` restart service or `Esc`
  not now (which leaves the window; a client and daemon that cannot read each other do not talk, so there is no
  read-only mode).
- **Links in the terminal view.** Cmd/Ctrl-click on a file name opens it in the Inspect panel (`findPathLinks`).
  Cmd/Ctrl-click on a web address opens it in the person's default browser through the host's `open_link`
  (`findWebLinks`): an address with its scheme, or a bare site name with a common ending (`app.hubspot.com`), which
  is opened as `https://` and is no longer offered as a file.
- **Service a release behind (desktop)** (`features/updates/ServiceBehindNotice.tsx`, shown by the workspace's
  dialogs when the service is on the app's protocol): an update leaves a running daemon alone while it holds
  sessions, so the window can be newer than the service it talks to, and none of the release's fixes to the service
  apply until it restarts. When the service can be restarted with nothing lost and says no agent is working or
  waiting, and **Restart the service when idle** (Settings › General › Updates, off by default, separate from
  **Install updates when idle**, which installs the app) is on, the window restarts it by itself at the first quiet
  moment and says `Service restarted` with how many sessions came back (idle agents are resumed by the restore).
  Quiet means the service counts no agent working or waiting, no session the window can see is working, needs
  you, is being restored or has an unknown status, and no session is starting
  (`features/updates/serviceRestart.ts`); until then the toast below stays and the window looks again every 10
  seconds. The service on another protocol (the **Restart Maiker to finish updating** card) follows the same rule
  with the service's own count, since its sessions cannot be read, and runs the card's own restart; the quiet
  note afterwards reads `Service restarted · N sessions back`. There is no countdown. Otherwise a toast that stays says
  `The Maiker service is still on <version>` with `Restart…`, which opens a dialog saying how many sessions come
  back and how many agent turns stop before anything is restarted. A service that cannot say whether agents are
  working is never restarted unasked, and a restart that fails falls back to the toast. With sessions that are not
  saved the toast says so and offers no restart. **Right after the app restarts into an update** the service's
  restart is part of that update (`afterAppUpdate`; `finishUpdate.ts` decides it may go unasked): it waits for the same
  quiet moment as Restart the service when idle (`serviceRestartStep`, read again every 10 s), whatever that switch
  says, with no question and no toast of its own; the `Updated to <version>` toast says "The service finishes updating
  once no agent is working." while it waits. A service on an older protocol (the restart card) is restarted the same
  way. Only a service that cannot be restarted with nothing lost, or cannot say who is working, still asks. Remote
  machines follow on their own under **Update remote machines too** (`[updates] machines`), or with their one-click Update.
- **After a restart** a line reads `maikerd restarted · N agents stopped · Enter on its row resumes` for 30 seconds
  while any session has `TermInfo.interrupted`; Enter on that row in the sidebar types its resume command.
  Resuming is never automatic.
- **No sessions**: the TUI sidebar says `no sessions yet`; the desktop app's empty state (`features/workspace/components/states.tsx`) says `No sessions running` with a `New session` button and a note that sessions live in the Maiker service and closing the window never stops them.
- **Updates box** (`client/screen/updates.rs`; opened from the release chip's menu, it has no leader key: leader `u` is Usage): above the sidebar footer. Available: `<current> → <version>`, the
  notes under NEW, `d Download · s Skip · l Later`; Downloading: a spinner, the step (`Downloading`, `Checking the download`, `Unpacking`, `Installing`) and a bar of the steps done, `step 2 of 4`
  (the installer reports no byte count, so the bar moves in whole steps and never shows a percentage; `cli::update::step`); Ready: `r Restart now` (the same one step as everywhere else: the server restarts onto the installed version and this window reopens; it asks first when a session is working or waiting for you); Failed: the error and
  `r Retry` and `l Close`; up to date: `<app> <version> is the latest.` with `c Check now`; Downloading and Ready also offer `l Later`. It reads the existing state (`update_available`, `updating`, `restart_needed`) and uses `start_update` and `ask_restart`.

## Project-specific: Machines dialog

Code: `client/screen/machines.rs` (the view, its keys and its drawing), `client/machine_flow.rs` (what a
choice does), `client/machine_config.rs` (where `config.local.toml` is; the `[[machines]]` entry edits are in `maitty-machines`),
`maitty-machines/src/machine_probe.rs` (the look at a machine). Opened by leader `w` or the command palette
(`Machines`); `Mode::Machines`.

- **One input, typed like scp.** `ADD MACHINE`: `Where's the machine? Type it like scp or ssh.`, the
  input (`› user@host`, on `card2`) and under it a parse line, `user` and `host` each a faint label and a
  bold value, a faint `—` while unknown. A host that is a `Host` of `~/.ssh/config` fills its user and host
  name. Under it, `FROM ~/.ssh/config` lists the hosts (read off the UI thread; `loading hosts from
  ~/.ssh/config…`, then `alias  user@hostname`), filtered by the host part of the input; a host that is
  already a machine is not offered. The keys start in the input (the cursor `█`); `↓` (or `Tab`) walks into the list, where the chosen
  host is marked with `⏎ connect`, and `↑` from its first row (or typing) is back in the input.
  Keys: typing, `↑↓`, `Enter` connects (to the typed text, or the chosen host), `Esc` cancels. A
  `:path` after the host is refused for now (opening a folder after connecting is not built).
- **Your machines.** With a machine configured, `YOUR MACHINES` lists them above the input, by name: ` ⇄ build  ci@build` and at the right how its connection stands (`✕ needs update`, in the state's colour). `↑` from the input walks onto the list and `↓` from its last row is back in the input; a click on a remote machine's heading in the sidebar opens the dialog with that machine chosen. A machine whose app is missing has an accent ` u install ` chip left of its state, one on another version ` u update ` (`MachineRow::fix`). Under the chosen one is what to do about it, in full (the fix text, `<name>` filled in). On it: `r` (or Enter) reconnects, `u` installs or updates (the bar says which), `i` opens its details (below), `e` edits where it is, `x` (or Delete) removes; `n` and `s` turn toasts and alert sounds from that machine on or off (both are off until you do), and `c` whether its programs may write this computer's clipboard (on until you turn it off; turning it off is at once, turning it on asks first on its own step, "Let build copy to your clipboard?" with what that means, Enter allow, Esc keep it off). Under the chosen machine a line says where they stand, "From build: toasts off · sounds off · copies to your clipboard on", and each change is written to its `config.local.toml` entry. A machine that connects with toasts off says so once per run, "Toasts from build are off. Open Machines, pick build and press n to turn them on.", at the connection and never when its agent needs you, so a machine cannot put a toast on the screen unasked. The title is `MACHINES` while the keys are there.
- **A machine's details** (`client/screen/machine_info.rs`, `Mode::MachineInfo`): `i` on one of your machines, or **Details…** on any machine heading's right-click menu (This computer's too). A modal titled `this computer` or `machine · <name>` with three parts, each asked of that machine's own daemon with a tag of its own (an answer from another machine, or to a question since asked again, is dropped; a machine that is not connected is not asked and says so; this computer's daemon older than a request is not asked and says to restart the service):
  - `MAITTY`: for this computer the service version, its session count and socket (`AGENT_SOCKET`, else `default`) and the service log's path (`o` opens it in the system viewer, `y` copies the path); for another machine its address, version, sessions and whether it is connected.
  - `GITHUB` (`Query::GitHubAccounts`): each signed-in account with a green `●`, the active one marked; no `gh` there, nobody signed in and a problem each say so. `g` starts GitHub's own sign-in, exactly `GITHUB_SIGN_IN_COMMAND` (`gh auth login --web --git-protocol https`, shared with the desktop app in `maitty-shared`), as a new session named `GitHub sign-in` on that machine; the dialog closes and a toast says to finish it there. Its prompts are answered by the person in that session; nothing passes through the window.
  - `GIT IDENTITY` (`Query::GitIdentities`): who commits where no rule applies, then FOLDERS THAT COMMIT AS SOMEONE ELSE, one row per rule: the folder, and the name, email and GitHub account a rule Maiker wrote sets, or `set outside Maiker` (listed, never changed). ↑↓ choose one. `a` adds a rule (refused until an account is signed in there): Folder, Name and Email fields (the global name and email filled in) and the GitHub account (←→ among the signed-in ones), Tab between them; Enter asks for a preview (`GitRuleChange::Preview`) and shows the lines the daemon would write, by file, as text; only Enter on a clean preview writes it (`Apply`), Esc goes back. `x` on a rule Maiker wrote asks `Remove the rule for <folder>?` first (Enter removes, Esc keeps it); on one set outside Maiker it says to change it in the git config. After a write or a removal the rules are read again and a line says how it went; `r` reads everything again. Text from the daemon is drawn cleaned of control characters; nothing here holds a credential.
- **Windows.** The dialog says, in a dim line at its top and on Windows only, `Windows: use ssh keys or an
  agent. Password prompts work in the popup but are not remembered.`
- **Adding is one step for a key-based host.** Enter on a host row (or on the typed text) first refuses a
  target ssh would read as an option or that holds whitespace (the loader's own words, shown under the lists;
  nothing runs and nothing is written). The name is the alias, made valid and unique (`build`, then
  `build-2`); when nothing usable is left of the target, a name step asks for one and shows the loader's
  reason inline. The entry is `name` and `target` only, and `target` is the alias, so ssh's own config for
  it (user, port, key, jump host) still applies. Then the machine is looked at, off the UI thread, with `ssh
  <target> maiker --version` that never asks anything (`BatchMode`, a short `ConnectTimeout`, stdin closed;
  `Checking…`, `Esc` ends ssh and adds nothing, and a limit of 12 s ends it whatever ssh does).
  - *It answers:* the entry is appended to `config.local.toml` (comments and the rest of the file kept,
    written atomically, never `config.toml`), the machine's supervisor starts, and its group is in the
    sidebar as `connecting` at once.
  - *ssh needs a person* (a password, a code, an unknown host key): the entry is written, and ssh is run
    **once**, interactively, in a popup pane on this computer's daemon (`Command::Popup`), so the prompts can
    be answered. The popup line is the probe's without `BatchMode`, with the same hardening (`ForwardAgent=no`,
    `-a`, `ConnectTimeout`, `--` before the target). When the popup pane closes the machine is dialled with
    `BatchMode` as every connection is; whether the login worked is the connection's to say, and if it did
    not the machine shows `needs login` with the fix. A popup has the keys only in plain typing mode, so
    the dialog closes when it asks for the popup and a toast says `ssh needs you to log in: use the popup`;
    the keys then go to ssh. A popup that is never seen (it ended between two reports of the daemon) is
    taken as closed after 20 s. A `remote_cmd` that needs quoting, or an `ssh_args` word that holds a quote, cannot
    be put on a pane's command line safely: the machine is added and the dialog says to run `ssh` once in a
    terminal.
  - *The app is missing, old or not running there:* the machine is added; its state shows `needs update`
    or `unreachable` with the exact fix text. A `needs update` toast names the click rather than the command
    (`build has no Maiker: click install on its sidebar heading, or press u on it in Machines`; `runs another
    version of Maiker` and `update` for an old one; `AppFix::notice`).
  - *ssh cannot reach it* (a bad host): ssh's last line, cleaned of control characters and cut, is shown
    under the lists, and nothing is added. Nothing hangs: every look ends at its limit, on `Esc`, or when
    ssh does.
  A Windows remote is not supported in v1; the dialog does not guess one from the probe.
- **Checklist.** After Enter the dialog shows the steps connecting takes: `reach host`, `verify host
  key`, `sign in as user`, `maitty-daemon`, with `✓` done, a spinner while running, `●` (amber) waiting on you,
  `○` pending and `✕` failed. While ssh is being asked, the first step runs. When the machine is written the
  title becomes `MACHINE ADDED` and the steps show how it stands: all `✓` with the daemon's version; `●` at
  the sign-in with `log in in the popup`; or `✕` at `maitty-daemon` with `the connection shows the fix`.
  `Enter` or `Esc` closes. The host key, password and daemon install are still asked by ssh in its popup,
  not inline.
- **A machine heading's right-click menu** (`App::menu_for_machine`): **Install Maiker** or **Update Maiker** first while the app
  there is missing or on another version, **New terminal here**, **Details…** (the machine's details, above), and for a remote machine **Reconnect** and **Machines…** (the dialog with it
  chosen, where Edit and Remove are). The sidebar's ` menu ` chip lists `Install Maiker on <name>` / `Update Maiker on <name>` first for
  each machine that needs it. Reconnect dials it now and clears a refusal; a machine
  with no supervisor gets one. Install and Update (the menu items, the heading's chip, `u` in the dialog) run
  `maiker machine update <name> --hold` in a popup pane on this computer, with no `--install` or `--yes`: it says what it found and asks
  `Install …?` or `Replace …?` there, and that answer is the consent, so nobody types a flag. A newer version there is refused, never
  downgraded, and a Windows machine is refused before anything is sent. `--hold` (hidden from `--help`) prints how it ended (installed,
  already up to date, not confirmed, refused, could not reach it) and waits for Enter, because the popup closes when the command ends. The
  toast says `Installing Maiker on <name>` or `Updating Maiker on <name>`, and the machine is dialled again when the popup closes, so its
  heading shows how it stands. Edit asks `Where is build? Type it like scp or ssh.` with the address it has now in the field: Enter writes the new `target` into its entry in `config.local.toml` (its name, its other keys and the rest of the file kept), lets the old connection go, forgets the daemon id recorded for the name and dials the new address at once; a target the loader refuses is said under the field and nothing is written. The name is not edited: its saved layout is kept under it. Remove asks first (`Remove machine`, with the address and "Its sessions keep running on it, and you can add it again"; Enter removes, Esc keeps it; in the Machines dialog, `x` asks the same on its own step), then says `Removes build from this list. Its sessions keep running on
  build.` in a toast. It deletes the entry from `config.local.toml`, stops the supervisor and the connection, takes the machine out
  of the sidebar and the window's records, and forgets the daemon id recorded for the name. The machine, its
  daemon, its sessions and its saved layout (kept under its name) are not touched.
- **A refused machine** (a different daemon answers at its name) shows `refused` with the reason and the
  fix: remove it and add it again, or fix the host name or DNS and reconnect.
- Adding and removing take effect in the running window. Editing the file by hand still takes effect at the
  next start.

## Project-specific: Hairline

Not applicable: the Hairline look was removed; Floating is the only look.

## Project-specific: features that need a pane's files

Files, Changes, Find, Branches, References, connecting an agent, worktree
actions (but Clean up worktrees, below) and the TUI's Resume a conversation here read or change the files of the pane they apply to
(in the TUI, Changes is not refused: see *the TUI's Changes is the same exception* below). (Pasting an image is not on this list in
the desktop app: it works for panes on other machines, see below. The terminal app's own list is
unchanged.) For a pane on another machine they do
nothing but show one error toast, always in this form: "<Feature> is local-only in v1: the files
are on <machine>, not on this computer." The check is per pane: moving the focus or the sidebar
selection between a local and a remote pane turns the feature off and on. Menu entries that would
run git in a remote pane's folder (Changes, Snapshots, Make it a git repo) are left out of that
pane's menu instead.

**The side panel is the exception for Changes.** In the desktop app the side panel opens for a pane
on another machine and its Changes tab shows the same file list and diffs as for a local pane, read
from that machine's daemon (`repoStatus` and `repoDiff` with the machine, `features/inspect/api.ts`)
with the same commit bar under the files: the ticks, the message, **Commit N files**, the remote
button (**Pull ↓N**, **Push ↑N** or **Fetch**, by the same rule as locally, `remoteAction.ts`) and
**Create PR**. Each is run by that machine's daemon in the pane's checkout (`git_commit_all`,
`git_sync` and `git_create_pull_request` with the pane, `Query::Git`), with that machine's git
identity and GitHub sign-in, and its answer or failure shows as it does locally. Files lists that machine's folders and opens only its Markdown documents (ADR 0014, `FilesTab.tsx`), saying "Only Markdown documents open from <machine>; its other files stay there." for the rest, and References is not offered. History's Snapshots shows the local-only sentence in the tab instead of asking anything (its Status log works as locally); Checks is as for a local pane except that a check's output shows the local-only sentence; Timeline is as for a local pane. A chat on another machine that has no terminal of its own has no pane to ask, so the panel
does not open for it and the toast says Inspect is local-only.

**The TUI's Changes is the same exception** (`client/changes_more.rs`). Leader `c` on a pane of
another machine (or a window on `--remote`) opens Changes with that pane's uncommitted changes,
asked of its daemon (`Query::Repo` with `RepoRequest::Diff`, every file's diff in one answer; nothing
is read with git here): the branch reads `<branch> on <machine>`, `reading the changes on <machine>…`
until the answer, and a refusal shows in its place. Commit (`c`, ticked files or all), Open PR (`p`,
asked first; the daemon pushes and opens it, and changes not committed stay out), Fetch (`f`), Pull
(`u`) and Push (`P`) are `Query::Git` to that machine, one at a time ("still committing…"), each
answer or refusal a toast, the changes read again after each. A mark (`x`) lasts while the view is
open, since the file cannot be read here to tell whether it changed. Merge, discard (`m`, `M`, `d`)
and the editor (`e`) stay with this computer's checkouts: their toast says what Changes does on that
machine. A daemon that does not answer in 30 s (a git step: twice the daemon's limit and 30 s) is
taken to be older than the request: `<machine> did not answer: update maiker there …`.

**Dropping files on a pane** (`features/terminal/dropRoute.ts`, `useFileSends.tsx`, host `file_send.rs`,
ADR 0007). On a pane of this computer the dropped paths are typed into it, quoted for its shell. On a
pane of another machine a path here names nothing there, so the files are sent to that machine over its ssh
line (regular files only, 100 MB each, at most 10 at a time; more are refused whole with one error toast,
never cut) and the path each one is kept at is typed into the pane as it lands. A machine that is not
`connected` is refused with one error toast. The send runs on the host's background worker, one at a time. A
progress toast (`Sending a.log to build (2 of 3)`, a named progress bar with the percentage, and a
**Cancel** button) stays until the host reports the end; it has no close button, because hiding it would not
stop the send. It ends as `Sent 3 files to build`, an error toast with what ssh said (the files after the
failed one are not tried), or `Stopped sending to build`. Cancel cuts the file now going and tries no other.
What the machine reports is untrusted: the window types a path only if it is absolute, at most 4096
characters and free of control and invisible characters, and a path that is not typed is named in the final
toast instead.

**Pasting an image into a pane** (`features/terminal/clipboardImage.ts`, `useImagePaste.ts`, `api/imagePaste.ts`,
host `image_paste.rs`, ADR 0007 and the amendment to 0055). Ctrl+Shift+V on Windows and Linux, or Cmd+V on macOS, pastes through the
webview's paste event, whose clipboard holds text, an image or both. **Text comes first**: any text and the
terminal pastes it as it always has (bracketed paste included); only an image with no text becomes an image
paste. On Linux the webview hands a pasted image over as an empty paste, so an empty paste asks the host for the
clipboard's picture ([tauri-clipboard](stack/tauri-clipboard.md)). Plain Ctrl+V on Windows and Linux is never taken: like every plain Ctrl+letter there, it goes to the program
in the pane as a raw `^V` (so Claude Code's own clipboard handling and vim's `^V` work). The chat composer takes any
paste chord, since its paste event is not behind a terminal. PNG, JPEG, GIF and WebP are taken (the host checks the
first bytes, not the name the webview gives); another image type is refused with one error toast. At most 25 MB,
refused before the image is read. On a pane of this computer the host keeps the image in its private cache
(`pastes` in the app's cache folder, mode 600, cleared after a week) and the path is typed into the pane, quoted
for the shell. On a pane of another machine the image is sent as a dropped file is, by the same runner and events:
the same progress toast (`Sending the image to build`, progress bar, **Cancel**), the same error toasts, and the
far-side path typed only if it is absolute, at most 4096 characters and free of control and invisible characters.
A machine that is not `connected`, one reached by a custom transport (`via`), or an unknown one is refused with one
error toast, in the words used for dropped files. The image never goes through an event and is never logged: it is
the raw body of the command.

**What the TUI asks another machine's daemon instead** (each answer is taken only as the reply to
this window's own question, as every reply from another machine is, and what it names is drawn with
control and hidden characters taken out):

- **Clone a repository** (`client/screen/clone_repo.rs`, `Action::CloneRepo`; Search commands, the Menu's
  NEW, a machine heading's right-click). A modal `Clone a repository to <this computer | machine>`: the
  address (it has the keys first; at most 2,048 characters), the machine's own GitHub repositories
  (`Query::GitHubRepos`, `Query::GitHubOwners`: newest pushed first, `· private`, the description; a
  search asked again 300 ms after the last key; Ctrl+O the next owner; `Loading your repositories…`,
  `No repository matches.`, the first-200 note), then "It goes in a new folder, named after the
  repository, inside:" and that folder (at most 4,096; the last one used on that machine, kept in
  `<app>-ui.json` `clone_into`, else this computer's start folder or `~`). Enter in the list fills in
  the address; Enter in the address or folder sends `Query::CloneRepo`, whose daemon judges the address
  and runs git with that machine's sign-in. A machine with nobody signed in says `Sign in to GitHub on
  <machine> to pick from your repositories: gh auth login`, one without `gh` says where to get it;
  pasting still works. While it clones it reads `Cloning… A large repository can take a few minutes.`
  and takes no typing; a refusal stays in the dialog as the machine said it. Success opens the folder
  (this computer's as any folder opens, another machine's with a shell there). Esc while cloning closes
  the dialog and the clone ends in a toast. An older local daemon gets "restart the service to clone a
  repository" and is not asked.
- **Open a folder on a machine** (`Action::OpenFolderOn`; a machine heading's **Open a folder…**). The
  folder picker, titled `Open a folder on <machine>`, lists that machine's folders through
  `Query::ListFolders` (tagged; an answer for a folder already left is dropped), from `~`, with `/` in
  paths, `reading <machine>…` while it waits and `no such folder there` when it has none. Enter on
  `.` or a repository starts a shell there on that machine; another folder is gone into by the path its
  daemon gave. A machine that is not connected is refused with a toast. With no other machine connected
  the command opens this computer's picker.
- **Specialist agents** (`client/screen/specialists.rs`, `Action::Specialists`; Search commands, the
  pane's Project… menu). A read-only modal `Specialist agents · <session>` from `Query::Specialists` for
  the pane's machine: THIS PROJECT, YOUR HOME FOLDER, ELSEWHERE, each file's name, tool and description;
  Enter shows the file as text (`Claude Code · <path>`, `The file is longer; only its start is shown.`).
  Nothing is written; Claude Code's `/agents` and the files themselves are where they are changed (ADR
  0010).
- **Clean up worktrees** works for another machine's project: its daemon says where each worktree stands
  (`Query::WorktreeStanding`, asked one after another since the answer names none; a worktree whose
  folder is gone is left out) and removes the ticked ones (`Command::TidyWorktrees` to that machine).
  This computer's are still read with git here.

**The TUI's worktree picker** lists, after the worktrees, each branch with none (local ones, then
remote ones by their short name, read with git off the UI thread) as `+ add a worktree on <branch>`;
Enter makes it with `Command::NewWorktree` and opens it, as a typed branch does. A typed name that is
an existing branch is that row, not a new branch.

## Project-specific: frame presentation

Wrap each outer terminal frame in synchronized-update markers; end the update
even when drawing fails. An unfinished child update from the previous frame
must not delay switching to another session.

Keep pane padding and the card interior on the same surface as a terminal app
when at least three screen corners use one explicit background color. Preserve
the pane insets; isolated colored panels keep their existing theme treatment.
Preserve colors applications paint explicitly.

## Project-specific: Extensions page (desktop)

Settings › Extensions (`apps/gui/src/features/extensions/`, nav key X; data from `apps/gui/src/api/extensions.ts`) lists,
switches, removes and adds the skills, plugins, MCP servers and marketplaces of Claude Code and Codex, so none of them
needs a terminal ([spec](features/chat-extensions/spec.md)). The chat's `/plugin`, `/plugins`, `/marketplace`, `/skills`,
`/hooks` and `/mcp`, typed alone, open it (`windowCommands.ts`); with an argument they still go to Claude Code. Rules:

- **Where it looks.** A **Project** picker ("Just mine", then this computer's open projects) decides whether a project's
  own plugins, servers and skills show with the user's; another machine's projects are not offered, because the daemon
  changes its own computer's agents. One card per agent lists Plugins, MCP servers, Skills and Marketplaces with what is
  installed, "None installed." when nothing is, and a file that exists but could not be read as a line saying so.
- **Changing.** A plugin has a switch; every item has Remove. Remove asks first ("Remove X?", Cancel focused; a skill's
  words say its folder and the files in it are deleted). Both go through the agent's own command, so the list is read again
  afterwards; a refusal is a typed line, never the agent's raw words. "A change shows up in the next chat you start."
- **Adding.** Three cards (marketplace, plugin, MCP server) only ask for a **Review**. The dialog then shows the agent,
  where it applies, where it comes from, exactly what it will run, the host that hears the person's prompts, and **This
  runs code on your computer with your access.** Cancel is focused and Enter does not confirm; only the confirm button
  sends the token the review returned (`confirmAdd` is called from nowhere else). No "trust always". A server's keys and
  headers are not taken here.
- **Needs a terminal.** A card says so in plain words with the exact commands: `claude mcp login <name>` and
  `codex mcp login <name>` for a server that signs in through a browser, and that a project's `.mcp.json` servers wait for
  the person's approval inside Claude Code itself.
- **Not seen on screen yet:** the page was written against the existing Settings cards and tests only.

## Project-specific: desktop chat view

The desktop app's chat view is a second view of a Claude Code or Codex session, never a second session
([chat view plan](features/chat-gui/chat-view-plan.md), ADR 0006). Rules:

- **Source.** It renders only the daemon's structured events, through `features/chat/` (the projection).
  It never reads terminal output. A session has a chat only when `conversationsFromSnapshot` found a daemon
  conversation whose native terminal is that pane (`Conversation.chat`); `model/chatView.ts` decides
  availability: `ready`, `no-events`, `unsupported` (another agent) or `shell`.
  `model/agentAbilities.ts` is the one table of what each agent supports (slash commands, permission modes,
  structured chat, move to worktree, answer keys, changing its model from the chips, `!` shell lines, resuming saved
  conversations, model discovery, asks reported by hooks); an agent it does not name has none of them. Code that offers
  or hides one of these asks `abilitiesOf` (or `hasAbility`, which also narrows to a `StructuredAgent`) rather than
  comparing the agent's name.
  The daemon gives a Claude, Codex or Gemini CLI agent started in a pane a **read-only** conversation that follows the agent's
  own transcript (Gemini's `~/.gemini/tmp/<project>/chats/session-….jsonl`, named by the hook's `transcript_path`; it has no structured runtime, so "New session" starts it in a terminal opened on its terminal view) ([ADR 0003](adr/0003-status-and-conversation-trust.md)); its link has
  `readOnly: true`, and the conversation is not listed as a session of its own (the pane is the session).
- **A chat session is the other kind of session** ([ADR 0003](adr/0003-status-and-conversation-trust.md)):
  a structured conversation the daemon started (`Conversation.execution` is `Structured`, `chat` is set without
  `readOnly`, `native_term` is none; `model/chatSession.ts` `isChatSession`). It is a sidebar row, tab and pane of its
  own, grouped by its machine like any session. It has **no terminal**: the pane is the chat
  always, there is no Terminal | Chat switch, `chat-toggle` does nothing, the terminal slot holds a one-line note
  (`NoTerminalNote`), and nothing that needs a pane number (find, restart, paste, broadcast, typed answers, the
  worktree menu, Inspect) is offered for it. Its composer is on (send, queue with Remove, Stop, attachments); an
  approval is answered by request id (y / a / n) and a user-input request by a form (`UserInputForm`), so neither
  points to a terminal.
  **A new session** (the New session draft) starts the chosen
  agent (Settings › Chat › Chat view › **Default agent**, Claude or Codex, unless the page picks another) in a new
  shell the daemon owns and types the agent's command into it, and opens the pane in the view Settings › Chat
  names for that agent (**Open sessions in**: Chat or Terminal, one choice for every agent but Gemini, which always opens in its terminal). It is
  one session either way: **the switch between Terminal and Chat never restarts the agent**
  ([ADR 0003](adr/0003-status-and-conversation-trust.md), v18 B.3). The chat reads the
  agent's own transcript (ADR 0003), and its composer **types into the agent's terminal** as one bracketed paste and
  Enter, only while the pane's trusted status says the agent is idle or done; while it works the composer is off and
  **Stop** sends Esc, and while it asks something in the terminal the chat shows a card, built from the agent's own
  `PermissionRequest` hook and never the screen: "<agent> wants to use <tool>" and one line of what it acts on. For
  Claude the card has **Yes once** (sends `1`) and **No** (sends Esc); for Codex it has the same two buttons, which send `y` and Esc (checked against codex-cli 0.166.0), but only while the pane's screen is Codex's command or file-change approval menu in the shape checked then and shows the command or file the hook reported (`codex_prompt_answerable`, read again on every list). For an agent whose answer keys are not
  verified, a Codex menu of any other shape or for another command than the hook's, or a menu the chat has no buttons for (the Claude autocompact size, a setting to confirm), it shows the question as the agent's terminal draws it (`TerminalPrompt`, read again every second and after each key) and a row of **↑ ↓ ← → Enter Esc**, which type those keys into the agent's terminal, so the person answers from the chat as they would there. The keys are the person's own and change no status (ADR 0003); on another machine the screen cannot be read, so the card says the question is in the terminal and keeps the keys. The daemon sends a screen as what a terminal needs to draw it, so the text is read back as plain lines first (`linesOfScreen`): no colour or cursor code is ever shown. What is shown is the menu under the rule that opens it, looked for under the last two rules only (a rule Claude draws inside its question menu, above the last option, does not start it), or the last 14 lines under the last rule, each cut at 140 characters, when no menu is found. A menu is one with a selected option: a `❯` line that is numbered or has another choice right beside it, so a message the person sent, which Claude also marks `❯`, is not one. The options start at the unbroken block that holds the selected one, so a numbered list in the question stays with the question. Of a menu, the last 12 lines above the options and the first 60 lines of options are shown, uncut in length. What is asked stays in view, itself no taller than 220px; the options scroll under it at 220px, with the selected one marked and kept in sight. The card is the message box's question tray
  ("Yes once" sends `1` for Claude and `y` for Codex, "No" sends Esc). The sidebar's answer buttons and a notification's Allow are separate: they type a key from `sidebarAnswerKeys` (`y` as `1` for Claude, and bare letters for its `a` and `n`). For Codex they send only the verified keys, `y` to allow and Esc to decline, never `a`, and only while the daemon marks the ask `answerable` (read from the session's ask when the button is shown and again when it is pressed); otherwise Codex gets no Allow and nothing is typed, and the person answers in the chat or the terminal. A plan Claude asks to leave plan mode with (`ExitPlanMode`) is shown formatted,
  read from the history's ExitPlanMode call (`planApproval.ts`; a plan the history cut says so), with Claude's own
  plan menu as the daemon read it off the screen (`asking`; `planMenuChoices` takes the choices from the last line
  numbered 1, which must run 1, 2, 3… to the end, because the daemon's reading also takes in the plan's numbered
  steps), one button each in Claude's words that sends its number, and **Keep planning** (`n`, Esc). The menu
  differs between Claude versions and sessions, so it is never assumed: where it cannot be read the card shows the
  terminal's question and keys (`TerminalPrompt`) and `y`, Enter and the numbers send nothing. On a Claude permission card, a choice Claude's own menu offers beside Yes and No is a ghost button in Claude's own words that sends its number (`alwaysAllowChoices`, `alwaysAllow.ts`), only on a click: nothing is pre-selected, no key or Enter picks it, and Maiker writes no rule of its own (Claude keeps what it is told, and its words say what and where). Read off the daemon's `asking` text, it is offered only when the menu is "1. Yes", then choices numbered in order, then a "No", and the choice starts "Yes, and don't ask again" (the wording of the checked fixture; "allow all edits during this session" and other wording is unverified and so not offered). Any other menu keeps the two buttons. A question Claude asks (`AskUserQuestion`) with one answer has a button
  for each choice, which sends its number. A prompt of several such questions (`PermissionAsk.questions`) shows them
  one at a time: a tab for each (its number, ✓ once answered), the question with its choices, **Back** and **Next**,
  and on the last one **Send answers**, off until every question has an answer;
  it then types the number of each pick in the prompt's order, a quarter second apart, and `1`, which is "Submit
  answers" on the page that reviews them (checked against Claude Code 2.1.322 in a terminal). A prompt with a question
  that takes several answers (`multiSelect`, even a lone one) comes as `PermissionAsk.form`, which a peer from before
  it does not read, so it leaves that prompt to the terminal instead of answering a key per question. The form gives
  such a question checkboxes ("Pick any", at least one) and types each ticked number, then → to move on (checked
  against Claude Code 2.1.325); a question with one answer still takes its number. After the choices, every question
  (a lone one too) has a **Your own answer** row, the prompt's own "Type something": a one-line box that counts as the
  answer once it holds words (for a question with one answer it replaces the pick). Its keys, checked against Claude
  Code 2.1.325: for one answer, the row's number, the words and Enter; for several, ↓ once per choice to reach the
  row (typing ticks it), the words, Tab to its Submit row and Enter (→ there would move the text cursor). A lone
  question's row has its own **Send**. The daemon writes each key a beat (80 ms) after the last while the pane asks
  something (`KEYS_APART`), because keys that reach an agent in one read are taken as typed text and the menu ignores
  them. The box stays off while
  the tray shows, because typed text would answer that prompt. A message the daemon types for an agent (the
  first message of a new chat, or a queued one) is its text and then Enter a tick later; when the agent was still
  starting or the machine was busy the two can arrive together, and the agent reads the Enter as a new line and leaves
  the message unsent in its box. An agent with hooks reports a prompt the moment it is submitted, so when no report
  comes within three seconds the daemon presses Enter once more (`Term::enter_again_due`), never when something was
  typed into the pane since. A message the chat box pastes into an agent's terminal gets the same second Enter from
  the window when, 1.5 s later (`RESUBMIT_AFTER_MS`), the agent is still at rest and its history does not hold the
  message; a message the agent joined to the one before it counts as sent (`countUserMessages` matches the words
  inside a message, not only a whole one). Attachments are off for it. **New terminal** (the sidebar button, Cmd+Shift+T or Ctrl+Alt+T,
  a project's **New terminal here**, the palette) is a plain shell with no chat view. A chat session of ADR 0003, with
  no terminal, still starts from a shell's empty chat card (**Start a Claude chat** / **Start a Codex chat**) and
  stops the agent when closed (`closeChatSession`: end, then put away; if the stop fails it stays open).
- **Choosing the agent for one session.** The sidebar's + and its right-click menu (**New session**, **New terminal**) open the New session draft, which starts the default agent from Settings; the agent dropdown in the draft changes it for that session, and a machine's menu has **New session here** for another machine.
- **New session draft: nothing jumps** (`NewChatPage`, `session-dialogs.css`). The header's chips, the message box and the foot's chips keep their places whatever is chosen: the Branch chip's width is its own and not its text's, the permission chip and More options always show, and the Starting card takes the place of the title in the same column the session's own chat uses. The draft is a plain region in the main area (`aria-label="New session"`), never a `dialog`; a test fails if it becomes one. Check it by measuring `getBoundingClientRect` of each control across the states (each agent, model, effort, New worktree and This folder, an error, a long branch name, 360px and 1200px): the differences are 0. `#dialogs?show=new`, `new-long`, `new-more` and `new-fail` draw the states.
- **The agent dropdown** (`AgentPicker compact`, given `onAgent`) is the dialog's one control for the agent, model and effort: its menu opens downward from the button, so it never covers the message box it belongs to (it flips up when there is no room, and is never taller than the room there is), and has an Agent radio list (flat marks, type-ahead), the Model rows and Reasoning as a Segmented (none for an agent without an effort setting). It stays open while a choice changes and closes on Esc, Enter or a click outside. The chat's own button, below, is unchanged.
- **Agent, model and effort.** A button names the agent's mark and the model (the one picked, else the one the agent's
  own file says, else just the agent) with a four-bar meter for the effort, and opens one small menu (`AgentPicker`, layout 2h: 300px, square,
  opening up from the right of the box): the agent, only before a chat starts (after that its agent is already running), as an **Agent**
  segmented control with a column per agent, each its mark and name; the models, a 32px row
  each with its description as the tooltip, an accent tick on the picked one and a dim "default" on the model the agent's settings
  name; then a foot of **Effort**, four rising bars (Low, Medium, High, Max) and the level's name at the right. Earlier models wait
  under a **More models** row, so the newest lead; the picked one shows wherever it is. Picking leaves the menu open; Esc
  or a click outside closes it. The default model (the one the settings name, else the one Claude Code says it
  would pick) stands for "nothing picked": there is no separate Default row then, and picking it sends no model. Where
  no default is known (and for Codex), a Default row stays, because which model it means cannot be read. Effort starts as "Agent's own" with no bar filled, since the level the
  agent uses cannot be read; pressing the picked bar again goes back to it. A level a model does not take is dimmed with
  "not on this model": the levels come from the agent's own list for each model (for Codex's Default row, whose model cannot be read, Max
  is left out). Codex's default is the top-level `model` of its `config.toml`, where its list has that model.
  Picking a model that does not take the picked level drops to Medium, or to the agent's own where it takes none.
  Claude's models are asked of Claude Code itself (`agent_models` in `apps/gui/src-tauri/src/lib.rs`): the app starts it once, reads the
  model list from its start-up reply and stops it, so every model the account can run is there under Claude Code's own
  names. Where it cannot be asked, the list it gave last time is used, and failing that its files are read instead (the account's extra models, the ones it has settings for
  and the one its settings name) and added to the fixed aliases. The list is this computer's, also for a chat on
  another machine. The choice is kept per conversation in this window's storage
  (`agentChoice.ts`) and goes to the daemon with every message (`send_conversation`'s `model` and `effort`); what was
  not picked sends nothing, so the chat keeps what it started with and the button never claims a model the chat is not
  using. A chat that follows the agent's terminal keeps no choice of its own: a pick is typed in as the agent's
  `/model` or `/effort`, the button shows it at once, and from then on names what the agent's own files say it runs
  (`TermInfo.effort`, the chat's model), so a change typed in the terminal shows here and one made here shows there.
  A kept pick could disagree with the terminal: one made in the terminal, or a number reused after a daemon restart.
  A resumed Claude comes back on the model and effort it last ran (`Daemon::running_as`, API_PATTERNS).
  Claude's fixed aliases are Fable, Opus, Sonnet and Haiku (`KNOWN_MODELS`, which the list read from Claude Code extends);
  Codex's models are read from its own `models_cache.json`, and until Codex has fetched them only its account default is offered. The agent never changes.
- **A chat that fails to draw** shows "This chat hit a problem" in its pane only (`PaneErrorBoundary`), with **Try
  again** and, for a terminal agent, **Show the terminal**; the rest of the window and the session go on.
- **Switching changes the window, not the session.** The choice is per session (`usePaneViews`), the terminal stays
  mounted and its pane keeps its size, and no daemon command is sent. The one thing that moves is the chat box's text: going to the terminal pastes it into the agent's prompt, with no Enter, when the pane is idle or done and no file is attached (`carryDraftToTerminal`). The shortcut is `chat-toggle`
  (Ctrl+Shift+E, Cmd+Shift+E) on the focused pane.
- **Keyboard.** While the chat covers a pane its terminal is not focused (`TerminalView focused` is false) and is
  hidden from Tab and screen readers. The chat adds no layer to the Esc ladder.
- **Selecting.** In a terminal pane, releasing the mouse on a selection copies it and a "Copied" toast says so
  (xterm's own selection, `TerminalView.tsx`). In the chat nothing is copied by itself: a small bar appears where the
  mouse let go (`SelectionBar`, `selectionActions.ts`; never for the message box, and only for a selection that
  started in that chat) with **Copy**, which copies with the same toast, and **Quote**, which puts the text in the quote strip above the message box
  (see Replies and quotes below) and puts the caret in the box. The bar goes when the
  selection does, on Esc, and when the chat scrolls. It is drawn in the window root over everything, like a menu, and
  kept inside the window, never under a code block or cut off at the chat's edge.
- **What opens on top.** Every menu, picker, popover and tooltip (the shared ones in `components/ui`) and the chat's
  selection bar open on one layer, `--layer-pop` (`App.css`), above the window's panels, drawers and dialogs, so one
  opened from inside a drawer or dialog is never drawn behind it. Give a new floating thing that layer, not a number. A program that handles the mouse itself (a full-screen agent) copies what was
  selected in it with OSC 52; the daemon passes that on as `Clipboard` and the window puts it on the clipboard with the
  same toast (`useMachines.ts`), for this computer and for a machine that was allowed to.
- **Replies and quotes.** Quotes collect in a strip above the message box (`QuoteStrip`, up to 5, duplicates ignored, × per row,
  **Clear**) and are sent as one blockquote each with the line `> Quote from <who>:`; `quoteMessage.ts` is the one place that
  writes and reads that format, and `selectionActions.ts` says whose message a selection began in. Each message has a quote
  button (reserved room, shown by opacity on hover or focus; the person's own sits in the meta line). A stub in a sent bubble
  is a button: it scrolls to the source (`quoteJump.ts`), opens the folded block that holds it (`RevealContext`, read by
  `WorkCard` and `AgentsCard`) and outlines the row for 1.2s, never with reduced motion. Message actions reach the chat through
  `ChatActionsContext`; a chat with no message box to reply in (a helper's) provides none and draws none.
- **Quick reply.** A finished agent message that asks in plain text (`askablesOf`, conservative, see DESIGN.md) gets a Reply on
  each question and, for two or more, the line "N questions · Reply to each". The **reply tray** (`ReplyTray`) is a labelled
  group in the question slot, neutral, one row per question. Focus: opening puts the keys in the first answer (or the
  question's own); the answers are `tabindex=-1`, the row is the tab stop. On a **row**: Up and Down or Tab and Shift+Tab move
  between rows, Enter or Right writes in it, `y` and `n` answer a yes-or-no row and go on, `1` to `9` jump to that row, any
  other key starts writing. In an **answer**: Enter goes to the next row and sends from the last, Ctrl+Enter sends from
  anywhere, Shift+Enter is a new line, Up and Down on a one-line answer move between rows. Esc or Cancel closes and keeps the
  drafts; a send clears them and says "Reply sent" in a polite live region. Inputs are labelled with their question, the row
  is a group named by its number and text, `dir="auto"` follows right-to-left text, and unbroken text wraps. The send is the
  composer's (`sendReply`), so a busy, starting or failed session queues or refuses exactly as the box does.
- **A program's "bright black" background** is drawn as the hovered row's ground (`terminalSlab`), not the palette's
  bright black, which is dim text and as a background is a glaring bar. xterm has one colour per slot, so
  `brightBlackGround.ts` rewrites `100` and `48;5;8` to a true colour on the way in. The TUI does the same when it draws.
- **History.** `useChatFeed` follows one conversation while its chat is open (`chatFeed.ts` is the pure core). The
  first read pages the whole history; later reads happen when the daemon says the conversation changed
  (`conversation-changed`, at least 100 ms apart) and on a poll (300 ms while the agent works or waits on a person,
  1 s once the daemon has announced a change for this chat, 3 s otherwise, none while the window is hidden). Each
  reads from the daemon's `resume` cursor, which returns only the entries added or
  changed since, so a 1,000-entry conversation costs one small read per poll. A page that says `reset` (the history was
  rebuilt, or the conversation started over) replaces what the feed held. A failed read, or a daemon that predates
  `resume`, falls back to the old way: ask again for the last page read, or read from the start when that cursor is
  stale. A failed read is tried again after 500 ms (`RETRY_READ_MS`); the chat shows a "Reconnecting to this chat…" line ("What is shown may be out of date." and the reason)
  with the reason only when that one fails too, since one failure is usually a stale kept line, and only while the
  service is up: a lost service is the window's news, said once by its bar. A history
  the daemon marks incomplete (`completeness`, such as a long transcript of which it reads only the last 16 MB) shows
  no notice: the chat shows what it has. Entries already applied unchanged are skipped, so nothing is shown twice and unchanged events stay the same
  objects. A new generation shows a fresh projection. Pending approvals come with every page and go to `applyApprovals`,
  which keeps the projection when nothing about them changed; a read that would draw the same chat (`looksTheSame`:
  the same projection and page facts) does not redraw it, so a working agent's chat is not drawn again several times a
  second for nothing. The daemon reads a followed agent's transcript every 250 ms while the pane works or asks, and
  every second at rest (`follow_gap`). The last feed per conversation is kept (32 at most), so reopening a chat shows it
  at once.
- **List.** `VirtualList` draws only the rows near the view (`transform` placement, measured heights, stable event
  ids as keys) opens on the newest row and follows it while the view is at the end, so rows that arrive or grow keep the
  end in sight. Following goes by the reader's direction (`followAfterScroll`): any move up lets go at once, even a nudge
  that stays near the end, and only a move down that ends at the end takes it again; a scroll the list or the web view made
  says nothing. A reader who scrolled up is never pulled down. Rows that come in above the view while the reader reads move
  the view by as much, so what is read stays put. When the person sends a message (`toLatest`, with `isSent` naming the rows
  that are theirs) the view takes it to the top with room left below it (`sendTop`, `sendSpacer`, the scroller's padding
  counted), keeps it there while the reply is shorter than the view, then follows the reply's end until the reader scrolls
  up; a message queued behind a running turn is not in the chat, so it moves nothing. When the view is short of the end the
  list offers "Jump to the latest message". Rows
  are `buildRows(events)`: one agent message per turn (adjacent agent messages of a turn are joined; a step between
  two messages keeps their order), user bubbles, step cards, approvals, turn dividers, and the live box last. While the
  agent works the turn's own steps, thoughts and messages are drawn as they arrive, above the live box; only a pending
  request is left out of the list (the question tray asks it).
  Two or more steps that follow each other (edits, commands, tools; never the to-do list) fold into one **work row**
  (`workSummary.ts`, `WorkCard`): a line such as "Read 2 files, edited 3, ran 1 command" with the daemon's own time for
  the run, a "N steps" chip and a chevron on one row that opens to every step, one open at a time. Every run and every
  step inside a run starts folded, a failed one too (its line says so), so a long turn stays short; only a run whose pending
  request is about one of its steps starts open. A command or an edit that stands alone is a card with its facts in
  the head (`StepView` with `alone`) and starts open, showing the command's last lines of output or the edit's diff;
  inside a run it stays a folded row.
  The agent's reasoning (the daemon's `Reasoning` history items, Claude's thinking and Codex's reasoning summary) is one
  folded **Thought** row (`ThoughtRow`, a `thought` row of `buildRows`): reasoning that follows each other in a turn merge
  into one row, a Thought between two steps ends the run of steps before it, and a click or Enter opens its text. The text is
  model output, so it is plain paragraphs (no Markdown, no HTML), is not searched while folded, and is never logged or sent
  anywhere. A reasoning item with no text gets no row. A merged row's button is named "Thought, N parts". A Thought always ends the run of steps before it and splits an agent message around it, so the message before and after stay two messages; with Hide successful tool calls on, thoughts that only quiet runs separated merge into one row, but a Thought between two messages still keeps them apart. There is no live "thinking…" line while it runs.
  Settings › Chat › Chat view › **Hide successful tool calls** (`hideSuccessfulTools`, off by default; a setting saved
  before it reads as off) leaves out a run, or a lone step, made only of reads and searches that completed
  (`isQuietRun`: Claude's Read, Grep, Glob, LS, NotebookRead, WebSearch, WebFetch and ToolSearch, matched on the whole
  name; Codex reads and searches through commands). A command, any other tool (every MCP tool), an edit, a
  written document, a step running, failed or stopped, and the to-do list always show; so do the turn's divider and
  changes row. A run shows while it runs and goes when it finishes. A message the hidden run stood between reads as
  one, and an approval about a hidden step links to no row. The summary a new chat starts from is built as if
  nothing were hidden.
  Under the divider of a turn that edited files is a **changes row**: "3 changed files +111 −0" (each file once; the
  lines only when every diff was kept), which opens the side panel on Changes with what that turn changed: the diff
  from the last snapshot taken by the turn's start to the last one taken by its end, a snapshot counting up to 3 s
  late (`inspect/turnRange.ts`; the snapshot list is read again for each turn). The range covers the checkout, not
  the agent: hand edits, or another agent in the same checkout, during the turn are in it. "This turn's changes"
  heads the files with **All changes** to go back to the working tree, and no commit is offered beside it. With no
  snapshot from before the turn, none newer than that by its end (a row only shows for a turn that edited files, so
  that one is missing, not "nothing changed"), or a turn without the daemon's times, it shows the working tree as
  before under "Whole working tree · <why>". The row focuses its own pane and shows that pane's session (a helper agent's chat open there stays open); moving
  to another session, closing the panel, and the other ways in show the working tree. A session on another machine
  gets the local-only refusal, as before.
  A message the person sent has a **⋯ menu** beside its bubble (shown on hover or focus) with **Edit from here**
  (`MessageMenu`, `useEditFromHere.ts`). It finds the snapshot taken before that message's turn
  (`snapshotBefore` in `inspect/turnRange.ts`, by the daemon's turn times), asks the daemon how many files a restore
  would change against the files as they are now (`RepoRequest::RestoreCount`), and asks first: "N files change back
  … What is there now is kept as a "before a restore" snapshot", Cancel (which has the focus, so an Enter typed as it opens does nothing) or **Restore N files** (danger). Nothing is
  restored without that yes. A turn without the daemon's times, no snapshot from before it, or a count that cannot be
  read gives a toast saying why and offers no restore. After the restore the message goes in the box, ahead of
  anything already typed there (a draft is kept, under it, and the confirm says so); nothing is sent. The next
  message sent from that chat starts with one line telling the agent the files were restored to before that message
  (`restoreNote`; the quoted words cut by character, with no control or format characters); the agent's own conversation is not rewound. A line under the box says the note will go, with **Leave it out**. A bubble, a later Edit from here and the quote leave that note out (`stripRestoreNote`).
  The note goes when the box is emptied or the chat is left; a slash command or `!` line goes out without it and
  leaves it for the next message. The item is greyed, with the reason in the menu, while the agent works (the daemon
  refuses then too, for a terminal agent and for a chat working in the same checkout) or the daemon is offline; a session on another machine gets the local-only refusal.
  It is also greyed, "Another session is using this folder", while another open session on the same machine runs
  anything but a plain shell in the same checkout, idle or not, since a restore would undo its files too
  (`sharedCheckoutRefusal` in `workspace/model/sharedCheckout.ts`). Same checkout means the same top folder (the
  daemon's `top`, the pane's main checkout or linked worktree), compared with either separator and without a `\\?\` prefix, and without case only for a
  Windows drive path; a
  session in a subfolder shares it, another linked worktree of the same repository does not. A chat the daemon gives no
  checkout for counts when its folder is inside this one. The session's own terminals and closed sessions do not
  count. The check is the window's; the daemon holds no lock. A refusal that arrives while the confirm is open makes
  the confirm restore nothing and say why.
  Where an agent ran out of room and carried on from its own summary of the conversation, the daemon sends the summary
  as a `contextSummary` tool step and the chat shows a **summary row** (`ContextSummary`): a divider reading "Earlier
  conversation summarised to make room" that opens to the summary as formatted text. It is never a user bubble, never
  folds into a work row, and Find does not look inside it. A turn that held only the summary gets no "Finished in"
  divider. What `/compact` prints ("Compacted (ctrl+o …)" and its hooks' output) is drawn as a **compacted line**
  (`compactionOf`, `CompactedLine`): a pill in `--link` across the chat reading "Conversation compacted", with the hook
  events that ran named ("PreCompact hook ran"), never their command lines; the whole output is its tooltip.
- **Cards** (`features/chat/components/`). Every fact the history carries is shown, and a missing one is said to be
  unavailable (a diff the history did not keep, a checklist without items, a command time or exit code the provider
  does not report, a turn without the daemon's times shows "Turn finished", not an invented duration). Only a step
  that is running animates (its spinner).
  - *Step row* (`cardParts.tsx` `StepRow`): the mark, the kind of work as a small glyph (`StepTool`: read for a
    tool that looks at something, edit for a file change, run for a command), a verb, what the step acted on, and how
    it ended. Every step is one; a step with detail is a button that opens it. A command on its own is a card that
    opens on its output once it has ended; an edit card's Open in side panel is the side-panel glyph, and the
    changed-files bar wears the edit glyph. A table column of figures (`numericColumns`: every cell a number, maybe
    with a currency or a short unit) sits right, in mono, unless the table set its alignment.
  - *Tool step:* the verb and target are read from the tool's own input (`toolFacts.ts`): "Read `src/a.ts` lines
    40–88", "Search `pattern` in src", "Fetch example.com/docs", "Skill review:pr" and its arguments, an extension's server
    and tool. Nothing the input does not hold (hit counts, a status code) is shown. Click opens the input and the
    result, bounded.
  - *Edit step:* the file as a badge, Added / Deleted where the history says (Modified only on a Write, or on the
    edit card that shows no verb; after "Edit" it would repeat it), `+N` `−N`; it opens to the
    diff, folded past 12 lines with "Show all N lines" / "Show less", and "Open in side panel" (the Inspect panel's
    Changes view). A diff too large, one the history did not keep and a secret file each say so. A finished Write of a
    Markdown file whose text the history kept is a document card instead (`writtenDocument.ts`).
  - *Command step:* what the command does when it is one plain read-only form (`commandIntent.ts`: "Search
    `"x"` in src", "Read `a.ts` lines 10–80", "List", "Find files in", "Check git status", "Run tests"; anything piped,
    chained or redirected is not read), else the command's first line; then the live clock or `exit N · time`. A search
    that found nothing (exit 1, no output) reads "no matches" and counts as finished, not failed (`foundNothing`); it opens to the whole command
    and the last 3 lines of output with "Show all N lines". The elapsed time is the provider's duration, else the
    daemon's start and completion times; the exit code exists for Codex only, so for Claude it reads "exit code not
    reported". One on its own starts open; one inside a run starts folded, a failed one too.
  - *Approval card:* see Approvals. *Helper agents:* consecutive helper calls are one card, "3 agents, 2 working",
    a row each (title, type, what it was asked, its time); a row opens what it was asked and its report. *Plan:*
    the agent's own to-do items, "N of M done" and a progress bar. *Live box:* a frameless line, the running light, "Working for 12s" and "Esc to stop", over a skeleton (the step is for screen readers only; a deliberate deviation from the prototype's bordered box); no token count,
    because the daemon's history carries none.
  - *Markdown* (`markdown.ts`, `components/Markdown.tsx`): an agent message is read into a data tree and drawn as
    elements. There is no HTML anywhere (no `dangerouslySetInnerHTML`), raw tags are text, images are never loaded
    (their alt text shows), and a link is kept only for an `http(s)` address. A link is a button, never an anchor, so it
    never navigates the webview: a click hands the address to the host (`open_link`), which opens it in the person's
    default browser, and the toast that says so offers **Copy link**. Outside the desktop app a click copies it. A bare
    address and inline code that is only an `http(s)` address are links too, the code keeping its chip.
  - *Saving a block* (`exportBlock.ts`, `saveBlock.ts`): a code block has **Copy** and **Save**; a table has **Copy**
    (as Markdown) and **Markdown**, **CSV** and **HTML**. Both are cards whose buttons sit in the head above the content,
    so nothing hangs loose under a table where it reads as part of the next paragraph. A save goes to the export folder of Settings › General
    (Downloads until one is picked with the system's folder picker) under "what date time.ext", and a toast says where.
    A code block saves as `.md`, `.html`, `.csv` or `.json` when that is its language and as `.txt` otherwise. A CSV
    cell that a spreadsheet would run as a formula is written with a leading `'`; an HTML table's cells are escaped text.
    A table (a header line, a `| --- |` delimiter row of the same width, then rows, with `:` for alignment) is a
    real `<table>` drawn as a hairline grid in existing tokens, inside its own named, focusable, sideways-scrolling
    region, so a wide table never widens the message; cells hold inline markdown, and a right-aligned column stays on
    one line.
    A reply still arriving (`running`) is read in its finished form (`streamingText`): an opened bold, italic or code
    span, or a link whose address is still arriving, reads as if it closed; a mark with nothing after it yet and a
    last line that is only a list, quote or heading marker are left out; a table waits for its delimiter row; an open
    code fence is untouched. A finished reply is read as written.
    Supported: paragraphs, headings, fenced code, lists, quotes, rules, inline code, bold, italic.
  - *Rows* are memoised on their events (`ChatItem`), and the virtual list measures heights, so a card that expands
    resizes its own row only.
- **While it waits.** The chat never looks stuck. First read of a history: `ChatSkeleton`, the shape of a conversation,
  static (an endless animation costs a repaint every frame, PERFORMANCE), blank for its first 150 ms
  (`useAppearsAfter`) so a quick read never flashes it. A new session's chat is `StartingChat`, there
  at once with its message box; what is typed then is held per session (`firstMessage.ts`) and sent when the real chat can
  send, and a half-typed draft carries over. The model, effort and mode picked on the new-chat page are held the same way
  (`holdStartChoice`): the starting chat draws them in the same chips the real chat has (locked), and the real chat takes them as
  its conversation's choice, so nothing in the box changes when it takes over. One message is held at a time. **Connect <agent>** on its notice installs the hooks and then restarts that session in place (`reloadAgentOnDaemon`, `Command::ReloadAgent`), so the agent loads them. A message sent into the terminal is drawn at once as an `echo` row, with the
  working line under it, until the history has those words (`countUserMessages` against the count at send time); it is
  dropped after 20 s rather than left standing as sent. The **live box's step** (read aloud only) says what the agent is doing from the newest
  step still running (`workPhase.ts`): "reading src/app.ts", "writing hello.txt", "running npm test", "thinking". It says
  only what the history says. When only helpers keep the session working after the agent's own turn ended
  (`Session.helpersOnly`, from `TermInfo.own_turn_over`), it says "Free · 3 helpers working", and
  the box sends at once instead of queueing: the agent is at its prompt.
- **Mode and model.** The message box's bottom row says how Claude is set up, from its own transcript and
  never a guess: the permission mode is a shield whose tooltip and name say it (`Ask before edits`, `Accept edits`, `Plan mode`, `Auto`; the shield is in the
  danger colour for `Bypass permissions`, like Full access), "not reported yet" until the file has said one; in Plan mode a strip in the box says "Plan mode · Reads and plans. Changes nothing until you approve." and the placeholder is "Reply to the plan…". A Claude chat that follows a terminal agent
  changes both from that row, by typing the agent's own commands into its terminal: the mode chip is
  a dropdown that presses Shift+Tab until the agent's screen shows the pick (`modeFromScreen`). It can be picked while the
  agent works: the chip shows the pick at once with a toast ("… from the next turn"), and the keys (or Codex's
  `/permissions`) are typed only when the turn ends, so none lands in it; only a question the agent asks or an offline
  daemon greys it. The effort row of the model menu names the level the agent runs at, or **Default** when its files
  do not say (its tooltip: the agent's own setting); the model and reasoning picker sends `/model` and `/effort`, and a pick made while the agent works is
  typed in at once, as it would be in the terminal, for the agent to take as soon as it can; only a question the agent is asking holds the picker, since typed text would answer it. The agent
  itself is never changed in a chat that has started. A Codex chat on this computer moves its mode with Codex's own `/permissions` command
  and shows the pick until its screen says the command was refused (Codex's files do not name its mode, so the chat claims no more than that);
  its model label is a button that types `/model` and draws Codex's menu in the chat (`CommandMenuTray`: the menu as its terminal shows it
  and the keys a person presses; Close types Esc), off while Codex works or asks. Nothing is chosen for the person: each pick is theirs, and
  Bypass permissions / Full access list what they allow in the menu. Other agents, and a chat on another machine (whose screen cannot be read from here), show them read-only (`chatMeta.ts`,
  `SessionMeta` in the read result). Bypass permissions is pickable only when Claude started with it (`bypassSessions.ts`): **Settings ›
  Permissions › Bypass Permissions** has one switch per agent, on by default and shared with the terminal app, that puts
  the agent's own flag first on the launch line of sessions started afterwards (`withBypass`; Claude started in another
  picked mode gets `--allow-dangerously-skip-permissions` so it can switch later).
- **Composer.** `useChatComposer` sends through the conversation's own send (`send_conversation`) with an operation
  number (the receipt's plus one; a failed send is retried with the same number so the daemon can tell a retry from a
  new message). Enter sends, Shift+Enter adds a line (not while an input method is composing), Esc or Stop interrupts
  the running turn (`cancel_conversation`). It is off, with the reason as its placeholder, while an approval is
  pending ("Answer the request above first"); the request's first control that takes a key then has the focus, so `y` / `a` / `n` or
  Enter answer it at once (a card answered only by a click, such as trusting a folder, takes no focus), and the box has the focus back once it is answered (only when the focus was in this chat's
  box or nowhere). While the daemon is offline the box still takes typing and says why it cannot send. ↑ in an
  empty box brings back the last message sent in this chat, ↑ again the one before, ↓ forward and back to an empty box;
  it steps only while the box holds the recalled message unedited (`promptRecall.ts`). The text of every box is kept
  in the window's storage, 300 ms after the last key (`data/composerDrafts.ts`: text only, the newest 50, a week at
  most), so a restart loses no draft. While the daemon reports the turn working,
  Enter still sends: the daemon holds the message (`ReadResult.queued`) and delivers it when the turn ends, in order
  and once each, so it is shown as a dashed pending bubble with remove and Edit (both `dequeue_conversation`; Edit puts the words back in the box only after the daemon has let go of them, so a message sent a moment ago is never sent twice) and Send now (`send_conversation_now`, `ConversationSendNow`; a refusal shows its reason and leaves the message queued; hidden while an approval or question shows) for as long as the
  daemon holds it, and closing the window loses nothing. The queue is the daemon's memory: a daemon restart drops it,
  and a message queued for a conversation that has since started over is dropped, not sent into the new one. The
  boundary is the end of the turn, the one the daemon can observe for both providers; a message is delivered into a
  running turn only when the person presses Send now. A send that the daemon refuses as `stale or reused` (another window sent in between) is read
  and sent again under a new number; a retry of any other failure keeps its number. A chat that follows a terminal
  agent leaves a message sent while the agent works with the pane's daemon (`queue_follow_up`) under a random
  operation (`terminalSendOperation`); one that failed, a timeout included, keeps it when sent again with the same text within 30 seconds and the box
  untouched; a send still pending never does ([API_PATTERNS](API_PATTERNS.md#project-specific-api-style)).
- **Naming a file with @** (`fileMention.ts`, `useFileMention.ts`, `FilePicker.tsx`). An `@` at the start of the box
  or after a space, with the name typed after it at the end of the text and the caret there with nothing selected,
  opens a list over the box (the command list's
  look) of the session's files whose path holds the name. An `@` inside a word (an email address) opens nothing. The
  daemon finds and ranks them (`RepoRequest::FindFiles`, through `repo_query` and the same pane Inspect asks,
  `repoPaneOf`), asked 120 ms after the typing stops for at most 50; an answer for a name typed earlier is dropped,
  and the client does not re-rank. Only the answer for the name typed now is listed: until it comes the list says
  "Looking for files…" and ↑ ↓, Enter and Tab do nothing (Enter does not send). Moving the caret off the end closes
  the list and gives the keys back to the box. ↑ ↓ move, Enter or Tab replaces the `@` and the name with the path and a space,
  Esc puts the list away until the text changes, a click picks. The path is relative to the session's folder
  (`pathFromFolder`: the daemon answers from the checkout's top, so a session in a subfolder gets `src/x.rs` or
  `../other/y.rs`), and one with whitespace or a `"` is written in double quotes, its own quotes escaped as `\"`. Folders are matched
  without case on a Windows drive path. The message stays plain text. A list of 50 says
  only the best 50 are listed; a daemon that stopped its walk early says some files may be missing. A failed search,
  a daemon older than protocol 89 among them, is one quiet line in the list. For a session on another machine the
  picker reads that machine's folder index instead (`index_remote_files`, the host's ssh index the Get a file dialog
  uses; no daemon question, so no protocol floor): the session's folder is indexed as the list opens, down to six
  folders deep (`INDEX_DEPTH`), and the box ranks the index itself (`fuzzyFind`, the dialog's ranking); the paths are
  already relative to the folder. An index of the same machine and folder is reused while it runs and for 30 s after
  it finishes (`INDEX_KEPT_MS`); a failed one is not kept. Until the index comes the list says "Looking for files…"
  and ↑ ↓ and Tab do nothing, but Enter sends the message as typed, since a machine that has gone quiet can take its
  ssh line's timeout to answer. A failed index is the same quiet line; a machine shown as down says "Machine offline"
  and asks nothing. Which place a session gets is `fileSearchOf` (`fileMention.ts`). It is not offered in the browser
  build or for a session of this computer with no pane to ask.
- **Attachments** (ticket 20). A paperclip left of the text box (tooltip and `aria-label` "Attach files",
  or "Attach files: <reason>" while the composer is off; `aria-disabled`, not `disabled`, so the reason can be read),
  a drop on the composer, or a bare image pasted into the box adds files to the draft; a paste that holds any text
  stays a text paste. The picker is the dialog plugin's `open` (`api/attachments.chooseFilesToAttach`); a drop
  reaches the composer through `chat/composerDrop.ts`, which `DesktopApp`'s one file-drop handler asks before it
  routes the drop to a pane. `useAttachmentIntake` is the only code that adds or removes a draft file: at most 10 per
  message (a drop over the limit is refused whole), a pasted image over 25 MB is refused before it is read, the
  host (`attach_local_file`, `attachment.rs`) checks everything else and returns the cleaned name that is shown.
  Draft files live in `composerStore` beside the text, so switching views loses nothing. Each is a chip (kind icon,
  name, size, a Remove button) or, for a pasted image, a thumbnail made from the bytes the window already holds
  (an object URL, revoked on remove or send). A chip is at most 240px wide: a long name is cut with an ellipsis (its
  whole name is the tooltip), and the thumbnail, size and Remove stay inside it. When a file lands (a drop, or a picture pasted for
  another machine, which arrives after the paste has ended) and focus is not in another field, it goes back to the
  message box with the caret at the end (`useKeepTyping`), so typing carries on. Sending builds the text with `buildAttachmentMessage` (the text, then a
  fixed block naming each kept file by path); a message may be only files. A failed send gives text and files back.
  A sent message is shown by `parseAttachmentMessage` as its text and chips (name, and a thumbnail for an image; "no longer available"
  when `attachments_exist` says the kept file was swept). An image thumbnail, in a draft or a sent message, opens the picture
  full size in a viewer (`KeptImage.tsx`; Escape or a click outside closes it); the host returns a kept image's bytes
  (`attachment_image`, only from its own folders and only for an image) and the window shows them as an object URL. The composer takes a `machine` (the chat link's):
  for another machine the same picker, drop and paste send the file there (`sendAttachments` over `send_files_to_machine` /
  `send_pasted_image`, with the terminal's progress toast and Cancel) and the chip holds the far-side path, checked
  before it is used. No chat sets a machine yet. A read-only chat shows no paperclip, unless it types into the agent's terminal (a chat that follows a terminal agent): the files go in as the block of paths, pasted with the message.
  The new-chat page and a chat that is still starting take files too, keyed in `composerStore` under a negative key
  (`-1` for the page, `draftKeyFor(session)` for a starting chat) since no conversation exists yet; the page puts them in the
  first message, the starting chat holds them with its held message and shows the echo as text and chips.
- **Read-only chat.** For a link with `readOnly` the composer is off with "Read-only: talk to the agent in the
  terminal" as its placeholder, and offers no Stop or queue wording; the daemon refuses send, approve and cancel
  for such a conversation. The history and status still follow the agent. When the agent asks, the box points at the
  card above it, which always carries the question's buttons or, where the chat has none, the terminal's menu and keys
  (`TerminalPrompt`), so a question is never answered only in the terminal.
- **Trust this folder.** A new folder makes the agent ask "do you trust this folder?" before it reports in, so the question is
  in the starting chat (`StartingChat`), read from the daemon's `asking` text (`parseTrustPrompt`, `trustPrompt.ts`). The card
  (`TrustFolderTray`) names the exact folder the screen shows, says in plain words what trusting allows (read and change files,
  run commands, hooks and tools the folder asks for), and has two buttons, **Don't trust** first and **Trust this folder**; both
  are soft, neither is the Enter default, the card takes no Enter, and nothing is ever sent before a click. Each answer is
  found by its exact words (Claude: "Yes, I trust this folder" / "No, exit"; Codex: "Yes, continue" / "No, quit") and sent as
  the cursor's arrow keys and Enter. A screen with other words, a third choice, no folder, or a folder with control characters
  is not this card: it stays the generic menu card (`ScreenMenuTray`). Claude's wording is the screen in the daemon's
  `prompt.rs` test; Codex's is from its source and not yet checked against a capture. No protocol change: the keys go through
  the same pane write as every other answer, which the daemon already gates.
- **Approvals.** A pending request is the message box's waiting card (`QuestionTray.tsx` on `WaitingCard`), not a row of the list; only the oldest shows, and it
  answers through `approve_conversation` by request id, and the request then folds into one line in the list ("Allowed", "Allowed for this session", "Denied"),
  with the buttons gone. While it is pending, `y` (once), `a` (this session) and `n` (no) answer it from anywhere in the
  chat but a field, the same letters as typing into the terminal, which stays a working fallback. The daemon's `answered_approvals` are
  read with every page, so a request answered in the terminal or in another window shows as answered with the real
  choice, even when this chat was opened afterwards. The card names the tool step it is about (`item_id`) and its
  "For: ..." link scrolls the list to that step. A request that asks the person a question (`UserInput`) is answered
  in the terminal.
- **Screen readers.** The history is a labelled region, not a live region. A separate polite status line says only
  that the agent is working, is waiting for an answer, or finished.
- **Styling.** Tailwind utilities on theme tokens only; the keyframes for the view change live in `workspace.css`.

Settings spacing: the page list is one row each; every row on the right ends in one blank row. The sidebar leaves one blank row between a machine heading and its first session, and between machines; sessions sit tight against each other.

Host terminal tab: the client writes the focused session's state mark (the working spinner while it works) and name to the terminal's tab title (`ESC ] 0`, `screen::window_title`, `App::sync_window_title`) after each frame, only when it changed, so the tab says what you are on and whether it needs you.

**A Gemini chat's commands and model.** A Gemini chat is its terminal read back, so its slash commands are the window's list (`chat/geminiCommands.ts`, pinned to the Gemini CLI release `GEMINI_COMMANDS_PINNED_FOR`; written from Gemini's command reference, not from a running Gemini) and every one runs in the terminal, which is shown (`/help` alone is answered by the window and lists the commands). A command is not run while Gemini works: the box says to run it when the turn finishes, because Gemini's documentation does not say a command may run mid-turn (`midTurnCommands` is empty). The model is picked on the New chat page from Gemini's own aliases (`pro`, `flash`, `flash-lite`; Default sends nothing) and goes on the launch line as `-m`; to change it later, run `/model`. Gemini documents no effort setting, so its picker shows none (`takesEffort`). Not built because it could not be verified without running Gemini: answer keys for its permission menu, a permission-mode switch, and reading a question from its screen; Maiker never starts Gemini in auto-approve (`--yolo`, `--approval-mode auto_edit`) on its own (ADR 0005).

A line starting with `!` in a Claude or Gemini chat that follows a terminal is typed into that terminal, not pasted: the `!` first, then the command and Enter after a short gap (`typeMessage`, `isBangLine`), so the agent switches to its own shell mode, runs it and keeps the output in its context. The box says it runs in the terminal, where anything it asks (a login code) is answered. A chat with no terminal, and Codex, send it as an ordinary message. A row whose status is unknown (its machine is out of reach, or a list just missed it) fades to half and says `offline` in place of the time.

## Project-specific: markdown documents

A `.md`, `.markdown` or `.mdx` file of the Files tab opens as a document (`features/documents/DocumentView.tsx`) instead of
the numbered text preview, with a **Segmented** switch **Drawn | Source | Edit** (Drawn is the default; the choice is
remembered per file, never `Edit`). A changed file still opens as its diff first; Show the whole file opens the document.
The Files tab's tree has a **README** entry above the list when the top folder has one; the palette has **Open README** (the
Files tab on it) and **Open README beside the chat**.

- **Beside the chat.** The viewer's header has **Open beside the chat**. It adds a document pane (`PaneSlot.doc`, a path;
  `sessionId` is the session it belongs to) in a new column to the right of that session's pane, by the same split rules as
  Split right: at most `MAX_PANES`, and a full window says so in a toast. A second document in the same arrangement is
  shown in the same pane. In a narrow window the panes stack, as every split does. The pane's Close takes only the pane out
  (`closePaneById`): never the file, never the session. A document pane never trades places with a session pane.
- **Edit** is a plain monospace text box. **Save** (button or Ctrl/Cmd+S) is disabled until the text differs; a small dot
  by the file name says it is unsaved. From 640px of viewer width the drawn page shows beside the text (Preview toggles it).
  Undo is the text box's own. The file keeps its line endings (CRLF stays CRLF) and its final newline as left.
- **Conflicts.** A save over a file that changed on disk is refused: an inline line says so with **Reload** and
  **Overwrite**. While a draft is open, a change found on disk when the window regains focus shows a quiet line with
  Reload; with no draft open the new text simply replaces the shown one. The app watches no files, so the window's focus is
  when it looks.
- **Errors** are an inline line with Retry in the viewer (a failed read, a failed save), never a banner or a toast.
- **Unsaved work is never lost silently.** One registry (`documents/draftGuard.ts`) knows every viewer that holds a draft
  (a viewer registers while its text differs from the file, with its pane and its session). Every way a document can go
  asks through it: the viewer's Close, the pane's close and its ⋯ menu (`closePaneById`), the close shortcut, the palette,
  the sidebar's close and Stop (`endSessions`, which also covers its agent's terminals), a session that ended by itself
  (`useAgentExits`), another file taking the pane's place (`openDocument`, a link in the document, **Open beside the
  chat**), another file picked in the Files tab, and the viewer's own mode switch away from Edit. The question is one
  dialog, **Discard changes to README.md?** (several documents: "Discard changes to 3 documents?"), with **Keep editing**
  (focused, and Esc), **Discard** and **Save**. Save writes every draft first and goes on only when each landed; a conflict
  or an error leaves the draft open and says so in the viewer. A second question while one is open is answered Keep
  editing. Not covered: quitting the app or closing its window (the app has no close-request handler yet, so a draft in a
  window that is closed is lost), the Files panel being hidden while a draft is open (the panel stays mounted), and a
  change of the whole layout (there is no reset or close-others command).
- **Task lists.** `- [ ]` and `- [x]` entries draw as read-only checkboxes (the chat, a document's Drawn view and its
  preview): a flat 14px box (`.mx-task-box`) in the bullet's place that is the same size ticked or not, `role="checkbox"`
  with `aria-checked`, `aria-readonly` and its text as the name; a done entry's text turns `--dim`. Nested entries (two or
  more columns in) indent 18px a level, at most three levels. `[ ]` anywhere else stays text.
- **Other machines.** A session on another machine opens, edits and saves markdown documents through that machine's own
  daemon (ADR 0014): the Files tab lists its folders and opens `.md` files, the README entry and **Open beside the chat**
  work, and its other files say "Only Markdown documents open from <machine>; its other files stay there." A daemon too
  old to save shows Drawn and Source with the line "This machine's service is older: restart it to edit."; a text that
  had to be cleaned to be shown safely is read-only with a line that says so.
- Not offered: Edit against a service older than this app (Drawn and Source only).
