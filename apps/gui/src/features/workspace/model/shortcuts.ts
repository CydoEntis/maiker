/**
 * The window's keyboard shortcuts: one table that the key handler, the tooltips, the keycaps, the
 * menus, the palette and the shortcut overlay all read, so a key is written down once.
 *
 * The contract (v18 B.8, owner decision 2026-11-04): a pane's terminal owns every plain Ctrl+letter
 * on Windows and Linux (Ctrl+C, D, W, L, R, J ...), so the window uses Ctrl+Shift there. On macOS
 * the window uses Cmd and leaves Ctrl to the terminal.
 *
 * The view refines it (owner decision 2026-11-19): in the chat view nothing needs plain Ctrl+letter, so
 * a few window keys also work as plain Ctrl+key there (a binding's `chat` list). In the terminal view only the
 * Ctrl+Shift and Ctrl+Alt forms are taken and plain Ctrl+letter always reaches the program. Only the keys
 * a `chat` list names are ever taken: Ctrl+A, C, V, X, Z and Backspace stay the text box's. macOS is the
 * same in both views, since Cmd is the window's there.
 */
import type { PaneView } from './chatView'

export type Platform = 'mac' | 'windows' | 'linux'

/** The view the keys are read for: the one the focused session shows (`PaneView`). */
export type ShortcutView = PaneView

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
  'palette', 'jump-needs', 'focus-previous', 'focus-next', 'new-terminal', 'open-folder', 'toggle-sidebar', 'usage', 'performance', 'settings', 'text-larger', 'text-smaller', 'shortcuts',
])

export type ShortcutAction =
  | 'new-session'
  | 'new-terminal'
  | 'split-right'
  | 'split-down'
  | 'focus-previous'
  | 'focus-next'
  | 'close'
  | 'toggle-sidebar'
  | 'settings'
  | 'palette'
  | 'jump-needs'
  | 'inspect'
  | 'find'
  | 'new-worktree'
  | 'open-folder'
  | 'fetch'
  | 'broadcast'
  | 'focus-mode'
  | 'shortcuts'
  | 'text-larger'
  | 'text-smaller'
  | 'usage'
  | 'performance'
  | 'terminal'

/** The sections of the shortcut overlay, in the order it shows them. */
export const HOTKEY_GROUPS = ['Sessions', 'Panes', 'Find & jump', 'Window'] as const
export type HotkeyGroup = (typeof HOTKEY_GROUPS)[number]

export type Modifier = 'cmd' | 'ctrl' | 'alt' | 'shift'
const MODIFIERS: readonly Modifier[] = ['cmd', 'ctrl', 'alt', 'shift']

/** One key with the modifiers held for it. `cmd` exists on macOS only. */
export type Combo = {
  mods: readonly Modifier[]
  /** The key as it is drawn on a keycap and compared, case-insensitively, with `KeyboardEvent.key`. */
  key: string
  /** Matches with or without Shift: `+` is Shift+`=` on most layouts, and both mean "larger". */
  anyShift?: boolean
}

export type Binding = {
  action: ShortcutAction
  /** The overlay row and the palette entry. */
  label: string
  group: HotkeyGroup
  mac: readonly Combo[]
  /** Windows and Linux share one column. Empty: no key on those platforms (the feature is still reachable by menu or palette). */
  other: readonly Combo[]
  /**
   * Windows and Linux in the chat view: these in place of `other` (so they list the Ctrl+Shift form too when it keeps working).
   * Absent: the chat view uses `other`.
   */
  chat?: readonly Combo[]
  /** False until the feature behind it exists. The window ignores the key and the overlay hides it. */
  available: boolean
}

const cmd = (key: string, ...more: Modifier[]): Combo => ({ mods: ['cmd', ...more], key })
const ctrlShift = (key: string, ...more: Modifier[]): Combo => ({ mods: ['ctrl', ...more, 'shift'], key })
const ctrl = (key: string, ...more: Modifier[]): Combo => ({ mods: ['ctrl', ...more], key })

