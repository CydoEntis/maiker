/**
 * The window's keyboard shortcuts: one table that the key handler, the tooltips, the keycaps, the
 * menus, the palette, the shortcut sheet and Settings > Hotkeys all read, so a key is written down once.
 *
 * The contract: both views use the same keys. On Windows and Linux the window takes only Ctrl+Shift+letter,
 * Alt with an arrow or a digit, a function key, and Ctrl with a symbol a terminal has no code for. It never
 * takes a plain Ctrl+letter, an Alt+letter, a Ctrl+Alt combination or a Shift-only key: those are the
 * program's in a terminal pane and the field's in a text box. On macOS the window uses Cmd and leaves Ctrl
 * to the terminal. `reservedReason` is that rule, and no key in this table or chosen in Settings breaks it.
 */

export type Platform = 'mac' | 'windows' | 'linux'

export function detectPlatform(userAgent: string): Platform {
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'mac'
  return /Windows/i.test(userAgent) ? 'windows' : 'linux'
}

export function isMacPlatform(userAgent: string): boolean {
  return detectPlatform(userAgent) === 'mac'
}

/**
 * The shortcuts that still work on the New session dialog. It is a page, not a dialog: the window's own keys and the ones
 * that leave for another session work from it. The ones that act on the pane it covers do not.
 */
export const NEW_CHAT_PAGE_ACTIONS: ReadonlySet<ShortcutAction> = new Set<ShortcutAction>([
  'palette', 'jump-needs', 'session-next', 'session-previous', 'go-to-session', 'focus-sidebar', 'focus-previous', 'focus-next', 'new-terminal', 'open-folder', 'add-machine', 'toggle-sidebar', 'usage', 'settings', 'text-larger', 'text-smaller', 'shortcuts',
])

export type ShortcutAction =
  | 'open-folder'
  | 'palette'
  | 'session-next'
  | 'session-previous'
  | 'go-to-session'
  | 'jump-needs'
  | 'focus-chat'
  | 'focus-sidebar'
  | 'find'
  | 'new-session'
  | 'new-worktree'
  | 'new-terminal'
  | 'close'
  | 'switch-view'
  | 'model-picker'
  | 'fetch'
  | 'inspect'
  | 'toggle-sidebar'
  | 'terminal'
  | 'files'
  | 'changes'
  | 'panel-tab-next'
  | 'panel-tab-previous'
  | 'split-right'
  | 'split-down'
  | 'focus-next'
  | 'focus-previous'
  | 'broadcast'
  | 'settings'
  | 'shortcuts'
  | 'add-machine'
  | 'usage'
  | 'focus-mode'
  | 'text-larger'
  | 'text-smaller'

/** The sections of the shortcut sheet, in the order it shows them. */
export const HOTKEY_GROUPS = ['Go to', 'Sessions', 'Side panel', 'Terminal panes', 'App'] as const
export type HotkeyGroup = (typeof HOTKEY_GROUPS)[number]

export type Modifier = 'cmd' | 'ctrl' | 'alt' | 'shift'
const MODIFIERS: readonly Modifier[] = ['cmd', 'ctrl', 'alt', 'shift']

/** The key of a combination that stands for the nine digit keys 1 to 9; a match says which was pressed. */
export const DIGIT_RANGE = '1…9'

/** One key with the modifiers held for it. `cmd` exists on macOS only. */
export type Combo = {
  mods: readonly Modifier[]
  /**
   * The key as it is drawn on a keycap. A letter or a named key is compared, case-insensitively, with `KeyboardEvent.key`;
   * a symbol or a digit is compared by where the key sits (`KEY_CODES`).
   */
  key: string
  /** Matches with or without Shift: `+` is Shift+`=` on most layouts, and both mean "larger". */
  anyShift?: boolean
}

export type Binding = {
  action: ShortcutAction
  /** The sheet's row and the Hotkeys row: what the key does. */
  label: string
  group: HotkeyGroup
  mac: readonly Combo[]
  /** Windows and Linux share one column. Empty: no key (the action is still in the command palette). */
  other: readonly Combo[]
  /** Its keys cannot be changed in Settings: a key that stands for a range has no single key to press in its place. */
  fixed?: true
}

