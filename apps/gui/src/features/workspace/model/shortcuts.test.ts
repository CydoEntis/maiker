import { describe, expect, it } from 'vitest'
import { ESC_LADDER, topmostOpen } from './escLadder'
import { BINDINGS, HOTKEY_GROUPS, bindingFor, captureCombo, detectPlatform, formatShortcut, hotkeyRows, isOwnKey, matchShortcut, readKeyOverrides, shortcutChords, shortcutText, takenBy, type KeyOverrides, type Platform, type ShortcutAction } from './shortcuts'

type Key = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }

/** The key press a chord written as text stands for, so the table below is the only place a key is spelled out. */
function pressOf(text: string, platform: Platform): Key {
  const symbols = text.match(/^[⌘⌃⌥⇧]*/)?.[0] ?? ''
  const parts = platform === 'mac' ? [...Array.from(symbols), text.slice(symbols.length)] : text.split('+')
  const named = parts.at(-1) ?? ''
  const mods = new Set(parts.slice(0, -1))
  const shifted = mods.has('Shift') || mods.has('⇧')
  const key = named === '−' ? '-' : shifted ? named : named.toLowerCase()
  return { key, ctrlKey: mods.has('Ctrl') || mods.has('⌃'), metaKey: mods.has('⌘'), shiftKey: shifted, altKey: mods.has('Alt') || mods.has('⌥') }
}

/** One row per binding: what the keycap says on macOS and on Windows and Linux ('' = no key there). */
const TABLE: readonly [ShortcutAction, string, string][] = [
  ['new-session', '⌘T', 'Ctrl+Shift+T'],
  ['new-terminal', '⌘⇧T', 'Ctrl+Alt+T'],
  ['new-worktree', '⌘⇧N', 'Ctrl+Shift+N'],
  ['open-folder', '⌘O', 'Ctrl+Shift+O'],
  ['fetch', '⌘⇧F', 'Ctrl+Alt+Shift+F'],
  ['split-right', '⌘D', 'Ctrl+Shift+D'],
  ['split-down', '⌘⇧D', 'Ctrl+Alt+Shift+D'],
  ['focus-previous', '⌘[', 'Ctrl+['],
  ['focus-next', '⌘]', 'Ctrl+]'],
  ['close', '⌘W', 'Ctrl+Shift+W'],
  ['undo-close', '⌘Z', 'Ctrl+Shift+Z'],
  ['broadcast', '⌘⇧B', 'Ctrl+Alt+Shift+B'],
  ['palette', '⌘K', 'Ctrl+Shift+K'],
  ['jump-needs', '⌘J', 'Ctrl+Shift+J'],
  ['inspect', '⌘I', 'Ctrl+Shift+I'],
  ['find', '⌘F', 'Ctrl+Shift+F'],
  ['toggle-sidebar', '⌘B', 'Ctrl+Shift+B'],
  ['terminal', '⌃`', 'Ctrl+Shift+`'],
  ['usage', '⌘⇧U', 'Ctrl+Shift+U'],
  ['performance', '⌘⇧P', 'Ctrl+Shift+P'],
  ['focus-mode', '⌘.', 'Ctrl+.'],
  ['settings', '⌘,', 'Ctrl+,'],
  ['text-larger', '⌘=', 'Ctrl+='],
  ['text-smaller', '⌘−', 'Ctrl+−'],
  ['shortcuts', '⌘/', 'Ctrl+/'],
]

const PLATFORMS: readonly Platform[] = ['mac', 'windows', 'linux']

describe('the shortcut table', () => {
  it('has a row for every binding and nothing else', () => {
    expect(TABLE.map(([action]) => action).sort()).toEqual(BINDINGS.map((binding) => binding.action).sort())
  })

  it.each(TABLE)('writes %s as %s on macOS and %s on Windows and Linux', (action, mac, other) => {
    expect(formatShortcut(bindingFor(action), 'mac')).toBe(mac)
    expect(formatShortcut(bindingFor(action), 'windows')).toBe(other)
    expect(formatShortcut(bindingFor(action), 'linux')).toBe(other)
    expect(shortcutText(action, 'mac')).toBe(mac)
  })

  it('splits a chord into its keycaps', () => {
    expect(shortcutChords(bindingFor('split-down'), 'mac')).toEqual([['⌘', '⇧', 'D']])
    expect(shortcutChords(bindingFor('split-down'), 'windows')).toEqual([['Ctrl', 'Alt', 'Shift', 'D']])
    expect(shortcutChords(bindingFor('jump-needs'), 'linux')).toEqual([['Ctrl', 'Shift', 'J']])
  })

  it('gives no two actions the same key on a platform', () => {
    for (const platform of PLATFORMS) {
      const written = TABLE.map(([action]) => formatShortcut(bindingFor(action), platform)).filter((text) => text !== '')
      expect(new Set(written).size).toBe(written.length)
    }
  })
})

