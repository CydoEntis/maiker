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

The desktop GUI is a separate React application in `apps/gui/`, following the TypeScript, React and
shadcn/Tailwind stack docs. It shares session and conversation contracts with the TUI; its look is in
[DESIGN](DESIGN.md#desktop-app).

**Sessions in both clients.** A session is a chat or a terminal session from the moment it starts; nothing switches a
live session between them. A chat's name and closed state are the daemon's, shared by both clients. In the TUI, Enter
on a chat's row says it opens in the desktop app. The desktop host holds one supervised connection per machine; the
web view knows a machine by name, never by where it points. Another machine's session id is `<machine>/t12` (a chat
`<machine>/c12`). A machine's nickname (`machineLabel`) is display only; its own name stays the key.

**Starting a session (desktop).**

- A session starts in an opened project or, on this computer, with no project in the start folder. Nothing starts on
  its own. **Open a project** starts nothing. **New session** opens **the New session draft** (`NewChatPage`) in the
  project in front (`startProjectOn`); no session starts until the first message is sent.
- The draft is a region in the main area, never a modal dialog, and "New session" is the only label that starts an
  agent (tests fail on a dialog, "New chat" or "New agent chat"). Esc or × discards it. A plain shell is **New
  terminal**.
- The draft asks **Where** (Machine, Project, Branch, Work in), **What** (the message box) and **Who** (agent and
  permission chip). Branch and Work in are always drawn; outside git they are dimmed with the reason. A chip that
  cannot be used is `aria-disabled`, not `disabled`. Start stays off while the machine is down or no folder is chosen.
- Defaults: the focused session's machine, the last project, the current branch, the last agent, Medium effort
  (`START_REASONING`). The model button never claims an effort the agent's files do not show.
- A pasted repository address is rebuilt from the checked names (`model/repoAddress.ts`), so a user name or token is
  never sent. Clone failures are plain sentences (`explainCloneFailure`). `~/Projects` is the only folder the daemon
  makes unasked.
- New worktree on a branch checked out elsewhere cuts a new branch from it (`worktrees::branch_worktree`), named from the
  task (`nameForTask`, else `suggestBranchName`); a typed name is used as typed (ADR 0015).
- **Open sessions in** (Settings › General) picks the view; changing it never restarts an agent. Gemini always opens in
  its terminal.
- While an agent's **Bypass Permissions** switch is on (the default), a start uses Bypass permissions, except in the
  start folder with no project (`looseFolder`), which starts in the agent's usual mode.
- The warm agent (`useWarmAgent`) is a head start only; any failure falls back to starting on send.
- **Ctrl+Shift+Enter** starts in the background. Draft starts run alongside each other in order (`useSessionStarts`);
  every other start runs alone and is refused while anything starts. A failed background start is an `InlineNote` whose
  **Put back** never overwrites what was typed since.
- On another machine the launch line is built only from fixed lists (`launchFlags`, `everywhereModel`), so no free
  text reaches the remote shell.