const cmd = (key: string, ...more: Modifier[]): Combo => ({ mods: ['cmd', ...more], key })
const ctrlShift = (key: string): Combo => ({ mods: ['ctrl', 'shift'], key })
const ctrl = (key: string, ...more: Modifier[]): Combo => ({ mods: ['ctrl', ...more], key })
const alt = (key: string, ...more: Modifier[]): Combo => ({ mods: ['alt', ...more], key })

const UP = '↑'
const DOWN = '↓'
const MINUS = '−'

/** Every action of the window with its keys. An action with no key is reached from the command palette. */
export const BINDINGS: readonly Binding[] = [
  { action: 'open-folder', label: 'Open a project', group: 'Go to', mac: [cmd('O')], other: [ctrlShift('O')] },
  { action: 'palette', label: 'Command palette', group: 'Go to', mac: [cmd('K')], other: [ctrlShift('K')] },
  // Alt with an arrow or a digit is the TUI's way too. Ctrl with a digit is a control code in a terminal.
  { action: 'session-next', label: 'Next session', group: 'Go to', mac: [cmd(DOWN, 'alt')], other: [alt(DOWN)] },
  { action: 'session-previous', label: 'Previous session', group: 'Go to', mac: [cmd(UP, 'alt')], other: [alt(UP)] },
  { action: 'go-to-session', label: 'Session 1 to 9', group: 'Go to', mac: [cmd(DIGIT_RANGE)], other: [alt(DIGIT_RANGE)], fixed: true },
  { action: 'jump-needs', label: 'Next session that needs you', group: 'Go to', mac: [cmd('J')], other: [ctrlShift('J')] },
  { action: 'focus-chat', label: 'Focus the chat box', group: 'Go to', mac: [cmd('L')], other: [ctrlShift('L')] },
  { action: 'focus-sidebar', label: 'Focus the sidebar', group: 'Go to', mac: [cmd('S', 'shift')], other: [ctrlShift('S')] },
  { action: 'find', label: 'Find in the pane or every session', group: 'Go to', mac: [cmd('F')], other: [ctrlShift('F')] },

  { action: 'new-session', label: 'New session', group: 'Sessions', mac: [cmd('T')], other: [ctrlShift('T')] },
  { action: 'new-worktree', label: 'New worktree', group: 'Sessions', mac: [cmd('N', 'shift')], other: [ctrlShift('N')] },
  { action: 'new-terminal', label: 'New terminal', group: 'Sessions', mac: [cmd('T', 'shift')], other: [ctrlShift('`')] },
  { action: 'close', label: 'Close the session, or the focused split', group: 'Sessions', mac: [cmd('W')], other: [ctrlShift('W')] },
  { action: 'switch-view', label: 'Switch between Chat and Terminal view', group: 'Sessions', mac: [cmd('Y', 'shift')], other: [ctrlShift('Y')] },
  { action: 'model-picker', label: 'Agent and model picker', group: 'Sessions', mac: [cmd('A', 'shift')], other: [ctrlShift('A')] },
  { action: 'fetch', label: 'Fetch the repository', group: 'Sessions', mac: [], other: [] },

  { action: 'inspect', label: 'Show or hide the side panel', group: 'Side panel', mac: [cmd('B')], other: [ctrlShift('B')] },
  // Plain Ctrl+\ quits the program in a terminal, so Shift joins it.
  { action: 'toggle-sidebar', label: 'Show or hide the sidebar', group: 'Side panel', mac: [cmd('\\')], other: [ctrlShift('\\')] },
  // A terminal has no code of its own for Ctrl+`, so nothing a program reads is taken.
  { action: 'terminal', label: 'Show or hide the terminal', group: 'Side panel', mac: [ctrl('`')], other: [ctrl('`')] },
  { action: 'files', label: 'Files', group: 'Side panel', mac: [cmd('E', 'shift')], other: [ctrlShift('E')] },
  { action: 'changes', label: 'Changes', group: 'Side panel', mac: [cmd('G', 'shift')], other: [ctrlShift('G')] },
  { action: 'panel-tab-next', label: 'Next side panel tab', group: 'Side panel', mac: [ctrl('Tab')], other: [ctrl('Tab')] },
  { action: 'panel-tab-previous', label: 'Previous side panel tab', group: 'Side panel', mac: [ctrl('Tab', 'shift')], other: [ctrl('Tab', 'shift')] },

  { action: 'split-right', label: 'Split right', group: 'Terminal panes', mac: [cmd('D')], other: [alt('=', 'shift')] },
  { action: 'split-down', label: 'Split down', group: 'Terminal panes', mac: [cmd('D', 'shift')], other: [alt(MINUS, 'shift')] },
  // Ctrl+[ is Esc in a terminal, so the panes are stepped through with a function key.
  { action: 'focus-next', label: 'Next pane', group: 'Terminal panes', mac: [cmd(']')], other: [{ mods: [], key: 'F6' }] },
  { action: 'focus-previous', label: 'Previous pane', group: 'Terminal panes', mac: [cmd('[')], other: [{ mods: ['shift'], key: 'F6' }] },
  { action: 'broadcast', label: 'Broadcast to the layout', group: 'Terminal panes', mac: [], other: [] },

  { action: 'settings', label: 'Settings', group: 'App', mac: [cmd(',')], other: [ctrl(',')] },
  { action: 'shortcuts', label: 'Keyboard shortcuts', group: 'App', mac: [cmd('/')], other: [ctrl('/')] },
  { action: 'add-machine', label: 'Add a remote machine', group: 'App', mac: [cmd('M', 'shift')], other: [ctrlShift('M')] },
  { action: 'usage', label: 'Usage and cost', group: 'App', mac: [cmd('U', 'shift')], other: [ctrlShift('U')] },
  { action: 'focus-mode', label: 'Focus mode', group: 'App', mac: [cmd('.')], other: [ctrl('.')] },
  { action: 'text-larger', label: 'Larger text', group: 'App', mac: [{ mods: ['cmd'], key: '=', anyShift: true }], other: [{ mods: ['ctrl'], key: '=', anyShift: true }] },
  { action: 'text-smaller', label: 'Smaller text', group: 'App', mac: [cmd(MINUS)], other: [ctrl(MINUS)] },
]

