# Design

Maiker's current look. This doc owns the visual language; behaviour (sizes that code relies on, keys, what each
state says) is in [UI](UI.md). The code is the final word: the TUI theme in
`crates/maitty-terminal-client/src/theme.rs`, its screens in `crates/maitty-terminal-client/src/client/screen/`, and
the reference frames the tests compare against (see [TESTING](TESTING.md#project-specific-layout-and-fixtures)).

Most sections below describe the TUI. The desktop app is in [Desktop app](#desktop-app); its code is
`apps/gui/src/features/workspace/`, its tokens `apps/gui/src/tokens.css` and `theme/themes.ts`, its materials
`apps/gui/src/material.css`.

## Principles

- **Status first.** Every session reads as working, needs you, done or idle at a glance, and
  that mark stays in view longest when space runs out.
- **Shape and word carry the meaning; colour backs them.** Every state reads in the Unicode
  glyph set and without colour.
- **Colour means status only.** Borders, names, buttons and the selected row are neutral; teal is working, coral
  needs you, green done, red failed, yellow a caution. The brass accent marks one thing in the TUI: an update waiting.
- **Only what has the keys is lit.** The focused pane, the open sheet or the selected row (a selected row's ground is
  the strongest text tinted into its surface, `SELECTED_TINT`, so it shows on dark and light); everything else is
  quieter.
- **Plain words.** Sentence case, no bracketed explanations, every key shown as a keycap.

## Themes and colour roles

Colours come only from the theme's roles, never a literal. Dark and light are two remembered slots and a switch.
**Maiker Dark** (`maiker-dark`) is the default dark theme and **Maiker Day** (`day`) the default light one; Maiker
Night (`night`) is the terminal app's own and the desktop app does not list it. Maiker's colours are read from
`crates/maitty-settings/maitty-tokens.json`; every built-in theme is listed in `crates/maitty-settings/themes.json`
([theme sources](theme-credits.md)). Brass is the accent, teal only ever means working, coral only ever means needs you.

| Role | Used for |
| --- | --- |
| `bg` | the ground, and a terminal cell's default background |
| `card`, `card2` | panels, header strips; fields and action rows inside modals |
| `btn`, `hov` | chips and buttons; the hovered row and the open session's row |
| `line` | borders, dividers |
| `muted`, `text`, `strong` | quiet text, body text, names and titles |
| `accent`, `acc_ink` | focus, the current tab; ink on the accent |
| `working` | working, and only that |
| `blocked` | needs you, and only that |
| `done`, `err` | passed or finished; failed |

By day the accent is the file's `brassText`, since the brass fill is too pale to read. The error red is kept apart
from the coral of needs you. `sky()` (checking, copy selection) and `violet()` (could not run) are derived from the
theme, not roles of their own. Every built-in theme passes a contrast audit, and needs you never looks like failed.

## Type and glyphs

The terminal's own font. Bold marks names and states worth a look; italic only the splash tagline and a toast's
preview. Status glyphs (Settings › Appearance › Status glyphs): **Unicode**, the default, gives each state a shape (`!`
needs you, `×` failed, `✓` done, `–` idle, `┆` an unreachable machine) and colour backs it; **Dots** is a `●` told apart
by colour alone. Working is the spinner you pick; checking is a sweeping ring. Agent marks: `✻` Claude, `◆` Codex,
`✦` Gemini, `◇` OpenCode.

## Layouts

One look: the sidebar and the workspace, `ui.gap` apart, and the status bar under them. Every pane is its own box with
round corners; a split is two to four boxes a column or row apart. A pane's labels are plain text on its border.
Exactly one box, the focused pane's, has the bright border. `ui.padding` is the blank space round both frames. See UI ›
*layout and navigation* and *the frame*.

## Chips, rounding and padding

Anything you click or read as a control is a chip on `btn`, or on the accent when current. `ui.rounded` is the one
shape setting: `off` is square, `corners` (the default) rounds every box and keeps chips square-ended, `full` also ends
chips, tabs, buttons, titles, rows and the hover in half-circle pills (a Nerd Font glyph). Keys are keycaps: ` key ` on
`btn`, `strong` and bold. The hover is one quiet tint; selection is a neutral tint with an accent `▎` bar, never an
accent fill. See UI › *UI conventions*.

## Sidebar

Sessions grouped by status (or by machine), each group a bold heading with its count; **Needs you** holds failed
sessions too. A session is two lines: mark, name (bold while working, needing you or failed) and age; then, dim,
`project / branch`. The open session has the row ground, a `▎` bar and a third line. A stopped chat dims its pane to
about 35% under a box with a red edge. See UI › *the sidebar*.

## Pane titles

The top border carries the status mark and the name (bold while it has the keys) at the left and ` ± changes N ` and
` × ` at the right; the folder is dim on the bottom border. The TUI draws no chat. At 85% context a one-line yellow bar
along the pane's bottom offers `/compact`. The focused box is the bright neutral, or the KEYS yellow in key mode.

## Side panel

Files, Branch and References slide in from the pane's right edge over its box (about 220 ms, eased out) and leave the
panes their size; they draw no key-hint row. Changes docks beside the pane instead, and replaces it under 140 columns;
added lines sit on a 9% green tint, removed on a 9% red one. The Inbox floats from the sidebar's side.

## Modals and popovers

Everything that floats is a box in the accent on the panel ground, corners by `ui.rounded`, no shadow; a modal's title
is an accent chip on its top border with a ` × ` chip near the corner. Settings is a full window, not a modal. A menu
has no title; the item that ends something is last, in red. Small explanations open beside their row with a `◂`.

## Toasts

News toasts (`client/screen/toasts.rs`) sit bottom right above the status bar with a 2-column edge in the status colour,
one at a time, `+N` when more wait. Plain notices are a small box above the agent's input area in the notice's colour;
their text wraps rather than cuts. Both slide and fade only with motion on.

## Errors

The desktop app's error states (`components/ui/feedback.tsx`, `feedback.css`, `components/ui/toaster.tsx`; where each
shows is UI › *design system*, *Errors in the desktop app*). The rule: **say it where it happened, only as loud as what
it blocks, and never twice.** There are no banners and no coloured edge bars. The tone is carried by the mark before the
title: `--err` failed (`×`), `--caution` a warning (`▲`), `--needs` needs you (`!`), `--ok` back or done (`✓`),
`--working` running (the spinner), the accent a note (`i`). The fix is the first button, filled in the tone's soft
ground; then outlined buttons; Copy details last, which says Copied in the same width.

- **Toasts** are the floating surface with **no coloured edge**: the status colour is the status mark at the head (an
  error or warning is a `!` in a circle, the toast's own mark, since neither is a session state). Bottom right, newest
  on top; from 3 on only the newest shows with two layers behind it. Success and notes show a countdown line. An error
  toast's title is what failed and its reason why in plain words (`explainError`). A needs-you toast names the session
  and offers **Allow** only when the window can answer. A progress toast has no ✕, only **Cancel**, and becomes its
  outcome in place. Under software painting or reduced motion toasts only fade or slide.
- **Field errors** sit under the field after a red `×`, one sentence that says what to type; the field's edge turns red.
- **Inline notes** are a card with the status mark, a title, the reason and text actions.
- **Chat problem** dims only the chat column (a flat veil, nothing blurs) under one dialog that does not trap focus;
  **Not now** leaves the problem line at the top of the dock. A stopped agent is never a dialog.
- **Stop toasts** (`features/notifications/stops.ts`) are raised once per occurrence, keyed by what the daemon
  reported, so a re-render or reconnect says nothing twice. The one fix is **Install <agent>** when its program is not on
  PATH. A plan limit is a warning toast. A shell whose command failed raises none.
- **Service offline** dims the whole window under one dialog that traps focus; **Not now** leaves a red **× Offline**
  chip. **Service update** is the same dialog in caution. The sidebar foot has no service dot.
- **Light and dark.** The tones are the theme's own, so the same rules draw both.

## Status bar

The one full-width row along the bottom, always up: a `pane` chip and the keys that still reach Maiker; in key mode a
yellow `keys` chip; otherwise a calm chip naming what has the keys, its keys at the right with the way out last. Keys are
bold, their words muted. See UI › *the frame*.

## Splash

Centred on the plain ground: the wordmark in block letters drawn as filled cells (its "AI" in the accent), the rolling
swell, the tagline in italics, then the START and WHILE YOU WERE AWAY boxes. Night has its own wordmark colours; other
themes take theirs from their text and accent. See UI › *splash*.

## Desktop app

The desktop app's design is **handoff v5**, kept in `.maitty/references/handoff-v5/` (`README.md`, `screenshots/`,
`prototype/`). The mock (`prototype/Maiker Current.dc.html`) is the source of truth for copy and spacing; this section
holds the rules and the decisions that override the handoff.

**The design language below binds every change.** A bullet under [Screens](#screens) may still describe an older look
until its screen is rebuilt; where the two disagree, the design language wins.

### Design language

- **No edge bars.** Nothing gets a coloured bar down its left side: not a picked row, a quote, a notice, a found
  message or a log block. Selection is a fill, a tone is its icon's colour, a quote is a well. A 1px rule between two
  columns, or down the left of a nested list, is structure and stays. `leftEdge.test.ts` fails on an `inset Npx 0 0`
  shadow or a left border wider than 1px.
- **The tree.** Machine › project › session › helper or split. A project is a folder on a machine, so the same folder
  on two machines is two projects. A session starts in a project, or on this computer with no project in the start
  folder, listed under **No project**. A **helper** is a session its lead started; it nests one level under the lead
  while the lead exists. A **split** is a plain shell that belongs to its session, in the Terminal view only: it is not
  in the sidebar and it closes with the session. A session holds six panes at most, its own among them.
- **Four states, and only four.** There is no failed, error, starting or waiting state in the window.

  | State | Mark | Means |
  | --- | --- | --- |
  | Needs you | amber speech bubble with `?` | the agent stopped and waits for your answer: an approval, a question, a helpers request |
  | Working | teal spinner | it is doing something, starting up and waiting on helpers or a free slot included |
  | Done | green speech bubble with a tick | it finished its turn; its changes are there to review |
  | Idle | no mark, the row dimmed | nothing going on |

  **Needs you means a question only you can answer.** The daemon alone decides status
  ([ADR 0003](adr/0003-status-and-conversation-trust.md)) and still reports `error`, `limited` and `unknown`; the
  window draws all three as **idle**. A crash, a missing CLI or a lost sign-in keeps the CLI's own error line and raises
  an **error toast** that offers the fix. Anything that sounds like a fifth state is the session's activity text
  ("Waiting for a free slot", "Waiting on 3 helpers", "Limited until 14:05").
- **Chat view is Maiker's UI. Terminal view is the agent's UI.** In the Chat view Maiker talks to the agent through its
  structured API and draws the conversation, cards, buttons and chips. In the Terminal view the pane is the agent's real
  CLI, and **Maiker draws nothing inside it**: no approve buttons, footer, bar or overlay. Maiker owns the pane header,
  the sidebar mark and the toasts, all outside the pane. Never parse CLI output to drive a button: a menu the CLI
  reorders would send the wrong key to an agent about to run a real command. **The view is app-wide**, set in Settings ›
  General › **Open sessions in**; there is no per-session or per-pane switch. Changing it asks once: new sessions use
  the new view, open ones stay. An agent with no chat adapter always opens in Terminal.
- **One palette for picking things.** Opening a project, browsing folders on any machine, cloning and adding a remote
  machine happen in one keyboard-first palette of a fixed size: Enter does what the highlighted row says, Backspace on
  an empty field goes back or up, Esc closes. The model picker and the chip menus follow the same keys.
- **Tokens, not colours.** Every colour is a token, and a raw hex value in a component fails review. A theme sets
  these roles:

  | Role | Used for |
  | --- | --- |
  | `--t0` | the window background |
  | `--t1` | panes and the sidebar |
  | `--t2` | the selected row, anything raised |
  | `--t3` | the chat box and inputs |
  | `--float-bg` | menus, dialogs, toasts |
  | `--well` | code, and fields inside a float |
  | `--fg`, `--fg2`, `--muted`, `--dim` | text, four levels |
  | `--ink` | hairlines and hover fills: one colour at low opacity (white in a dark theme, black in a light one) |
  | `--needs`, `--working`, `--ok`, `--danger` | status; darker in a light theme so they read on white |
  | `--sy-*` (7) | syntax colours |

  A status tint is the status colour mixed into transparent, never a second colour. Everything is themed: onboarding,
  Settings, syntax highlighting and toasts too. The code's names and aliases are under [Screens](#screens).
- **The look.** Flat and rounded: panes are cards with a gap between them, lifted from the window background by tone.
  **Shadows only on what floats** (menus, popovers, toasts, dialogs). **Colour only where it means something**: status,
  focus, a destructive action. Icons are monochrome, and every icon button is **26px with a 14px glyph**. **Selection
  looks the same everywhere**, the sidebar's selected-row fill: no check marks and no accent outline for "selected".
- **Confirm only what is destructive or surprising.** One confirm dialog, used for: close a session, close a terminal
  or split, switch the view, discard changes, remove a project, pull when the branch has diverged. Each has **Don't ask
  again**, stored per kind, except a discard that deletes a file no commit has, which asks every time. The one
  exception is removing several things that can each lose different work (the Workspace panel's Remove worktrees): it
  confirms inside its own panel as a list, a row per item saying what it would lose and a tick for each that loses
  work, with no **Don't ask again**. Nothing else confirms.
- **The window.** Title bar: the Maiker logo and name; at the right **one side-panel button** and the window controls.
  Under it: sidebar | main pane | optional file pane | optional side panel; the sidebar sits flat on the window ground and
  the others are cards with gaps; the side panel floats only in a narrow window. The **status bar**: version and
  `Update to …` at the left; at the right a usage bar for every limit of each agent, then the Commands and Shortcuts
  keys. **Context is always a bar, never a ring.** The side panel holds tabs of four surfaces: Files, Changes,
  Terminal, Pull requests.
- **The sidebar's order.** One list of projects, each holding all its sessions in the order they were made, so a row
  stays put whatever its state does; folded, its heading says the most urgent state of its rows. A project never moves
  because its sessions changed state; the list follows the sort picked in the filter menu: **Recently opened** (the
  default), **Name, A to Z**, or **Machine** (this computer first). **No project** is last in each sort, listed only
  while it has sessions, with a plain folder badge in `--muted`. There is no Idle section: a quiet project is drawn grey
  where it sits. There are no machine headings, no status headings and no pinned needs-you list: a remote project
  carries a machine tag in that machine's own colour (`machineColor`), amber while the machine is offline; a machine
  that only needs Maiker updated gets an **Update** button after its tag. Sessions are set in under their project with
  a rule down their left edge. A session row is its name, how long it has been as it is, and its status mark; no agent
  icon. A lead shows the state of its most urgent helper. There is no Put away section and no snooze in the desktop app.

### Decisions that override the handoff

- **Adding a machine** keeps the one-field flow of [ADR 0017](adr/0017-remote-machines-rely-on-your-ssh-setup.md): no
  checklist, no fingerprint question, no password, no key copied over.
- **One shortcut set for both views.** On Windows and Linux the window takes Ctrl+Shift+letter, Alt, function keys and
  Ctrl with a non-letter, and never a plain Ctrl+letter, which is the terminal's. Where the handoff writes `Ctrl O`,
  the key is the one in the binding table (*Keys*, below).
- **Every existing theme stays.** The handoff's themes the app lacks are added to them.
- **No options for** corners, density, icon colour, the accent or toast position. The one size control is the whole
  window's (**Interface size**), which scales text, icons and panes together. Settings has no Performance page, and its
  Extensions page is to go: it stays, last under Agents, until the user confirms its removal. The side panel has no
  History view and no Checks view.
- **Where the handoff is older than the code, the code wins.** The daemon owns every PTY
  ([ADR 0001](adr/0001-the-daemon-owns-every-session.md)); the window never spawns one. GitHub goes through the `gh`
  CLI. Gemini chats over ACP ([ADR 0019](adr/0019-acp-for-agents-without-an-adapter.md)). Syntax highlighting is
  `crates/maitty-highlight`.

### Screens

Exact sizes live in the feature stylesheets beside their components (`sidebar.css`, `pane.css`, `menu.css`,
`dialogs.css`, `features/chat/chat.css`, `frame.css`), `workspace.css` and the tokens in `tokens.css`. This section
holds the rules behind them.

**Tokens and materials.**

- `themeStyle` (`features/workspace/theme/themes.ts`) is the one function that turns a theme into CSS variables, on the
  window root and the page root. The code uses the design's role names (`--ok` also read as `--done`, `--danger` as
  `--err`; danger is a destructive action or an error toast, never a session's state). Older names are aliases defined
  once in `COMPATIBILITY` (`--bg` is `--t0`, `--main`/`--pane` `--t1`, `--sel` `--t2`, `--raise` `--t3`, `--warn`
  `--needs`, `--hl` `--ink`, `--sk` `--shk`); a name leaves the block when nothing reads it. Other themes are mapped onto
  the roles by `designRoles`.
- **One material, three roles** (`material.css`): every surface is a *panel* (tone and hairline, no shadow), a *float*
  (menus, popovers, dialogs, palette, find, toasts) or a *field* (the message box), and takes fill, hairline and shadow
  from that role's rule. A new surface joins a role's list and sets no background of its own; a popover opens through
  `PopupContent` or carries `mx-pop`; dialogs, selects and menus mount inside `.mx-app`. One flat finish: no gradient,
  highlight or blur except the first-run veil. **Nothing but the float rule names a shadow.** Inside a surface nothing
  reads the theme's solid colours (use the `--m-*` tokens), and tints are written on `--hl`/`--hk`, never a fixed white.
  `src/material.test.ts` enforces this.
- **Depth** is three steps: panel, float (`--float-sh`), dialog (`--dialog-sh` over the one `--scrim`). Under software
  painting the shadows are a 1px ring ([PERFORMANCE](PERFORMANCE.md)).
- Cards, fields and selected things step toward the text colour (`cardSteps` in `themes.ts`); the design's own smaller
  steps ran together on a real screen. A theme changes hue and accents, never the depth of the surfaces, and keeps its
  window ground a step below its cards (`separatedGround`).
- Text roles keep 4.5:1 on `--term` and the ground; Maiker Night, Maiker Day and every light theme hold it for status and
  ANSI text too. The design's ten themes keep the handoff's values; the theme tests record each shortfall and fail if one
  gets worse. On a light theme xterm lifts program colours to 4.5:1 (`minimumContrastRatio`).
- **Fonts**: Inter for the interface and JetBrains Mono for paths, branches, commands and numbers, bundled and set in
  `theme/look.ts`. The terminal's font is the user's setting.
- Agent marks are flat glyphs in their brand colour, defined once on `.mx-app` (Codex's is `--fg`). Project colours are
  `--proj-1` to `--proj-5`, chosen from the name, never amber or red.

**Primitives** (`components/ui/`). Every shared piece reads tokens; the gallery (`#gallery`) shows each in every state.
**Button** has only `primary` (the accent), `needs` (only the main answer to something waiting on you), `ghost` (every
other action), `danger` and `link`. **IconButton** is the one icon button; a caller places it and never sizes or colours
it, and `label` is required. Nothing on screen says Loading; a skeleton's label is for screen readers only.

**Status marks** (`StatusIcon`): needs you a speech bubble with `?` in `--needs`, done the bubble with a tick in `--ok`,
working a half-lit ring in `--working`; idle draws **nothing** and the row dims. With motion reduced the ring stands
still. `markOf` (`lib/statusMark.ts`) is the one function that files a status under a mark. A mark is decoration beside
words; `named` makes it an image where there are none. There is no failed mark.

**Selection and controls.** A picked row is `--m-sel` and bold (`menu-row.css`), never a tick; the shared menus have no
checkbox item. Every radius is a `--r-*` token. Shared pieces read the component tokens in `material.css`; a new control
gets tokens first and is checked in both kinds of theme. The switch is the one on/off control; a per-file commit tick
stays a checkbox. Focus is UI's one focus rule (*GUI design system rules*).

**Motion.** Panels that open from a side slide and fade over `--panel-in`/`--panel-out` and stay, unclickable, until gone
(`usePresence`). A popover grows from its anchor's corner and shrinks back; a dialog does not grow. Panes change places
with a glide (`movePanes`, pictures only, so text never reflows); picking a session shows it at once, the layout never
eases, and changing the view plays no animation. No waves, shimmer or glow on rows and tabs; the only loop is the
spinner, which holds in the background. Nothing animates `box-shadow`, `filter` or `backdrop-filter`. Rows never slide,
tint or flash when their status changes. The terminal caret is steady unless Settings turns blinking on.

**Window and frame.**

- **Title bar** (`AppTitleBar`): the M mark and "Maiker" take no pointer, so a press on them drags; the one side-panel
  button is disabled while no session is in focus; the window buttons are drawn as the platform draws them.
- **The frame**: the sidebar has no card; main, side panel, split panes, file pane and terminal drawer are cards on
  `--t1` lifted by tone alone. Among several panes the one with the keys has a neutral ring (`--pane-focus-line`), never
  the accent, and the others are not dimmed. Every gap between cards is a drag handle. No tools bar, middle column or tab
  bar. The chat column keeps `--chat-min`; the side panel gives way first.
- **Tooltips** are the themed `HoverTips`, never the browser's: anything with a `title` and every icon-only button,
  radio or switch gets one. Anything clickable shows the pointer; a disabled control keeps the arrow.
- The window ground is opaque on every platform. The app icon is generated with `pnpm tauri icon` into
  `src-tauri/icons/`.

**Sidebar** (`Sidebar.tsx`). A project heading is a two-letter badge in the project's colour, the name, a machine tag
off this computer and, only while folded, its most urgent mark. **A quiet project** is `--muted` and `--dim` at the usual
weight; hover, focus and selection take their colours back, colour only. A helper is named by its task, never "New
session". There is no × on a row; Rename edits in the row at the same height. The hover card (`RowHoverCard`) shows the
state word in its colour and the activity in the daemon's words, takes no pointer input, and is never a native `title`.
A **limited** session is idle and never counted as needs you. The rail lists no idle session or helper. The Pull
requests badge counts only those that need you, quiet, not amber. Sidebar on the right mirrors the window.

**Pane** (`PaneCard.tsx`): one header line, no `⋯`, no view switch, no status strip. The terminal shield is `--needs`
only when the session started with Bypass Permissions; Maiker never reads the mode off the screen.

**Status bar** (`StatusBar`): the version and update button at the left; one meter pill per limit, the focused agent
lit; Commands and Shortcuts. Every meter is a bar. **Update button** (`UpdateSlot`): nothing until an update needs you;
its card says what the next click does. It installs only on Restart now or when the app is idle (no agent working or
waiting, no input for 5 minutes, the window unfocused or minimized).

**Menus** (`MenuPopup.tsx`): one look for every menu, the float. A row that cannot run is disabled and says why. **One
word for it**: closing a session, terminal or project stops what runs in it and takes it off the sidebar, and every
menu, toast and question says **Close session**, **Close terminal** or **Close project**; nothing says Remove.

**Confirm dialog** (`features/confirm`): the primary is the ink on `--fg`, or `--danger` when it stops or removes
something; focus starts on it; Esc or a click outside cancels. Kinds are `CONFIRMS` entries; *delete a new file* asks
every time (`canSkip`). Closing has no Undo. While a question is open the window's shortcuts do nothing.

**Settings dialog**: the float with the dialog corner; tone does the grouping, no rules. The nav is APP, AGENTS and
MACHINES with no shortcut letters. The page never scrolls; its body does. Every row is a setting, and every page saves
at once with **Saved** in the header. Remote machines is one list; a machine on an older Maiker shows the amber `!` and
"Needs an update to connect", and machine marks are drawn dots so they match in every font. No page offers corners,
density, icon colour, an accent or status headings.

**Keys.** `features/workspace/model/shortcuts.ts` (`BINDINGS`) holds every window shortcut once, read through
`formatShortcut(binding, platform, overrides)`; the keys are in [shortcuts.md](shortcuts.md#the-desktop-app).
`reservedReason` lists keys never taken or accepted, and a model test holds the table to it with no key twice. Symbols
and digits are read by position (`KeyboardEvent.code`). No plain Ctrl+letter is ever taken. The window's keys stand down
during onboarding, a confirm, the Open a project palette, Settings and key capture. The web view's own keys have their
page default cancelled (`pageKeys.ts`) but are not stopped. Esc closes the topmost layer (`model/escLadder.ts`); a new
dialog adds its id there. The command palette offers an action only where it can act. There is no Inbox.

**Chat.**

- Your messages are bubbles; an agent's reply has no avatar, its lead sentence in `--fg`. Cards (command, diff, code,
  plan, helpers) are the shared Card with wells flush inside; colour is for state and amber only for what needs you. A
  failed block has no coloured edge. A run of steps is one quiet line (`WorkCard`, no box); the step a pending request
  is about is the only amber one.
- **The live box** (`LiveBox`): one frameless line, "Working for 12s" and "Esc to stop", a deliberate deviation from the
  prototype's bordered card. A reply is typed in a few words at a time (`useTypedText`) unless it was already there or
  Reduce motion is on. Jump to the latest glides (`glidePlan`) and the reader's own input ends it.
- **The chat box** (`Composer.tsx`): one field and ONE row (model, shield, context bar; attach, send). The shield is the
  one place a bypassed chat says so (red, with a dot); no tag or bar repeats it. Controls are drawn from the first frame
  and only dim. An ended session swaps the box for a read-only line with **Resume** and **New session here**. Place
  chips show only on a session that has run nothing (`placeChipsShown`).
- **Model picker**: three columns, rail and reasoning sunk below the float; on a light theme the steps are ink tints.
- **Needs-you cards** (`WaitingCard`) stack above the box on the float, the agent's own question nearest. The only colour
  is one amber `!`; answers are a column (`AnswerList`) and the weight never changes. **Always in this project** is a
  plain line with no key (ADR 0005). Quick reply uses the neutral tone, since the agent is not blocked.
- **Slash commands** (`SlashPicker`): a terminal-only command says so; one with a menu shows it in the terminal;
  `/exit`, `/background` and `/clear` ask first; internal and look-only commands are hidden (`CLAUDE_HIDDEN_COMMANDS`).
- **A secret** goes from the field to the daemon and nowhere else: never kept in state, a toast, a log or the clipboard,
  and the field is emptied either way (ADR 0006). This computer's sessions only.
- Interface size is the webview's own zoom, so measuring, drags and portals scale together.

**Side panel and files.**

- The side panel docks beside the main pane, with no scrim, and floats over the file pane while a file is open. Files
  shows still bars while it reads, never "Loading". Changes draws no diff itself; its remote button is disabled with a
  reason when the branch has diverged. A file's menu leaves out an entry that does not apply; discarding a new file says
  it is **deleted for good**. A diff-line comment is not sent to an agent that is asking.
- **Worktrees** (`WorktreeManager.tsx`): Create and Cancel stay on screen. Merge never fast-forwards and is refused with
  uncommitted changes on either side; a Remove that would lose work asks **Keep** or **Lose … ? Remove**.
- **Terminal dock**: the terminal fills it edge to edge on opaque `--term` (see-through costs a blend per repaint); every
  tab holds the room of its ×. Closing the dock only hides its shells.
- **Splits** (`model/splitTree.ts`): only a split proven by its daemon-side mark (`provenShells`) is kept out of the
  sidebar and ended with its session; a pane an agent runs in is never one.
- **Switching sessions**: a local pane shows its kept screen at once, never a spinner or "Connecting"; a slow remote pane
  shows a strip under its header, never over the terminal. Kept tabs are `inert` and hidden from screen readers.
- **Ended panes** never disappear because a refresh missed their session; a toast outside says it ended.

**First run** (`Onboarding.tsx`): a veil (the one blur, since it shows once over a still app), the mark drawing itself,
then one fixed-size window so header and foot never move. Skip saves nothing; remote machines are not offered.

**Usage and cost** is a Settings page, named as rolling UTC days. An unreported figure is a dash; with no reported cost
there is no dollar total and one note, never one per row. The bar chart has a hidden table as its text alternative.

**Notifications**: a system notification names the session and where it is, never what the agent asked; nothing is sent
for a session you are looking at, on opening the app or on a reconnect.

### Notification toasts

A session that needs you or finished while you look elsewhere is a toast (`features/notifications/notify.ts`,
`noticeForSession.ts`): its title names the session and what happened, the reason says what it asks, and its actions are
**Allow** (only when the GUI can answer the choice) and **Open session**. It is keyed by its session, so the daemon's
alert for the same event replaces it.

## Documents

A markdown file in the file pane is flat. Its Preview is the chat's own markdown on the pane's ground, capped at 78ch and
centred; the drawn page sits beside the editor from 640px (**Side by side** toggles it). Notes are one line under the
header: `--danger` for an error, `--dim` for a notice. The room of the controls is kept, and hover and focus change
colour only. A task entry is one flat box in the bullet's slot, the same size ticked or not, so ticking moves nothing.

## Chat and sidebar fidelity (the current handoff)

- **Colours.** Maiker Dark (`maiker-dark` in `themes.json`) is the handoff's palette, role for role; the values are in
  `themes.json` and nowhere else. Its accent is the Maiker brass, which the handoff does not name.
- **Chat pane.** An empty chat is blank (screen readers still hear "No messages yet."). Its header is `project / session
  name` and ×.
- **Chat box.** Placeholder `Reply…`. One row: the agent's mark and `Model · Effort` as one plain muted line (no chevron,
  no strength bars), the shield (its mode's name only off the default), the context bar with its figure from the start
  for an agent that reports its context; the paperclip and send at the right. Folder, branch and sync sit under the box
  only until the session has run something.
