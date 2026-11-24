import { describe, expect, it } from 'vitest'
import { ESC_LADDER, topmostOpen } from './escLadder'
import { BINDINGS, DIGIT_RANGE, HOTKEY_GROUPS, bindingFor, captureCombo, detectPlatform, formatShortcut, hotkeyRows, isOwnKey, matchShortcut, pressOf, readKeyOverrides, reservedReason, shortcutText, takenBy, type Combo, type KeyInput, type KeyOverrides, type Platform, type ShortcutAction } from './shortcuts'

type Key = Required<KeyInput>

/** Where the keys the table names sit, and what they type: spelled here apart from the model, so the table below is checked against real presses. */
const PLACED: Readonly<Record<string, readonly [code: string, key: string, shifted: string]>> = {
  '`': ['Backquote', '`', '~'], '\\': ['Backslash', '\\', '|'], '=': ['Equal', '=', '+'], '−': ['Minus', '-', '_'], '/': ['Slash', '/', '?'], ',': ['Comma', ',', '<'], '.': ['Period', '.', '>'],
  '[': ['BracketLeft', '[', '{'], ']': ['BracketRight', ']', '}'], '↑': ['ArrowUp', 'ArrowUp', 'ArrowUp'], '↓': ['ArrowDown', 'ArrowDown', 'ArrowDown'], Tab: ['Tab', 'Tab', 'Tab'], F6: ['F6', 'F6', 'F6'],
}

/** The key press a chord written as text stands for. */
function pressText(text: string, platform: Platform): Key {
  const symbols = text.match(/^[⌘⌃⌥⇧]*/)?.[0] ?? ''
  const parts = platform === 'mac' ? [...Array.from(symbols), text.slice(symbols.length)] : text.split('+')
  const named = parts.at(-1) ?? ''
  const mods = new Set(parts.slice(0, -1))
  const shiftKey = mods.has('Shift') || mods.has('⇧')
  const placed = PLACED[named]
  const typed = placed ? { code: placed[0], key: shiftKey ? placed[2] : placed[1] } : /^[0-9]$/.test(named) ? { code: `Digit${named}`, key: named } : { code: `Key${named}`, key: shiftKey ? named : named.toLowerCase() }
  return { ...typed, ctrlKey: mods.has('Ctrl') || mods.has('⌃'), metaKey: mods.has('⌘'), shiftKey, altKey: mods.has('Alt') || mods.has('⌥') }
}

/** One row per action with a key: what the keycap says on macOS and on Windows and Linux. */
const TABLE: readonly [ShortcutAction, string, string][] = [
  ['open-folder', '⌘O', 'Ctrl+Shift+O'],
  ['palette', '⌘K', 'Ctrl+Shift+P'],
  ['session-next', '⌘⌥↓', 'Alt+↓'],
  ['session-previous', '⌘⌥↑', 'Alt+↑'],
  ['go-to-session', '⌘1…9', 'Alt+1…9'],
  ['jump-needs', '⌘J', 'Ctrl+Shift+J'],
  ['focus-chat', '⌘L', 'Ctrl+Shift+L'],
  ['focus-sidebar', '⌘⇧S', 'Ctrl+Shift+S'],
  ['find', '⌘F', 'Ctrl+Shift+F'],
  ['new-session', '⌘T', 'Ctrl+Shift+T'],
  ['new-worktree', '⌘⇧N', 'Ctrl+Shift+N'],
  ['new-terminal', '⌘⇧T', 'Ctrl+Shift+`'],
  ['close', '⌘W', 'Ctrl+Shift+W'],
  ['switch-view', '⌘⇧Y', 'Ctrl+Shift+Y'],
  ['model-picker', '⌘⇧A', 'Ctrl+Shift+A'],
  ['inspect', '⌘B', 'Ctrl+Shift+B'],
  ['toggle-sidebar', '⌘\\', 'Ctrl+Shift+\\'],
  ['terminal', '⌃`', 'Ctrl+`'],
  ['files', '⌘⇧E', 'Ctrl+Shift+E'],
  ['changes', '⌘⇧G', 'Ctrl+Shift+G'],
  ['panel-tab-next', '⌃Tab', 'Ctrl+Tab'],
  ['panel-tab-previous', '⌃⇧Tab', 'Ctrl+Shift+Tab'],
  ['split-right', '⌘D', 'Alt+Shift+='],
  ['split-down', '⌘⇧D', 'Alt+Shift+−'],
  ['focus-next', '⌘]', 'F6'],
  ['focus-previous', '⌘[', 'Shift+F6'],
  ['settings', '⌘,', 'Ctrl+,'],
  ['shortcuts', '⌘/', 'Ctrl+/'],
  ['add-machine', '⌘⇧M', 'Ctrl+Shift+M'],
  ['usage', '⌘⇧U', 'Ctrl+Shift+U'],
  ['focus-mode', '⌘.', 'Ctrl+.'],
  ['text-larger', '⌘=', 'Ctrl+='],
  ['text-smaller', '⌘−', 'Ctrl+−'],
]