/** Keys the window never takes: they belong to the terminal. Listed so the sheet can say so. */
const TERMINAL_KEYS: readonly { label: string; group: HotkeyGroup; letter: string }[] = [
  { label: 'Interrupt', group: 'Terminal panes', letter: 'C' },
  { label: 'Clear screen', group: 'Terminal panes', letter: 'L' },
]

/**
 * Where each symbol and digit key sits (`KeyboardEvent.code`). They are matched by position, not by the character: on a
 * German or French layout `` ` `` `\` `=` `-` `/` and the digits are other keys or need Shift or AltGr, and a numpad
 * digit (an Alt code on Windows) must not count as the digit row.
 */
const KEY_CODES: Readonly<Record<string, string>> = {
  '`': 'Backquote', '\\': 'Backslash', '=': 'Equal', [MINUS]: 'Minus', '/': 'Slash', ',': 'Comma', '.': 'Period', ';': 'Semicolon', "'": 'Quote', '[': 'BracketLeft', ']': 'BracketRight',
  '0': 'Digit0', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4', '5': 'Digit5', '6': 'Digit6', '7': 'Digit7', '8': 'Digit8', '9': 'Digit9',
}
const KEYCAP_OF_CODE: ReadonlyMap<string, string> = new Map(Object.entries(KEY_CODES).map(([keycap, code]) => [code, keycap]))
const DIGIT_CODE = /^Digit([1-9])$/

/**
 * What `KeyboardEvent.key` reports for the keycaps whose character differs or changes with Shift. Read for a named key
 * (an arrow, the space bar), and for a symbol only when the press does not say where its key sits.
 */
const EVENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  [MINUS]: ['-', '_'], '=': ['=', '+'], '`': ['`', '~'], '\\': ['\\', '|'], '/': ['/', '?'], ',': [',', '<'], '.': ['.', '>'],
  Space: [' '], [UP]: ['arrowup'], [DOWN]: ['arrowdown'], '←': ['arrowleft'], '→': ['arrowright'],
}
const KEYCAP_OF_NAMED: Readonly<Record<string, string>> = { ' ': 'Space', '-': MINUS, ArrowUp: UP, ArrowDown: DOWN, ArrowLeft: '←', ArrowRight: '→' }

/**
 * The keys chosen in Settings › Hotkeys: one combination per action, in place of the action's own keys. Saved with the
 * window's settings on this computer, so a combination is always for the platform it was pressed on.
 */
export type KeyOverrides = Partial<Record<ShortcutAction, Combo>>
export const NO_OVERRIDES: KeyOverrides = {}

const ownCombos = (binding: Binding, platform: Platform): readonly Combo[] => (platform === 'mac' ? binding.mac : binding.other)