/**
 * Where two actions need the same letter on Windows and Linux, the second takes Ctrl+Alt+Shift
 * (split down against split right, broadcast against collapse sidebar). macOS has no such clash
 * because it spends Cmd and Cmd+Shift on them separately.
 */
export const BINDINGS: readonly Binding[] = [
  { action: 'new-session', label: 'New session', group: 'Sessions', mac: [cmd('T')], other: [ctrlShift('T')], available: true },
  { action: 'new-terminal', label: 'New terminal', group: 'Sessions', mac: [cmd('T', 'shift')], other: [{ mods: ['ctrl', 'alt'], key: 'T' }, ctrlShift('T', 'alt')], available: true },
  // A chat with the default agent in the current fleet, without the New session modal.
  // Ctrl+Shift+N stays "new worktree" until brain dump (v18 C.6), which takes this key, is built.
  { action: 'new-worktree', label: 'New worktree', group: 'Sessions', mac: [cmd('N', 'shift')], other: [ctrlShift('N')], available: true },
  // Opens the Open a project palette in this computer's folders. Plain Ctrl+O is the chat view's; the terminal's own Ctrl+O stays the terminal's.
  { action: 'open-folder', label: 'Open a folder', group: 'Sessions', mac: [cmd('O')], other: [ctrlShift('O')], chat: [ctrl('O'), ctrlShift('O')], available: true },
  // Fetches the focused session's repository. Ctrl+Shift+F is Find in the terminal view, so there fetch takes Ctrl+Alt+Shift+F.
  { action: 'fetch', label: 'Fetch the repository', group: 'Sessions', mac: [cmd('F', 'shift')], other: [ctrlShift('F', 'alt')], chat: [ctrlShift('F'), ctrlShift('F', 'alt')], available: true },
  { action: 'split-right', label: 'Split right', group: 'Panes', mac: [cmd('D')], other: [ctrlShift('D')], available: true },
  { action: 'split-down', label: 'Split down', group: 'Panes', mac: [cmd('D', 'shift')], other: [ctrlShift('D', 'alt')], available: true },
  { action: 'focus-previous', label: 'Previous pane', group: 'Panes', mac: [cmd('[')], other: [{ mods: ['ctrl'], key: '[' }], available: true },
  { action: 'focus-next', label: 'Next pane', group: 'Panes', mac: [cmd(']')], other: [{ mods: ['ctrl'], key: ']' }], available: true },
  { action: 'close', label: 'Close pane or session', group: 'Panes', mac: [cmd('W')], other: [ctrlShift('W')], chat: [ctrl('W'), ctrlShift('W')], available: true },
  // Closing ends the session after a short window; this key brings back the last one closed inside it.
  { action: 'broadcast', label: 'Broadcast to the layout', group: 'Panes', mac: [cmd('B', 'shift')], other: [ctrlShift('B', 'alt')], available: true },
  { action: 'palette', label: 'Command palette', group: 'Find & jump', mac: [cmd('K')], other: [ctrlShift('K')], chat: [ctrl('K'), ctrlShift('K')], available: true },
  // Plain Ctrl+J is a line feed in a terminal, so Windows and Linux add Shift (the contract above).
  { action: 'jump-needs', label: 'Jump to the next session that needs you', group: 'Find & jump', mac: [cmd('J')], other: [ctrlShift('J')], available: true },
  { action: 'inspect', label: 'Inspect the repository', group: 'Find & jump', mac: [cmd('I')], other: [ctrlShift('I')], available: true },
  { action: 'find', label: 'Find in the pane or every session', group: 'Find & jump', mac: [cmd('F')], other: [ctrlShift('F')], chat: [ctrl('F', 'alt')], available: true },
  { action: 'toggle-sidebar', label: 'Collapse sidebar', group: 'Window', mac: [cmd('B')], other: [ctrlShift('B')], available: true },
  // The terminal dock. ⌃` is the usual terminal key on macOS, where Ctrl is not the shell's; elsewhere Shift joins it (the contract above).
  { action: 'terminal', label: 'Show or hide the terminal', group: 'Window', mac: [{ mods: ['ctrl'], key: '`' }], other: [ctrlShift('`')], available: true },
  { action: 'usage', label: 'Usage and cost', group: 'Window', mac: [cmd('U', 'shift')], other: [ctrlShift('U')], available: true },
  { action: 'performance', label: 'Performance', group: 'Window', mac: [cmd('P', 'shift')], other: [ctrlShift('P')], available: true },
  { action: 'focus-mode', label: 'Focus mode', group: 'Window', mac: [cmd('.')], other: [{ mods: ['ctrl'], key: '.' }], available: true },
  { action: 'settings', label: 'Settings', group: 'Window', mac: [cmd(',')], other: [{ mods: ['ctrl'], key: ',' }], available: true },
  { action: 'text-larger', label: 'Larger text', group: 'Window', mac: [{ mods: ['cmd'], key: '=', anyShift: true }], other: [{ mods: ['ctrl'], key: '=', anyShift: true }], available: true },
  { action: 'text-smaller', label: 'Smaller text', group: 'Window', mac: [{ mods: ['cmd'], key: '−' }], other: [{ mods: ['ctrl'], key: '−' }], available: true },
  { action: 'shortcuts', label: 'Keyboard shortcuts', group: 'Window', mac: [cmd('/')], other: [{ mods: ['ctrl'], key: '/' }], available: true },
]