/** In the command palette only. */
const KEYLESS: readonly ShortcutAction[] = ['fetch', 'broadcast']

const PLATFORMS: readonly Platform[] = ['mac', 'windows', 'linux']
const ELSEWHERE = ['windows', 'linux'] as const
const LETTERS = Array.from('abcdefghijklmnopqrstuvwxyz')

const press = (key: string, held: Partial<Omit<Key, 'key'>> = {}): Key => ({ key, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...held })

/** Every key press the table takes on a platform, with the action it is for: a key that takes Shift or not is both, and the digit key is all nine. */
function everyPress(platform: Platform): { action: ShortcutAction; press: Key }[] {
  return BINDINGS.flatMap((binding) => (platform === 'mac' ? binding.mac : binding.other).flatMap((combo) => {
    const spelled: Combo[] = combo.key === DIGIT_RANGE ? Array.from('123456789', (key) => ({ ...combo, key })) : [combo]
    const shifts: Combo[] = spelled.flatMap((each) => (each.anyShift ? [each, { ...each, mods: [...each.mods, 'shift'] }] : [each]))
    return shifts.map((each) => ({ action: binding.action, press: pressOf(each, platform) }))
  }))
}

const spelled = (key: Key): string => [key.metaKey, key.ctrlKey, key.altKey, key.shiftKey, key.code || key.key.toLowerCase()].join('|')

describe('the shortcut table', () => {
  it('has a row for every action, and the two without a key are the palette\'s', () => {
    expect([...TABLE.map(([action]) => action), ...KEYLESS].sort()).toEqual(BINDINGS.map((binding) => binding.action).sort())
    for (const action of KEYLESS) for (const platform of PLATFORMS) expect(shortcutText(action, platform)).toBe('')
  })

  it.each(TABLE)('writes %s as %s on macOS and %s on Windows and Linux', (action, mac, other) => {
    expect(formatShortcut(bindingFor(action), 'mac')).toBe(mac)
    for (const platform of ELSEWHERE) expect(formatShortcut(bindingFor(action), platform)).toBe(other)
  })

  it('gives no two actions the same key on a platform, counting every key of every action', () => {
    for (const platform of PLATFORMS) {
      const presses = everyPress(platform)
      expect(new Set(presses.map((each) => spelled(each.press))).size, platform).toBe(presses.length)
      for (const each of presses) expect(matchShortcut(each.press, platform)?.action, `${platform} ${spelled(each.press)}`).toBe(each.action)
    }
  })

  it('uses no reserved key', () => {
    for (const platform of PLATFORMS) {
      for (const binding of BINDINGS) {
        for (const combo of platform === 'mac' ? binding.mac : binding.other) expect(reservedReason(combo, platform), `${platform} ${binding.action}`).toBeNull()
      }
    }
  })

  it('has no plain Ctrl+letter, Alt+letter or Ctrl+Alt key on Windows and Linux', () => {
    for (const binding of BINDINGS) {
      for (const combo of binding.other) {
        const letter = /^[a-z]$/i.test(combo.key)
        const mods = [...combo.mods].sort().join('+')
        expect(letter && (mods === 'ctrl' || mods === 'alt' || mods === 'alt+shift'), `${binding.action} ${combo.key}`).toBe(false)
        expect(combo.mods.includes('ctrl') && combo.mods.includes('alt'), binding.action).toBe(false)
      }
    }
    for (const platform of ELSEWHERE) {
      for (const letter of LETTERS) {
        for (const key of [letter, letter.toUpperCase()]) {
          expect(matchShortcut(press(key, { ctrlKey: true }), platform), `Ctrl+${key}`).toBeNull()
          expect(matchShortcut(press(key, { altKey: true }), platform), `Alt+${key}`).toBeNull()
          expect(matchShortcut(press(key, { ctrlKey: true, altKey: true }), platform), `Ctrl+Alt+${key}`).toBeNull()
        }
      }
    }
  })

  it('leaves the terminal, the agents and a text box their keys', () => {
    const theirs: readonly Key[] = [
      ...Array.from('CVZIRQ', (key) => press(key, { ctrlKey: true, shiftKey: true })),
      press('Tab', { shiftKey: true }), press('Enter', { shiftKey: true }), press('Enter'), press('Tab'), press('Escape'),
      press('ArrowLeft', { ctrlKey: true, shiftKey: true }), press('Backspace', { ctrlKey: true }), press('[', { ctrlKey: true, code: 'BracketLeft' }), press('\\', { ctrlKey: true, code: 'Backslash' }),
    ]
    for (const platform of ELSEWHERE) for (const key of theirs) expect(matchShortcut(key, platform), spelled(key)).toBeNull()
  })
})