/** The combinations that do the action here: the chosen one, else the action's own for the platform. */
function combosOf(binding: Binding, platform: Platform, overrides: KeyOverrides): readonly Combo[] {
  const chosen = overrides[binding.action]
  return chosen ? [chosen] : ownCombos(binding, platform)
}

export function bindingFor(action: ShortcutAction): Binding {
  const found = BINDINGS.find((binding) => binding.action === action)
  if (!found) throw new Error(`No binding for ${action}`)
  return found
}

const MAC_GLYPH: Readonly<Record<Modifier, string>> = { cmd: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' }
const WORD: Readonly<Record<Modifier, string>> = { cmd: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' }
/** The order modifiers are written in: ⌘⌃⌥⇧ on macOS, Ctrl+Alt+Shift elsewhere. */
const MODIFIER_ORDER: readonly Modifier[] = ['cmd', 'ctrl', 'alt', 'shift']

/** One combo as the keys to press, in order: `['⌘', '⇧', 'D']` on macOS, `['Ctrl', 'Shift', 'D']` elsewhere. */
export type Chord = string[]

export function comboChord(combo: Combo, platform: Platform): Chord {
  const mods = MODIFIER_ORDER.filter((modifier) => combo.mods.includes(modifier)).map((modifier) => (platform === 'mac' ? MAC_GLYPH[modifier] : WORD[modifier]))
  return [...mods, combo.key]
}

/** Every key combination that does the action on this platform; empty when it has none. */
export function shortcutChords(binding: Binding, platform: Platform, overrides: KeyOverrides = NO_OVERRIDES): Chord[] {
  return combosOf(binding, platform, overrides).map((combo) => comboChord(combo, platform))
}

/** A chord written as one string: `⌘⇧D` on macOS, `Ctrl+Shift+D` elsewhere. */
export function writeChord(chord: Chord, platform: Platform): string {
  return chord.join(platform === 'mac' ? '' : '+')
}

/** The binding's first key combination as text, or '' when the platform has none. */
export function formatShortcut(binding: Binding, platform: Platform, overrides: KeyOverrides = NO_OVERRIDES): string {
  const [first] = shortcutChords(binding, platform, overrides)
  return first ? writeChord(first, platform) : ''
}

/** What a tooltip or menu hint shows for an action on this platform. */
export function shortcutText(action: ShortcutAction, platform: Platform, overrides: KeyOverrides = NO_OVERRIDES): string {
  return formatShortcut(bindingFor(action), platform, overrides)
}

/** A key press as the table reads it. `code` is where the key sits; some presses have none (`positionOf`). */
export type KeyInput = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'> & { code?: string }

/** The action a key press is, and for a key that stands for 1 to 9 (`DIGIT_RANGE`) which digit it was. */
export type ShortcutMatch = { action: ShortcutAction; digit?: number }

/** What `code` holds when the press has no known position (an on-screen keyboard, a key the platform cannot place). */
const NO_POSITION: ReadonlySet<string> = new Set(['', 'Unidentified', 'Unknown'])

/** Where the pressed key sits, or null when the press does not say; its character is read then. */
function positionOf(event: KeyInput): string | null {
  return event.code === undefined || NO_POSITION.has(event.code) ? null : event.code
}

/** Which of 1 to 9 the press is on the digit row, or null. */
function digitOf(event: KeyInput): number | null {
  const position = positionOf(event)
  const found = position === null ? /^[1-9]$/.exec(event.key)?.[0] : DIGIT_CODE.exec(position)?.[1]
  return found === undefined ? null : Number(found)
}

function matchesKey(combo: Combo, event: KeyInput): boolean {
  if (combo.key === DIGIT_RANGE) return digitOf(event) !== null
  const code = KEY_CODES[combo.key]
  const position = positionOf(event)
  if (code !== undefined && position !== null) return position === code
  return (EVENT_KEYS[combo.key] ?? [combo.key.toLowerCase()]).includes(event.key.toLowerCase())
}

function matches(combo: Combo, event: KeyInput, platform: Platform): boolean {
  const wanted = (modifier: Modifier) => combo.mods.includes(modifier)
  if (event.metaKey !== (platform === 'mac' && wanted('cmd'))) return false
  if (event.ctrlKey !== wanted('ctrl')) return false
  if (event.altKey !== wanted('alt')) return false
  if (!combo.anyShift && event.shiftKey !== wanted('shift')) return false
  return matchesKey(combo, event)
}

/**
 * The window shortcut this key press is, or null when it belongs to the terminal or the field with the focus. Modifiers
 * must match exactly, so Ctrl+T on Windows or Linux (a shell's own key) is never taken.
 */
export function matchShortcut(event: KeyInput, platform: Platform, overrides: KeyOverrides = NO_OVERRIDES): ShortcutMatch | null {
  for (const binding of BINDINGS) {
    for (const combo of combosOf(binding, platform, overrides)) {
      if (!matches(combo, event, platform)) continue
      const digit = combo.key === DIGIT_RANGE ? digitOf(event) : null
      return digit === null ? { action: binding.action } : { action: binding.action, digit }
    }
  }
  return null
}

export type HotkeyRow = {
  action: string
  group: HotkeyGroup
  /** Alternatives: any one of these does it. */
  chords: Chord[]
  /** The action, for a row Settings can change; null for a key that is the terminal's or is fixed. */
  id: ShortcutAction | null
  /** Why Settings cannot change it, as one word beside the row; null for a row it can. */
  fixed: 'Terminal' | 'Fixed' | null
  /** Its keys were chosen in Settings, not the action's own. */
  changed: boolean
}

/** The modifier keys drawn as symbols, which the keycaps set in the interface font. */
const MODIFIER_SYMBOLS: ReadonlySet<string> = new Set(['⌘', '⇧', '⌃', '⌥'])
export const isModifierSymbol = (key: string): boolean => MODIFIER_SYMBOLS.has(key)

/** The Hotkeys list, in the words the window uses. Actions without a key here are left out. */
export function hotkeyRows(platform: Platform, overrides: KeyOverrides = NO_OVERRIDES): HotkeyRow[] {
  const rows: HotkeyRow[] = BINDINGS
    .map((binding): HotkeyRow => ({ action: binding.label, group: binding.group, chords: shortcutChords(binding, platform, overrides), id: binding.fixed ? null : binding.action, fixed: binding.fixed ? 'Fixed' : null, changed: overrides[binding.action] !== undefined }))
    .filter((row) => row.chords.length > 0)
  const ctrl = platform === 'mac' ? MAC_GLYPH.ctrl : WORD.ctrl
  for (const key of TERMINAL_KEYS) rows.push({ action: key.label, group: key.group, chords: [[ctrl, key.letter]], id: null, fixed: 'Terminal', changed: false })
  return rows
}

/** Marks the field in Settings › Hotkeys that takes down a new key, so the window and the dialog leave its keys alone. */
export const KEY_CAPTURE_ATTRIBUTE = 'data-key-capture'

/** Keys that are only held for another: a capture waits for the key pressed with them. */
const HELD_ONLY: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'Fn'])
const SINGLE_LETTER = /^[a-z]$/i
const FUNCTION_KEY = /^F([1-9]|1[0-2])$/
const ARROWS: ReadonlySet<string> = new Set([UP, DOWN, '←', '→'])
/** Longer than any key name `KeyboardEvent.key` reports, so a saved value that is not one is dropped. */
const MAX_KEY_LENGTH = 16