/** Keys the window never takes: they belong to the terminal. Listed so the overlay can say so. */
const TERMINAL_KEYS: readonly { label: string; group: HotkeyGroup; letter: string }[] = [
  { label: 'Interrupt', group: 'Sessions', letter: 'C' },
  { label: 'Clear screen', group: 'Sessions', letter: 'L' },
]

/** What `KeyboardEvent.key` reports for the keycaps whose character differs, or has a second spelling (Shift+= is `+`, Shift+` is `~`). */
const EVENT_KEYS: Readonly<Record<string, readonly string[]>> = { '−': ['-'], '=': ['=', '+'], Space: [' '], '`': ['`', '~'] }

/**
 * The keys chosen in Settings › Hotkeys: one combination per action, in place of the action's own keys. Saved with the
 * window's settings on this computer, so a combination is always for the platform it was pressed on.
 */
export type KeyOverrides = Partial<Record<ShortcutAction, Combo>>
export const NO_OVERRIDES: KeyOverrides = {}

/** The combinations that do the action here: the chosen one, else the action's own for the platform and view. */
function combosOf(binding: Binding, platform: Platform, overrides: KeyOverrides, view: ShortcutView): readonly Combo[] {
  const chosen = overrides[binding.action]
  if (chosen) return [chosen]
  if (platform === 'mac') return binding.mac
  return view === 'chat' ? binding.chat ?? binding.other : binding.other
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

/** Every key combination that does the action on this platform; empty when it has none or is not built. */
export function shortcutChords(binding: Binding, platform: Platform, overrides: KeyOverrides = NO_OVERRIDES, view: ShortcutView = 'terminal'): Chord[] {
  return combosOf(binding, platform, overrides, view).map((combo) => comboChord(combo, platform))
}

/** A chord written as one string: `⌘⇧D` on macOS, `Ctrl+Shift+D` elsewhere. */
export function writeChord(chord: Chord, platform: Platform): string {
  return chord.join(platform === 'mac' ? '' : '+')
}

/** The binding's first key combination as text, or '' when the platform has none. */
export function formatShortcut(binding: Binding, platform: Platform, overrides: KeyOverrides = NO_OVERRIDES, view: ShortcutView = 'terminal'): string {
  const [first] = shortcutChords(binding, platform, overrides, view)
  return first ? writeChord(first, platform) : ''
}

/** What a tooltip or menu hint shows for an action on this platform. */
export function shortcutText(action: ShortcutAction, platform: Platform, overrides: KeyOverrides = NO_OVERRIDES, view: ShortcutView = 'terminal'): string {
  return formatShortcut(bindingFor(action), platform, overrides, view)
}

type KeyInput = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

export type ShortcutMatch = { action: ShortcutAction }

function matches(combo: Combo, event: KeyInput, platform: Platform): boolean {
  const wanted = (modifier: Modifier) => combo.mods.includes(modifier)
  if (event.metaKey !== (platform === 'mac' && wanted('cmd'))) return false
  if (event.ctrlKey !== wanted('ctrl')) return false
  if (event.altKey !== wanted('alt')) return false
  if (!combo.anyShift && event.shiftKey !== wanted('shift')) return false
  const pressed = event.key.toLowerCase()
  return (EVENT_KEYS[combo.key] ?? [combo.key.toLowerCase()]).includes(pressed)
}

/**
 * The window shortcut this key press is, or null when it belongs to the shell. Modifiers must match
 * exactly, so Ctrl+T on Windows or Linux (a shell's own key) is never taken. Features not built yet
 * return null too, so their keys still reach the terminal.
 */
export function matchShortcut(event: KeyInput, platform: Platform, overrides: KeyOverrides = NO_OVERRIDES, view: ShortcutView = 'terminal'): ShortcutMatch | null {
  for (const binding of BINDINGS) {
    if (!binding.available) continue
    for (const combo of combosOf(binding, platform, overrides, view)) {
      if (!matches(combo, event, platform)) continue
      return { action: binding.action }
    }
  }
  return null
}

export type HotkeyRow = {
  action: string
  group: HotkeyGroup
  /** Alternatives in the view asked for: any one of these does it. */
  chords: Chord[]
  /** Keys that do it only in the other view (Windows and Linux), so Settings can name both. */
  otherView: Chord[]
  /** The action, for a row Settings can change; null for a key that is the terminal's. */
  id: ShortcutAction | null
  /** Its keys were chosen in Settings, not the action's own. */
  changed: boolean
}

/** The modifier keys drawn as symbols, which the keycaps set in the interface font. */
const MODIFIER_SYMBOLS: ReadonlySet<string> = new Set(['⌘', '⇧', '⌃', '⌥'])
export const isModifierSymbol = (key: string): boolean => MODIFIER_SYMBOLS.has(key)

/** The Hotkeys list, in the words the window uses. Actions without a key here, or not built yet, are left out. */
export function hotkeyRows(platform: Platform, overrides: KeyOverrides = NO_OVERRIDES, view: ShortcutView = 'terminal'): HotkeyRow[] {
  const elsewhere: ShortcutView = view === 'chat' ? 'terminal' : 'chat'
  const rows: HotkeyRow[] = BINDINGS.filter((binding) => binding.available)
    .map((binding) => {
      const chords = shortcutChords(binding, platform, overrides, view)
      const written = new Set(chords.map((chord) => chord.join('+')))
      const otherView = shortcutChords(binding, platform, overrides, elsewhere).filter((chord) => !written.has(chord.join('+')))
      return { action: binding.label, group: binding.group, chords, otherView, id: binding.action, changed: overrides[binding.action] !== undefined }
    })
    .filter((row) => row.chords.length > 0)
  const ctrl = platform === 'mac' ? MAC_GLYPH.ctrl : WORD.ctrl
  for (const key of TERMINAL_KEYS) rows.push({ action: key.label, group: key.group, chords: [[ctrl, key.letter]], otherView: [], id: null, changed: false })
  return rows
}

/** Marks the field in Settings › Hotkeys that takes down a new key, so the window and the dialog leave its keys alone. */
export const KEY_CAPTURE_ATTRIBUTE = 'data-key-capture'

/** Keys that are only held for another: a capture waits for the key pressed with them. */
const HELD_ONLY: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'Fn'])
const SINGLE_LETTER = /^[a-z]$/i
/** Longer than any key name `KeyboardEvent.key` reports, so a saved value that is not one is dropped. */
const MAX_KEY_LENGTH = 16