- **Move to a new worktree…** is offered only for an idle Claude or Codex whose conversation id passes its pattern; a
  folder name with quotes, `$`, `` ` `` or `%` is refused rather than typed.

**Problems and lists.** A chat shows its one problem by what it blocks (`features/chat/problem.ts`): a lost machine or
a restart that cut agents is a dialog over the chat column only; a stopped agent or a context at 95% is a dock line.
Every problem comes from a daemon signal; the window never guesses one. A session the daemon's list stops naming leaves
the sidebar only when this window closed it, the daemon gave a removal reason (`Snapshot.removed`) or its machine was
removed here; otherwise it stays, shown as unknown, until a full list confirms it is gone (`trackMissing`). A pushed
list never confirms it, and this computer's list never confirms another machine's session. A screen reader is told once
when a machine goes down and once when it is back; nothing about machines animates.

**Settings › GitHub** (`GitHubSection`) shows what each machine's own `gh` and git say. Nothing is written until **Write
these lines** sends the previewed `Apply`; editing a field drops the preview. A rule set outside Maiker is never changed.

**Machines.** Adding a machine is the Open a project palette's **New machine** level (ADR 0017); there is no
add-machine dialog. A down machine is mended where the sidebar lists it, never with a Trust. Settings › Remote
machines follows the TUI's *Machines dialog*.

**Dialogs that list sessions** ask this computer's daemon only, and each says in one line while it looks, when empty,
when the read fails (with **Try again**) and when the service is too old (with a restart button). **Bring in your
chats**, **Resume a saved chat…** and **Recent sessions** start nothing until a pick; a chat written to in the last two
minutes starts unticked. A row that cannot reopen stays reachable (`aria-disabled`) and says why. The **Workspace**
panel opens and closes nothing until a button is pressed; its **Remove N** confirms inside the panel as a list (the one
exception to the confirm dialog) and sends `go_even_if_dirty` only for a confirmed worktree. The main checkout and a
worktree a session runs in cannot be ticked.

**Desktop service states** (`ServiceStatus.tsx`, `model/serviceState.ts`). While the service does not answer every
status reads Unknown. The first 3 s (`OFFLINE_AFTER_MS`) only the title-bar chip says **Reconnecting…**; then one window
dialog says chats are safe, with **Start service**, **Not now** and **Copy details**. A service of another protocol asks
**Restart Maiker to finish updating** (or **Update Maiker to reconnect**); protocol numbers are never written as app
versions. Toasts raised while offline are held (`holdToasts`). Nothing resumes by itself after a restart.

**Errors in the desktop app** (`lib/toast.ts`, `components/ui/feedback.tsx`; look in DESIGN › *Errors*). A failure
shows where it happened, only as loud as what it blocks: a `FieldError` under the field (`aria-invalid`, shown once the
field is left or the form sent, never while typing), an `InlineNote` on the page you came to read, a chat's dialog or
dock line, the service dialog and chip, and otherwise a toast, never a banner. Errors, warnings, needs-you and progress
toasts stay until dismissed; others go after `TOAST_HIDE_MS`. The stack is a polite live region (errors assertive).
`src/errorSystem.test.ts` fails on another toast library, a banner, or a raw error in `toast.error`.

**The TUI** (ratatui). Colours come only from the theme (`theme.rs`) slots: `bg`, `card`, `card2`, `hov`,
`accent`/`acc_ink`, `text`/`strong`/`muted`, and status `working`, `blocked` (needs you), `done`, `idle`, `err`. Needs
you is amber and failed red in every theme (`with_distinct_needs`); the audit in `theme.rs` asserts needs you looks
unlike every other status, and every built-in theme passes a WCAG contrast test. Shared primitives are in
`client/design.rs` and `client/screen/`. Icons come from `[icons]`, with Nerd Font glyphs where present.

## Project-specific: GUI design system rules

Rules for `apps/gui/`. The app is built to the [design language](DESIGN.md#design-language); where a screen's
description and the design language disagree, the design language wins.

1. Every colour, radius and shadow comes from a theme token (a CSS variable),
   mapped into Tailwind by the `@theme inline` block in `apps/gui/src/index.css`.
   No raw hex, `rgb()` or `hsl()` in components.
2. Every popup (menu, dropdown, dialog, tooltip, popover, listbox) is a shadcn/Radix primitive from
   `src/components/ui/`. No hand-rolled focus, Esc or arrow-key handling. Every control inside a page (switch,
   segmented or radio choice, select or picker, dialog) exists once in `components/ui/` and every feature uses it
   ([shadcn-tailwind](stack/shadcn-tailwind.md#primitives), "One component per control").
3. New components use Tailwind utilities on those tokens. Heavy animation and per-look rules (`data-gpu`) stay in
   `material.css` and `workspace.css`; role, spacing, type, radius and motion tokens are in `tokens.css`. Corners are
   the `--r-*` tokens, with no option.
4. Old CSS moves to these rules only when a ticket touches that area. There is no big-bang rewrite.

`pnpm lint` enforces rule 1 (`eslint.config.ts`; exempt: test files, `features/workspace/theme/`, `TerminalView.tsx`)
and the one-component-per-control rule (a hand-built `role="switch"`, `radiogroup`, `radio`, `dialog`, `alertdialog`,
`menu`, `menuitem`, `menuitemradio`, `listbox` or `option`, or a `createPortal` import, outside `components/ui/`, with
no exempt files). Don't widen the exemptions to pass a change.

**One segmented control.** Every row of choices with one picked is `Segmented` (`components/ui/radio-group.tsx`),
drawn only by `components/ui/segmented.css`. A class on it only places it; a missing look is added to the one
stylesheet. `src/segmented.test.ts` enforces this.

**Reserve the space; reveal with opacity, never by growing.** A tab, row, chip, menu item or button never changes its
size or place to show a ×, pin, count, shortcut or label. The part owns its slot, only its `opacity` changes, and it
stays focusable while hidden. A part over a row with no slot is `position: absolute`; a tab that turns bold keeps its
width with a hidden bold twin. Panels that open are the exception. `src/revealSpace.test.ts` enforces this.

**Focus on a control is one style:** a 1px accent edge around the whole control, drawn inside it (`--focus-edge`), set
on everything by `.mx-app :focus-visible`. No `outline`, outside ring, glow, `outline-offset` or growing border.
Bordered exceptions: the message box, the commit message and the legacy composer. **A text field** instead turns its
whole 1px edge `--field-focus`, one rule in `material.css` that a new field joins; an invalid field keeps its danger
edge. `src/focusStyle.test.ts` enforces both and gives each exception its reason.

**A hover, focus or press changes colour and opacity, nothing else, and does it at once.** No delay (only `HoverTips`
and `HoverController` wait, in code, never with `transition-delay`). No jump: no change of size, place, border width,
padding, line height, weight or text, no `translate`/`scale`, no `filter`. Interactive elements fade colour, border and
opacity over `--t-fast` through a zero-weight `:where()` rule in `workspace.css` (a new non-button class joins its
list); use the time tokens, never a raw time. Only `opacity`, `transform`, `background-color`, `color` and
`border-color` animate on a state. Reduce motion zeroes the tokens. `src/hoverMotion.test.ts` enforces this; to check on
the real web view, compare `getBoundingClientRect` before and after hover ([PERFORMANCE](PERFORMANCE.md)).

**The terminal is edge to edge.** A terminal sits on one opaque `--term` ground that fills its card, with a token
inset and no frame, ring or card of its own. The card carries the focus.

## Project-specific: desktop window sizes and sidebar order

Rules for `apps/gui/` (the look is in [DESIGN](DESIGN.md#desktop-app)).

1. The window is at least 720px wide. Under 1100px the sidebar is the 56px rail and expanding it opens the full
   sidebar as an overlay; under 800px panes stack in one column. The widths are constants in
   `features/workspace/model/windowSize.ts`; change them there and in DESIGN, nowhere else.
2. The sidebar lists **agents and shells only**, as one list of opened projects in
   [the sidebar's order](DESIGN.md#design-language). The order is one pure function, `sidebarOrder` in
   `model/sidebarTree.ts`, which the full sidebar and the rail both draw; nothing else decides where a row sits.
   - A project never moves because its sessions change state; projects follow the picked sort (`sidebarSort`). The
     header filter is this window's state and is not saved. Folds are kept in `maiker.gui.sidebar-folds.v1`.
   - `error`, `limited` and `unknown` are idle wherever a status is drawn or counted (`markOf`, `sectionOf`).
   - No machine headings, status headings, needs-you strip or Put away section, and no setting for any. The desktop
     app sets neither the put-away nor the snooze flag.
   - A lead and its project take their most urgent helper's state without moving.
   - The session on screen keeps the state it was picked in until another is picked (`held`). Rows never animate
     into a new place. The focused session is marked seen (`MarkSeen`, `ConversationMarkSeen`).
   - Until the daemon's first list arrives the window says "Looking for your sessions…", never "No agents running".
   - A machine down only for its Maiker version is never called offline (`versionWord`).
   - A row's right-click menu is exactly Rename, New worktree, Open worktree…, Copy path and Close session…
     (`sessionMenu.ts`); a new session action goes to the palette or the pane's menu. A row's accessible name gives
     its name, its helper relations and its status in a word.
   - A session closes after the confirm, with no Undo. Maiker shows no workflow runs (ADR 0011).
3. A terminal sits on the workspace card's own ground (`--main`, xterm's background and ANSI black).
4. The window's state is put together once in `useWorkspaceState.ts` and read through `useWorkspace()`; a component
   used outside the window still takes props. New window state goes in a hook that `useWorkspaceState` calls, not in
   `DesktopApp`.
5. **Opened projects** are a saved list per machine (`model/openedProjects.ts`, `maiker.gui.opened-projects.v1`, never
   the daemon's). A project is a machine and a folder. `groupByProject` puts every session under exactly one project:
   a git session under its main checkout, any other under the deepest opened folder; this computer's sessions in the
   start folder go under **No project**, listed only while it has sessions. The home folder is never kept as a
   project. A folder already open, in any spelling, selects that project. A session whose repository changes moves
   with a note, except in its first `START_SETTLE_MS`. **Close project…** saves the open set with the service and
   never waits on the save; **Switch to…** waits for the save and ends nothing when it fails.

## Project-specific: usage and cost page (desktop)

The Usage and cost page (`apps/gui/src/features/usage/`) shows only what providers reported through the daemon's usage
store ([ADR 0009](adr/0009-usage-is-provider-reported-never-estimated.md)). A figure nobody reported is a dash, never
zero and never computed from tokens. The monthly budget is a client preference (`monthlyBudget`, validated in
`preferences.ts`); the ring needs a budget, a known cost and the Month window. The report is fetched with a query (no
polling faster than 60 s), and the page never blocks the UI thread.

## Project-specific: layout and navigation

<!-- local: user requested sidebar-bottom controls and no global footer; on 2026-10-24 they chose one exception, the mode bar along the bottom. -->

The TUI has one look: the **sidebar** and the **workspace**, `ui.gap` apart, and the mode bar along the bottom, the
only application-wide footer. `ui.rounded` and `ui.padding` shape every box; retired layout values still load
(`Ui::fold_retired_layout`) and the first start says so once.

- Tab, Shift+Tab and Esc go to the program in the pane. The prefix is `Ctrl+Space`.
- A window under 80 by 24 draws only `make the window bigger: 80×24 at least`. Under 110 columns the first frame starts
  with the sidebar as its rail; under 140 columns docked sheets take the pane's place. Popups clamp to the screen.
- Mouse users reach every visible control. A click on a toast is the toast's, even over a pane that asked for the mouse.
- Prefer Maiker's retained history; when an agent has none, pass wheel and Page Up/Down to the agent.
- Terminal bells add no sidebar indicator or history entry. **Update <version>** shows only when one is available.
- **Settings** is a full window (`screen/settings_page.rs`) in which every setting is reachable. Values outside a
  setting's list are refused when the config loads.
- **Status log** explains the status from the daemon's reason and timeline; it never sets one (ADR 0003).
- A daemon older than a request is not asked (`ClientMsg::introduced_in`); a toast says to restart it. A resume id that
  is not letters, digits, `-` and `_` is refused.
- **Secret requests** open once per request id and ignore keys for 1.5 s, so a line being typed is not given away.
- **Helpers** (`[sessions] helpers`: ask, always, never): `ask` makes the row needs you, and only `1`, `2`, `3` inside the
  popover answer; no bare key answers from the sidebar. A helper past `helpers_at_once` waits and is never refused.
- **Agent launchers:** an agent typed in a repo's main checkout starts in a new worktree (`worktree.per_agent`);
  anywhere else it starts where you are, silently.
- **Changes** commits only the picked files (`git add -A -- <paths>`, `git commit -- <paths>`); comments go to the
  agent's message box, never sent without Enter.
- Keys: one key per action, no default needing Shift, sentence case, no bracketed explanations. Every action has a
  leader key or is search only. `docs/shortcuts.md` documents the other screens' keys.
- **Restart now** restarts the server and replaces this window in one step; it asks only when a session is working or
  waiting (or `restore.enabled` is off). Installing never stops sessions. Nothing resumes on its own unless
  `restore.continue_turn` is on.
- A new `maiker` replaces an older idle server, prompts before replacing one that holds sessions, and never replaces a
  newer one. Without a terminal, or with `--remote`, there is no automatic step.

## Project-specific: new-session gaps (desktop)

- Not built: editing machine, folder and branch before a first message (the desktop starts a session from the New session dialog, where those are
  chosen), and a draft terminal page.

## Project-specific: pane focus

Only the area with the keyboard is lit: the focused pane's whole border, or the open sheet. Unfocused panes fade by the
Dim setting (off, light, normal or heavy; normal by default; older "subtle", "30%" and "60%" read as light, normal and
heavy). Do not reserve a full-width bottom row for global hints; the mode bar is the one exception. The pane has no
status line.

## Project-specific: window chrome (desktop)

The desktop window has one full-width foot, the status bar. Its parts are in
`apps/gui/src/features/workspace/components/` (look in [DESIGN](DESIGN.md#desktop-app)).

- **Title bar** (`AppTitleBar`): **one** side-panel button (`SidePanelButton`, `toggleInspect`, `aria-pressed` while
  the panel shows) and the window buttons; no per-surface button. Everything that is not a button stays a drag area
  (`data-tauri-drag-region`) on every platform.
- **Side panel surfaces** (`features/inspect/`): the tab model is pure (`panelTabs.ts`). A new surface is registered,
  never special-cased (`SURFACE_KINDS`, `SURFACES`, `WorkspaceSidePanel`), and opened through `openSurface`. The strip
  is a `tablist` over one `tabpanel`. **A surface lists; it never shows a file**: Files and Changes open files in the
  file pane through `FileActions`. Discarding a file's changes is all in `useDiscardFile.ts` (question, draft guard,
  host command off the UI thread). Panel placement is `panelPlacement`; widths are `panelWidth.ts`. Closing a terminal
  tab ends its shell and asks first; hiding, pinning or switching never ends it. Pull requests are asked for only while
  the window is in front, and which need the person is the daemon's to say.
- **Cards and gaps** (`frame.css`): fill and edge come from the panel role in `material.css`; every gap is a frame
  token. A card casts no shadow.
- **Pane header** (`PaneTitle`): a machine tag (other machines only), `project / session name`, close. A terminal pane
  adds the shield, the context bar and the splits; a chat pane has them in its chat box. No pane has a `···` button.
- **Nothing of Maiker's in a terminal pane**: no foot, bar, strip, overlay or button read from the CLI's screen. What a
  session asks where its pane cannot say it is a needs-you toast with no ✕ (`model/outsideAsks.ts`) that stays until
  the daemon says it is answered.
- **Status bar** (`StatusBar`): the version and the update button (`UpdateSlot`, the only place it is drawn) at the
  left; one meter per reported agent limit, then **Commands** and **Shortcuts**, whose keycaps come from the binding
  table. Meters are plan-aware, amber from 70% and red from 90% (`levelOf`), from `Snapshot.limits`; an agent with no
  reported limit has none (ADR 0009). A meter is always a bar (`UsageMeter`, `MeterBar`); the code has no ring.

## Project-specific: UI conventions

<!-- local: user requested distinct active, keyboard and hover sidebar states, mouse-first sidebar controls and parent-owned child-agent visibility. -->

- Popups are centred `panel()`s framed like a pane: an accent box (a modal holds the keys), corners by `ui.rounded`,
  the title as an accent chip on the top border and a × chip near the top right. No accent bar across the top (the
  user chose the pane-like frame). No shadow, and the screen behind is not dimmed. Small explanations are popovers
  beside their sidebar row (`frame_beside_row`).
- The pointer's tint is one pass after drawing (`render.rs`): only the topmost clickable region is tinted; widgets do
  not tint themselves. Behind an overlay nothing tints (`dim_all`, `hits_under_overlay`).
- Shortcut mode ends on Esc, the leader, a click, or an action that takes you into a pane; each calls
  `leave_shortcut_mode`, and a new way to start a pane must too.
- Leader `x` closes what has the keys: a side panel with the keys closes with no question, so x never stops the program
  behind it; Files with unsaved edits stays open and says so.
- Selection is a neutral tint (`sel_on`) with an accent `▎` bar; never the accent colour as a row fill.
- Every popup row is clickable and keyboard-reachable; every key is shown as a keycap somewhere.
- Short-lived notes are toasts above the pane content; destructive actions ask first (`Confirm`) and go last in menus.
- Anything filled that you click or read as a control is drawn with `button`/`btn`, `chip` or `pill`, never a bare
  `seg` on a button colour.
- Copy is plain words ("Focus the sidebar", not "browse-tree").

## Project-specific: sign-in card

`SignInCard` (`features/signin/`) is the one surface for signing an agent in: above the message box for `/login` in a
Claude chat, and above the Accounts card in Settings. It shows the link's host, Open link, the code, Copy code and
Cancel while waiting; Done, or the reason with Try again, when it ends. Escape cancels a waiting sign-in. The card never
shows a token. Behaviour and limits: [chat-sign-in spec](features/chat-sign-in/spec.md).

## Project-specific: theme browser

Dark and light are two remembered slots (`theme_dark`, `theme_light`) and a switch (`appearance`); `theme` is the theme
showing now (`Config::settle_theme`), and a file with only an older `theme` is not rewritten. A theme's tab is read from
its background (`theme::is_light`). Themes are listed alphabetically by display name, ignoring case, in `BUILTIN` order;
there are no user-defined themes, only overrides. The list is `crates/maitty-settings/themes.json`, shared with the
desktop app and held equal to `BUILTIN` by a test; a removed id loads through `ALIASES`. Left and Right on a theme row
apply at once; Esc in the browser changes nothing; saving runs in a background task and a failure keeps the selection
with a toast. Sources: [theme sources](theme-credits.md).

## Project-specific: menus drawn to the handoff (desktop)

Right-click and row menus share `MenuPopup` (`.mx-ctx`) and draw no heading; the name is only the accessible label. A
row with `items` opens a submenu beside it. The place chips' menus use `ChipMenu` variant `place`. A picked row is a
ground and bold, never a tick. The model picker is its own float (see *desktop chat view*).

## Project-specific: Open a project (desktop)

**Open a project** (`features/open-project/OpenProjectPalette.tsx`) is the one palette for bringing a folder in from
any machine; it never knows which machine it is on.

- **Frame and keys.** The same height at every level. Focus stays in the field (a `combobox` over one `listbox`).
  `keyAction` in `openPalette.ts` (`stageKeyAction` after a new machine's Enter) is the one place a key gets its
  meaning: Enter does what the highlighted row says, Backspace on an empty field goes up or back, Esc closes; no plain
  letter or Ctrl+letter. The window's shortcuts stand down while it is up (`isOpenPaletteUp`).
- **Folder browser.** Every read goes through one `list(machine, path)`, so nothing branches on the machine. A new
  folder is made by that machine's daemon when `folderNameProblem` passes it. A down machine is not asked. Paths
  ignore case on Windows and macOS and keep it on Linux (`ignoresCase`, `sameFolder`).
- **New machine** (`MachineLevel.tsx`, pure `newMachine.ts`; ADR 0017): one field taking what `ssh` takes
  (`checkAddress`), optional Port and Key file (checked to exist, never read). A port given twice is refused, not
  guessed; a machine is never added twice. After Enter: **Connecting** (Cancel ends it; a late answer is ignored),
  **Added** (a Name kept as the nickname), or **Failed** (the host's one sentence, Copy for its `fix_command`, never a
  Trust; **Sign in in a terminal** only for `needs-person`). Leaving the level removes a machine nobody saw added.
  Nothing here asks for a password, shows a fingerprint or copies a key.
- **Clone**: an address with a user name or password is never sent; GitHub goes through this computer's `gh`; a clone
  cannot be cancelled, so the palette stays until it ends.
- **Taking a folder** (`onTake`, `OpenProjectRequest.purpose`): `project` opens it with no session; `session` opens the
  New session draft. A refusal keeps the palette open. Entry points are in `useOpenProject.ts`.

## Project-specific: choosing a folder, and the loader

A part of the window that needs a folder, not a project, asks with `useFolderPick`: the palette in `pick` mode, the
folder browser on the machine asked about and nothing else. It answers with the folder and machine, or null. The
browser is the app's own because it lists folders through the session machine's daemon; the system dialog only
browses this computer. A wait inside a list or row is the running light (`StatusIcon`) after 160 ms; a chat being read
shows skeleton lines on the same delay (`useAppearsAfter`). The desktop has no spinner setting.

## Project-specific: sidebar check result

A session's row carries no check line. A failed check, or a command that ended in failure (`TermInfo.exit`), is the
**problem** state: the red status glyph on its row, its pane's border and the collapsed column. The check's words,
checkpoints and output stay in the Inbox, the evidence sheet and the Project menu's re-run and override items.

## Project-specific: check evidence sheet

The check evidence sheet is part of the frame. Enter on a row whose check failed, could not run, was overridden, went
stale or is never run opens it (a row waiting for approval opens the approval), as does Output in the Inbox. Command
output is not trusted: colour codes and control characters are stripped before drawing. **Sending a failure**
(`m`, `client/screen/failure_note.rs`) writes the failure and its last 40 lines into the agent's message box, stripped
the same way and below any draft; nothing is sent until Enter.

## Project-specific: check modals and settings

Deciding is a modal; nothing here pops up on its own. Each matches its reference frames at 160×45, 100×30 and 80×24
(`client/screen/check_modals_tests.rs`). Colours are existing slots.

- **Override** (`check_actions.rs`) says what the session will read (`done (overridden)`), what it hides and where the
  failure stays visible, and takes an optional reason. Enter overrides; `O` only while the reason is empty.
- **Approving a repo's command** (`check_approve.rs`) opens only from its waiting item. The command is shown in full,
  with control and invisible characters spelled out. `1` and `2` answer only once the last frame showed the whole
  command, and only for that command; a command that does not fit says to make the window bigger, and a changed command
  disarms `2`. There is no default: `1` once, `2` twice for Always, `3` Never; Enter, `y` and Space send nothing.
- **Settings › Check** (`check_settings.rs`) edits your `[[check]]` tables in config.toml in place, keeping comments,
  off the UI thread. A repo's checkpoint is read-only here. There is no add screen.

## Project-specific: Inbox check groups

The Inbox (leader `i`) is part of the frame (`client/screen/inbox.rs`, `check_inbox.rs`). Groups, in order: NEEDS YOU,
FAILED CHECKS, COULD NOT RUN, FINISHED, EXITED, HEADS UP. A question is never below a check. An empty group is not
drawn; with nothing it says "Nothing is waiting on you."

- A Done session is finished (`check::finished`) when it has no check, or its check passed, was overridden, passed on
  older code or is never run. It is not finished while checking, failed, could not run or waiting for approval. The
  home screen counts by the same rule. A session that is working or asking is not listed for its old result.
- A failed check stays listed until a later run replaces it. A could-not-run check is listed until you look.
- EXITED lists a session whose last command failed (`TermInfo.exit`) that asks for nothing; one both finished and
  exited is listed as exited only.
- Enter runs an item's first button; 1–9 answer a question; Delete marks seen.
- A session on another machine ends its head line with ` · on <machine>`; a down machine has no items.

## Project-specific: the frame

The layout is summed up in [DESIGN](DESIGN.md); `client/screen/flat_tests.rs` and `frame_tests.rs` hold the frames.
The sidebar is `SIDE_DEFAULT` columns (between `SIDE_MIN` and `SIDE_MAX`, never more than half the screen), or the
`RAIL_W` rail when hidden. Every label on a border is a chip (`chips.rs`). Every pane is its own box, up to `MAX_PANES`;
exactly one box, the focused pane's, has the accent, and a pane being closed lights red. ` × ` closes a pane with an
undo, asking again for a running agent. With no pane open nothing starts a shell by itself. Sheets dock right from 140
columns, else take the pane column (`split_for_sheet`, `PANES_KEEP`); the Inbox floats and the panes keep their column.

**Status bar** (`mode_bar.rs`): its two rows are always kept, so menus and key mode never move the frames, and it is
never blank. Hints are read from the keymap, so a rebound key shows its new key. Under anything that has the keys the
bar is words only and takes no click (`only_says`). When a mode or view is added, add its row (the match is
exhaustive). A dead key in key mode shows `Shortcut mode — Esc to type`, at most every 6 s, not kept in history.

## Project-specific: home screen check counters

The "while you were away" line counts finished by the Inbox's rule (`check::finished`) and a check waiting for approval
as needing you. `✕ N checks failed` follows only when N is above zero. When the line does not fit, the lead-in is
dropped so no count is cut. Code: `client/screen/splash.rs`.

## Project-specific: splash

The splash (`client/screen/splash.rs`, `splash_wide.rs`) uses theme colours only (`Theme::splash()`). The wordmark is
filled cell backgrounds, never `█`. It shows less as the terminal shrinks: START and WHILE YOU WERE AWAY side by side;
START alone with the counts line over it (who needs you is never dropped); the boxes without the wordmark; the cards
only when START does not fit. Cards and hints are drawn from the first frame and keys act at once.
`ui.splash_animation` is `cold start` (default), `always` or `never`; motion off or a remote session never plays it.

## Project-specific: hiding the sidebar

The sidebar shows or collapses (`App::sidebar`) to a narrow rail (`draw_rail`): `»`, `⌕`, `+`, one status mark per
session and `≡`. Leader `b` or the `«` button collapses it; `»` brings it back.

## Project-specific: the sidebar

(`client/screen/side.rs`.) Sessions grouped by status (`Needs you`, `Working`, `Done`, `Idle`; the default) or by
machine, agents and shells alike; the daemon's workspaces are not shown. There is no filter field (`/` opens a Filter
sessions modal) and no folder grouping. A folded heading keeps its count; a filter shows every match whatever is
folded. Within a group rows follow the sort, so a row moves when its status changes group. Rows carry no status words
but `limited 16:30` (`TermInfo.resume_at`, while still ahead). A session whose machine is down is drawn in `idle`. A
helper names its starter; the starter's helper count is never a status (`mark_helpers`). Subagents come from
`TermInfo::subagent_activity` and clear after `FINISHED_LINGER_SECS`; the agent's own background list outranks the
daemon's count, so a lost stop neither leaves a row nor holds the session as working. **Put away**
(`screen/put_away.rs`) stops and moves nothing, with a 6 s undo; a put-away session is hidden except while it needs you.
`F2` renames in place through the shared rename. Keys are in `screen/side_keys.rs`.

**Status glyphs** (`screen/status_mark.rs`): by default (`ui.glyphs = "unicode"`) each state has its own shape, so
colour is not the only cue: `!` needs you, `✓` done, `×` problem, `–` idle, `┆` unreachable machine; working is the
chosen spinner, its first frame under Reduce motion. `dots` draws one coloured `●` for every state.

## Project-specific: New session

There is no New session dialog in the TUI. `Action::PickSession` (leader `n`) does what **Shell here**
(`Action::ShellHere`, leader `t`) does: one plain shell at once where you are. Every session it starts is a shell;
agents start inside it.

## Project-specific: tray item (desktop)

The desktop app keeps one tray or menu-bar item (`useTrayItem.ts`, `model/traySessions.ts`, host `tray.rs`) listing
sessions that need you, then finished ones, at most ten each, then **Show Maiker** and **Quit Maiker**. The menu is the
system's, so it takes no theme. Closing the window still closes the app.

The window title says "Maiker · N need you" and the app icon carries the count where the system has one
(`useAttentionBadge`). A chat session that needs you or finishes rings the same tone as a terminal one when
**Notification sound** is on. The window opens on its theme's ground (`public/boot-ground.js`), never flashing white.

## Project-specific: closing, service and update states

- **Closing a session** always asks first. Only then does `Command::CloseSession` go; the daemon keeps the process for
  `UNDO_WINDOW` and `Command::UndoClose` brings it back. Closing several panes at once has no undo.
- **Toasts** (`client/screen/toasts.rs`): a remote agent's own words never show in a needs-you toast. Esc on a toast
  never reaches the agent. Toasts hide while the service is down and while a dialog, menu or settings screen is open.
- **A chat stopped** (`stopped.rs`) is derived from signals the daemon reports; the client adds no status.
- **Reconnecting** (`service.rs`): the window stays when it loses its daemon. Typing goes nowhere; tries follow
  `BACKOFF` with no limit, and a connect waits at most `ipc::CONNECT_WITHIN`. Peers that cannot read each other do not
  talk, so *Service update needed* (`restart_prompt.rs`) has no read-only mode.
- **Links in the terminal view** (desktop): Cmd/Ctrl-click opens a file in the file pane (`findPathLinks`) or a web
  address in the default browser through the host's `open_link` (`findWebLinks`).
- **Service a release behind** (desktop, `serviceRestart.ts`): with **Restart the service when idle** on (the default)
  the window restarts it at the first quiet moment. A service that cannot say who is working, or whose sessions are not
  saved, is never restarted unasked. Whether it is behind is read from the real version mismatch.
- **Updates & repair** (desktop, `UpdatesPage.tsx`): the repair never speaks the service's protocol. Every restart goes
  through `RestartServiceDialog` first; **Force update** without saved chats needs its explicit confirm.
- **No sessions**: the desktop's empty state (`EmptyStart.tsx`) shows once the service has listed its sessions, headed
  `Nothing running` only with no session at all. Its keys `1`–`9` are the screen's own, not bindings, and act only
  with no modifier, outside fields and terminals, with no dialog or menu open (`agentForDigit`).

## Project-specific: Machines dialog

Code: `client/screen/machines.rs`, `client/machine_flow.rs`, `client/machine_config.rs`,
`maitty-machines/src/machine_probe.rs`. Opened by leader `w` or the palette.

- **One input, typed like scp.** Hosts from `~/.ssh/config` are read off the UI thread. A `:path` is refused.
- **Your machines** show each state with its fix (`link_failure::sentence`, shared with the desktop); a narrow row drops
  buttons, never the state. Toasts and sounds from a machine are off until turned on; clipboard writes are on until
  turned off, and turning them on asks first.
- **A machine's details** (`machine_info.rs`): answers carry a tag, so a stray answer is dropped. GitHub sign-in runs
  exactly `GITHUB_SIGN_IN_COMMAND` in a session on that machine. A git rule is written only after a clean preview.
- **Windows** shows `Windows: use ssh keys or an agent. Password prompts work in the popup but are not remembered.`
- **Adding shows no steps** (ADR 0017). A target ssh would read as an option, or with whitespace, is refused before
  anything runs. The entry is `name` and `target` only, so ssh's own config applies, appended atomically to
  `config.local.toml` (never `config.toml`). The look is `ssh <target> maiker --version` that never asks anything
  (`BatchMode`, short `ConnectTimeout`, stdin closed, 12 s limit, Esc ends it). Only `FailureClass::NeedsPerson` opens
  a popup, where ssh runs once interactively with `ForwardAgent=no`, `-a`, `ConnectTimeout` and `--` before the target.
  A refused key, or a missing or old app, adds the machine with its fix. A changed host key adds nothing and is never
  called unreachable; a new key is recorded (`StrictHostKeyChecking=accept-new`, SECURITY.md). A Windows remote is not
  supported in v1.
- **Install and Update** run `maiker machine update <name> --hold` in a popup with no `--install` or `--yes`; the answer
  there is the consent. A newer version is never downgraded. **Edit** rewrites only the `target`. **Remove** asks first
  and touches nothing on the machine.
- Adding and removing take effect in the running window; hand edits take effect at the next start.

## Project-specific: Hairline

Not applicable: Floating is the only look.

## Project-specific: desktop side panel parity

The desktop References tab (`features/inspect/ReferencesTab.tsx`) lists `.maiker/references` newest first, says the
files are seen by every agent and kept on this computer, not in git, and only lists: adding, renaming and removing are
the TUI's (`maitty-terminal-client/src/references.rs`). Not built: a dedicated Branches view.

## Project-specific: features that need a pane's files

Files, Changes, Find, Branches, References, connecting an agent, worktree actions (but Clean up worktrees) and the
TUI's Resume a conversation here read or change the files of their pane. For a pane on another machine they only show
one error toast, always: "<Feature> is local-only in v1: the files are on <machine>, not on this computer." The check
is per pane. Menu entries that would run git in a remote pane's folder are left out of its menu.

- **Changes is the exception**: both clients read and commit another machine's changes through its daemon, with its git
  identity and sign-in; merge, discard and the editor stay this computer's. Files lists its folders (ADR 0014).
- **Dropping files** (`dropRoute.ts`, host `file_send.rs`, ADR 0007): local paths are typed, quoted for the shell; on
  another machine regular files are sent over ssh (100 MB each, at most 10, more refused whole), one at a time, under a
  progress toast with no close button.
- **Pasting an image** (`clipboardImage.ts`, host `image_paste.rs`): text comes first; plain Ctrl+V on Windows and
  Linux is never taken. PNG, JPEG, GIF and WebP only, by first bytes, at most 25 MB. Local images go to a private cache
  (mode 600, a week). The image is never logged.
- A path the remote machine reports is typed only if it is absolute, at most 4096 characters and free of control and
  invisible characters. The TUI takes another machine's answers only as replies to its own question and draws them
  with control and hidden characters removed.

## Project-specific: frame presentation

Wrap each outer terminal frame in synchronized-update markers; end the update
even when drawing fails. An unfinished child update from the previous frame
must not delay switching to another session.

Keep pane padding and the card interior on the same surface as a terminal app
when at least three screen corners use one explicit background color. Preserve
the pane insets; isolated colored panels keep their existing theme treatment.
Preserve colors applications paint explicitly.

## Project-specific: Settings dialog (desktop)

Rules for `apps/gui/src/features/settings/components/DesktopSettings.tsx` (look in [DESIGN](DESIGN.md#desktop-app)):

- **The nav is a list of buttons** inside a `navigation` landmark named "Settings sections"; the current page's button
  carries `aria-current="page"`, and none does while a search shows. A letter pressed in the dialog does nothing.
- **Esc** closes an open list first, then empties the search, then closes Settings. The window's shortcuts are off
  while it is open, except **Find**, which focuses **Search settings**.
- **Search is a filter over the pages themselves** (`settingsSearch.ts`). A row added with `Row` and a group added with
  `Card` are searched with no further work.
- **Every on/off setting is a `Switch`** (`role="switch"`) with an accessible name that says what it switches.
- **Open sessions in** is the only control of the view. A change asks through the confirm dialog (kind `switch-view`)
  unless turned off, and the view and a ticked Don't ask again are saved in one change (ADR 0020).
- **A confirm that was turned off can be turned back on:** **Ask again** empties `confirmSkipped` for every kind.
- **A setting is removed with what reads it.** A stored key the app no longer reads is ignored on read and dropped on
  the next save.

## Project-specific: Extensions page (desktop)

Settings › Extensions (`apps/gui/src/features/extensions/`, data from `api/extensions.ts`) lists, switches, removes and
adds Claude Code's and Codex's skills, plugins, MCP servers and marketplaces ([spec](features/chat-extensions/spec.md)).
`/plugin`, `/plugins`, `/marketplace`, `/skills`, `/hooks` and `/mcp` typed alone open it; with an argument they go to
Claude Code.

- **Where it looks.** A **Project** picker covers this computer's projects only, since the daemon changes its own
  computer's agents. A file that could not be read is a line saying so.
- **Changing.** Remove asks first (Cancel focused). Changes go through the agent's own command and the list is read
  again; a refusal is a typed line, never the agent's raw words.
- **Adding.** At most one Add form is open; Esc closes it without closing Settings (`data-owns-escape`). A form only
  asks for a **Review**, which shows exactly what will run and "This runs code on your computer with your access."
  Cancel is focused and Enter does not confirm; only the confirm button sends the review's token (`confirmAdd`). No
  "trust always". A server's keys and headers are not taken here.
- **Needs a terminal** is a folded card with the exact commands (`claude mcp login <name>`, `codex mcp login <name>`).

## Project-specific: desktop chat view

The chat view is a second view of a session, never a second session ([chat view
plan](features/chat-gui/chat-view-plan.md), ADR 0006). Code is `apps/gui/src/features/chat/`.

**Source and kinds.**

- It renders only the daemon's structured events, never terminal output, for its history. `model/chatView.ts` decides
  availability. `model/agentAbilities.ts` is the one table of what each agent supports: code asks `abilitiesOf` or
  `hasAbility`, never the agent's name.
- A CLI agent in a pane gets a **read-only** conversation that follows its transcript; its composer types into the
  agent's terminal only while the trusted status says idle or done. The daemon refuses send, approve and cancel for it.
- A **chat session** (`isChatSession`) has **no terminal**: nothing that needs a pane number is offered for it.
- The Chat view's draft starts a daemon-owned chat with no terminal (`startDirectChat`, ADR 0020). Claude Code and Codex
  run through their adapters; Claude's Accept edits and Auto have no daemon posture, so the draft refuses them. Other
  agents run over ACP with their own settings. Every start in the Terminal view is the agent's own session.
- **One view for the whole app** (`chatOf`, `effectiveView`): no per-session or per-pane switch, no key for one, and
  no control that moves a session between chat and terminal ([ADR 0020](adr/0020-the-chat-view-talks-to-the-agent-directly.md)).
  A plain shell is never made in the Chat view.

**Answering from the chat.**

- A terminal agent's ask card is built from its own hook, never the screen. Codex's buttons work only while the screen
  is the verified menu (`codex_prompt_answerable`). Anything unverified shows the terminal's question as plain lines
  (`TerminalPrompt`, `linesOfScreen`) with arrow, Enter and Esc keys. Sidebar and notification answers type only
  verified keys (`sidebarAnswerKeys`). An "always allow" row is offered only for the verified wording and is never the
  default; Maiker writes no rule of its own.
- Approvals come from `answerRows.ts`: only the decisions the provider sent, in its order and words. `y`, `a` and `n`
  pick rows from anywhere but a field; the message box is a field even when empty.
- **Trust this folder**: neither button is the Enter default, and nothing is sent before a click.
- The daemon presses Enter again when a typed message got no report in three seconds (`Term::enter_again_due`), never
  when the pane was typed into since.

**Model, effort and mode.** The picker (`AgentPicker`, `modelPicker.ts`) marks the picked row with the selection fill,
never a tick, and shows no shortcut hints. Nothing picked sends nothing, so the button never claims a model the chat is
not using. A chat that follows a terminal types picks as `/model` or `/effort`. Model and reasoning lock while the agent
works or asks (`workingLock`), with the reason in the accessible name. A started chat's agent never changes. The shield
says only what the transcript reports, and Bypass permissions is pickable only when Claude started with it.

**Composer.** Sends carry an operation number; a retry keeps it. While a turn works the daemon queues what is sent and
delivers it in order when the turn ends; Send now is the only way into a running turn. The box is off while an approval
waits; offline it still takes typing. Drafts are kept in window storage (`data/composerDrafts.ts`). `useAttachmentIntake`
is the only code that adds or removes a draft file (at most 10; a pasted image over 25 MB refused before it is read).
A paste with any text stays a text paste. Attach uses `aria-disabled` with its reason.

**History and list.**

- A read that would draw the same chat does not redraw. A failed read is retried once before the chat says it is
  reconnecting, and only while the service is up. An incomplete history shows no notice.
- `VirtualList` follows the end only while the reader is at it; any move up lets go, and nothing pulls the reader down.
- Every fact the history carries is shown and a missing one is said to be unavailable; nothing is invented. Only a
  running step animates. Reasoning text is plain, never logged or sent.
- **Markdown** (`markdown.ts`): no HTML anywhere, images never load, only `http(s)` links are kept, and a link hands the
  address to the host (`open_link`); it never navigates the webview.
- A saved CSV cell a spreadsheet would run as a formula gets a leading `'`; an HTML table's cells are escaped.
- **Edit from here** restores files only after the person's yes and never rewinds the agent's conversation. It is off
  while the agent works or another open session shares the checkout (`sharedCheckoutRefusal`).