type KeyKind = 'letter' | 'digit' | 'symbol' | 'arrow' | 'tab' | 'function' | 'other'

function kindOf(key: string): KeyKind {
  if (SINGLE_LETTER.test(key)) return 'letter'
  if (key === DIGIT_RANGE || /^[0-9]$/.test(key)) return 'digit'
  if (KEY_CODES[key] !== undefined) return 'symbol'
  if (ARROWS.has(key)) return 'arrow'
  if (key === 'Tab') return 'tab'
  return FUNCTION_KEY.test(key) ? 'function' : 'other'
}

/** Ctrl+Shift with one of these letters is never the window's, on Windows and Linux. */
const RESERVED_CTRL_SHIFT: Readonly<Record<string, string>> = {
  C: 'Ctrl+Shift+C copies in a terminal.',
  V: 'Ctrl+Shift+V pastes in a terminal.',
  Z: 'Ctrl+Shift+Z is redo in a text box.',
  R: 'Ctrl+Shift+R reloads the window.',
  Q: 'Ctrl+Shift+Q quits on some desktops.',
  I: 'Ctrl+Shift+I opens the developer tools.',
}
/** ⌘ with one of these letters is the system's or the text box's, on macOS. */
const RESERVED_CMD: Readonly<Record<string, string>> = {
  C: '⌘C copies.', V: '⌘V pastes.', X: '⌘X cuts.', A: '⌘A selects everything.', Z: '⌘Z is undo.', Q: '⌘Q quits the app.', H: '⌘H hides the app.',
}
/** Function keys that already have a job. Keyed by the key, with ⇧ in front for the shifted one. */
const RESERVED_FUNCTION: Readonly<Record<string, string>> = {
  F2: 'F2 renames the focused row.',
  F5: 'F5 reloads the window.',
  F11: 'F11 is full screen.',
  F12: 'F12 opens the developer tools.',
  '⇧F10': 'Shift+F10 opens the menu of the focused row.',
}
/** The symbols Ctrl alone may take: a terminal has no code for them. Ctrl with `[` `]` `\` or a digit is a control code. */
const PLAIN_CTRL_SYMBOLS: ReadonlySet<string> = new Set([',', '.', '/', '=', MINUS, '`', ';', "'"])