/** A key press in the capture field of Settings › Hotkeys: still waiting, the combination it makes, or why it cannot be one. */
export type Captured = { kind: 'waiting' } | { kind: 'combo'; combo: Combo } | { kind: 'refused'; reason: string }

/**
 * What a key pressed in the capture field makes. The terminal keeps its own keys (the contract at the top of this file):
 * on macOS a window key needs ⌘, and on Windows and Linux it needs Ctrl, with Shift or Alt beside a letter.
 */
export function captureCombo(event: KeyInput, platform: Platform): Captured {
  if (HELD_ONLY.has(event.key)) return { kind: 'waiting' }
  const mods = MODIFIERS.filter((modifier) => (modifier === 'cmd' ? platform === 'mac' && event.metaKey : modifier === 'ctrl' ? event.ctrlKey : modifier === 'alt' ? event.altKey : event.shiftKey))
  const key = keycapOf(event.key)
  if (platform === 'mac') {
    if (!mods.includes('cmd')) return { kind: 'refused', reason: 'A window key needs ⌘ on macOS; Ctrl and ⌥ keys belong to the terminal.' }
  } else {
    if (event.metaKey) return { kind: 'refused', reason: 'The Windows key belongs to the system.' }
    if (!mods.includes('ctrl')) return { kind: 'refused', reason: 'A window key needs Ctrl; other keys belong to the terminal.' }
    if (SINGLE_LETTER.test(key) && mods.length === 1) return { kind: 'refused', reason: `Ctrl+${key} is the shell's own key. Add Shift or Alt.` }
  }
  return { kind: 'combo', combo: { mods, key } }
}

