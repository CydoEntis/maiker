# Design

Maiker's current look, in one page. It describes the visual language; the detailed rules
(sizes, what gives way, keys, every state's words) live in [UI](UI.md), and each section
below links to the part of UI.md that owns them. The code is the final word: the theme in
`crates/maitty-terminal-client/src/theme.rs`, the screen in `crates/maitty-terminal-client/src/client/screen/`, and the reference frames the tests compare
against (see [TESTING](TESTING.md#project-specific-layout-and-fixtures)).

Most of this document describes the TUI. The desktop app's look is in
[Desktop app](#desktop-app) at the end; its code is `apps/gui/src/features/workspace/`
(tokens in `theme/themes.ts`, styles in `workspace.css`).

## Principles

- **Status first.** Every session reads as working, needs you, done or idle at a glance, and
  that mark stays in view longest when space runs out.
- **Shape and word carry the meaning; colour backs them.** Every state reads in the Unicode
  glyph set and without colour.
- **Colour means status only.** Borders, names, buttons and the selected row are neutral; teal is working, coral
  needs you, green done, red failed, yellow a caution. The brass accent marks one thing in the TUI: an update waiting.
- **Only what has the keys is lit.** The focused pane (a bright neutral border and a bold title), the open sheet or the
  selected row (a selected row's ground is the strongest text tinted into the surface it is on, `SELECTED_TINT`, so it
  is seen on dark and light alike; in the GUI a terminal selection is the solid accent); everything else is quieter.
- **Plain words.** Sentence case, no bracketed explanations, every key shown as a keycap.

## Themes and colour roles

Colours come only from the theme's roles, never a literal. Dark and light are two remembered
slots (Settings › Appearance) and a switch; **Maiker Dark** (id `maiker-dark`) is the default dark theme (the desktop app does not list Maiker Night, id `night`, which stays in the shared file for the terminal app) and
**Maiker Day** (id `day`) the default light one, and the browser lists each side on its own tab. **Maiker Dark** (`maiker-dark`) and **Maiker Light** (`maiker-light`) are the same accents on a standard black and white ground, from the file's `dark` and `light` sections. They are
Sea-glass and Brass, built from `crates/maitty-settings/maitty-tokens.json`, the one file the colours are
read from: brass is the accent, teal only ever means working, coral only ever means needs you, and the AI in
the wordmark is gold. Night is a deep teal-black ground; Day a pale sea-glass one. The other twelve built-in
themes (a dark and a light each of GitHub, One, Catppuccin, Solarized, Gruvbox and Tokyo Night, listed with Maiker's four in
`crates/maitty-settings/themes.json`) fill the same roles; [theme sources](theme-credits.md) lists where they come from.

| Role | Used for | Night | Day |
| --- | --- | --- | --- |
| `bg` | the ground, and a terminal cell's default background | `#05131a` | `#e9f0ed` |
| `card`, `card2` | panels, header strips; fields and action rows inside modals | `#0a2329`, `#092229` | `#f8fbfa`, `#d6e9e6` |
| `btn`, `hov` | chips and buttons; the hovered row and the open session's row | `#0b2a30`, `#092229` | `#d6e9e6`, `#c3dedb` |
| `line` | borders, dividers | `#17383c` | `#b9ccc5` |
| `muted`, `text`, `strong` | quiet text, body text, names and titles | `#8fa8a1`, `#c2d3ce`, `#eef5f2` | `#344845`, `#22393b`, `#0b1f22` |
| `accent`, `acc_ink` | focus, the current tab; ink on the accent (brass) | `#e3a72f`, `#07161a` | `#8a5a00`, `#f8fbfa` |
| `working` | working, and only that (teal) | `#3dd6c6` | `#09605a` |
| `blocked` | needs you, and only that (coral) | `#ff6a4a` | `#9e2e12` |
| `done`, `err` | passed or finished; failed | `#7fd99a`, `#e0245e` | `#439261`, `#c4003c` |

The day brass fill is too pale to read as text or carry an ink, so by day the accent is the file's `brassText`.
The error red is not in the file; it is kept apart from the coral of needs you. Day's `done` is the file's green
text lifted a third toward its green fill, because the file's own green and teal text colours are too close to
tell apart by colour alone.

`sky()` (checking, copy selection) and `violet()` (could not run) are derived
from the theme, not roles of their own. Every built-in theme passes a contrast audit, and
needs you never looks like failed. See UI › *design system*.

## Type and glyphs

The terminal's own font. Bold marks names and states worth a look; italic only the splash
tagline and a toast's preview. Status glyphs come from Settings › Appearance › Status glyphs:
**Unicode** (the default), where each state has a shape of its own (`!` needs you, `×` failed, `✓` done, `–` idle,
`┆` for an unreachable machine) and colour backs it, or **Dots**, a `●` told apart by colour alone (`○` at rest).
Working is the spinner you pick (the default, Blocks, is `▖▘▝▗` at 120 ms a frame); checking is a sweeping ring. An
agent's own mark is `✻` Claude, `◆` Codex, `✦` Gemini, `◇` OpenCode. See UI › *the sidebar* and *working spinner
picker*.

## Layouts

There is one look, drawn to the TUI redesign: the sidebar and the workspace, `ui.gap` apart (one
column by default), and the status bar under them. Every pane is a box of its own with round
corners; a split is two to four boxes a column or row apart. A pane's labels are plain text on its
border. Exactly one box, the focused pane's, has the bright border.

`ui.padding` is the blank space inside the terminal round both frames: `small` none, `medium` (the
default) 1 row and 2 columns, `large` 2 rows and 4 columns. See UI › *layout and navigation* and *the frame*.

## Chips, rounding and padding

Anything you click or read as a control (a button, tab, tag or key) is a chip on `btn`, or on
the accent when it is current. `ui.rounded` is the one shape setting: `off` is square, `corners` (the default when on) rounds every box (`╭╮╰╯`) and keeps chips as square-ended full-background rectangles, and `full` also ends chips, tabs, buttons, titles, rows and the hover in half-circle pills (a Nerd Font glyph). Keys are keycaps: ` key ` on `btn`, `strong` and bold. The
pointer's hover is one quiet tint; selection is a neutral tint with an accent `▎` bar, never an
accent fill. See UI › *UI conventions*.

## Sidebar

Sessions grouped by status, on the panel ground, 34 columns by default (24 to 60 resizable); 5 columns collapsed. The
header sits inside the frame: ` Maiker ` and, dim, how the list is grouped (`status`, `status · a–z`), then four plain
buttons, `⌕` search, `+` new chat, `≡` group and sort, `«` collapse. The groups are **Needs you** (failed sessions too),
**Working**, **Done** and **Idle**, each a bold heading with its count; a click folds it. `≡` chooses status or machine
grouping (by machine, each machine is a heading with its count, a `+` that starts a shell there, and a `●` while it is
up) and the order inside a group: newest change first, oldest first or A–Z. A row therefore moves when its status
changes. A session is two lines: the status mark, the name (bold while it is working, needs you or failed) and its age
at the right (`now`, `4m`, `2h`, `1d`); then, dim, `project / branch`, a `⑂` when it has a worktree of its own and
`· machine` when it is not on this computer. `limited 16:30` in the needs-you colour and a pull request's headline
follow on that line. The open session has the row ground, a `▎` bar and a third line, `Claude · this computer ·
working 12s`. An agent's subagents follow it: one still running for as long as it runs (after its parent's turn
too), one finished in the current turn for a few seconds; `└` and a mark each, or under the open session one row each
with `├`/`└` and the name, and a quiet `└ 3 done · show` line that lists the finished ones (`· hide` folds them
again). A subagent's row opens its own steps in a modal ("subagent name": what it was asked, `▸` what it ran, what it
said, the newest that fit, asked again every 1.5 s while it works); Enter goes to its parent's pane. Another machine's
opens the pane. The foot is a rule, then `menu` (with a `▪`, or `•` with round corners, in the accent while an update
waits or needs a restart) at the left and `? keys` at the right; the menu starts with **Install update X** or
**Restart to finish update**, and a build that is not a clean release prints its commit and age between the two. The
collapsed rail is `»`, `⌕` and `+` over one status mark per session with a short rule between groups and `≡` (with
the update mark) at the bottom. The chat menu (right-click, `shift+F10`) lists Open, Rename… (the name is typed on the row with a
cursor), Show changes, Copy folder path and, from 80% of the context, Compact the context, then in red after a line Stop the
agent (only while it works or needs you) and Close chat. A chat that stopped dims its pane to about 35% under a box with a red edge
(`Claude stopped`, or `<machine> stopped answering`) and, after Not now, leaves a one-line red bar at the pane's foot. See UI › *the sidebar*; the Machines dialog and its states are in UI › *Machines
dialog*.

## Pane titles

A pane's top border carries its title as plain text at the left: the status mark and the name, bold while the pane has
the keys. At the right, plain too, ` ± changes N ` (only where the checkout has changes; a click opens Changes) and
` × `. The folder it runs in is dim on the **bottom** border (cut with `…`); the branch is on its sidebar row. A click
on the folder opens the Project menu, where Files and Changes are. The program starts on the row under the border: an
agent's pane is its own terminal, and the TUI draws no chat of its own. At 85% context or more, a one-line yellow bar,
`▲ Context almost full · 91% used. Compact to keep the important parts.`, sits along the pane's bottom; a click types
`/compact` into the agent. With no pane open, a dashed box says `No pane open` over an ` n new session ` chip. A pane
closes with Alt+x, leader `x` or its `×`, with an undo, and a running agent asks first, its box red until you answer.
Unfocused panes fade; the focused pane's box is the bright neutral, or the KEYS yellow (`blocked`) in key mode. See
UI › *the frame* and *pane focus*.

## Side panel

Files, Branch and References are panels that slide in from the pane's right edge, over
its box, the pane's top line, its chips and its own ` ✕ ` included, so the panel's ` ✕ ` is the only close
at that corner (about 220 ms, eased out): the panel ground, a line down its left edge, its title chip
(` files `, ` changes N `, ` branch `, ` references `, lit while it has the keys) and a ` ✕ ` that
closes it (Esc too). Files starts 96 columns wide and at most 80% of the panes, a tree beside the
open file (Markdown drawn); Branch the
branch, ahead/behind, recent commits, the last check and snapshots; References the project's
screenshots and design files. The panes keep their size under them. The panels draw no key-hint row
of their own; the status bar shows their keys. Changes is the exception: it docks beside the pane, 52 columns on the sidebar's ground with a line down
its left edge, and replaces the pane under 140 columns. Top to bottom it holds the branch line, the
files with their boxes and A/M/D letters, the diff (additions on a 9% green tint, removals on a 9% red
one), the commit message in a bordered box and the `ctrl+enter` and `p` actions. Search is a box
near the top with `⌕` and the typing, a Chats group and a Commands group, the lit row on the selected
fill. The check evidence sheet docks beside the panes
(and over the sidebar below 100 columns). The Inbox is a panel 62 columns wide over the
workspace from the sidebar's side, with a card for each session that needs you, finished or exited. See UI › *the frame* (Sheet), *Inbox check
groups* and *check evidence sheet*.

## Modals and popovers

Everything that floats over the screen (menus, the keys help, confirms) is a box in the accent
on the panel ground, corners by `ui.rounded`; what sits on its top border stands on the ground
behind. Deciding is a modal: centred, its title as an accent chip on the top border, a ` × `
chip on `btn` a cell in from the corner, no shadow. Settings is not a modal but a full window:
a 20-column list of pages down the left, the rows at the right (a label and a dim description at
the left, the control at the right; a switch is `━━● on` or `●━━ off`, a choice is segments, the
chosen one filled with the border colour and bold). The keys help is a box listing every key. A menu has no title:
one row per item, the leader key at the right in the accent, the item that ends something last in red.
Small explanations (why, the message and helpers popovers) open beside their row with a `◂` pointer.
See UI › *UI conventions*, *Menus* and *check modals and settings*.

## Toasts

**News toasts** (`client/screen/toasts.rs`): a box 50 columns wide, bottom right, just above the status bar, on the plain
ground with the theme's border and a 2-column edge filled in the status colour (`blocked` needs you, `err` failed,
`done` finished, the accent an update). Row 1 is the colour's mark (`!`, `×`, `✓`, `↓`) and the bold title, then `+N` in dim
when more wait, and a dim `×` at the right; then the body, then the keys in the status bar's style (the key bold, its words
dim). One shows at a time, the newest. Plain notices keep the card below and ride above a news toast, never over it.

The TUI's plain notices: one small floating pane, bottom right, above the agent's input area, a box on the plain ground in the
notice's colour (`err`, `blocked` for needs you, `done`, else the accent) with a kind chip on the top border (`▲ Needs you`,
`✕ Error`, `✓ Done`, `i Hint`, `✓ Notice`) and the red × chip at its right, then a bold title, a detail and an optional
preview in italics. Every text row wraps at the toast's width: the title and detail onto up to three lines, the preview
onto up to two, the last line ending in `…` only past that. A question waiting on you also has its two answers as buttons
on the bottom border: a green `Answer` and a red `Later esc`. It slides in and fades out with motion on. See UI › *the
frame* (Toast). The desktop app's toasts are under *Errors*.

## Errors

The desktop app's error states (built 2026-11-18; `components/ui/feedback.tsx`, `feedback.css`, `lib/toast.ts`,
`components/ui/toaster.tsx`). The rule: **say it where it happened, only as loud as what it blocks, and never twice.**
There are no banners. Every surface is the Folded float (a `--line2` hairline, the fold, the dialog shadow) with a 3px
**status edge** on its left in its tone: `--err` failed, `--caution` (`--m-mid`) a warning, `--blocked` needs you,
`--ok` back or done, `--working` running, the accent a note. The mark before the title is the tone's glyph (`×`, `▲`,
`!`, `✓`, `i`, or the running spinner). Buttons are 26px (30px in a dialog): the fix filled in the tone's soft ground with
its line, then outlined ones, then text ones (Copy details); Copy details says Copied in the same width for 2 s.

- **Toasts** (`toast.*`). Bottom right, 16px in, 360px wide, newest on top, at most 3. Title 13px 600, the reason 12.5px
  `--fg2` up to three lines, the actions on their own row, a ✕ at the top right. Errors, warnings, needs-you and progress
  stay until dismissed or replaced; success and notes go after 4 s and wait while the pointer or focus is on the stack.
  An error toast's title is what failed ("Could not …") and its reason why in plain words (`explainError`: a raw tool or
  OS failure of a known kind in plain words), with **Copy details** when the tool's own text says more (CODE-STANDARDS ›
  error messages). The same failure again is one toast with `×2`. A needs-you toast names the session ("Parser fix needs you"), says what it
  asks, and offers **Allow** (only when the window can answer) and **Open session**. A progress toast (a file being sent)
  has no ✕, only **Cancel**, and becomes its outcome in place. They slide in 8px and fade; reduced motion only fades.
  Settings › Notifications and the desktop settings each have a **Show a test** row.
- **Field errors** (`FieldError`). Under the field, 12px `--fg2` after a red `×`, one sentence that says what to type
  ("Branch names can’t contain spaces. Try feat-new-login."). The field keeps its value and its underline turns red. It
  shows once the field is left or the form sent, never while typing.
- **Inline notes** (`InlineNote`). A failure on the page you came to read (a start that failed in New session, a clone, a
  git rule): the edge, a title, the reason in full, and text actions (Put back, Dismiss, Copy details).
- **Chat problem** (`ScopedAlert` scope `chat`, `ChatProblem.tsx`). A problem that stops a chat dims only the chat column
  (a flat veil of `--bg` at 72%, nothing blurs) under one 480px dialog: "devbox stopped answering" / the reason / **Try
  again** (or **Restart**), **Not now**, and **Copy details** at the right. Not now leaves the **problem line** at the top
  of the dock: the edge, the title in bold and the reason on one line, the fix and Copy details at its right. A context at
  95% or more is a caution line there instead ("Context almost full", **New chat with summary**, **Compact**), never a
  dialog. The chat dialog does not trap focus, as the sidebar and other panes still work.