function reservedOnMac(combo: Combo, kind: KeyKind): string | null {
  const held = (modifier: Modifier) => combo.mods.includes(modifier)
  const letter = combo.key.toUpperCase()
  if (!held('cmd')) {
    // ⌃` and ⌃Tab are the usual terminal and tab keys on macOS, and no program in a terminal can read them.
    if (held('ctrl') && !held('alt') && (kind === 'tab' || (combo.key === '`' && !held('shift')))) return null
    return 'A window key needs ⌘ on macOS; Ctrl and ⌥ keys belong to the terminal.'
  }
  if (held('ctrl')) return '⌃⌘ keys belong to macOS.'
  if (kind === 'letter' && combo.mods.length === 1 && RESERVED_CMD[letter] !== undefined) return RESERVED_CMD[letter]
  if (letter === 'Z' && held('shift') && !held('alt')) return '⌘⇧Z is redo.'
  return null
}

function reservedElsewhere(combo: Combo, kind: KeyKind): string | null {
  const held = (modifier: Modifier) => combo.mods.includes(modifier)
  const letter = combo.key.toUpperCase()
  if (held('cmd')) return 'The Windows key belongs to the system.'
  if (held('ctrl') && held('alt')) return 'Ctrl+Alt is AltGr on Windows and the desktop’s own on Linux.'
  if (held('ctrl') && held('shift')) {
    if (kind === 'letter') return RESERVED_CTRL_SHIFT[letter] ?? null
    return kind === 'arrow' || kind === 'other' ? 'Ctrl+Shift with that key selects or edits text.' : null
  }
  if (held('ctrl')) {
    if (kind === 'letter') return `Ctrl+${letter} is the terminal’s own key. Add Shift.`
    return kind === 'tab' || PLAIN_CTRL_SYMBOLS.has(combo.key) ? null : 'Ctrl with that key is a key the terminal or a text box uses. Add Shift.'
  }
  if (held('alt')) {
    if (kind === 'arrow' || kind === 'digit') return null
    if (kind === 'symbol' && held('shift')) return null
    return kind === 'letter' ? 'Alt with a letter belongs to the shell and the agents.' : 'Alt works with an arrow or a digit, or with Shift and a symbol.'
  }
  if (kind === 'function') return RESERVED_FUNCTION[`${held('shift') ? '⇧' : ''}${combo.key}`] ?? null
  if (held('shift') && kind === 'tab') return 'Shift+Tab changes the mode in an agent.'
  if (held('shift') && combo.key === 'Enter') return 'Shift+Enter is a new line.'
  return 'A window key needs Ctrl+Shift, Alt with an arrow or a digit, or a function key; other keys belong to the terminal.'
}

/**
 * Why a combination can never be a window key on this platform, or null when it can. This is the reserved list: the keys a
 * terminal, an agent, a text box, the web view or the system needs. The table above uses none, and Settings accepts none.
 */
export function reservedReason(combo: Combo, platform: Platform): string | null {
  const kind = kindOf(combo.key)
  return platform === 'mac' ? reservedOnMac(combo, kind) : reservedElsewhere(combo, kind)
}

/** A key press in the capture field of Settings › Hotkeys: still waiting, the combination it makes, or why it cannot be one. */
export type Captured = { kind: 'waiting' } | { kind: 'combo'; combo: Combo } | { kind: 'refused'; reason: string }