describe('matching a key press', () => {
  it.each(TABLE.filter(([action]) => action !== 'go-to-session'))('%s is taken from %s on macOS and from %s on Windows and Linux', (action, mac, other) => {
    expect(matchShortcut(pressText(mac, 'mac'), 'mac')).toEqual({ action })
    for (const platform of ELSEWHERE) expect(matchShortcut(pressText(other, platform), platform)).toEqual({ action })
  })

  it('says which session a digit asks for', () => {
    expect(matchShortcut(pressText('Alt+3', 'linux'), 'linux')).toEqual({ action: 'go-to-session', digit: 3 })
    expect(matchShortcut(pressText('⌘9', 'mac'), 'mac')).toEqual({ action: 'go-to-session', digit: 9 })
    expect(matchShortcut(pressText('Alt+0', 'windows'), 'windows')).toBeNull()
  })

  it('leaves Ctrl alone on macOS and Cmd alone elsewhere', () => {
    expect(matchShortcut(press('d', { ctrlKey: true }), 'mac')).toBeNull()
    expect(matchShortcut(press('t', { metaKey: true }), 'linux')).toBeNull()
  })

  it('reads a symbol or digit by where its key sits, whatever the layout types there', () => {
    // German: the key left of 1 types a dead ^, and the key right of 0 types ß.
    expect(matchShortcut(press('Dead', { code: 'Backquote', ctrlKey: true }), 'linux')).toEqual({ action: 'terminal' })
    expect(matchShortcut(press('?', { code: 'Minus', altKey: true, shiftKey: true }), 'windows')).toEqual({ action: 'split-down' })
    // French: the digit row types & é " without Shift.
    expect(matchShortcut(press('&', { code: 'Digit1', altKey: true }), 'windows')).toEqual({ action: 'go-to-session', digit: 1 })
    // The character alone is not enough when the key sits elsewhere: Alt with a numpad digit types a character code on Windows.
    expect(matchShortcut(press('1', { code: 'Numpad1', altKey: true }), 'windows')).toBeNull()
    expect(matchShortcut(press('`', { code: 'Equal', ctrlKey: true }), 'linux')).toEqual({ action: 'text-larger' })
  })

  it('falls back to the character when a press carries no position', () => {
    expect(matchShortcut(press('~', { ctrlKey: true, shiftKey: true }), 'windows')).toEqual({ action: 'new-terminal' })
    expect(matchShortcut(press('+', { ctrlKey: true, shiftKey: true }), 'linux')).toEqual({ action: 'text-larger' })
    expect(matchShortcut(press('4', { altKey: true }), 'linux')).toEqual({ action: 'go-to-session', digit: 4 })
  })

  it('needs the modifiers exactly', () => {
    expect(matchShortcut(press('T', { ctrlKey: true, shiftKey: true }), 'linux')).toEqual({ action: 'new-session' })
    expect(matchShortcut(press('T', { ctrlKey: true, shiftKey: true, altKey: true }), 'linux')).toBeNull()
    expect(matchShortcut(press('t', { shiftKey: true }), 'linux')).toBeNull()
    expect(matchShortcut(press('F6', { ctrlKey: true }), 'linux')).toBeNull()
  })
})