- **Service offline** (`ServiceStatus.tsx`). A blip (under 3 s) is a title-bar chip, **Reconnecting…** with the running
  mark. Then the whole window dims (`--bg` at 78%) under one dialog that traps focus: "Maiker can’t reach its background
  service", **Start service** (then "Starting…"), **Not now**, **Copy details**, and "Trying again in Ns" in mono at its
  right. Not now leaves a red **× Offline** chip that opens it again. Back after an outage, the dialog turns green
  ("Reconnecting…", "Found the service. Picking your chats back up.") for 1.2 s, then a **Back online** toast, yellow with
  **Restart both/all** when chats were interrupted. The sidebar foot has no service dot.
- **Service update** (same dialog, caution): **Restart Maiker to finish updating** with what a restart keeps (`✓` green),
  warns about (`▲` caution) and stops (`–` dim), a restart that asks for a second click, **Later** and `protocol a → b`;
  Later leaves a caution **Restart needed** chip. A downloaded app update is a note toast that stays, "Maiker X is ready",
  with **Restart now** and **Later**; after the relaunch a success toast "Updated to X" offers **What’s new**.
- **Light and dark.** The tones are the theme's own, so the same rules draw both; on the light theme a filled fix is the
  tone at its soft ground with a darker line. Folded, Rounded and Square corners all apply through the float material.

## Status bar

The one full-width row, along the bottom, on the panel ground. It is always up. Typing: a `pane` chip (the button
ground, strong text) and, at the right, the keys that still reach Maiker, bold with their words muted: `alt+↓/alt+↑
chats  ^space k search  ^space n new  ^space tab next pane  ^space keys  ^space ? help` (every other key goes to the
agent, so a key that needs the leader is shown with it; the session keys need none). Key mode: a yellow `keys` chip and
`n new  s split  x close  tab pane  ? help  esc back`, each a click that presses it; starting a pane ends it. When
something other than the panes has the keys, a calm chip names the holder in lower case and its keys sit at the right
with the way out last (`sidebar` … `↑↓ move  enter open  n new  esc back`), with `shortcut mode waits` while the mode
is held. Keys are bold in the strong colour, their words muted. Under a popup the bar is words only and takes no click.
**Update** or **Restart** sits at its right end when waiting, unless the sidebar shows it at its foot.
See UI › *the frame* (Status bar).


## Splash

Centred on the ground: the name as a wordmark in 5-row block letters drawn as filled cells, its
"AI" in the accent; under it the swell, one rolling `▁▂▃▄▅▄▃▂` line fading into the ground at
each end; the tagline in italics; then, when a release is out (or installed and waiting for a restart), a
banner boxed as the look boxes a pane in the accent: `↑ maiker 0.47.0 is out` and `u update`,
which `u` or a click does; then the choice cards (Resume, New session, Open a project),
the chosen one with an accent `▌` edge. On the first start of a version the letters rise from
the deep colour one by one and the swell fades in. Night has its own wordmark, swell and deep
colours; other themes take them from their text and accent. See UI › *splash*.

The splash is the wordmark on the plain ground, with nothing round the screen, and under it the
START box (choices and recent projects) and the WHILE YOU WERE AWAY box (agents by urgency and the
machines) side by side. A smaller terminal shows less of the same splash: START alone with the
counts over it when there is no room for both boxes, then no wordmark when there are too few rows.
Only one too small for the START box draws the cards.

## Desktop app

The desktop app is drawn to the redesign handoff (`design_handoff_maitty_redesign`, "Maiker Desktop.dc.html",
Maiker Dark first). One model: **sessions live in the sidebar, an agent opens as a chat, a shell opens as a terminal,
and a terminal for an agent exists only when you ask** ("New terminal"). Every session is still a shell that
maikerd owns; Claude Code and Codex sessions have a chat view ([chat view plan](features/chat-gui/chat-view-plan.md)),
every other agent and every plain shell stays terminal-only. The prototype is the reference for exact sizes, shadows
and timings; the feature stylesheets beside their components carry them (`sidebar.css`, `pane.css`, `menu.css`,
`dialogs.css`, `features/chat/chat.css`), and `workspace.css` the rest.