/** What a key pressed in the capture field makes: the combination, unless it is reserved (`reservedReason`). */
export function captureCombo(event: KeyInput, platform: Platform): Captured {
  if (HELD_ONLY.has(event.key)) return { kind: 'waiting' }
  // A numpad digit with Alt is how Windows types a character by its code.
  if (event.code?.startsWith('Numpad')) return { kind: 'refused', reason: 'Numpad keys stay the numpad’s. Use the main keys.' }
  const mods = MODIFIERS.filter((modifier) => (modifier === 'cmd' ? event.metaKey : modifier === 'ctrl' ? event.ctrlKey : modifier === 'alt' ? event.altKey : event.shiftKey))
  const combo: Combo = { mods, key: keycapOf(event) }
  const reason = reservedReason(combo, platform)
  return reason === null ? { kind: 'combo', combo } : { kind: 'refused', reason }
}

/** How a pressed key is drawn: a symbol or digit by where it sits, letters in capitals, arrows and the space bar by glyph or name. */
function keycapOf(event: KeyInput): string {
  const placed = KEYCAP_OF_CODE.get(positionOf(event) ?? '')
  if (placed !== undefined) return placed
  const named = KEYCAP_OF_NAMED[event.key]
  if (named !== undefined) return named
  return event.key.length === 1 ? event.key.toUpperCase() : event.key
}

/** The key press a combination is, to compare it with the others through the same test the window uses. */
export function pressOf(combo: Combo, platform: Platform): Required<KeyInput> {
  const held = (modifier: Modifier) => combo.mods.includes(modifier)
  const keycap = combo.key === DIGIT_RANGE ? '1' : combo.key
  return { key: (EVENT_KEYS[keycap] ?? [keycap])[0] ?? keycap, code: KEY_CODES[keycap] ?? '', metaKey: platform === 'mac' && held('cmd'), ctrlKey: held('ctrl'), altKey: held('alt'), shiftKey: held('shift') }
}

/** The other action this combination already does, if any, with the chosen keys in place. */
export function takenBy(combo: Combo, action: ShortcutAction, platform: Platform, overrides: KeyOverrides): Binding | null {
  const press = pressOf(combo, platform)
  return BINDINGS.find((binding) => binding.action !== action && combosOf(binding, platform, overrides).some((candidate) => matches(candidate, press, platform))) ?? null
}

/** Whether the combination is one of the action's own keys here, so choosing it is the same as resetting. */
export function isOwnKey(combo: Combo, action: ShortcutAction, platform: Platform): boolean {
  return ownCombos(bindingFor(action), platform).some((candidate) => matches(candidate, pressOf(combo, platform), platform))
}

function isModifier(value: unknown): value is Modifier {
  return MODIFIERS.some((modifier) => modifier === value)
}

function isCombo(value: unknown): value is Combo {
  if (typeof value !== 'object' || value === null) return false
  const { mods, key } = value as { mods?: unknown; key?: unknown }
  return Array.isArray(mods) && mods.every(isModifier) && typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH
}

/**
 * The chosen keys from saved settings. A key is kept only for a known action whose keys can change, when it is well
 * formed, not reserved, and not a key another action has: a key saved before the table changed would otherwise win
 * over the new action that now owns it. An action whose key is dropped goes back to its own, which can take a key
 * away from another saved choice in turn, so the check runs until nothing more is dropped.
 */
export function readKeyOverrides(value: unknown, platform: Platform): KeyOverrides {
  if (typeof value !== 'object' || value === null) return NO_OVERRIDES
  let read: KeyOverrides = {}
  for (const binding of BINDINGS) {
    const combo: unknown = (value as Record<string, unknown>)[binding.action]
    if (binding.fixed || !isCombo(combo)) continue
    const kept: Combo = { mods: [...combo.mods], key: combo.key }
    if (reservedReason(kept, platform) === null) read[binding.action] = kept
  }
  for (;;) {
    const current = read
    const clashing = BINDINGS.map((binding) => binding.action).filter((action) => {
      const chosen = current[action]
      return chosen !== undefined && takenBy(chosen, action, platform, current) !== null
    })
    if (clashing.length === 0) return read
    read = clashing.reduce(withoutAction, read)
  }
}

/** Without the one action's chosen keys, so it goes back to its own. */
export function withoutAction(overrides: KeyOverrides, action: ShortcutAction): KeyOverrides {
  return Object.fromEntries(Object.entries(overrides).filter(([chosen]) => chosen !== action))
}