/** How a pressed key is drawn: letters in capitals, the minus sign and the space bar by name or glyph. */
function keycapOf(key: string): string {
  if (key === ' ') return 'Space'
  if (key === '-') return '−'
  return key.length === 1 ? key.toUpperCase() : key
}

/** The key press a combination is, to compare it with the others through the same test the window uses. */
function pressOf(combo: Combo, platform: Platform): KeyInput {
  const held = (modifier: Modifier) => combo.mods.includes(modifier)
  return { key: (EVENT_KEYS[combo.key] ?? [combo.key])[0] ?? combo.key, metaKey: platform === 'mac' && held('cmd'), ctrlKey: held('ctrl'), altKey: held('alt'), shiftKey: held('shift') }
}

/** The other action this combination already does, if any, with the chosen keys in place. */
export function takenBy(combo: Combo, action: ShortcutAction, platform: Platform, overrides: KeyOverrides): Binding | null {
  const press = pressOf(combo, platform)
  const views: readonly ShortcutView[] = ['terminal', 'chat']
  for (const view of views) {
    const match = matchShortcut(press, platform, overrides, view)
    if (match !== null && match.action !== action) return bindingFor(match.action)
  }
  return null
}

/** Whether the combination is one of the action's own keys here, so choosing it is the same as resetting. */
export function isOwnKey(combo: Combo, action: ShortcutAction, platform: Platform): boolean {
  const binding = bindingFor(action)
  const own = platform === 'mac' ? binding.mac : [...binding.other, ...(binding.chat ?? [])]
  return own.some((candidate) => matches(candidate, pressOf(combo, platform), platform))
}

function isModifier(value: unknown): value is Modifier {
  return MODIFIERS.some((modifier) => modifier === value)
}

function isCombo(value: unknown): value is Combo {
  if (typeof value !== 'object' || value === null) return false
  const { mods, key } = value as { mods?: unknown; key?: unknown }
  return Array.isArray(mods) && mods.every(isModifier) && typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH
}

/** The chosen keys from saved settings, keeping only known actions with a well-formed combination. */
export function readKeyOverrides(value: unknown): KeyOverrides {
  if (typeof value !== 'object' || value === null) return NO_OVERRIDES
  const read: KeyOverrides = {}
  for (const binding of BINDINGS) {
    const combo: unknown = (value as Record<string, unknown>)[binding.action]
    if (isCombo(combo)) read[binding.action] = { mods: [...combo.mods], key: combo.key }
  }
  return read
}