- **Flat cards on the window ground** (the chat handoff, `design_handoff_maitty_chat`). The window is the theme's
  `--bg`, with two cards on it: the **sidebar** (264px, 12px from the window's edges) and the **workspace**, 12px
  beside it. Each is a solid `--main` with a 1px `--line` hairline, no highlight and no shadow. Only what opens over
  them casts a shadow (`--sh-pop`); a waiting card rising from the message box casts `--sh-rise`. `--hl`/`--hk` (the
  highlight colour and strength) and `--sd`/`--sk` (the shadow) are theme tokens; the design's nine themes set their
  own strengths (`hk`/`sk` in their palette), and the rest take dark .7/.6 or light 1/.35 (`theme/corners.ts`).
  Nothing tints the window behind the cards. A terminal sits on the card's own ground: xterm's background and ANSI black are `--main`, so a
  program that paints with black leaves no box. On a web view without WebGL 2 (`data-gpu="software"`) the same rules
  use cheaper values: a 1px ring for the popover shadow ([PERFORMANCE](PERFORMANCE.md)). The window ground is opaque
  on every platform (no Mica), and nothing blurs.
- **The toast (`components/ui/toaster.tsx`).** 360px wide, 16px from the bottom and right edges; see *Errors*.
- **One material, three roles (`apps/gui/src/material.css`).** Every surface is a *panel* (sidebar, main card,
  inspector), a *float* (menus, popovers, dialogs, the palette, find, toasts) or a *field* (the message box and its
  tray), and takes its fill, hairline and shadow from that role's rule in `material.css`: a panel is `--main` with a
  `--line` hairline and no shadow, a float the same with one plain shadow, a field `--raise` with a `--line2` hairline.
  There is one finish, flat: no gradient, highlight or blur anywhere (no `backdrop-filter`; hover tints stay). A new
  surface is added to a role's list in `material.css`; it does not set a background of its own. A popover opens
  through `PopupContent` (`components/ui/popup.tsx`) or carries `mx-pop`, so it is portalled into the window root and
  takes the float role. **Inside a surface**, nothing reads the theme's solid colours directly: a sunken control is
  `--m-well`, a raised or current row `--m-raise`, a picked row `--m-sel`, a hovered one `--m-hover`, a dialog's own
  ground `--m-pane`, each mapped to the theme's `--well`/`--raise`/`--sel`/`--hover`/`--pane`. Tints are written
  `rgba(var(--hl), calc(.06 * var(--hk)))`, never a fixed white. `src/material.test.ts` fails when a stylesheet other
  than `material.css`, `index.css` and `tokens.css` reads a solid surface colour or a fixed white, and when any
  stylesheet reads a token of the removed glass finish (`--m-sheen`, `--m-edge`, `--m-shadow`, `--m-blur`, `--m-line`,
  `--m-panel`, `--m-float`, `--m-field`, `--gk`, `--blur-pop`), selects on `data-finish` or blurs with
  `backdrop-filter`. It reads the stylesheets from disk, because Vitest hands a test every `.css` import
  as an empty string. Left on purpose: terminal grounds (`--term`, `--main` under a terminal), scrims, brand and status
  colours, and the browser preview's `App.css` shell (`features/preview/`), which keeps its own fills and `data-theme`
  tokens in `index.css`.
- **Design tokens (`apps/gui/src/tokens.css`).** The handoff's role names over the theme's colours, so a component
  never reads a theme colour or a raw value: `--bubble` (a user message), `--needs`/`--on-needs` (the theme's `--warn`,
  meaning needs you and nothing else), `--err`, `--focus`/`--link` (the theme's blue), code colours (`--code-kw`,
  `-str`, `-fn`, `-num`, `-com`), file-type tag tones (`--tag-ts`, `-tsx`, `-data`, `-toml`, `-sql`, `-env`, `-md`, `-rs`, `-py`, `-go`, `-css`, `-html`, `-sh`,
  `-img`, and `-text` for any other type: each common type its own, never the
  needs colour), spacing `--s1`..`--s9` (2, 4, 6, 8, 12, 16, 20, 24, 32px), the type scale (`--text-h1` 22px down to
  `--text-tag` 10.5px mono, `--text-reply` 14.5/1.65, `--text-code` 12.5/1.65), the corner radii (`--r-control`,
  `--r-panel`, `--r-badge`) and motion (`--t-fast` 120ms, `--t-base` 180ms, `--t-slow` 260ms, `--t-spin` 900ms, one
  `--ease` of `cubic-bezier(.2,.8,.2,1)`; Reduce motion zeroes the three durations). A panel that opens from a side (the side panel, the sidebar's width and its narrow-window overlay, the terminal dock) moves 28px and fades: in over `--panel-in` (0.28s, `cubic-bezier(.22,.9,.24,1)`), out over `--panel-out` (0.22s, `cubic-bezier(.4,0,.7,.2)`), and stays on screen, unclickable, until it has gone (`usePresence`); with motion reduced it comes and goes at once (the 2h handoff, §1). The usage meters read `--m-ok`,
  `--m-mid`, `--m-or` and `--m-hi`, which every theme sets. `--card`, `--done` and `--sh-pop` are set in `index.css`
  and `workspace.css`.
- **Primitives (`apps/gui/src/components/ui/`).** The chat handoff's shared pieces, each on the tokens above and named
  as the system page names them: **Card** (`card.tsx`: shell, `CardHead` 36px with its buttons at the right,
  `CardBody` 10px 12px, `CardFoot` 40px with the answers; `tone` `needs` for an amber edge, `err` for a red one;
  `interactive` for a card that is itself a button, `--line2` edge on hover and the focus underline inside), **Button**
  (`button.tsx`: kinds `primary` (the theme's accent), `needs` (only the main answer to something waiting on you),
  `soft`, `ghost`, `danger`, `link`; sizes `sm` 24px, `md` 30px, `icon` 28px; `keyHint` draws the key that also
  presses it; hover brightens, press darkens toward `--bg`, focus is the one 2px accent underline (`--focus-underline`),
  disabled is 42% opacity), **IconButton** (an icon with its label as tooltip and name), **Tag** (`tag.tsx`: a
  mono word in a hairline, `neutral`, `done`, `err` or `working`), **SkeletonLines** (`skeleton.tsx`: pulsing bars in `--line2` where something is on its way; nothing on screen says
  Loading or Reading, the label is for screen readers only), **FileBadge** (the path with its folder dimmed and no type icon,
  then the path with its folder dimmed; a long path shortens from the front so the name stays), **CodeChip**,
  **TextLink**, **StatusMark** (`status-mark.tsx`: running a spinner (the Settings spinner where the caller passes
  it), done ✓, failed ×, stopped ■, waiting ·, needs you ! on the needs square; with `word`, the state's word beside
  it in its colour), **Fold** (a 30px row: "Show 12 more lines" or "Hide"), **Progress** (a 4px bar on `--sel`),
  **Counter**, **Divider** and **ToastCard** (`toast-card.tsx`: one line on the card with the pop shadow). The
  chat's step marks, file badges and change tags (`cardParts.tsx`) and the workspace toast are built from them. The
  gallery shows every primitive in every state, and the chat's cards at 760 and 360px, on any theme and either corners: open the app or the browser preview
  with `#gallery` (`#gallery?theme=Paper&corners=rounded`; `features/gallery/`).
- **Corners: Folded, Rounded or Square, any theme** (Settings › Appearance › Corners, `corners`; the root carries
  `data-corners`). Folded is the default (a saved choice wins; a window style from before the switch still maps to Rounded or Square). Corners are shape only, never colour or
  type: every theme wears either, in Inter and JetBrains Mono (`withLook` in `theme/corners.ts` sets `--ui`, `--mono`
  and the shading). Square is the one rule at the end of `material.css`, which zeroes every radius inside the window;
  Rounded sets `--r-control` 6px, `--r-panel` 10px and `--r-badge` 3px. A component not yet on those tokens keeps its
  own radius under Rounded. **Folded** cuts the top-left and bottom-right corners diagonally: 5px controls, 12px panes and
  the message box, 14px floats, 10px chat bubbles, 8px toggle frames, 4px tiles (`material.css`, last block). A web view
  with `corner-shape: bevel` draws it with `border-radius: N 0 N 0`. WebKit (Linux, macOS) has none, so
  `@supports not (corner-shape: bevel)` draws the same cut with a `clip-path` polygon sized `--fold`, and pays for what
  the polygon clips: every cut surface draws a 1px anti-aliased stripe along both cuts as its top background layer, in
  `--fold-line` (the colour of its border or its 1px inset shadow; transparent when unset, so a filled button with no
  edge shows no line; the accent on a focused message box; Button and Card variants set it; a segmented control's first
  and last choice cut only their outer corner through `--fold-tl` and `--fold-br`), a float's polygon is widened by `--fold-bleed` (48px) on its
  square sides so its shadow survives (no `filter`, no wrapper: cheap on software drawing). A new Folded surface is added to both blocks and looked at in both engines. The corners are the desktop app's own: the
  shared `window_style` setting is not read by the desktop. A window style saved before the switch carries over: Glass,
  Flat and the older names to Rounded, Squared and Retro Pixel to Square (`cornersOfWindowStyle`). **Components are
  built once and read tokens, never the corners.** Besides the base tokens, the shared pieces read the component
  tokens declared in `material.css`: `--c-sel-*` (every selected state: a sidebar row, a settings nav item, a chosen
  segment, a palette row), `--c-field-*` (dropdown buttons, pickers, the new-session segments, inputs), `--c-track-*`
  (the tray behind a segmented control), `--c-sw-*` and `--c-knob-*` (the switch), `--c-tile-ring` (agent and shell
  tiles) and `--c-head-bg` (sticky headers). A new control gets tokens first and is checked in both corners and both
  kinds of theme. **Agent marks** are flat glyphs with no tile or background anywhere (`AppIcon`): Claude's is
  `--agent-claude` orange, every other agent's takes `--fg2`, a shell's `--dim`. Settings › Appearance › Icons
  (`iconColor`, `data-icons`): `grayscale` makes Claude's neutral too. **Segmented control**: a 28px frame on `--well`
  with a 1px `--line` edge and 2px of room; 22px choices (12px/500, `--dim`, `--fg` on `--m-sel` while picked) with a
  13px mark 6px from the word. **Drawers** (Changes, Files, the terminal dock) grow as they slide: `from` opacity 0,
  translate 28px and width (height for the bottom dock) 0 over `--panel-in`, out over `--panel-out`, so the chat
  beside them narrows with them; Reduce motion (the OS or Settings) shows them at once.
- **Focus and popovers.** Focus is a 2px `--accent` underline (`inset 0 -2px 0 var(--accent)`) on buttons, fields and rows,
  one rule in `workspace.css` (and the same in `index.css` outside the window); menu items and options keep their own highlight, and the message box is the one
  exception: its whole border turns accent. A popover grows from the corner that touches its anchor: `transform-origin` is Radix's
  `--radix-popper-transform-origin`, 160ms `cubic-bezier(.2,.8,.2,1)` from scale .9 (`mx-grow`, `material.css`), off under reduced motion; a dialog has no anchor and does not grow.
- **App icon.** The desktop app's icons (window, taskbar, dock, tray, installers) are generated from one 1024px-plus
  source with `pnpm tauri icon <source.png>` into `src-tauri/icons/` (only the desktop sizes listed there are kept);
  every bundle and the updater carry them, so an update changes the icon too.
- **Title bar** (`AppTitleBar`, `frame.css`). 38px on the window ground (`--bg`), all of it a drag area
  but the window buttons: at the left the 18px **M mark** (`components/ui/maiker-mark.tsx`, an inline SVG: ribbons
  `--fg`, folded faces 70% `--fg` over `--bg`, outline `--bg`, all set through `style` so the variables apply; white in a dark theme, black in a light one)
  and "Maiker" (13px 600 `--fg`), plain, with no menu; at the right the platform's window buttons (46x38 captions on Windows, drawn as
  Windows draws them, close hovering `#c42b1c`; `TitleBarView.tsx`). What the old menu started is in the command palette and the sidebar.
- **No tools bar.** The right-hand tools column is gone; its jobs live in the session header (Changes and Files buttons,
  the ⋯ menu) and the terminal dock. The ⋯ menu lists **Changes**, **Files**, **History**, **Checks** (with `N failed` beside it
  while checks fail) and **Terminal**
  (shows or hides the dock, adding the first terminal when the session has none; `toggleTerminal`), then the pane's own entries.
  A view button opens the side panel on that view, or closes it when it already shows it. There is no middle column and no tab bar: the window is the sidebar, the workspace and the side panel.
- **Small windows.** The window is never narrower than 720px (`minWidth`). Under **1100px** the sidebar is the
  52px rail, and its expand button opens the full sidebar as an overlay from the sidebar's side, over a scrim;
  picking a session, a click on the scrim or Esc closes it. Under **800px** the panes stack in one column. The
  widths are `COMPACT_WIDTH_PX` and `NARROW_WIDTH_PX` in `model/windowSize.ts`. The chat column keeps at least
  **400px** (`--chat-min`): the side panel beside it shrinks first, down to its 300px, and under **900px**
  (`inspect.css`) the side panel lies over the chat instead of beside it.
- **Settings dialog** (⌘,). A nav on `--m-well` at the left, in three groups under dim caps: **APP** (General,
  Appearance, Notifications, Hotkeys), **AGENTS** (Chat, Permissions, Terminal) and **MACHINES** (Remote machines, M). Each item is 32px with a plain 15px glyph stroked in its section's colour and its jump key at the right;
  the current one is on `--m-raise` with an inset `--line`. The nav's foot is the **update box** (`UpdateBox.tsx`): a
  dot in the state's colour, one line ("v0.65.0 is ready", "Downloading v0.65.0 · 42%", "Up to date", "Update
  failed"), the running version at its right, a dim note when there is one, the download bar while it downloads, and
  the one button the state offers (Restart to update, Download, Check now, Try again). General keeps only the two
  update switches. At the right, a fixed header (the page title, a one-line description and a 30x30 **×** icon
  button, tooltip "Close (Esc)", no label) above a body that scrolls; the page itself never scrolls. The title and
  description slide with the page. A page is groups (`Card`) of up to 640px: an uppercase 11px `--dim` title over
  rows of 14px padding, each with a `--line` above it, and a dim foot note. A group has no box of its own. The
  sidebar settings sit in Appearance, the daemon's in Remote machines ("This computer") and the approved commands in
  Permissions. **Usage** and **Performance** have no nav item: Ctrl+Shift+U and Ctrl+Shift+P or the palette open them,
  and they take the whole dialog, with no nav (Usage's groups run full width).
  **Remote machines** (`MachinesPage.tsx`) is a wide **This computer** tile (a monitor glyph with a status square, its
  version and sessions), a toolbar (a segmented All | Connected | Needs attention, each with its count, a "Find a
  machine" field and **+ Add machine**), a summary line of the real counts ("3 machines · 2 connected · 1
  unreachable"), and a two-column grid of machine tiles, the troubled first: a server glyph with a status square, the
  name, the state word in its colour (with how long it has been down) and its sessions, with "Update" or "Install" when
  its app needs one. A click selects a tile (accent border, `--m-raise`) and draws its cards under the grid, with a
  bar naming it and **Close**: Connection (Link, or the down state with **Retry now**; Since; Sessions), Version (only
  when its app needs installing or updating: the command, Copy command, and the confirm before it runs), Allow
  (clipboard, notifications), GitHub (when connected) and Remove (asks first). This computer's are the daemon card and
  its GitHub row. **Add machine** replaces the page with a breadcrumb back and a box: From ~/.ssh/config (a radio list
  of the hosts, name and address) or By address, **Name in Maiker**, and **Connect <name>**; then one stage, "Reaching
  <target> over ssh…" with Cancel (Esc), and either the failure in the machine's words with **Edit and try again**, or
  what was added with **Add another** and **Open its settings**.
  **Search settings**, a 30px field under the nav's title, looks through every page in nav order and Performance
  (not Usage, which holds figures): while it has text the body is the pages' groups, each titled "Page · Group", whole
  when the page name or the group title matches, else with only the rows whose label or detail match, and a group with
  none is left out; the header reads **Search** over "N settings match “q”", or "No settings match “q”." in the body.
  No nav item is current then. A group's title opens its page with focus in that group; a nav item opens its page;
  both empty the search, and Esc empties it before it closes Settings (`settingsSearch.ts`, the `Card` and `Row` of
  `DesktopSettings.tsx`).
  Performance shows live frame, drawing, output and process figures with a **Copy report** button, and a switch for a
  corner readout over the window ([PERFORMANCE](PERFORMANCE.md#measuring-in-the-app)). The **switch** is 32×18 with a
  12px knob (`--c-sw-off` is the well, on is the accent, the knob `--muted` off and `--on-accent` on); a
  **segmented** control sits on `--c-track-*` with its chosen segment on `--m-raise`.
- **Keyboard shortcuts** (⌘/ or Ctrl+/, also in the palette). An 860px dialog over a dimmed scrim: "Keyboard
  shortcuts", "Change them in Settings › Hotkeys" and a close ×, then an auto-fit grid (240px minimum) of the groups
  (Sessions, Panes, Find & jump, Window, and In chat: Enter, Shift+Enter, Y, A, N, Esc), each row 32px with its keys as
  small 22px keycaps. The window's rows come from the same table Settings › Hotkeys reads (`hotkeyRows`), so the two
  never differ. Other shortcuts are ignored while it is open; ⌘/ and Esc close it.
- **Menus** (`components/MenuPopup.tsx`, `menu.css`). One look for every right-click and ⋯ menu: 228px or wider,
  5px inside, radius 12, a float like the cards, a dim 11px heading that names what it is for, 30px rows of 13px text with
  their key at the right in mono, separators between groups. A danger row is red; one that stops something running
  is handled by the app, which asks in a dialog first (see Close ends the session). Arrow keys, Home and End move, Esc or a click outside closes and
  gives focus back. **Session**: Open, Open in split right, Open in split down (not for the one in front), Open
  terminal here (agents), Rename… (F2), Copy folder path, Get a file… (another machine's sessions), Show changes
  (agents), Stop session or Close shell.
  **Machine**: Install Maiker or Update Maiker first (a machine that needs it), New session here, New terminal here (or a disabled "Not reachable: <why>" line when it is down), Collapse or Expand, Machine
  settings…. **Pane** (⋯ or a right-click in the pane): Split right, Split down, Changes and files, Pin terminals
  under chat or Move terminals to side panel (agents); then Rename…, Maximize pane, Show chat or Show terminal, and New
  terminal (agents) or Clear and Copy folder path (shells); then Close pane, only when there are several. **Close pane** on one pane of several closes only the pane when its
  session has work in it (an agent, a chat, a shell running a program): the session keeps running and stays in the
  sidebar (`useClosing`, `removePane`). A plain idle shell, or the only pane, ends its session as before, with Undo.
- **No status bar.** The window has none: the service's state is the title bar's chip and, once it has been out of reach for 3 seconds, one dialog over the whole window (see *Errors*). A downloaded update is a toast that stays, "Maiker X is ready.", with **Restart now** and **Later**.
  The the theme and corners are in Settings › Appearance, the terminal
  text size is Ctrl+= and Ctrl+− (and Settings › Terminal), and the shortcuts open with their own key.
- **Sidebar** (`components/Sidebar.tsx`, `sidebar.css`, `frame.css`; the whole-app mock). Agents only: no fleets, ships
  or tabs. A 264px card on `--card` with a `--line` hairline, 8px from the window's edges. Its header reads **Chats**
  (12px 600 `--muted`) after a **Hide sidebar** button (Ctrl+Shift+B / ⌘B), then four 26px buttons: **Search** (the command palette; there is no filter field), the **≡ menu**
  (`SidebarFilterMenu`: a 264px popover that grows from the button's bottom-left corner. **Group** Status | Project | Machine and **Sort** Recent | Oldest | A–Z
  as segmented toggles; then a project search ("Find one of N projects" above six) over the projects, busiest first, each with its count, six rows
  before it scrolls, **All projects** first while the search is empty; **Reset** appears when anything differs from Status, Recent and All projects.
  A choice applies at once and the menu stays open. Recent puts the session whose state changed last first, Oldest is creation order; the sort is the sidebar's own and is not remembered), **New terminal** (the terminal glyph; a plain shell in the start folder, the same action as New terminal and its key, shown in the tooltip) and **New session** `+` (opens the draft chat on this computer; a right-click offers New session,
  New terminal and Add a remote machine…). The grouping is `sidebarGroup`, also Settings › Appearance › Group sessions by.
  **By status** (`statusSections`): **Needs you** (in `--needs`; an agent that stopped is here too, and so is one held
  by its plan limit), **Working**, **Finished**, **Idle** (a session the daemon cannot read is here) each a heading
  with its count that folds it on a click; a section with nothing in it is not listed, and rows follow the Sort within one. A terminal that asks is under Needs you.
  **Terminals** are not one of these headings: under every grouping, the sessions with no agent in them (a shell, a
  program running in one, a shell that exited, the shell an agent left behind) are one **Terminals** section stuck
  over the foot (`TerminalsSection`, `splitTerminals`): it never scrolls away with the list, takes at most a third of the
  sidebar's height and scrolls its own rows past that, shows its count, folds from its heading, and has its own **+**
  (New terminal), so a new terminal's row appears beside the button that made it. Each row keeps its × on hover to close it.
  A terminal that asks stays with Needs you, and a chat session is never listed here. In the 52px rail the section is
  one terminal glyph over the foot with its count; each press opens the next terminal after the one on screen. A row
  of another machine names the machine after its project (the nickname given to it, else its name); a row of this computer names no machine. **By project** (`projectSections`): one heading per project
  by name, with its colour square, count and needs-you count; a project on another machine gets its own heading,
  `name · machine` with the line's dot. In both, a machine that needs the app is listed under the rows with its
  **↑ Update** (or Install) button or its percentage, since no machine heading carries it, and a draft chat is the
  first row of the list. **By machine**, this computer first: an uppercase 10.5px heading with a 12px caret (`--accent`; a project's caret is `--ansi-blue`), a laptop or server mark, the count and
  the line's 5px dot (its tooltip gives the reason when the machine is down; a right-click opens the full menu); clicking the heading's name folds the group. There is no `+` on a machine and no group-by-project toggle: New session is one door. Within a
  machine the rows are in the **Session order** setting (`sidebarOrder`): as created, or with what needs you first.
  While the new-chat page is open, a draft row (**New session** in italics, a dim `draft` tag and the agent's tile at
  .75 opacity) is listed first (last on this computer when grouped by machine),
  so the draft is never missing from the sidebar; it goes when the chat starts and the chat's own row takes its place.
  Grouped by project inside a machine, each project is a folding heading (its colour square, name, needs-you count,
  count). A row whose status changes glides to its new place over 420ms, and the headings and rows it passes glide with it, so
  nothing in the list snaps (`useFlip`); a new row slides in from the left; Reduce motion turns both off. A row is never tinted or flashed when its
  status changes: its badge says the new status, and a flash on every finished turn read as noise.
  **Put away** (`splitPutAway`) is the last heading of the scrolling list in every grouping, folded until opened, with
  its count and "still running": the sessions put away from their menu, terminals included, as created. A row there has
  an arrow (**Bring back**) in place of the hover ×; a put-away session that needs you is listed under Needs you instead.
  The rail leaves put-away sessions out.
  A **row** (padding 7px 10px, radius `--r-control`) is the 16px flat app tile, dimmed while idle or unknown, with a
  9px status badge at its corner (`!` needs you, pulsing; the spinner; `✓` done; `×` stopped; `‖` limited; a dashed
  square for unknown; none while idle), the name with how long it has been in its state at the right, and the project
  (and another machine) under it.
  A pointer resting on a row for 450ms shows a **hover card** beside it (`RowHoverCard`, 300px, its top 4px above the row (a row in the lower half of the window stands the card on its
  bottom instead, so it grows up) and kept inside the window, fading in by opacity with a one-pixel ring and no blurred
  shadow; while it is warm, moving to another row within 250ms shows it there at once, with no 450ms wait and no fade;
  never a native `title`): the status icon and name (two lines at most) over the
  activity line in the daemon's own words (the status word, dim, only when it said nothing; never both), then icon rows hanging in the left margin: the
  folder (locked for a worktree; a shell shows its working directory in mono), the branch in mono with an **own worktree** tag, the changes
  (`+added` `--ok`, `−removed` `--danger`) and the pull request (`#218` and its state in the state's colour), and a 30px footer with the agent's mark,
  `agent · machine` and how long ago it last changed. It takes no pointer input and goes on leave, click, scroll or a menu.
  The name is 13px, 600 and `--fg` for an agent that is doing anything. A stopped agent says `stopped` and an exited shell `exited` at the right, in `--danger`, instead of a
  badge. An agent the daemon holds until its plan limit resets is **limited**: its row says `limited until 14:05` there in
  `--muted` (the daemon's `TermInfo.resume_at`, in this computer's time; `limited until Thu 14:05` when that is not today), and it goes back to the daemon's status when that
  time comes or the daemon clears it. Only that time makes a session limited, and only one the daemon calls idle or done: one that works, asks or failed keeps its status. A limited session is listed under the sidebar's Needs you and nowhere else that says needs you: the jump, the tray, the counts and the notices leave it out, because it waits on the limit and not on you, and its limit ending is not a new finish. Any other agent row has, at the right in 11px `--muted`, how long it has been in its state (`now`, `4m`, `3h`,
  `2d`; the daemon's `TermInfo.since`); it gives way to the close button once the pointer has rested on the row for 450ms (focus shows it at once). A finished agent's menu has **Mark as
  done**, which files it under Idle without opening it (`MarkSeen`). A shell's tile is a flat `--raise` square with a teal `>_`. The selected row is a raised pill. The row
  is named by the name you gave it, else a shell's folder, else its agent. **Rename**: double-click, F2 or the menu
  turns the name into a field; Enter or leaving saves, Esc cancels, empty clears. Project colours are five tokens
  (`--proj-1` to `--proj-5`: teal, blue, pink, violet, green), chosen from the project's name, never amber or red.
  With nothing running the list says "Chats and shells you start appear here, sorted by what needs you."
  The foot holds the update button (nothing while there is nothing to do: the version lives only in Settings; or "Reconnecting to maikerd…") and the Settings gear; Recent sessions is in the command palette.
  Hidden (Ctrl+Shift+B, or Hide sidebar), the sidebar leaves no rail: the first pane's header starts with a **Show
  sidebar** button. The edge drags (208 to 440px; double-click resets). The **rail** (the collapsed sidebar, or a narrow
  window's; `Rail` in `Sidebar.tsx`) is 52px: expand, new session, search and new terminal (32px buttons) on top, then one 30px row per
  chat holding only its 14px `StatusIcon`, in the full list's order and groups with a 20px divider between groups; the
  open chat has the `--sel` fill and a 2px `--fg` bar on its left edge. Hovering a row shows the same hover card as the
  full list, a click opens the chat and a right-click gives the same menu. The foot has the update button and Settings.
  No agent logos, initials or connection dot (the service's state is the title-bar chip), and no Recent sessions button
  (it is in the command palette). The width eases on the drawers' timing.
- **The running turn is drawn as it happens.** While the agent works, its steps (folded into runs as they come), its
  thoughts (the folded Thought row) and its reply appear in the chat as each read of the history brings them, above the
  working line (*The live box*, below). Steps and thoughts show as fast as the history has them. A reply is typed in a few
  words at a time (`useTypedText`: at least 120 characters a second, and fast enough that any reply is in within 2.5 s), so
  one the history brings whole (an agent started in a terminal pane writes its message to the transcript only when it is
  finished) still appears the way a streamed one does, and one that streams (Claude's structured chats,
  `--include-partial-messages`) is only smoothed. A reply that was there when the chat opened, or came while the window was
  hidden, shows whole (`KnownRowsContext`); Reduce motion shows every reply whole. What shows is read in its finished
  form so a half-written mark or table never flashes (`streamingParagraphs`). A pending request stays out of the
  feed; it is asked in the tray over the box. A helper agent reporting back (the harness's `<task-notification>` block, which the history keeps as a
  user message) is one quiet line, "Agent "name" finished · 11s · 50.5k tokens", never the markup; once it has reported,
  it clears from the helpers dock. One that still needs you stays.
- **Running helpers** (`HelpersDock`, the daemon's `subagent_activity`, `model/subagents.ts`). Helpers that run show in the dock above the message box, not in a bar over the chat; the daemon takes a helper's own report that it finished as final, whatever second its other reports were stamped with, and only a start of its own brings a finished helper back, so one whose last news arrives late is not listed as running again and then as stopped (`apply_hook`).
- **Panes change places with a glide.** Every change that moves panes (a split, a pane closed, a saved arrangement,
  maximize, a swap by drag) goes through a View Transition (`movePanes` in `paneTransition.ts`): only
  the browser's pictures of the panes move, cropped and never stretched, so text never reflows on the way; a pane that leaves
  fades out and one that arrives fades in. Without View Transitions, with Reduce motion, or on the Linux web view (where a swap
  by drag was reported to take the window down in 0.72.0), the change just happens. Picking a session to show (the sidebar, the palette, a
  notice) is not a move: it shows at once, since it is the most frequent thing done in the window and a cross-fade on
  each pick made switching feel slow.
- **Toasts are one design** (see *Errors*): bottom right, 360px, a status edge, the title and reason, the actions on their own row.
- **A remote machine that needs the app** has no row of its own: its dot turns amber and an amber **↑ Update** (or Install)
  text button sits in its header before the folder button. While it updates, a mono percentage replaces the button and a
  2px accent line runs under the header (indented 26px left, 10px right); both go when it ends. The percentage is the stage
  the update has finished (probed 5, found 15, build fetched 55, sent and verified 85, reachable 95), not a byte count: the
  download and upload have none to report.
- **A chat that starts does not jump.** The message you send from the New session draft is drawn in the same view at once, then in the conversation,
  where it will stay, with "claude is starting…" under it; there is no queued row above the box and no bar that comes and goes. When the agent reports in and the real chat takes over, the message stays where it is while the history is first read (no loading skeleton in between), and the tray already says Worktree or Branch.
  The needs-you card is raised by the window from the status change as well as by the daemon's own alert (one card per
  session, so they never stack). The theme's tokens are on the page root, so a menu or popover that renders outside the window
  reads the same colours and is never see-through.
- **Typing while an agent works.** A chat run by the daemon queues what you send, and the daemon sends it when the turn
  ends. A chat that follows an agent in a terminal does the same: the message is left with the pane's daemon
  (`queue_follow_up`, the queue the terminal app uses; shown under the box in the queue, removable and editable through
  `drop_queued_follow_up`) and the daemon types it into the agent's prompt, one at a time, when a turn ends; nothing is
  typed while it is asking something. The window types none of them, so a queue goes on with the window closed, and
  the chat draws a message as sent when it leaves the front of the daemon's queue. While messages are still queued
  for a session (`SessionView.queued`), a turn that ends raises no "finished" notice or sound: the session has not
  finished. What a box holds (unsent text, files) is kept
  by conversation number and belongs to its session: when the daemon gives the session's chat a new number, it moves
  to that number (`followComposer`).
- **Settings pages.** ESSENTIALS: **General** (start and export folders, each the folder shown with **Browse…**, which
  opens the system's folder picker, and a way back to the default; nothing is typed; the start folder reads as `cd <folder>`
  and says "Saved" for two seconds after a change; updates; sessions) and **Chat** (how a
  chat starts and is drawn: default agent, the view every new session opens in (**Open sessions in**), width, text size) and **Permissions** (first a
  **Bypass Permissions** card, one switch per agent, all on, with a foot that says what it allows; then the account each
  of Claude and Codex is signed in to, as the agent's own command says, with **Sign in**, which opens the agent's own
  sign-in in a terminal, **Sign out**, and **Check again**). TERMINAL: **Terminal** (text,
  scrollback, and Panes: where an agent's terminals open), **Appearance** (look, surfaces, density and pane
  title text, motion) and **Sidebar** (grouping, order, position, icon and text size, width). WORKSPACE and ADVANCED
  are as they were. Each page has a letter that jumps to it (G, C, E, T, A, S, U, N, M, ?, D, P).
- **Chat size.** Settings › Chat › Chat view has **Chat width** (`chatWidth`: Auto, Narrow, Wide, Full) and **Chat
  text size** (`chatTextSize`: 90 to 140%). Auto is the 760px column on a small pane and grows with a large one, to 62%
  of the pane and 1100px at most, so the chat is not a strip on a big screen; the message box is as wide as the
  messages. The text size draws the whole chat larger or smaller (`zoom` on `.mx-chat`), cards and message box included.
- **Slash commands.** In a Claude chat, a slash as the first thing in the message box opens the agent's commands over
  it (`SlashPicker`, the shared `ResultsList`): its own, and the person's and the project's commands, skills and
  plugins, as Claude Code itself lists them for the session's folder on the machine the chat runs on (`agent_commands`,
  or `agent_commands_on` for another machine's daemon; asked as the chat opens and again after five minutes; a machine
  that is offline or lacks the agent is named in the picker's note, never answered with this computer's list), each with what it does and what it takes. Typing narrows them (the exact name, then names
  that start with it, then a plugin's command by its own name, then names that hold it). The list is square, headed
  "Commands" with the number that match, with the keys at its foot (↑↓ choose, Tab complete, Enter run, Esc close);
  with none it says "No command by that name" and "Press Enter to send <typed> to the agent as a message.". ↑ ↓ move, **Tab** completes
  the name, **Enter** or a click runs a command that takes nothing and completes one that takes something, **Esc**
  puts the list away until the text changes. The list goes once a space ends the name. A one-line message that
  starts with a slash is typed into a terminal agent instead of pasted, so it is read as a command, and its Enter
  follows 400ms later (`typeMessage`, `COMMAND_SUBMIT_GAP_MS`): sent with the text, Claude Code takes the Enter for the
  path it is completing and leaves `/export /some/path` typed in its box, and Codex loses it. Claude Code leaves
  the commands that only its terminal runs out of that list (`/help`, `/permissions`, `/resume`, `/add-dir`…), so they
  are written by hand in `terminalCommands.ts` (`CLAUDE_COMMANDS_PINNED_FOR`, the version each was run in) and offered, tagged `terminal`, to an agent
  that has a terminal: running one types it there and shows the terminal, since its menu is the terminal's to draw,
  and it is refused with a toast while the agent works. One typed out with what it takes goes the same way, since
  Claude Code draws its answer only in the terminal.
  Some of them the window answers itself, in a chat session too, and the picker tags each with where it goes instead
  of `terminal` (`windowCommands.ts`): `/diff` opens the side panel's Changes, `/rewind` (`/checkpoint`, `/undo`) its
  History, `/permissions` (`/allowed-tools`) Settings › Permissions with the approved commands, `/resume` Recent sessions,
  and `/help` puts a lone `/` in the box so the list shows every command. Typed with something after the name they go
  to Claude Code as typed, which has a use for it. `/exit` (`/quit`), `/background` (`/bg`) and `/clear` are tagged
  `asks first`: a `ConfirmCloseDialog` with Cancel focused says what happens, and only a yes sends the command as typed
  (typed into the terminal for the terminal's ones), refused with a toast while the agent works.
  **Side answers** (tagged `answered here`): `/btw <question>` and the commands that only report, typed alone
  (`/context`, `/usage`, `/skill-doctor`, `/goal`, `/advisor`, `/config`, `/mcp`), are answered in a card above the
  message box (`AsideCard`, `useAside`), as wide as the messages: a title, "Not added to the conversation" in
  `--muted`, a Close button; a side question also carries a `BTW` badge and a border in `--link`, so it reads as an
  aside at a glance; the question in italics; "Asking Claude…" while it runs, then the answer as Markdown,
  scrolling inside the card past 38% of the window's height. Its foot has **Copy** and, for a question, **Ask in the
  conversation**, which sends the question as a message. Esc or Close puts it away, and a new one replaces it. The
  daemon answers from a copy of the session it never saves (`sideAnswer`, API_PATTERNS), so it may run while the agent
  works; a failure is the card in the `err` tone with the daemon's reason. `/btw` alone puts `/btw ` in the box. One of
  the reporting commands typed with something after it (`/goal tests pass`, `/config editor=vim`) changes something,
  so it goes to Claude Code as typed. `/mobile`, `/privacy-settings` and `/artifacts`, which Claude Code shows as a
  QR code or a browser page, are the same card with the web address to open. A chat on another machine is answered
  by that machine.
  **Answered from what the chat holds** (`commandCards.ts`, `windowCommands.ts`; the same card, with nothing asked of the
  agent and nothing typed into it). For Claude and Codex alike, typed alone: `/status` is a card with the agent, model and
  effort, permission mode, folder, what it is doing now, the context (0% before its first turn) and the plan limits it has
  reported (a limit it never reported is left out, never a made-up figure); `/copy` puts the agent's last message on the clipboard; `/export` saves the conversation (what you
  said and what the agent answered) as `conversation <day> <time>.md` in the export folder chosen in Settings; `/diff` opens
  the side panel's Changes; `/resume` opens Recent sessions. Claude only: `/memory` is a card naming the `CLAUDE.md` files it
  reads, the project's own opening in the file viewer, and `/plan` asks first (`Switch to plan mode?`, Cancel focused) and
  only a yes moves the session to plan mode through the shield button's own control; a chat with no such control says so,
  and nothing changes the mode without that yes (ADR 0005). Codex only: `/permissions` is a card saying what each mode does
  with the current one marked; the pick stays the shield button's. With something after the name (`/export notes.md`,
  `/plan fix the build`) the command goes to the agent as typed. Still terminal-only, each needing the agent's own screen or
  a change the daemon would have to make: `/add-dir`, `/cd`, `/branch`, `/fork`, `/rename` for Codex, `/agents`, `/model`.
  **`/rename <name>`** names the Maiker session too (the sidebar's rename) and still goes to Claude Code, so both
  agree. A name Claude Code gives a session with a terminal, by `/rename` typed in the chat or the terminal, with a name
  or alone, renames the pane as well: the daemon reads the transcript's `custom-title` line (`follow.rs`; the names
  already in the file when it is first read are left alone, so a restart never undoes a rename made in the window).
  **What cannot run here says so.** A command only the terminal runs, typed in a chat with no terminal, gets the same
  card: "`/hooks` only works in Claude Code's own terminal, and this chat has none." In a chat with a terminal, one run
  there shows the terminal with the toast "/hooks has no chat version, so it opened in the terminal."
  The chat leaves out Claude's internal commands and the ones that only change how its terminal looks (the theme,
  colour, renderer, scroll speed, focus view, voice input; `CLAUDE_HIDDEN_COMMANDS`); they still work typed in the terminal.
  A listed command that opens a menu (`/model`, `/config`) still shows that menu in the terminal, not in the chat.
  A command run in the terminal shows in the chat as the person's bubble with what it printed beneath as a quiet
  "↳ Set model to Haiku 5.5" line, never as a shell step, and a turn that was only that gets no divider. What the
  agent then says it runs (`/model`, `/effort`) replaces the model and effort picked in the chat.
- **The message box** is one box (layout 2h): the text, with attach (+) at its top right, a plan strip while Plan
  mode is on (`PLAN MODE` in mono blue, then what it means), and a bottom row: the model picker, the permission mode
  as a shield and a chevron (`ModeControl`; the mode's name is in its tooltip, and the shield is `--danger` in a mode
  that asks about nothing), a spacer, the usage meters and send. Its focus is the border turning accent (the one bordered focus). The meters
  (`UsageMeters`, `usageStrip.ts`) are the context, then each plan limit, each a short name (`Context`, `5h`, `Week`, which
  go below a 1180px window), a 12px square ring (a path round the box, as square as the window's corners) and the
  figure in mono, ring and figure in the theme's meter colour for the quarter it is in (`--m-ok` under 25%, `--m-mid`
  under 50%, `--m-or` under 75%, `--m-hi` from there). A meter shows once it is at least half used
  (`METER_SHOWN_FROM`), when it is worth a look; below that Settings › Usage & cost has it. Each opens that page. When
  a limit starts over is in its tooltip. A plan limit shows only once the agent has reported it, in the order context, 5-hour, weekly, then any other: a plan without a 5-hour window (an API key, some
  Codex plans) never reports one, and a meter that only ever said "–" was noise. Other agents show only what they reported; a chat session with no pane has none yet. Where the chat works is in the pane header's crumbs, not in the box.
- **Codex's commands.** A Codex chat has the same picker. Codex cannot be asked what it takes, so its commands are a
  list the window keeps (`codexCommands.ts`: names from OpenAI's command reference, descriptions from the Codex CLI
  named by `CODEX_COMMANDS_PINNED_FOR`). The few whose result the conversation shows are sent from the chat; the rest open a picker or a page in
  Codex's terminal, are tagged `terminal`, and run there with the terminal shown. Codex does list its **skills**
  (`agent_commands` asks its app server, `skills/list`), so those are offered too, tagged `skill` and written `$name`
  as Codex's own box takes them: beside the commands after a slash, alone after a `$`. Picking one leaves `$name ` in
  the box to write the message around; a skill is never sent by itself.
- **Queued messages** (`QueuedMessages`, part of the dock above). One message is a strip: a clock and **Queued** (its tooltip says it
  is sent when the agent finishes, even with the window closed), the message on one line, a chevron. Two or more are a paper
  stack of two lighter sheets under the **first** message, headed "N queued" and ending in "+N". Opened, the stack is a card with a 34px head ("N queued", the
  hint "Sent one at a time, in this order, when Claude finishes") over a numbered list and **Clear all**. A click on a message reads it
  whole (as typed, at most 260px, then it scrolls) and only then shows its actions, as outlined 26px buttons: **Edit** (takes it
  out of the queue and puts its words back in the box, ahead of anything typed there, with its files back as attachments),
  **Send now**, **Move up** (not on the first) and **Remove**. One message is read at a time. A message with files shows them as the chips a sent message has.
  **Send now** interrupts the current step: for an agent in a terminal it types the message into the turn that is running; a chat the daemon runs
  steers it into the turn (Codex) or stops the turn and sends it next (`send_conversation_now`), and answers only once it has taken it. Its refusal is shown under the
  box and the message stays queued; the button is hidden while a question or approval shows and off while its answer is awaited. A local service
  older than the command (protocol 94) is told so in words; another machine's older one cannot be told apart and times out, and the message stays queued either way.
  **Move up** has no daemon command: the daemon's queue only takes a message at its end, so the message and every one after the one above
  it are taken out and queued again in the new order (`moveQueuedUp`); a message the daemon will not let go of stops the move, and one that cannot be queued again goes back in the box.
  A session that failed keeps its queue and says so in a quiet line under it ("This session failed. Your queued messages are kept and go out when it runs again.").
- **Replies and quotes** (`quoteMessage.ts`, `QuoteStubs.tsx`, `chatActions.ts`). Select text in any message and a small floating bar offers **Copy** and **Quote**; hover a message and a quote icon fades in at its top right (the person's own: in the meta line, beside the menu). A quote goes to the **strip above the message box**, never into the draft: one row each (who, one line of the words), up to 5, the same words from the same speaker ignored, a × per row and **Clear** (its room kept with one row, so the second row moves nothing). Quotes go out as ordinary text the agent reads, one blockquote each with an attribution line, above the words (`> Quote from Claude:` then the quoted lines with `> `), a blank line between blocks; a quote is cut at 800 characters. `buildQuoteMessage` writes the format and `parseQuoteMessage` reads it, the one pair, like `attachmentMessage.ts`: only a header at the start of the message or after a blank line, with a quoted line under it, is a quote, and a line of the person's own that looks like one is written with a backslash in front and read back without it. In the sent bubble each quote is a **stub** above the words it comes with, inside the one bubble: a 2px left edge, who it quotes, one line (ellipsis). Pressing a stub finds the nearest earlier message holding the words (`quoteJump.ts`: all of them, else the first line, else the start), scrolls to it, opens a folded block that holds it, and outlines the row 2px in the focus colour for 1.2s (with reduced motion: no outline, only the scroll). A message that is gone says so in a toast. The message queue shows a quote as its first words in curly quotes.
- **Quick reply** (`plainQuestions.ts`, `quickReply.ts`, `ReplyTray.tsx`). When an agent asks in ordinary text, the person answers item by item and the answers go back paired with the questions. **Detection** reads a finished agent message only (never while it is typed in or streaming, never the structured question card, never the person's words): list items (numbered or bulleted) whose words put a question (the last `?` ends them, or a bracket or dash note follows it) and standalone paragraphs ending with `?`. It keeps the agent's own label (`1.`, `Q3:`, `a)`), reads a paragraph that numbers its questions inline as separate ones, and ignores headings, a bold line alone, code, tables, quotes, diffs, `?` inside code or links, one-word questions, rhetorical headlines ("Why this matters?") and paragraphs over 500 characters. **Affordances:** each question shows a quiet **Reply** at its right edge on hover or focus (56px always kept, opacity only; on a device with no hover it shows); two or more questions add one quiet line under the message, "N questions · Reply to each"; one shows only its own Reply. **The tray** opens in the dock slot as the question card does, in the same card (`WaitingCard`, `tone="neutral"`: a quiet `↩` where the amber `!` is, because the agent is not blocked), headed "Reply to N questions" with the agent's name. A row is the number, the question (2 lines, then an ellipsis), and a one-line underline answer (grows with Shift+Enter up to 4 lines); a yes-or-no question (Should, Do, Is, Can, Will, Want and the like, or "or not", but not a choice between two things) offers **Yes** and **No**, and every question offers **Your call**; a chip picked is the pressed one in `--fg` on `--bg`. Opened from one question's Reply, that question has the keys and the others are one line each and stay so while it is open; nothing resizes on focus. The body caps at 46vh (420px) and scrolls, so 20 questions never grow the window. The foot: **Send replies (2 of 3)** (neutral primary, `--fg` fill), **Cancel**, and "Unanswered questions are left out" (or why it cannot send). **Sending** builds ONE message with `buildQuoteMessage`: for each answered question, in order, the question as a quote (with its label), then the answer. It goes by the message box's own send (`sendReply` in `useChatComposer`: queued behind a running turn, held for a starting agent, retried the same way; the box's own text and files are not touched), so the agent reads clean pairs and the chat shows each as a stub above the person's words. If the send does not go, the tray stays with its answers. What was written is kept per message while the window is open: Esc or Cancel closes, reopening restores, a send clears it. A pending request or a prompt from the agent takes the slot first; the tray returns when it is answered.
- **Pane** (`components/PaneCard.tsx`, `pane.css`, `frame.css`). Agents and shells share one 44px header ruled off by
  a `--line` hairline: the 20px flat app icon with its status badge (named "Agent · Status" for screen readers), the
  name (14px, 600; the folder and branch in its tooltip) and a pull request's state (`#45 merged` in `--ok`; once the
  branch has commits after the merged one, `#45 merged · 3 new commits` in `--working`, since work goes on), then at the right the **Chat ·
  Terminal** tabs (agents with a chat; 12.5px 500 `--dim`, the chosen one `--fg` underlined 2px in `--accent`), ⋯ and
  close. Split right, Split down, Maximize, Changes and files and Show or Hide the terminals are in ⋯ and on their
  keys; the header's buttons and ⋯ menu do the side panel and the terminals. Under 360px the tabs go too
  (`model/paneHeader.ts`); Show chat or Show terminal stays in ⋯ and the title keeps its room. The main area is one
  flat card on `--card` with a `--line` hairline, 8px from the window and the sidebar, and a lone pane fills it edge to
  edge; with two or more the shared card goes and each pane is a card of its own (the same `--card` and hairline) and the
  focused one gets a 2px accent line along its top edge, drawn above its content (as the focused terminal split does). A pane's status is the
  badge on its icon; there is no status chip in a corner. While broadcasting, the header says "◉ Broadcast".
- **First-run welcome.** On the first launch (no saved settings and no earlier welcome) a 560px dialog opens
  over a blurred scrim with a progress bar per step: **Welcome** (the same sessions as the TUI, closing never
  stops an agent, and the **New sessions start in** folder, checked before it continues) and **You're set**
  (six keycaps, then **Start a session**). Skip and Esc leave it; global shortcuts are ignored while it is
  open. A window that already has settings is never greeted. Settings › General › **Show the welcome again**
  replays it. The "Bring your TUI setup" step comes with the shared config.
- **Interface size.** Settings › Appearance › Interface size sets the sidebar icon size (Small 0.8, Medium 1,
  Large 1.2 times the session icons), the density (Compact 0.8,
  Comfortable 1, Spacious 1.25 times the row and pane spacing), the sidebar text size and the
  tab text size (12, 13.5, 15 px). They are CSS variables on the window root (`--pad`, `--sidebar-fs`,
  `--tab-fs`, `--icon-scale`), so every size rule that reads one follows it. The docked sidebar's right edge is a
  drag handle (`role=separator`, 208–440 px, default 264): the width follows the pointer and is saved
  on release; arrow keys step 16 px, Home or a double-click resets. The collapsed rail is fixed at 52px.
- **Terminal text.** Settings › Terminal sets, in one Text group of rows, the size (11 to 16), the cursor and its
  blink, the font family, the normal weight
  (Light 300, Regular 400, Medium 500, Semibold 600) and the bold weight (Semibold, Bold 700, Extra bold 800).
  The family is one font name typed or picked from the monospace fonts this computer has (the
  webview cannot list fonts, so a short list of well-known ones is measured against generic families); empty is
  the bundled Geist Mono, which also stands behind a missing font. Names are limited to letters, numbers,
  spaces and `. _ + -`, and a stored value outside that, or a weight outside the lists, reads as the default.
  The settings are `look` fields on the terminal (`fontFamily`, `fontWeight`, `fontWeightBold`, `lib/terminalFont.ts`)
  and are applied to open terminals in place, followed by a refit, never by recreating them. Regular is 400 by
  default; Medium is the fix when Geist Mono looks thin in WebKitGTK on Linux.
  Scrollback keeps 5k, 10k, 50k or 100k lines per pane in the window (maikerd keeps the full history).
- **What a session is using.** The agent the daemon detects (claude, codex, deepseek, ...), else the
  program running in it, else `shell` for a bare shell. Claude, Codex, DeepSeek, Gemini and opencode
  show their own mark on a tile in their own colours, the same in every theme; cargo and rustc have
  the Rust tile; any other name gets its first letter on a colour taken from the name. The marks are
  the LobeHub icon set's (MIT) and stay their owners' trademarks; they say which agent runs, nothing
  more.
- **Anything with a `title`, and every icon-only button, radio or switch**
  (by its `aria-label`), shows a themed tooltip (`HoverTips`), not the browser's: 420 ms after the
  pointer rests, 40 ms when another tip was on screen in the last 400 ms; hidden on a press, a key
  or the wheel; held back while a menu or a rich hover card is open. A trailing `(keys)` becomes
  keycaps and text after ` · ` a muted second line. It sits above the control, below it within 56px
  of the top, and beside it for a control marked `data-tip-side`. A control that opens its own hover
  card carries `data-hovercard` and gets no tip. A working row shows no run time, because the window only
  knows when it first saw the change.
- **Layouts are local, sessions are the daemon's.** A session's split layout (one to four panes in columns, each
  naming a session by id, each column with its relative width and each pane its relative height) is kept in this
  window only, in `localStorage` under `maiker.gui.layout.v3` (`model/layout.ts`, `model/layoutStorage.ts`). Choosing a
  session in the sidebar shows the layout it is in, else one of its own. Split right adds a column beside the focused
  pane, taking half its width; split down a pane under it, taking half its height; they mix. Right-click a pane for its
  menu.
  One pane fills the workspace card; two or more are **separate cards** on the window's ground with a gap between them
  (the workspace card drops its own fill). The layout itself never eases: a pane that is added, closed or resized has its final size at once, because
  easing a split made the terminal re-fit every frame and its text jumped. What the eye sees between the two layouts is the glide below,
  drawn from pictures; dragging a divider has no glide. A terminal pane, header included, is one
  surface (`--main`), with no band where the header ends.
- **Close ends the session, asking first when there is work to lose, with Undo.** The pane's **×**, the pane menu's
  Close session, a row's Close session and Ctrl+Shift+W (⌘W) first open the confirm dialog (`ConfirmCloseDialog`:
  "Close name?", Cancel and a red Close, or "Stop claude" for a running agent; Enter confirms, Esc cancels) unless every
  session in question has already ended or is a shell with nothing running in it, which Undo brings back as it was.
  Closing sends the daemon `CloseSession`: the session leaves the list at once and
  its process runs on for 6 seconds. A toast "Closed name" with **Undo** stays for the same 6 seconds;
  the button or ⌘Z (Ctrl+Shift+Z elsewhere; passed to the terminal when nothing was just closed, and left to a
  text field inside one) sends `UndoClose` and puts the pane back in its place. An agent's own terminals (its
  "New terminal" tabs) end with it and come back with it on Undo; the notice names the agent, not the count. A chat session closes the same way
  (`ConversationClose`): the daemon archives it at once and stops its agent when the 6 seconds pass; Undo
  (`ConversationUndoClose`) brings it back running. Only closing the window leaves sessions running.
- **An agent that ends by itself takes its pane with it.** A pane the desktop app started as an agent runs the agent
  inside a shell, which is left when the agent goes (`/exit`). The daemon ends that pane three seconds after the agent's
  own hook said its session was over (`close_ended_agents`, `AGENT_ENDED_GRACE`), never on a process scan that missed
  the agent, and keeps it when an agent is back by then (`/clear`, `/resume`) or the shell has been typed into since.
  The window takes the pane out of the layout instead of leaving it as an ended one, and ends the terminals the agent
  opened for itself (`useAgentExits`). A shell the person opened and typed an agent into stays a shell; so does a
  terminal app's pane; and a pane that dies with its agent still in it stays as an ended pane, since it may show why. Before
  it closes one, the daemon looks at what runs in the pane: anything but a shell keeps it. Whether a pane began as an
  agent is the daemon's record (`Term::began_as_agent`, saved with the pane and sent as `TermInfo.began_as_agent`), so it
  holds across restarts; it also starts when the process scan has lost the agent for several scans in a row, which covers
  an agent that was killed, crashed or whose resume found nothing. A pane saved before the record is not ended: it lists
  under Terminals like any shell.
- **An agent run by the pane's agent is not the pane's.** When an agent starts another of its kind as a command (a
  headless `claude -p`), that one's hooks report a session starting and ending. The daemon tells it by the processes
  above the reporter (`scan::reports_from_nested_agent`: two programs of the agent's name on the way up to the pane)
  and ignores its reports, so the pane keeps its own session, status and chat. An agent that runs under another
  program's name (`node`) cannot be told this way.
- **A dialog only the terminal shows still stops the chat.** Claude Code opens choosers no hook reports (its "We
  recommend compacting earlier" prompt). The daemon reads them off the screen (`crates/maitty-agent-detection/rules/
  claude.toml`, Maiker's own rules beside the vendored Herdr ones) and says the pane needs you, so the chat shows
  "claude is waiting for you", its box is off until it is answered in the terminal, and nothing queued is typed into it.
- **Hotkeys are keycaps.** Settings › Hotkeys lists them in the same rows as every other page, and draws each key as
  its own flat cap (`--m-raise`, a hairline and a thicker bottom edge, no gradient or highlight; symbols ⌘⇧⌃⌥ in the interface font, other keys in Geist Mono), with a dim "or"
  between alternatives. Windows and Linux show Ctrl, Shift and Alt as words.
- **Hotkeys can be changed.** Each window row ends in **Change** (small `mx-text-button`s, one width so the keycaps
  line up); it turns the keycaps into an accent-ringed "Press the new keys…" field that takes the next combination,
  and Esc cancels it without closing Settings (`KEY_CAPTURE_ATTRIBUTE`, `data-owns-escape`). A key the terminal owns
  (no Ctrl, a plain Ctrl+letter on Windows and Linux, no ⌘ on macOS) or one another action already has is refused in
  `--needs` under the row, naming that action. A changed row adds **Reset**, the card's foot **Reset all**; the
  terminal's own rows (Interrupt, Clear screen) say "Terminal" instead. The choice replaces the action's own keys,
  is saved with the window's settings (`keyOverrides`) and reaches every reader through `KeyOverridesContext`.
- **One key table.** `features/workspace/model/shortcuts.ts` holds every window shortcut once
  (`BINDINGS`); the key handler, tooltips, menu hints, palette, keycaps, Settings › Hotkeys and the
  overlay all read it through `formatShortcut(binding, platform, overrides)`, with the keys chosen in Settings in place. The glyphs are never rewritten in
  the DOM. On macOS the window uses ⌘ and leaves Ctrl to the terminal. On Windows and Linux a plain
  Ctrl+letter always goes to the terminal, so the window uses Ctrl+Shift (T, W, D, F, K, I, B, N,
  J ...); where two actions want the same Ctrl+Shift letter the second takes Ctrl+Alt+Shift (split
  down, broadcast). Ctrl with a non-letter (`,` `.` `/` `[` `]` `=` `1`-`9` Tab) is the window's
  too. A binding with `available: false` is registered but its key does nothing and the overlay
  hides it until the feature lands; none is off now (Undo close is on).
  Jump to the next session that needs you is ⌘J on macOS and Ctrl+Shift+J elsewhere: a bare Ctrl+J is a terminal key.
- **Chat | Terminal toggle.** An agent's pane header carries the toggle, Chat then Terminal. The
  chat covers the pane body while the terminal stays mounted underneath, hidden by `visibility`, so it keeps streaming
  and keeps its size: switching sends nothing to the daemon, except that going to the terminal moves the text waiting
  in the chat box into the agent's prompt (one paste, no Enter; `model/draftCarry.ts`), under the message box's rule: only while
  the agent is idle or done, and not when files are attached. Text typed in the terminal's prompt does not come back to the box. **An agent opens as its chat**; a shell opens as a
  terminal, and stays one when an agent is typed into it (the view tabs still show its chat): only New session opens a chat.
  Every session on this computer, agent or shell, has terminals of its own in its folder, shown in the **terminal
  dock** (`components/TerminalDock.tsx`, layout 2h): one card beside the chat, for the focused session, opened and
  closed by the ⋯ menu's Terminal, its New terminal or ⌃\` (Ctrl+Shift+\` on Windows and Linux,
  where a plain Ctrl key is the shell's), all through one `toggleTerminal`. Whether it is open is the window's, so
  switching chats keeps it open on that chat's terminals. It docks at the **bottom** (`clamp(120px, 100vh − 480px,
  260px)` tall), on the **right** (`min(440px, 45%)` wide) or **full** (the chat steps aside), picked by the three
  icons in its bar or Settings › Terminal › Panes › Terminals open in; a dragged edge keeps its own size
  (`model/terminalDock.ts`, at most 60% of the room) and a double-click puts the design's back. It slides in from its
  side on `--panel-in` and out on `--panel-out`. The dock is a card in the shell's shape (`.mx-tdock` in `material.css`: 12px
  cut top-left and bottom-right in Folded, with the WebKit clip-path fallback and its full border along the cuts; rounded or
  square otherwise), and **the terminal fills it edge to edge**: the bar sits on `--main`, one `--line` hairline under it,
  and everything below is one opaque `--term` ground (a see-through ground costs a blend per repaint, PERFORMANCE) with
  `--tdock-pad` (8px 12px) of text inset. No frame, ring or inner box around a terminal; shells of a split are told apart by
  one hairline between them, and the focused one of several by a 2px accent line along its top. Its 44px bar: mono tabs
  "shell", "shell 2" with an accent `>_` (each tab is a 5px-cut control; the picked one has the `--m-hover` fill and a `--line2`
  edge). Every tab holds the room of its × at all times: the × is 18px, always there, and only its opacity changes (shown on the
  picked tab, on hover and on focus; it stays reachable by keyboard), so no tab changes width when picked or hovered; × ends the tab's shells), **+** for another tab, the folder in mono, Split right, Split down, the dock
  choice, then hide and close; under 600px wide the folder goes, and under 380px the split and dock buttons fold into
  one **Split and dock** menu. A tab splits into up to four shells in columns and rows (`model/terminalTabs.ts`),
  each a shell of its own with a focus ring and its own ×; the keys go to the dock's focused shell from a click in it
  until a pane is clicked. A session with no terminal gets one when the dock opens for it, once; closing the last
  leaves a note with **New terminal**. The terminals are tabs of the session, not rows of the sidebar; which shell
  is whose, and how they are split, is the window's own memory (`data/agentTerminals.ts`, `data/terminalTabs.ts`),
  so the terminal app lists them as sessions, and one whose agent is gone is a row again. Closing the dock only
  hides them.
  Settings › Chat › Chat view picks the view each of Claude and
  Codex opens in (Chat by default). A shell, an unsupported agent or a session on another machine shows the chat
  card's empty state, "Chat view is for agent sessions", with the reason and the ways to start one.
  Changing the view, or switching between sessions, plays no animation.
- **Chat session ([ADR 0003](adr/0003-status-and-conversation-trust.md)).** A row and pane like any session, with the
  agent's mark and its branch line. Its pane has no terminal | chat switch; the pane is the chat. The approvals
  (y / a / n), user-input form, Stop and the daemon's queue are the chat's own.
- **Chat body** (`features/chat/chat.css`). A 760px centred column, 20px in, rows 16px apart, under a 36px fade at its
  top. The scroller is as wide as the column, so its scrollbar sits at the column's edge and not the pane's, and the jump-to-latest button is centred over the column; the wheel still scrolls the chat from the empty room beside it. A message you send moves to the top of the view, just under the fade, and the reply is drawn under it (see UI, *List*). Every card in the feed is the shared **Card** (a hairline, `--card`, no shadow; head 36px, body 10/12, foot 40px), every colour a token. Your messages are right-aligned bubbles (`--bubble`, a `--line` hairline, padding 9/13, 14/1.55, at most `min(560px, 85%)`), attachments above and a meta line under it (the time and the ⋯ menu); one still sending is at 60% with "Sending…".
  An agent's reply has no avatar: its lead sentence at 400 in `--fg` (the first sentence, kept whole: a full stop after e.g., i.e. or etc. does not end it, and a cut inside `code` or **bold** makes the whole first paragraph the lead), the rest in `--fg2` at 14.5/1.65, 10px between
  blocks, as rich text (headings 22 / 18 / 16 / 14.5 / 13 / 12, lists indented 20 and 22 with 4px between items, a quote
  with a 2px `--line2` rule, inline code as a **CodeChip**, a link in `--link`, a file's name in the text as inline code tinted in its type's `--tag-*` colour (Chat setting **Colour file names**, on by default; off leaves it plain), never a file badge or type tag before it). A code
  block is a card (language, **Copy**, **Save**; numbered lines in a 36px gutter on `--well`, folded past 24 lines). A
  table is a card (**Table**, "N rows", **Copy**, **Save as** Markdown / CSV / HTML; cells never wrap, numbers right-aligned, a wide table scrolls sideways).
  **A step** is a 30px row, gap 9: its **StatusMark** (14px), a verb at 13/600, what it acted on in mono 12.5 (cut at
  the end), how it ended in mono 11.5 `--dim` at the right, and a caret; it opens to its detail. The step a pending
  request is about is the only one in amber: a 9% `--needs` tint, a 2px left edge and "waiting for you ↓". A file is a
  badge (type tag, folder in `--dim`, name in `--fg`, cut from the front so the name stays). A **command on its own**
  is a card: its mark, `$` and the command, an exit tag ("exit 0" in `--done`, "exit 1" in `--err`), the time and
  **Copy command** in the head, and the last 6 lines of output on `--well` with "Show all N lines"; a failed one has the
  `--err` edge. An **edit on its own** is a card: its mark, the file name, the change tag, +A −R and
  **Open in side panel** in the head, and the diff below (open from the start; line numbers in a 36px gutter, a sign column, added lines
  tinted `--done` at 13%, removed `--err` at 13%, syntax colours from `--code-*`, folded past 12 lines); a secret file,
  a diff too large to show and a file still being written each say so in the well instead. A Markdown file the agent
  wrote is a **document card** (the file name and "wrote N lines", **Read** and **Copy** in the head, its title and first
  lines formatted, at most 150px with a fade), not a diff. **A run of steps** is a card whose head says what it did
  ("Read 2 files, edited 3, ran 1 command", 13/600) with its time and a caret, over its latest 3 steps as rows and a
  "+N more" line; the head opens every step. A failed step sits on a 7% `--err` ground. **The plan** is a card: "Plan",
  "2 of 5 done", a 120px **Progress** bar, and 26px rows (done struck through in `--muted`, the current one bold with
  "in progress", each with a 14px box). **Helper agents** are 40px rows (the agent's tile with a status badge, name,
  type, what it was asked, the time); several share a card, "3 agents · 1 working · 2 done", with hairlines between
  rows. **Thought** is one quiet italic 26px line in `--dim` that opens to the reasoning, ruled on its left in
  `--line2`. A helper's report is one line, "↳ summary · time", the summary cut short. A request answered earlier
  folds into one line, "Allowed", "Allowed for this session" or "Denied". A turn ends with a divider (centred words
  between hairlines, "Finished in 3m 40s · 10:46"; failed in `--err` and stopped in `--dim`, each with its mark; a
  turn the person stopped in the terminal is "Stopped after …", never a bubble of Claude's "[Request interrupted…]") and,
  when it edited files, the changed-files card (a head-only card: icon, "N changed files", +A −R, **Review**). card. While the agent works the chat shows the turn as it arrives and the live box at its end (see *The live box*). Problems with the history (offline, incomplete, a provider error) and Full access show in one
  slim strip above the list. **A subagent's chat** replaces the list with a 36px bar on `--well` (**‹ Main session**,
  "· Subagent", its name, its time in mono and a **read-only** tag), then the helper's own steps drawn as the chat's rows (read from the record its agent keeps, every 1.5 s while it
  works, "Its earlier steps are not shown." above them when the start was cut). Where there is no record (another
  machine, an older service, another agent) it shows what it was asked, what it is doing while it works and its report
  once done.
- **Message box** (`features/chat/components/Composer.tsx`), in three layers. **1. The waiting card** (`WaitingCard`), only while the
  agent waits on you, one at a time and the oldest first: a card 24px narrower than the box, open at its bottom so it
  rises out of the box's top (10px over 0.2s; it simply appears with motion reduced), with the needs edge. Its head is the needs
  mark and what is asked ("Wants to run a command", "Approve this plan?", "claude has a question for you") with the
  agent or "Plan mode" quiet at the right; its body the command on `--well`, the files as badges, the plan formatted
  as a reply, the question's choices as boxes with their number keys (the picked one on a 9% needs tint and the needs
  edge) or the agent's own menu in mono with its selected line tinted; its foot the answers: **Yes once** `y` in the
  needs colour, **This session** `a` and **No** `n` soft, and for a command request **Always in this project** as a
  ghost at the right (the daemon then approves that exact command in that project without asking; see ADR 0005).
  Settings → Permissions lists these under "Commands approved for a project" (`ApprovedCommands.tsx`), each with **Forget**.
  A plan has Claude's own menu, each choice on its number, and **Keep planning** `n` (no `y`: the menu has no single yes); a form **Send answer(s)** `⏎`; a menu its keys. y, a and n
  answer from anywhere in the chat but a field, a choice's number picks it, and Enter on the card gives its main
  answer. Answering removes it, the box unlocks and the agent is working again (its row and the badge follow the
  daemon); the request then folds into one line in the feed (a hairline row: its mark, "Allowed for this session",
  and **Go to step ↑**). **2. The box**: flat
  (`--main`, a `--line2` border, radius `--r-panel`; focused, a `--focus` border and 1px ring), a two-line text box on top, **+**
  (attach) at the left, and at the right the model picker ("Claude Sonnet 5.5 · Medium ▾": the agent's mark, the model
  picked or the one its own file says, the effort) and the 32px send button (radius `--r-control`), in the accent when it can send and grey while
  a question waits. While the agent works and nothing is typed, the send button is the Stop square, still (the line over the
  box says the agent is at work, so the button does not spin); just after a send, before there is a turn to stop, the
  square is there and off.
  Claude's model chip and mode chip are always there, from the first frame of a new chat: while the agent starts or works they
  stay where they are, greyed out with the reason as their tooltip, so the box never gains or loses a control. A chat that
  follows another agent (Codex, Gemini) draws its model label from the start, with just the agent's name until it says its
  model. The "agent has not reported" hint of a starting chat floats over the conversation and moves nothing. Placeholders: "Message the agent, or type / for commands" ("Reply to the plan…" in Plan mode), "Queue a
  message for when claude finishes" while it works, "Answer the request above first" (and off, with the focus on the question
  when it takes keys, never on one answered only by a click) while a question waits, "The daemon is offline" (still typeable) while it is. **3. The bottom row** (see *The message box*): the permission mode's menu is headed PERMISSIONS with the agent's name and has a row a mode, each with a line saying what it does; a new Codex chat has Read only, Auto and Full access instead. It does not list subagents: the sidebar and the helpers line do. Queued messages sit above in the dock (see *Queued messages*). The box's whole border turns `--accent` on focus, with no second ring; attach (top right) and send are both 32px and share the box's right edge; the meters at the right are neutral (`--fg2` ring, `--muted` mono figure, never a status colour), 12px, square under Square and Folded and a circle under Rounded.
- **Esc ladder.** Esc closes the topmost open layer and reaches the terminal only when none is
  open (`model/escLadder.ts`): What's new, palette, Settings, the sidebar drawer,
  Focus mode. A new dialog adds its id there.
- **Jump to next (⌘J, Ctrl+Shift+J).** Opens the next session that needs you, in creation order across every machine
  (`features/needs-you/model/needsYou.ts`), with the toast "Needs you · name · 1 of 2"; with nothing needing you it
  only shows "Nothing needs you".
- **Command palette (⌘K).** A 600px card 12% from the top over a dimmed scrim: type a few letters to jump to a
  chat, project, action or theme (themes only once something is typed). Results are grouped under **Chats** (most
  urgent first, each named as its row is with its agent and project, "Needs you" in amber), **Actions** (themes too)
  and **Projects**, each row with a 22px mark (a chat, an action, a folder) and its keys as a keycap. A
  run of the typed text ranks above letters that merely appear in order; ↑ ↓ move, ↵ runs, Esc closes. Three or more
  typed characters also search what this computer's sessions printed recently (`search_panes`, the same search as
  Find's *All sessions*; a session on another machine is not searched), 300 ms after typing pauses, one search at a
  time (a query typed while one runs waits, and only the newest is sent): up to 10 hits, one per session (its newest
  matching line), follow everything else in an IN SESSIONS group, each the session's name and the line in mono, cleaned
  of escape codes, control and bidirectional characters and cut to 60 cells with 16 before the match. Choosing one
  opens that session (it does not scroll to the line). An answer for an older query is dropped, and a failed search
  adds nothing.
- **No Inbox.** What needs you, what stopped and what finished are the first sections of the sidebar's status list, and
  the notification card and the tray menu say the same; the desktop app has no separate Inbox panel.
- **Session header** (`PaneCard.tsx`, `pane.css`; 52px, two lines). Left: the 14px status icon (`StatusIcon`: `--needs` `!`, the running light, `✓`, `×`, a dim `–`),
  the session's name (14px 600; one click turns it into a field, Enter or leaving saves, Esc cancels), and under it the folder (the locked folder for a
  chat with a worktree of its own, a plain one otherwise), the project in `--muted`, `/`, the branch in mono `--branch` as a button
  with a chevron that opens "Branch in <project>", and, for a session on another machine, `· machine`. A plain shell has one line, `zsh · <cwd>`, and nothing else until an agent starts in it.
  The header is a size container: under 700px the project goes, under 560px the branch's name and the machine. Right: the **Chat | Terminal** toggle (a data-fold segmented frame, a 13px mark and the word in each), the
  **Changes** button (two joined branches) with a count badge of the changed files, a **Files** button and the **⋯** menu (Changes, Files, History, Checks, Terminal, then split, rename and the pane's other entries). There is no PR chip (the pull
  request is in the row's hover card and Checks), no replay control and no model name.
- **New session draft.** A chat that has not been sent, in the main area (`position: absolute; inset: 0` over the panes, `--main`, opaque), never a float or a scrim. The header is a session pane's own (52px, `.mx-pane-head`), and its chips stand where a session's name and crumbs are: **Where**: the Machine, Project and Branch tokens and the **Own worktree** chip on one 36px line (28px tokens, 13px text, a 9px chevron, `/` between them; each opens a 320px list with a 34px head that names the token, a 32px search and 32px rows; the Project list is headed **Recent** and ends in **Open folder…**, **Clone from link…** and **My GitHub repos…**, the Machine list in **Add a machine…**; a machine that is down is a dimmed row with its reason under the name and a "not reachable" tag, and as the current machine its token turns to the warning colour; the Branch token has a width of its own, 148px that gives up room first; it is always drawn: in a folder that is no git repository, while it is read, and on another machine it is a quiet `--dim` chip with no hover that reads `no git repo`, `reading…` or `not read here`, the reason in its tooltip. **Own worktree** is a 28px chip with a hairline edge after the Branch token: the shared Switch, the words Own worktree and its state in 11.5px (`Auto`, `Auto: on`, `On`, `Off`; the edge and the word take `--fg` while a worktree will be made); dimmed with the Switch disabled when there is no git repository, with the reason in its tooltip), and at the right a × (absent on the home screen). Below it the chat's own empty line ("No messages yet. Write the first one below to start the session.", the 13px `--dim` line an empty session shows) sits above the chat's own message box (`mx-composer`: attach at its top right, 2 rows). The box's foot is **Who**: the agent dropdown (the agent's mark, name, model and effort in one button, `Claude · Sonnet 5.5 · Medium`), the **permission chip** (a small pill in the muted colour, `Permissions: Bypass permissions` in the danger colour while it skips prompts), a 28px **More options** button (three dots) that opens a popover below it with the **Skip permission prompts** switch and a 12px line saying what it does, and the round send button at the right. Under the box are two 12px muted lines (Gemini: "Gemini has no chat view yet, so this session opens in its terminal."; and the keys: Enter starts, Shift+Enter is a new line, Ctrl Shift ↵ starts it in the background), then the notes: the worktree line, a clone in progress or its failure (with **Use it**, **Pick another folder** or **Open GitHub settings**), a failed start, a failed background start or a missing agent. There is no Chat | Terminal control: Settings decides the opening view. While it starts, the title is replaced by the message sent and the **Starting <agent>…** card with the agent's working mark, the same card the session's pane draws, and the box is locked. The dropdown's menu opens downward from the button's left edge (up only when there is no room below; never taller than the room there is), clear of the message box, and has an **Agent** list (flat marks, the current one ticked, typing a letter jumps to an agent), the **Model** rows and **Reasoning** as the one Segmented; it stays open while the agent, model or effort is changed and closes on Esc, Enter or a click outside. Each agent keeps its own model and effort while the draft is open, and the last agent and choices are the next default. Under 768px wide the foot wraps and the agent has its own row. Focus is the 2px accent underline on every control. Agent marks are bare glyphs with no tile. Token lists sit above the page (z-index 95).
- **Open a folder picker.** 580px, the same float. A 46px head ("Open a folder on" and the machine dropdown, 14px 600), a 34px filter field, a 24px path row (up button, mono crumbs, and **New folder** at the right: a quiet 11.5px text button with a plus; disabled at 45% opacity with a note under the row when the machine's service is older), then a 300px list of 30px folder rows (name, a mono `--dim` branch, an enter chevron). **New folder** opens a 34px field at the top of the list on `--m-well` with a folder mark, mono 13px text, the hint "↵ Create · Esc" (hidden under 420px) and the accent underline while focused; a problem is one 11.5px `--danger` line under it. Hover and focus change colour and the underline only; nothing moves. The foot is 50px: the Hidden folders switch at the left, Cancel and **Open <name> ↵** at the right. The M loader shows while a machine is read for more than 160 ms; an asleep machine shows an amber dot and a sentence instead of a list.
- **New session draft on another machine.** The same draft as on this computer, with the machine in its Machine token: its projects, a pasted path, **Open a folder…** (the folder picker on that machine), no branch list, no attach or warm-agent controls, an **Own worktree** chip (made on that machine on a new two-word branch) and a Branch chip that reads `not read here`, and a model button with the agent switch, the fixed models (Default, Fable, Opus, Sonnet, Haiku for Claude) and the effort.
- **Focus mode (⌘.).** Hides the sidebar; a pill at the bottom says where you are and
  how many sessions need you elsewhere. Esc or the pill's Exit leaves it.
- **Broadcast (⌘⇧B).** Per layout. While on, every pane of the layout has a violet outline and a
  "Broadcast" pill, and what is typed in one pane is also typed into the layout's **idle** panes.
  A pane running something is skipped, so it never types into a busy agent.
- **Pane resize.** The gap between two columns drags (180px minimum, snaps to an even split,
  double-click resets). Widths are saved with the layout and reset when its columns change.
- **Drag a session into a pane.** Any sidebar row drags onto a pane: in the same layout it
  swaps, in another layout it moves here, otherwise it replaces the pane's session. The session that
  leaves keeps running.
- **Files dropped on a pane of another machine.** One progress toast (see *Errors*): the title `Sending <file> to <machine>`, with
  `(2 of 3)` for a drop of several, a thin `role="progressbar"` named `Sending <file>`, and the action
  **Cancel**. It has no close mark while it runs. It is then replaced in place by a success, error or
  note toast. See UI › *features that need a pane's files*.
- **A pasted image.** The same toast, titled `Sending the image to <machine>` (a progress bar named
  `Sending image`, **Cancel**), ending as `Sent the image to <machine>`. For a pane of this computer there is
  no progress: a short `Saving the image…` toast becomes `Pasted the image`.
- **Side panel** (⌘I, the header's Changes and Files buttons, the ⋯ menu, a session's Show changes;
  `features/inspect/InspectPanel.tsx`, `WorkspaceSidePanel.tsx`; layout 2h). It is docked beside the chat column
  and the chat narrows to make room; there is no scrim. A card on `--main` with a `--line` hairline,
  680px at first and at most 58% of the window; its inner edge drags (360 to 1100px) and the width is remembered (a
  double-click goes back to 680). It slides in and out over `--panel-in`/`--panel-out`. Its 40px header is the view's
  icon and name, its count (changed files; `✕N` in `--danger` for checks that want you) and × (Esc too, except in a
  terminal, where Esc is the program's). The header's buttons and the ⋯ menu pick the view: **Changes**, **Files**, **History** or
  **Checks**; a shell's further terminals still open here.
  Files reads the focused session's top folder before the panel opens; while a list or a file is still being read
  it shows still bars in its place, never the word "Loading". **References** is the first entry of the Files tree and
  opens as `Files › References`. **History** is a segmented control: **Snapshots** (the commit log and the agent's
  snapshots; snapshots that cannot be read are said, with Try again, above the commits) and **Status log** (what the
  pane reported lately, "Why the status changed"). A session's own terminals are in the terminal dock, not here.
  **Changes** has a top bar: the branch (a menu of the others with a ✓ on the current one, for a checkout on this
  computer), `↑a ↓b` against its upstream, and the remote as a split button (below). Under it a select-all row ("N
  changed", the totals), then two columns: the changed files (a tick, a letter for added, modified or deleted, the name
  over its folder, the lines added and removed) and the picked file's path, what happened to it, and its diff with both
  line numbers and without git's header lines. The commit area runs across the panel under both. With nothing changed
  it says "No changes yet" and that the agent's edits show up there. A chat session has no pane to ask about its
  repository, so the repository views appear for it once it has a terminal.
  **Checks** opens with "After every turn · N checks" and **Run all** (runs again every check that can), then lists
  what the repository's checks said about the agent's last turns: each check's command, its state in
  words (Running, Passed, Failed, Accepted as it is, Could not run, Needs your approval, …) and the first failing
  line, with **Run again**, **Accept the failure…** (a reason, up to 280 characters; **Undo accept** takes it
  back), **Run once / Always run this / Never run** for a command the repository brought, and **Output** for the
  tail of its last run (on another machine's session it says the output is local-only instead) (`ChecksTab.tsx`,
  `checks.ts`). Changes lists the
  changed files (`+N −N`) and the picked file's diff (added lines tinted with `--ok`, removed with `--danger`, hunk
  headers in the accent), with line numbers drawn beside it. For an agent, a click on a code line opens a comment box
  under it with **Send to Claude** (the agent's name; Ctrl/⌘+Enter sends, Esc closes the box); the comment goes to the
  agent as a message naming the file, the line and its text (`model/agentMessage.ts`), and stays pinned under the line as an accent-tinted "You → Claude" box, also while other files are read; the file's header then counts the comments. The chat draws the comment at once, like a message typed in its box (`outsideSends.ts`). An
  agent that is asking something is not sent one. Under the file list, for a checkout on this computer, is the commit
  message (first the session's name, else the first line of its last prompt; "Summary on the first line, then details",
  Ctrl/⌘+Enter commits), **Commit N files** (every changed file has a tick, all ticked at first; only the ticked ones are
  committed, "Commit k of N files", "Tick files to commit" with none), **Create PR** (pushes the branch and runs
  `gh pr create --fill`; "✓ Opened pull request #N · address" stays under the buttons) and **Suggest a message**
  (`commitText.ts` drafts one from the ticked files). The **remote split button** in the top bar follows where the
  branch stands against its upstream: **Pull N** when it is behind (fast-forward only), **Push N** when it is ahead,
  **Fetch** when it is level; when it is both ahead and behind it is disabled and its tooltip says why
  (`remoteAction.ts`); its ▾ offers Pull, Push and Fetch, each with a line on what it does (`ChangesBar.tsx`). What git or `gh` said
  is shown when any of them fails (`CommitBar.tsx`, `src-tauri/src/changes.rs`).
  A worktree whose folder was deleted by hand reads "its folder is gone" in the worktree manager with **Recreate**, which
  makes it again on its branch at the same place. Each row's standing comes from the daemon (`worktree_standing`), and one
  idle past `worktree.inactive_days` leads with "inactive N days". The same list opens with a line when two checkouts changed one file ("orders and rate-limit both changed checkout.ts"; the comparison is `maitty_shared::overlap`, shared with the terminal client). A pane's menu has **Hand off to <agent>** for an agent's pane: a new
  session of the other agent in the same folder starts with the text brief `maiker handoff` writes (`maitty_shared::handoff`; the
  desktop lists only uncommitted files and says so). The one other thing the panel
  changes is a file: **Edit** in the Files tab (this computer only, never in a diff) replaces an existing file whole;
  **Save** (Ctrl+S) first re-reads it and asks before overwriting a file that changed since the edit began. The daemon
  refuses links, `.git`, new files and anything over 256 KiB (`WriteFile`). In the History tab, **Restore** on a
  snapshot asks first and is disabled while the agent works, and **Compare** picks two entries. A tab that cannot load shows one calm
  screen with Try again. A folder that is not a git project says so.
  **Files** (`FilesTab.tsx`) lists the changed files first (**Changed**, each with its A, M or D mark), then the tree
  (**All files**): a file carries a type tag (`fileTag.ts`: TS, TSX, `{ }`, MD…) and its mark when changed, a folder a
  dot when it holds a changed file. It opens on the first changed file, else the README. A changed file shows its diff
  under a 44px bar with **Show the whole file**; a link to a line opens the whole file at that line.
- **Quick-look links.** ⌘-click (Ctrl-click elsewhere) on a file name in a pane's output, with an
  optional `:line`, opens it in Inspect › Files at that line. A name that is not a file in the
  pane's repository says so in a toast.
- **Find (⌘F).** A bar over the top right of the panes. **Pane** looks in the focused pane's
  scrollback (Enter next, Shift+Enter previous), or, when the pane shows its chat, in the conversation:
  the row that holds the text is scrolled to and marked, starting from the newest; **All sessions** lists lines from every session's
  recent output, and a click shows that session.
- **Worktrees (⌘⇧N).** The New worktree dialog names a branch and what to start it from (an
  existing branch is checked out instead), then opens a session in the new folder in a new tab. A
  project's right-click menu has a **Worktrees** submenu that opens a shell in any of the repo's
  worktrees, and a **New worktree…** row. The dialog also lists the project's other worktrees with where each stands
  ("merged, nothing uncommitted", "3 uncommitted changes", "not merged anywhere"), each with **Merge** (its committed
  work into the main checkout's branch, no fast-forward; refused while either side has uncommitted changes, and a
  conflict leaves the main checkout as it was) and **Remove** (removes the folder, but not one something still runs in, so close its sessions first;
  it asks again first when that would lose changes or unmerged commits). This computer's worktrees only
  (`WorktreeManager.tsx`, `src-tauri/src/worktrees.rs`). Worktrees group under their parent repo. A folder's row shows
  only its name: a branch belongs to a session, and a worktree's branch is not the folder's.
- **Branch or worktree.** A session in the project's own folder shows its branch in `--branch` (violet: #A78BFA on a dark ground, #6B46C1 on a light one, set by `themeStyle`; every branch name and icon uses it) with the branch mark;
  one in a linked worktree (the daemon's `TermInfo.linked`, never worked out from the folder) shows it in `--branch`
  with a tree, on its sidebar row, and its pane header's branch crumb. The tooltip says which.
- **A session whose agent asks for a secret** (`maiker_request_secret`) shows a bar across the top of its pane with the
  label and the reason the agent gave, and **Provide…** (a masked box; Enter gives it) and **Decline**. The value goes
  from that box to the daemon and nowhere else: it is not kept in the window's state and not shown in the chat, and the
  agent gets a single-use reference (ADR 0006, `SecretAskBar.tsx`). This computer's sessions only.
- **A session that asks to start helpers** shows a bar across the top of its pane, in the needs-you colour: "Wants to start N helpers", the
  tasks, and **Allow** (this session, from now on), **Always in this project** and **No**. It is the only place the desktop app
  answers that request, and it stays until the daemon says the request is answered.
- **Ended panes.** A pane never disappears because a refresh missed its session or the session ended: it
  stays in its tab with its output, the tab keeps its name, and a card along the bottom says **Session
  ended** with **Restart shell** (a new shell in the same folder, in the same place) and **Close pane**
  (which stops nothing). Only the first list after launch drops panes of sessions that died while the app
  was closed. The sidebar lists the sessions the daemon lists. A row goes at once when the daemon says why it
  left (closed, exited, put away, moved, the daemon stopping, or a reason it did not record) or this window
  closed it; a row a list leaves out with no reason stays, shown as unknown, until a full list read from the
  daemon confirms it is gone, so a daemon restarting under the app makes no row flicker out.
- **Switching sessions.** A pane shows at once: the last screen it had (kept in memory per session,
  `features/terminal/screenCache.ts`, bounded in size and count) or the replay in one write per frame. A
  pane on this computer never shows a spinner, overlay or "Connecting" text. A pane on another machine
  that has not attached after 300 ms shows a 24 px strip under the pane header (spinner, **Catching up
  from <machine> · N ms**, a 2 px progress line on its top edge) that sits in the flow, never over the
  terminal, and goes when the stream is live. A real failure keeps its banner; it is not a loading state.
  The two tabs shown last stay mounted behind the one showing (`model/keptTabs.ts`, at most eight panes
  between them, since each terminal holds a GPU context): the same box, not painted, `inert` and hidden from
  screen readers, their terminals paused and their chats unmounted, so going back builds no terminal and a
  hidden chat reads nothing and answers no key. A paused terminal catches up from the kept screen when shown.
- **Cards in the chat** (a command and its output, a diff, a code block, a table, the plan, helpers). Each is the
  shared Card: solid `--card`, a 1px `--line` hairline, no shadow, wells (output, diffs, code) on `--well` flush
  inside it. The point is that a card reads as an object in the conversation, and the feed stays quiet: colour is for
  state, and amber only for what needs you.
- **Sending scrolls to your message.** The chat never clears. A message you send stands 16px from the top of the view
  (`SEND_TOP_GAP_PX` plus the row's own 8px) with empty room under it (`sendSpacer`) so this holds even when the reply is
  short; the room shrinks as the reply grows, and once the reply is taller than the view the view follows its end. A chat
  opens on its newest row and **follows it while the view is at the end**, so a turn that streams in stays in sight. Any
  move up by the reader lets go at once and nothing then moves the view but them ("Jump to the latest message", or
  scrolling back down to the end, takes it again). Queuing a message while the agent works does not move the view (the
  message is in the dock, not the chat).
- **The live box.** While the agent works the turn ends in one frameless, quiet line (`LiveBox`, `role="status"`): no
  border, no background, no header bar. One 28px line with the 12px running light, "Working for 12s" (12.5px `--muted`, the
  time in mono) and "Esc to stop" (11.5px `--dim`) at the right. Until the turn has drawn a row of its own, a skeleton of
  three bars (92, 80 and 56%, `.mx-sk`, a 1.6s shimmer that is static under Reduce motion) under the line holds the place
  the first row will take (`placeholder` on the working row); it goes when that row comes. The step the agent is on is said
  only to screen readers. **Deliberate deviation from the prototype**, which frames this as a bordered card with a step row.
- **Chat blocks follow the Maiker Desktop prototype, not Chat Feed.dc.html** (the older spec). Your message is a plain bubble
  (no border, `--fg` 7% over `--main`, 14.5px/1.6, 10px 14px); the agent's reply is plain 14.5/1.65 text with its first
  paragraph in `--fg` and the rest `--fg2`, nothing bold unless written so. A command, a diff and a code block are one `Block`
  (`--well`, `--line` hairline, `data-fold`, a 34px head with a chevron that turns). A command head reads `$ command` and, at the
  right, "exit 1 · 2.9s" (red when it failed; a provider with no exit code shows only the time, and a screen reader hears "exit
  code not reported"); a failed block has a 2px red left edge; there is no check mark, chip or copy icon (Copy is a text button
  once open). A diff has old and new number columns (34px), a 14px sign and 10% red/green rows. A note (a `>` quote) is the well with a
  2px `--needs` edge and a bold lead. A list uses dim bullets; a table has no box (title row, Copy, rules under the head and
  rows). A turn ends in one quiet footer line ("✓ Finished in 2m 4s", × red when failed), the files it changed are 26px chips. An
  agent's mark in the chat (model chip, picker) is a flat glyph in its own colour with no tile. A run row keeps its ✱ and wears a red
  edge and the word "failed" when a step failed; inside it, steps are ✓ (quiet) or × (red) rows.
- **A run of steps is one row** (`WorkCard`): "Read 6 files, ran 1 command", a "6 steps" chip and a chevron on the `--well`
  ground; opened it lists the steps, and only one step is open at a time. There is no "latest 3" and no "+N more".
- **Action cards** (`WaitingCard`, Needs Card in the design) are floating cards the width of the message box: `--main`, a
  `--line2` border, the shared `--pop-sh`, 14px folded corners (`data-float`), an amber `!` and an amber primary
  button, rising in over 0.2s. A question card shows one question at a time: tabs with an amber underline, numbered answers
  with no boxes (1 to 9 pick, ↑↓ move, ←→ question, Enter next), a ruled free-text line, and "Skip" / "Next ↵" (the last one
  "Send answers (N left)").
- **Jump to the latest message.** The round arrow over the chat glides to the newest row instead of cutting to it
  (0.18 to 0.42s by distance, easing in; `glidePlan`). From far up it starts two screens above the bottom, so a long
  chat is not drawn on the way. The reader's own wheel, key or touch ends the glide where it is, and with motion
  reduced it is a plain jump.
- **A session's row.** The agent's tile and status badge at the left. To its right, two lines. First, small and
  dim, where the session is: the project's colour square and folder at the left, and at the right the branch in mono
  in the theme's magenta with the branch mark, or the tree and the branch in blue when it runs in a worktree. Under
  it the title, with the time or the stop word at its right. Inside a project group the folder is in the heading, so
  the first line is the branch alone, and a session with neither has only its title (`SessionRow.tsx`, `PlaceLine`).
  Only a session on another machine, outside that machine's heading, has `· machine` after the folder, and only then is
  the branch held to 58% of the line; otherwise it takes all the folder leaves, cut with `…` and its full name in the
  tooltip.
  The close button shows on hover over the time.
- **Rows slide, folds fold, never both.** A row that changes place slides there (`useFlip`). A section folding
  moves what is under it by itself, so while a fold runs nothing slides, and where things
  are when it ends is where the next slide starts from; the two together made the list bounce.
- **Sidebar footer and updates.** The footer's left slot is empty until an update needs you, then it is one 28px icon
  button (`UpdateSlot`): a download icon with a 5px accent dot while a release waits; a running light while it downloads; a restart icon once it is
  downloaded; the icon in `--danger` when the update failed. A card beside it (300px, `role="tooltip"`, opens on hover or focus, grows from the button's corner)
  says **Update ready** with `v0.45.2 → v0.46.0` in mono, a short **What's new** (the release's first lines) and "Click to download · installs on restart"; while it downloads the card shows the bar, what has arrived
  of the whole (`34.9 MB of 102 MB`) and, on the right, the percent and the time left from the last ten seconds' speed (`about 12 min left`, `downloadEta.ts`); once downloaded it says **Restart to finish** and "Click to restart · chats keep running"; a failure
  shows the real error with **Copy details** and "Click to retry". The click does the next step (download, nothing while it downloads, restart, retry); **Skip this version** is on the card of an available update, and a skipped release gets no button. Settings shows the same bar and line under its update row while a download runs, with the percent on its button (`DownloadProgress`); a light passes along the bar, and with no size yet a short run slides across, so it never reads as stuck. The updater downloads first and installs only on
  **Restart now**, or by itself when the app is idle, so sessions keep running either way. Settings › General › Updates shows the state with
  one fitting button and four switches: download automatically (on), **Install updates when idle** (on, helper
  "Never while an agent is working"), **Restart the service when idle** (off; helper "After an update, an older service restarts by itself once no agent is working, waiting on you or starting. Sessions come back.") and **Update remote machines too** (on, shared with the terminal app's
  General › Updates row). Right after the app restarts into an update, an older service is restarted as part of that
  update at the same quiet moment, with no second question, whatever the service switch says. Idle means no agent working or waiting on an answer, no keyboard input
  for 5 minutes, and the window unfocused or minimized. After the relaunch
  a success toast "Updated to X" with **What’s new** for 4 s (dismissable), and What's new opens a 460 px dialog with the release's
  notes and "No session was interrupted."
- **Sidebar position.** Settings › Appearance › Sidebar position, or the palette, puts the sidebar
  on the left or right. On the right the window mirrors: the resize edge is on its left, the narrow-window
  overlay slides from the right, Inspect opens from the left, and popovers open toward the middle.
- **Notifications.** Settings › Notifications has one switch each for needs you, done and error. With
  one on, a session that changes to that state while you are not looking at it (the window is in the
  background, or it is not the focused pane) sends a system notification, once per change. It names
  the session and where it is and never what the agent asked. Clicking it brings the window forward
  and shows that session. Opening the app, a session you are in, and a reconnect after the daemon
  was unreachable send nothing. The in-window toast follows the state: green for done, amber
  for needs you, red for an error. It always sits bottom right; Settings › Notifications can show a test.
- **Interrupted agents.** When the daemon restarted while an agent was mid-turn, its chat asks
  about it (see *Errors*, chat problem): which agent and the command that brings it back
  (`codex resume --last`). **Restart** types it into that session; **Dismiss** on the dock line puts it away. Nothing
  resumes on its own.
- **Usage and cost (⌘⇧U / Ctrl+Shift+U).** Settings › Workspace › **Usage & cost** (key U), above Notifications,
  drawn as one Settings card; the shortcut and the palette open Settings on that page, and Esc closes Settings.
  There is no usage button in the sidebar footer and no full-screen view.
  Header: a **Day / Week / Month** switch and the window it means, named honestly because the daemon
  counts rolling UTC days that end today (Today (UTC), Last 7 days, Last 30 days), then tokens (in
  and out), cost, turns and time working. A figure no provider reported is a dash; with no reported
  cost the page shows no dollar total, and when any session reports none it shows **one** note, never
  one per row. A per-day bar chart (accent bars, no animation) has a hidden table as its text
  alternative. The table sorts on every header (`aria-sort`, buttons, cost descending by default;
  text columns start A to Z, numbers biggest first; unreported figures sort last), ends in a totals
  row, and its Machine column is always "This computer" until the report covers remote machines. A
  row opens its pane only while that pane is open in this window; a closed session's row is plain
  text. The **budget ring** (56px, accent, warn from 70%, danger from 90%) appears only when a monthly
  budget is set, the cost is known and the Month window is showing; otherwise "Set a monthly budget"
  (an inline `$` field; empty or "No budget" clears it). The budget is the `monthlyBudget`
  preference (client-side; the daemon serves none). States: skeleton while loading, plain words with
  Retry on failure (a failed refresh keeps the old figures and says they may be stale), "Nothing
  recorded yet" when the store is empty. Refreshes on open, when the period changes and every 60 s
  while open. Source: `features/usage/`, ADR 0009.
- **Turn timeline.** Inspect › Timeline lists the focused pane's latest events, newest first: the
  agent started working, stopped for you, finished (with how long the turn ran), and, in a shell
  that marks its prompts, each prompt and command with its exit code.
- **Status is shape and word.** Working is the user's spinner, Needs you an amber square with a `!`, a problem the same
  square in red, Done a green checked square, Unknown a dashed square, and Idle a sleeping `Zz`; a stopped agent or an
  exited shell also says so in words on its row.
  Amber still means needs you and only that, in every theme.
- **Colours follow the theme.** Agent tiles, badges and the folder text are
  expressions over the active theme's tokens (`--accent`, `--ansi-*`, `--warn`, `--danger`,
  `--on-accent`), never fixed hex values, so switching theme recolours all of them.
- **Status marks, not effects.** Every state has its own shape on a row's or rail icon (`StatusBadge`), so colour
  is never the only signal: **working** is the user's spinner in `--accent`, on the icon's corner; **needs you** Lucide's
  `SquareExclamationPoint` in `--warn`, with a ring that pulses while it waits; **done** Lucide's `SquareCheck` in `--ok`;
  **problem** (a stopped agent, or the daemon's `TermInfo.exit`, a non-zero exit code of the last command, shown while
  nothing is working or waiting) `SquareExclamationPoint` in `--danger`; **idle** a `Zz` in `--dim` with no square;
  **unknown** (the daemon is gone) a dashed outlined square, with the row dimmed. The three squares and the `Zz` sit on
  `--bg`, drawn as outlines (stroke 2.4, scaled so the square fills the badge). The window only displays these; the daemon decides them. There are no waves, sweeps, shimmer or glow
  on rows and tabs, and no setting for them; the only looping motion is the spinner. Reduce motion (the setting or
  the system's) removes the pulses, slides and size animations, and the spinner holds one frame. The needs-you badge pops once with a ring (.6s) and
  the update dot once (.7s), as `transform` and `opacity` on a pseudo-element. The terminal caret is steady
  (blinking is Settings › Text › Blink, xterm's own option, off by default), and nothing animates `box-shadow`,
  `filter` or `backdrop-filter` ([PERFORMANCE](PERFORMANCE.md)). The working spinner steps every 160 ms and
  holds while the window is in the background.
- **Working loader.** A wait of a second or more shows the **M loader** (`MLoader`): the three strokes of the M icon traced in turn over 2.4 s, in the text colour, with a word beside it ("Reading <machine>…"); a list shows it only after 160 ms. Reduce motion draws the M still. There is no spinner setting. The working badge on a tile and row keeps its own small mark.
- **Desktop dialogs.** The folder picker, the command palette, Recent sessions, Resume a saved chat and the service card share one float: the page colour, a hairline, 14px (Folded: the cut corner), the shared dialog shadow, a 160ms scale from .96 in, and the 2px accent underline for focus. Lists opened from a token or the machine name grow from their anchor (160ms, `cubic-bezier(.2,.8,.2,1)`, from .9). Reduce motion turns the movement off. The **switch** is 26x14 with a 1px `--line2` border (`--fg2` when on), an 8px knob, and a faint fill when on; it is the one control for an on/off setting (a per-file tick that selects what to commit stays a checkbox).
- **Notices** (toasts, dialogs and lines; see *Errors*): flat floats in the same colours. A safety signal keeps its colour and words: the offline dialog and chip stay red, a needs-you toast keeps its amber edge.
- **Process icons** are generic tiles, never a product's mark: `>_` shell, `✻` codex, `rs` cargo.
- **Themes**: fifty-four in the desktop app (the terminal app also ships Maiker Night), twenty-eight dark and twenty-six light (`crates/maitty-settings/themes.json` lists them; a TUI test holds its ground and text equal to it). Eleven are Maiker's own. Nine are the chat handoff's, each with a `palette` that the desktop draws exactly as written (every surface, text, accent, status, meter and shading role; `paletteTheme` in `theme/themes.ts`): **Maiker Night** and **Maiker Day** (sea-glass and brass, the defaults), **Maiker Dark** and **Maiker Light** (a standard black and white ground, same accents), and **Abyss**, **Ember**, **Moss**, **Dusk** (dark) and **Paper** (light), each with its own accent and its own needs-you colour (`--warn`). The TUI still builds Night, Day, Dark and Light from `crates/maitty-settings/maitty-tokens.json`, so those four differ slightly between the two apps until it reads the palettes too. **Maiker Retro Dark** and **Maiker Retro Light** (navy ground, mint text and a lime accent by night; white, ink and a darker green by day) are generated like the families below. In Maiker's first four, brass is the accent (`--accent` as a fill, `--accent-text` as text, darker by day), teal is only ever `--working`, coral is only ever needs-you (`--warn`). The other forty-four are twenty-two families, each with a dark and a light (GitHub, One, Catppuccin, Solarized, Gruvbox, Tokyo Night, Dracula, Nord, Ayu, Everforest, Rosé Pine, Kanagawa, Nightfox, Flexoki, Gruvbox Material, One Half, PaperColor, Tomorrow, Melange, Cyberdream, Doom One, Zenbones), generated from six inputs (`bg fg accent mag blue green` and a light flag) by Oklab mixing. A saved theme that is gone, or Maiker Night saved by the terminal app, falls back to Maiker Dark or Maiker Day (the TUI maps each removed id to its nearest survivor). The theme is stored as its id (`night`, `github-dark`, ...) in the shared settings. Every theme's `--pane` is its opaque
  `--main`. The foreground, terminal text (`--fg2`), muted and dim text keep 4.5:1 on both `--term` and the
  window `--bg`, and Maiker Night and Maiker Day also hold it for the accent text, working, needs-you, red, done and the ANSI blue,
  magenta and green; the theme tests check this. Every light theme holds it too, for accent, amber, red,
  green, blue, magenta and all 15 ANSI text colours but black (the generated ones darken a published hue in
  place until it passes). Maiker Day uses the file's darker *Text colours so those hold on the light ground. A pane's
  xterm palette comes from the same tokens, and on a light theme xterm also lifts any 256-colour or truecolour
  foreground a program picks to 4.5:1 (`minimumContrastRatio`; dark themes leave them as asked). The
  scroll viewport behind the rows is painted `--term`, never xterm's black. **Settings › Appearance › Theme** has an Appearance switch (System, Dark or Light:
  `themeMode`) and a searchable dropdown each for the dark and the light theme (`darkTheme`,
  `lightTheme`); the dropdown lists its theme in use first. System follows the OS's own dark or
  light setting as it changes. Hovering a theme in the slot that is in use previews it on the
  whole window; leaving the list or closing the menu restores it, and picking commits it. A
  single theme saved by an older version fills its own slot and pins the mode to it.
- **Type.** Geist for the UI, Geist Mono for terminals, paths, counts and keys, both bundled.
- **Machines.** With another machine, the sidebar's folders sit under a header per machine: `this
  computer` first, then the others in id order, in a small uppercase `--dim` label. A machine's state is a
  chip at the right of its header: a glyph and a word (`●` connected in `--done`; `○` connecting and `◐`
  reconnecting #n in `--dim`; `▲` needs login, not installed and needs update and `✕` unreachable and refused in
  `--danger`), so colour never carries it alone, and nothing animates. Amber stays for agents that need
  you. A machine that is down shows `disconnected since 2m ago` and its fix (wrapped, in `--dim`) under the
  header, and its folders are drawn at 60% opacity. A machine that needs the app has a line under its header,
  lined up with its mark: `▲ not installed` or `▲ needs update` in `--danger` and an **Install** or **Update**
  text button in the accent (11.5px), which opens the same question as the menu's Install Maiker or Update
  Maiker (`components/MachineUpdateDialog.tsx`, the Rename dialog's frame: what it needs, what it interrupts,
  Cancel, Update when idle, and the primary Install now or Update now); a machine's header shows even with no
  sessions anywhere. With one machine there is no header. **Settings › Machines** is a card per machine (chip
  in its tone, how long, what it needs in plain words or the fix in full, the primary **Install** or **Update**
  in the accent, then **Copy command** with the command under the text as the secondary way, **Retry**, a
  confirmed **Remove**) and an **Add a machine** card (a field, then the `~/.ssh/config` hosts as rows); its
  states are loading, empty, error and checking, and it works with the keyboard alone.

### Notification toasts

A session that needs you, finished or failed while you look elsewhere is a toast (`features/notifications/notify.ts`, `noticeForSession.ts`): its title names the session and what happened, the reason says what it asks (a command in mono), and its actions are **Allow** (only when the session is stopped on a choice the GUI can answer) and **Open session**. It is keyed by its session, so the daemon's alert for the same event replaces it.

- **Working badge.** The spinner in `--working` on a 9px square at the tile's corner, ringed in `--card`; it is the same badge on the sidebar row and the pane header. The chat's scroll area fades to transparent over its top 36px.

## Documents

The document viewer (Files tab and the pane beside the chat) is flat: a 44px head on `--pane-line` with the file path in mono, the
one Segmented (Drawn, Source, Edit), then text buttons (Preview, Save, Open beside the chat, Close). The drawn page is the
chat's own markdown on `--m-pane`, capped at 78ch and centred; the editor is mono 12.5px on `--m-well` with the underline
focus style, and the drawn page sits beside it from 640px. Notes (changed on disk, a failed read or save) are one line under
the head: `--danger` for an error, `--dim` for a notice; the room of the controls is kept, and hover and focus change colour
only (measured: no box moves). A document pane takes the pane card and its focus ring. A task entry (`- [ ]`, `- [x]`) is a
14px box with a 1.5px `--dim` edge and 4px corners in the bullet's slot, filled `--ok` with a tick when done and then its
text `--dim`; it is one flat box (no box inside a box), the same size in both states, so ticking moves nothing.