describe('matching a key press', () => {
  const live = TABLE.filter(([action]) => bindingFor(action).available)

  it.each(live)('%s is taken from %s on macOS and from %s on Windows and Linux', (action, mac, other) => {
    const expected = { action }
    const press = (text: string, platform: Platform) => matchShortcut(pressOf(text, platform), platform)
    expect(press(mac, 'mac')).toEqual(expected)
    if (other !== '') {
      expect(press(other, 'windows')).toEqual(expected)
      expect(press(other, 'linux')).toEqual(expected)
    }
  })

  it('has no key registered for a feature that is not built', () => {
    expect(BINDINGS.filter((binding) => !binding.available)).toEqual([])
  })

  it('never takes a bare Ctrl+letter on Windows or Linux', () => {
    for (const platform of ['windows', 'linux'] as const) {
      for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
        for (const key of [letter, letter.toUpperCase()]) {
          expect(matchShortcut({ key, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, platform), `Ctrl+${key}`).toBeNull()
        }
      }
    }
  })

  it('claims no bare Ctrl+letter in the terminal view on Windows or Linux', () => {
    for (const binding of BINDINGS) {
      for (const combo of binding.other) {
        const bare = combo.mods.length === 1 && combo.mods[0] === 'ctrl'
        expect(bare && /^[a-z]$/i.test(combo.key), `${binding.action} ${combo.key}`).toBe(false)
      }
    }
  })

  it('leaves Ctrl alone on macOS and Cmd alone elsewhere', () => {
    expect(matchShortcut(pressOf('Ctrl+d', 'linux'), 'mac')).toBeNull()
    expect(matchShortcut({ key: 't', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false }, 'linux')).toBeNull()
  })

  it('shows or hides the terminal with Shift+` as the layout types it, ~ on most keyboards', () => {
    expect(matchShortcut({ key: '~', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }, 'windows')).toEqual({ action: 'terminal' })
    expect(matchShortcut({ key: '`', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }, 'linux')).toEqual({ action: 'terminal' })
    expect(matchShortcut({ key: '`', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, 'mac')).toEqual({ action: 'terminal' })
    // Plain Ctrl+` stays the shell's on Windows and Linux.
    expect(matchShortcut({ key: '`', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, 'linux')).toBeNull()
  })

  it('needs the modifiers exactly, so Ctrl+Shift+T is a new session and Ctrl+Alt+T (or Ctrl+Alt+Shift+T) a new shell', () => {
    expect(matchShortcut({ key: 't', ctrlKey: true, metaKey: false, shiftKey: false, altKey: true }, 'linux')).toEqual({ action: 'new-terminal' })
    // There is no second way in: Ctrl+Shift+A no longer starts an agent without the dialog.
    expect(matchShortcut({ key: 'A', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }, 'linux')).toBeNull()
    expect(matchShortcut({ key: 'T', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }, 'linux')).toEqual({ action: 'new-session' })
    expect(matchShortcut({ key: 'T', ctrlKey: true, metaKey: false, shiftKey: true, altKey: true }, 'linux')).toEqual({ action: 'new-terminal' })
    expect(matchShortcut({ key: 't', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false }, 'linux')).toBeNull()
    // macOS spends Cmd and Cmd+Shift on the two.
    expect(matchShortcut({ key: 't', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false }, 'mac')).toEqual({ action: 'new-session' })
    expect(matchShortcut({ key: 'T', ctrlKey: false, metaKey: true, shiftKey: true, altKey: false }, 'mac')).toEqual({ action: 'new-terminal' })
  })

  it('passes keys the window does not own to the shell', () => {
    for (const platform of PLATFORMS) {
      expect(matchShortcut({ key: 'c', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, platform)).toBeNull()
      expect(matchShortcut({ key: 'l', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, platform)).toBeNull()
      expect(matchShortcut({ key: 't', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, platform)).toBeNull()
    }
  })

  it('takes Ctrl and Shift plus = as larger text on a layout where + needs Shift', () => {
    expect(matchShortcut({ key: '+', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }, 'linux')).toEqual({ action: 'text-larger' })
  })

  it('jumps to the next session that needs you on Cmd+J on macOS and Ctrl+Shift+J elsewhere, and leaves a bare Ctrl+J to the terminal', () => {
    expect(matchShortcut({ key: 'j', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false }, 'mac')).toEqual({ action: 'jump-needs' })
    expect(matchShortcut({ key: 'J', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }, 'linux')).toEqual({ action: 'jump-needs' })
    expect(matchShortcut({ key: 'j', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, 'linux')).toBeNull()
  })

  it('has no tab shortcuts: Ctrl+Tab and Ctrl+1 belong to the terminal now', () => {
    expect(matchShortcut({ key: 'Tab', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, 'windows')).toBeNull()
    expect(matchShortcut({ key: '1', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, 'windows')).toBeNull()
  })
})

describe('the shortcut lists', () => {
  it('lists the hotkeys in the platform’s words', () => {
    expect(hotkeyRows('mac').find((row) => row.action === 'Split down')).toEqual({ action: 'Split down', group: 'Panes', chords: [['⌘', '⇧', 'D']], id: 'split-down', changed: false, otherView: [] })
    expect(hotkeyRows('windows').find((row) => row.action === 'Split down')).toEqual({ action: 'Split down', group: 'Panes', chords: [['Ctrl', 'Alt', 'Shift', 'D']], id: 'split-down', changed: false, otherView: [] })
  })

  it('shows the terminal’s own keys as the terminal’s', () => {
    expect(hotkeyRows('linux').find((row) => row.action === 'Interrupt')?.chords).toEqual([['Ctrl', 'C']])
    expect(hotkeyRows('mac').find((row) => row.action === 'Interrupt')?.chords).toEqual([['⌃', 'C']])
  })

  it('lists jumping to what needs you on every platform, and leaves out an action that is not built', () => {
    expect(hotkeyRows('linux').some((row) => row.action.startsWith('Jump to the next'))).toBe(true)
    expect(hotkeyRows('mac').some((row) => row.action.startsWith('Jump to the next'))).toBe(true)
    expect(hotkeyRows('mac').some((row) => row.action === 'Overview')).toBe(false)
    expect(hotkeyRows('mac').some((row) => row.action === 'Session panel')).toBe(false)
    expect(hotkeyRows('mac').some((row) => row.action === 'Undo close')).toBe(true)
  })

  it('puts every hotkey in a group of the overlay, and every group has some', () => {
    const rows = hotkeyRows('linux')
    expect(rows.every((row) => HOTKEY_GROUPS.includes(row.group))).toBe(true)
    for (const group of HOTKEY_GROUPS) expect(rows.some((row) => row.group === group)).toBe(true)
  })

  it('knows the platform from the user agent', () => {
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('mac')
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows')
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
  })
})

describe('the Esc ladder', () => {
  it('closes the topmost layer first, in the order of v18 C.9', () => {
    expect(ESC_LADDER.indexOf('palette')).toBeLessThan(ESC_LADDER.indexOf('drawer'))
    expect(topmostOpen({ settings: true, drawer: true, 'focus-mode': true })).toBe('settings')
    expect(topmostOpen({ palette: true, settings: true })).toBe('palette')
    expect(topmostOpen({ palette: true, drawer: true })).toBe('palette')
  })

  it('leaves Esc to the terminal when nothing is open', () => {
    expect(topmostOpen({})).toBeNull()
    expect(topmostOpen({ palette: false, drawer: false })).toBeNull()
  })
})

const press = (key: string, held: Partial<Omit<Key, 'key'>> = {}): Key => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...held })

describe('keys chosen in Settings', () => {
  const chosen: KeyOverrides = { palette: { mods: ['ctrl', 'alt'], key: 'P' } }

  it('puts the chosen key in place of the action\'s own, for the key handler and every list that names it', () => {
    expect(matchShortcut(press('p', { ctrlKey: true, altKey: true }), 'linux', chosen)).toEqual({ action: 'palette' })
    expect(matchShortcut(press('K', { ctrlKey: true, shiftKey: true }), 'linux', chosen)).toBeNull()
    expect(shortcutText('palette', 'linux', chosen)).toBe('Ctrl+Alt+P')
    expect(hotkeyRows('linux', chosen).find((row) => row.id === 'palette')).toMatchObject({ chords: [['Ctrl', 'Alt', 'P']], changed: true })
  })

  it('takes down a key pressed with its modifiers, waiting while only a modifier is held', () => {
    expect(captureCombo(press('Shift', { ctrlKey: true, shiftKey: true }), 'linux')).toEqual({ kind: 'waiting' })
    expect(captureCombo(press('y', { ctrlKey: true, shiftKey: true }), 'windows')).toEqual({ kind: 'combo', combo: { mods: ['ctrl', 'shift'], key: 'Y' } })
    expect(captureCombo(press('y', { metaKey: true }), 'mac')).toEqual({ kind: 'combo', combo: { mods: ['cmd'], key: 'Y' } })
    expect(captureCombo(press('-', { ctrlKey: true, altKey: true }), 'linux')).toEqual({ kind: 'combo', combo: { mods: ['ctrl', 'alt'], key: '−' } })
  })

  it('refuses the keys that are the terminal\'s: a plain Ctrl letter, no Ctrl at all, and Ctrl without ⌘ on macOS', () => {
    expect(captureCombo(press('c', { ctrlKey: true }), 'linux')).toMatchObject({ kind: 'refused', reason: expect.stringContaining('Ctrl+C') as unknown })
    expect(captureCombo(press('y', { altKey: true }), 'windows')).toMatchObject({ kind: 'refused' })
    expect(captureCombo(press('y'), 'linux')).toMatchObject({ kind: 'refused' })
    expect(captureCombo(press('y', { ctrlKey: true }), 'mac')).toMatchObject({ kind: 'refused' })
  })

  it('names the action a key already does, with the chosen keys in place', () => {
    expect(takenBy({ mods: ['ctrl', 'shift'], key: 'K' }, 'find', 'linux', {})?.action).toBe('palette')
    // Once the palette has moved, its old key is free.
    expect(takenBy({ mods: ['ctrl', 'shift'], key: 'K' }, 'find', 'linux', chosen)).toBeNull()
    expect(takenBy({ mods: ['ctrl', 'alt'], key: 'P' }, 'find', 'linux', chosen)?.action).toBe('palette')
    // Shift with = is still "larger", as the key handler reads it.
    expect(takenBy({ mods: ['ctrl', 'shift'], key: '=' }, 'find', 'linux', {})?.action).toBe('text-larger')
    expect(takenBy({ mods: ['ctrl', 'shift'], key: 'K' }, 'palette', 'linux', {})).toBeNull()
  })

  it('knows a key that is the action\'s own, so choosing it again resets it', () => {
    expect(isOwnKey({ mods: ['ctrl', 'shift'], key: 'K' }, 'palette', 'linux')).toBe(true)
    expect(isOwnKey({ mods: ['cmd'], key: 'K' }, 'palette', 'mac')).toBe(true)
    expect(isOwnKey({ mods: ['ctrl', 'alt'], key: 'P' }, 'palette', 'linux')).toBe(false)
  })

  it('reads back only known actions with a well-formed key from saved settings', () => {
    expect(readKeyOverrides({ palette: { mods: ['ctrl', 'alt'], key: 'P' }, nope: { mods: ['ctrl'], key: 'X' }, find: { mods: ['hyper'], key: 'F' }, usage: { mods: ['ctrl'], key: '' } })).toEqual(chosen)
    expect(readKeyOverrides('junk')).toEqual({})
    expect(readKeyOverrides(undefined)).toEqual({})
  })
})

describe('the keys by view', () => {
  const press = (key: string, mods: { shift?: boolean; alt?: boolean } = {}): Key => ({ key, ctrlKey: true, metaKey: false, shiftKey: mods.shift === true, altKey: mods.alt === true })
  const CHAT_PLAIN: readonly [string, ShortcutAction][] = [['k', 'palette'], ['w', 'close'], ['o', 'open-folder']]

  it.each(CHAT_PLAIN)('takes plain Ctrl+%s as %s in the chat view and passes it to the terminal in the terminal view', (letter, action) => {
    for (const platform of ['windows', 'linux'] as const) {
      expect(matchShortcut(press(letter), platform, {}, 'chat')).toEqual({ action })
      expect(matchShortcut(press(letter), platform, {}, 'terminal')).toBeNull()
      expect(matchShortcut(press(letter.toUpperCase(), { shift: true }), platform, {}, 'terminal')).toEqual({ action })
      expect(matchShortcut(press(letter.toUpperCase(), { shift: true }), platform, {}, 'chat')).toEqual({ action })
    }
  })

  it('takes no other plain Ctrl+letter in either view, so a chat text box keeps Ctrl+A, C, V, X and Z', () => {
    const taken = new Set(CHAT_PLAIN.map(([letter]) => letter))
    for (const view of ['chat', 'terminal'] as const) {
      for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
        if (view === 'chat' && taken.has(letter)) continue
        expect(matchShortcut(press(letter), 'windows', {}, view), `${view} Ctrl+${letter}`).toBeNull()
      }
      expect(matchShortcut(press('Backspace'), 'windows', {}, view)).toBeNull()
    }
  })

  it('makes Ctrl+Shift+F fetch in the chat view and Find in the terminal view, with fetch on Ctrl+Alt+Shift+F there', () => {
    expect(matchShortcut(press('F', { shift: true }), 'linux', {}, 'chat')).toEqual({ action: 'fetch' })
    expect(matchShortcut(press('F', { shift: true }), 'linux', {}, 'terminal')).toEqual({ action: 'find' })
    expect(matchShortcut(press('F', { shift: true, alt: true }), 'linux', {}, 'terminal')).toEqual({ action: 'fetch' })
    expect(matchShortcut(press('F', { shift: true, alt: true }), 'linux', {}, 'chat')).toEqual({ action: 'fetch' })
    expect(matchShortcut(press('f', { alt: true }), 'linux', {}, 'chat')).toEqual({ action: 'find' })
  })

  it('does not change macOS between the views', () => {
    const cmdO = { key: 'o', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false }
    expect(matchShortcut(cmdO, 'mac', {}, 'chat')).toEqual({ action: 'open-folder' })
    expect(matchShortcut(cmdO, 'mac', {}, 'terminal')).toEqual({ action: 'open-folder' })
    expect(shortcutText('palette', 'mac', {}, 'chat')).toBe('⌘K')
  })

  it('writes the hint for the view it is in', () => {
    expect(shortcutText('palette', 'windows', {}, 'chat')).toBe('Ctrl+K')
    expect(shortcutText('palette', 'windows', {}, 'terminal')).toBe('Ctrl+Shift+K')
    expect(shortcutText('open-folder', 'linux', {}, 'chat')).toBe('Ctrl+O')
    expect(shortcutText('open-folder', 'linux', {}, 'terminal')).toBe('Ctrl+Shift+O')
    expect(shortcutText('fetch', 'linux', {}, 'chat')).toBe('Ctrl+Shift+F')
    expect(shortcutText('fetch', 'linux', {}, 'terminal')).toBe('Ctrl+Alt+Shift+F')
    expect(shortcutText('settings', 'linux', {}, 'chat')).toBe('Ctrl+,')
  })

  it('lists both views in Settings > Hotkeys', () => {
    const row = hotkeyRows('windows', {}, 'terminal').find((candidate) => candidate.id === 'palette')
    expect(row?.chords).toEqual([['Ctrl', 'Shift', 'K']])
    expect(row?.otherView).toEqual([['Ctrl', 'K']])
    expect(hotkeyRows('windows', {}, 'chat').find((candidate) => candidate.id === 'palette')?.chords).toEqual([['Ctrl', 'K'], ['Ctrl', 'Shift', 'K']])
    expect(hotkeyRows('mac', {}, 'chat').find((candidate) => candidate.id === 'palette')?.otherView).toEqual([])
  })

  it('refuses a chosen key that is another action in either view', () => {
    expect(takenBy({ mods: ['ctrl'], key: 'K' }, 'settings', 'windows', {})?.action).toBe('palette')
    expect(takenBy({ mods: ['ctrl', 'shift'], key: 'F' }, 'find', 'windows', {})?.action).toBe('fetch')
  })
})