- Quotes use one format, written and read only in `quoteMessage.ts`.

**Other rules.** The chat never looks stuck (`ChatSkeleton`, `StartingChat`). A chat that fails to draw breaks only its
pane (`PaneErrorBoundary`). While the chat covers a pane its terminal is unfocused and hidden from Tab and screen
readers; the chat adds no Esc layer. Every menu, picker, popover, tooltip and the selection bar use `--layer-pop`, never
a number. The history is a labelled region, not a live region; a separate polite line says working, waiting or
finished. Maiker never starts Gemini in auto-approve (ADR 0005). Styling is Tailwind utilities on theme tokens only.

## Project-specific: first run (desktop)

`features/welcome/Onboarding.tsx` is the first run (look in [DESIGN](DESIGN.md)). It saves nothing itself.

- **The rules are pure functions in `setup.ts`**. Change behaviour there, with its test.
- Seen once (`welcomed.ts`, `maiker.gui.welcomed.v1`); Finish and Skip both set it.
- The drawing animates `stroke-dashoffset` and `fill-opacity`, never `fill`. Scans use existing background calls on a
  fixed shortlist with a 2 s limit, never a walk of home.
- Installs show the exact command and run nothing until **Run it**
  ([SECURITY](SECURITY.md#project-specific-installing-an-agent-from-the-desktop)), one at a time.
- Enter continues, Esc skips; each screen focuses its heading and announces "Step n of 2". Install buttons name the
  agent; choices are radio groups.
- The theme preview is removed on unmount; only the last button saves it. The end opens the Open a project palette.
- The side-panel tip (`CoachMark`) shows once per computer, takes no focus and stops no key.

## Project-specific: the file pane and markdown documents

A file opens in the **file pane** (`DocPane.tsx`, `DocumentView.tsx`), one viewer for every way in, all through
`openDocument` (`useDocuments.ts`).

- **Modes** (`documentEdit.ts`): `modesOffered` decides which of Preview, Changes, File and Edit apply, and a mode that
  does not apply is not drawn; `shownMode` picks the opener's ask, else the way last chosen for that file.
- An arrangement holds one file pane; its × closes only the pane, and it never trades places with a session pane.
- Changes never names a branch the diff was not made against. Edit keeps line endings and the final newline.
- A save over a changed file is refused with **Reload** and **Overwrite**. The app watches no files; it looks when the
  window regains focus. Errors are an inline line with Retry, never a banner or toast.
- **Unsaved work is never lost silently.** Every way a document can go asks through `documents/draftGuard.ts`, with
  **Keep editing** focused. Not covered yet: quitting the app or closing its window.
- Task lists are read-only checkboxes (`role="checkbox"`, `aria-readonly`), the same size ticked or not.
- Other machines edit Markdown through their own daemon (ADR 0014). On this computer the daemon refuses links, `.git`,
  new files and anything over 256 KiB.

## Chat and sidebar fidelity

The look is in [DESIGN](DESIGN.md#design-language).