describe('the shortcut lists', () => {
  it('puts every hotkey in a group of the sheet, and every group has some', () => {
    const rows = hotkeyRows('linux')
    expect(rows.every((row) => HOTKEY_GROUPS.includes(row.group))).toBe(true)
    for (const group of HOTKEY_GROUPS) expect(rows.some((row) => row.group === group)).toBe(true)
  })

  it('lists an action without a key only once one is chosen for it', () => {
    expect(hotkeyRows('linux').some((row) => row.id === 'fetch')).toBe(false)
    expect(hotkeyRows('linux', { fetch: { mods: ['ctrl', 'shift'], key: 'H' } }).find((row) => row.id === 'fetch')).toMatchObject({ chords: [['Ctrl', 'Shift', 'H']], changed: true })
  })

  it('offers no change for the terminal\'s keys or the digit key', () => {
    const fixed = hotkeyRows('windows').filter((row) => row.id === null)
    expect(fixed.map((row) => row.fixed)).toEqual(['Fixed', 'Terminal', 'Terminal'])
    expect(fixed[0]?.chords).toEqual([['Alt', DIGIT_RANGE]])
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

describe('keys chosen in Settings', () => {
  const chosen: KeyOverrides = { palette: { mods: ['ctrl', 'shift'], key: 'H' } }

  it('puts the chosen key in place of the action\'s own, for the key handler and every list that names it', () => {
    expect(matchShortcut(press('H', { ctrlKey: true, shiftKey: true }), 'linux', chosen)).toEqual({ action: 'palette' })
    expect(matchShortcut(press('P', { ctrlKey: true, shiftKey: true }), 'linux', chosen)).toBeNull()
    expect(shortcutText('palette', 'linux', chosen)).toBe('Ctrl+Shift+H')
    expect(hotkeyRows('linux', chosen).find((row) => row.id === 'palette')).toMatchObject({ chords: [['Ctrl', 'Shift', 'H']], changed: true })
  })

  it('takes down a key pressed with its modifiers, waiting while only a modifier is held', () => {
    expect(captureCombo(press('Shift', { ctrlKey: true, shiftKey: true }), 'linux')).toEqual({ kind: 'waiting' })
    expect(captureCombo(press('h', { ctrlKey: true, shiftKey: true }), 'windows')).toEqual({ kind: 'combo', combo: { mods: ['ctrl', 'shift'], key: 'H' } })
    expect(captureCombo(press('y', { metaKey: true }), 'mac')).toEqual({ kind: 'combo', combo: { mods: ['cmd'], key: 'Y' } })
    expect(captureCombo(press('ArrowLeft', { altKey: true }), 'linux')).toEqual({ kind: 'combo', combo: { mods: ['alt'], key: '←' } })
    expect(captureCombo(press('F8', { shiftKey: true }), 'windows')).toEqual({ kind: 'combo', combo: { mods: ['shift'], key: 'F8' } })
  })

  it('takes down a symbol as the key it sits on, so it is found again on any layout', () => {
    expect(captureCombo(press('~', { code: 'Backquote', ctrlKey: true, shiftKey: true }), 'linux')).toEqual({ kind: 'combo', combo: { mods: ['ctrl', 'shift'], key: '`' } })
    expect(captureCombo(press('ö', { code: 'Semicolon', ctrlKey: true }), 'windows')).toEqual({ kind: 'combo', combo: { mods: ['ctrl'], key: ';' } })
  })

  it.each<[string, Key, Platform]>([
    ['a plain Ctrl+letter', press('c', { ctrlKey: true }), 'linux'],
    ['an Alt+letter', press('y', { altKey: true }), 'windows'],
    ['a Ctrl+Alt key', press('p', { ctrlKey: true, altKey: true }), 'windows'],
    ['a key with no modifier', press('y'), 'linux'],
    ['a Shift-only key', press('Tab', { shiftKey: true }), 'linux'],
    ['Shift+Enter', press('Enter', { shiftKey: true }), 'windows'],
    ['copy in a terminal', press('C', { ctrlKey: true, shiftKey: true }), 'linux'],
    ['paste in a terminal', press('V', { ctrlKey: true, shiftKey: true }), 'windows'],
    ['redo', press('Z', { ctrlKey: true, shiftKey: true }), 'linux'],
    ['reload', press('R', { ctrlKey: true, shiftKey: true }), 'windows'],
    ['the developer tools', press('I', { ctrlKey: true, shiftKey: true }), 'linux'],
    ['quit', press('Q', { ctrlKey: true, shiftKey: true }), 'linux'],
    ['Esc in a terminal', press('[', { code: 'BracketLeft', ctrlKey: true }), 'linux'],
    ['rename', press('F2'), 'windows'],
    ['a numpad digit', press('1', { code: 'Numpad1', altKey: true }), 'windows'],
    ['the Windows key', press('k', { metaKey: true, shiftKey: true }), 'windows'],
    ['Ctrl without ⌘ on macOS', press('y', { ctrlKey: true }), 'mac'],
    ['copy on macOS', press('c', { metaKey: true }), 'mac'],
  ])('refuses %s, and says why', (_name, key, platform) => {
    expect(captureCombo(key, platform)).toEqual({ kind: 'refused', reason: expect.stringMatching(/\S/) as unknown })
  })

  it('names the action a key already does, with the chosen keys in place', () => {
    expect(takenBy({ mods: ['ctrl', 'shift'], key: 'P' }, 'find', 'linux', {})?.action).toBe('palette')
    // Once the palette has moved, its old key is free.
    expect(takenBy({ mods: ['ctrl', 'shift'], key: 'P' }, 'find', 'linux', chosen)).toBeNull()
    expect(takenBy({ mods: ['ctrl', 'shift'], key: 'H' }, 'find', 'linux', chosen)?.action).toBe('palette')
    // Shift with = is still "larger", as the key handler reads it.
    expect(takenBy({ mods: ['ctrl', 'shift'], key: '=' }, 'find', 'linux', {})?.action).toBe('text-larger')
    expect(takenBy({ mods: ['ctrl', 'shift'], key: 'P' }, 'palette', 'linux', {})).toBeNull()
    expect(takenBy({ mods: ['alt'], key: '7' }, 'find', 'linux', {})?.action).toBe('go-to-session')
  })

  it('knows a key that is the action\'s own, so choosing it again resets it', () => {
    expect(isOwnKey({ mods: ['ctrl', 'shift'], key: 'P' }, 'palette', 'linux')).toBe(true)
    expect(isOwnKey({ mods: ['cmd'], key: 'K' }, 'palette', 'mac')).toBe(true)
    expect(isOwnKey({ mods: ['ctrl', 'shift'], key: 'H' }, 'palette', 'linux')).toBe(false)
  })
})

describe('keys read back from saved settings', () => {
  const free: Combo = { mods: ['ctrl', 'shift'], key: 'H' }
  const filesKey: Combo = { mods: ['ctrl', 'shift'], key: 'E' }

  it('keeps only known actions with a well-formed key', () => {
    expect(readKeyOverrides({ palette: free, nope: { mods: ['ctrl', 'shift'], key: 'X' }, find: { mods: ['hyper'], key: 'F' }, usage: { mods: ['ctrl'], key: '' } }, 'linux')).toEqual({ palette: free })
    expect(readKeyOverrides('junk', 'linux')).toEqual({})
    expect(readKeyOverrides(undefined, 'linux')).toEqual({})
  })

  it('drops a key that is reserved now, so the action goes back to its own', () => {
    const read = readKeyOverrides({ palette: { mods: ['ctrl', 'alt'], key: 'P' }, find: { mods: ['ctrl'], key: 'K' }, usage: { mods: ['ctrl', 'shift'], key: 'V' } }, 'windows')
    expect(read).toEqual({})
    expect(shortcutText('palette', 'windows', read)).toBe('Ctrl+Shift+P')
  })

  it('drops a key that an action of the table now owns', () => {
    const read = readKeyOverrides({ find: filesKey, usage: free }, 'linux')
    expect(read).toEqual({ usage: free })
    expect(matchShortcut(pressOf(filesKey, 'linux'), 'linux', read)).toEqual({ action: 'files' })
  })

  it('keeps a key taken from an action that has moved to another', () => {
    const swapped: KeyOverrides = { palette: filesKey, files: free }
    expect(readKeyOverrides(swapped, 'linux')).toEqual(swapped)
  })

  it('drops the keys that clash once a dropped action is back on its own', () => {
    // Files moved to a reserved key, so it is back on Ctrl+Shift+E, which the palette had been given.
    expect(readKeyOverrides({ palette: filesKey, files: { mods: ['ctrl'], key: 'E' } }, 'linux')).toEqual({})
  })

  it('reads no key for the action whose keys are fixed', () => {
    expect(readKeyOverrides({ 'go-to-session': free }, 'linux')).toEqual({})
  })

  it('checks a key against the platform it was pressed on', () => {
    const cmdH: Combo = { mods: ['cmd', 'shift'], key: 'H' }
    expect(readKeyOverrides({ palette: cmdH }, 'mac')).toEqual({ palette: cmdH })
    expect(readKeyOverrides({ palette: cmdH }, 'windows')).toEqual({})
  })
})
