import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEY_CAPTURE_ATTRIBUTE, type KeyOverrides } from './model/shortcuts'
import { useShortcutKeys } from './useShortcuts'

function listen(keyOverrides: KeyOverrides = {}, open: { shortcutsOpen?: boolean; paletteOpen?: boolean; dialogOpen?: boolean; onNewChatPage?: boolean } = {}) {
  const runShortcut = vi.fn()
  renderHook(() => {
    useShortcutKeys({
      runShortcut,
      dialogOpen: open.dialogOpen ?? false,
      onNewChatPage: open.onNewChatPage ?? false,
      overlayOpen: open.paletteOpen ?? false,
      paletteOpen: open.paletteOpen ?? false,
      focusMode: false,
      drawerShown: false,
      welcomeOpen: false,
      shortcutsOpen: open.shortcutsOpen ?? false,
      setPaletteOpen: vi.fn(),
      setSettingsSection: vi.fn(),
      setNewChatOpen: vi.fn(),
      setDrawerOpen: vi.fn(),
      setFocusMode: vi.fn(),
      platform: 'windows',
      keyOverrides,
    })
  })
  return runShortcut
}

/** Presses a key in a focused `tag`, and says whether the field itself heard it and whether its default was left alone. */
function pressIn(tag: string, init: KeyboardEventInit) {
  const field = document.createElement(tag)
  document.body.append(field)
  field.focus()
  const heard = vi.fn()
  field.addEventListener('keydown', heard)
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  field.dispatchEvent(event)
  return { reached: heard.mock.calls.length > 0, prevented: event.defaultPrevented }
}

afterEach(() => { document.body.replaceChildren() })

describe('a key chosen in Settings', () => {
  const press = (target: HTMLElement, key: string, held: KeyboardEventInit) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held }))
  }

  it('runs its action, and the action\'s old key no longer does', () => {
    const runShortcut = listen({ palette: { mods: ['ctrl', 'shift'], key: 'H' } })

    press(document.body, 'P', { ctrlKey: true, shiftKey: true })
    expect(runShortcut).not.toHaveBeenCalled()
    press(document.body, 'H', { ctrlKey: true, shiftKey: true })
    expect(runShortcut).toHaveBeenCalledExactlyOnceWith('palette', undefined)
  })

  it('is not acted on while Settings is taking down a new key', () => {
    const runShortcut = listen()
    const field = document.createElement('button')
    field.setAttribute(KEY_CAPTURE_ATTRIBUTE, '')
    document.body.append(field)

    press(field, 'P', { ctrlKey: true, shiftKey: true })

    expect(runShortcut).not.toHaveBeenCalled()
  })
})

describe('the window\'s keys and the field with the focus', () => {
  it('takes a window key before the field hears it, the same in a text box as anywhere', () => {
    const runShortcut = listen()
    expect(pressIn('textarea', { key: 'P', ctrlKey: true, shiftKey: true })).toEqual({ reached: false, prevented: true })
    expect(runShortcut).toHaveBeenCalledWith('palette', undefined)
    expect(pressIn('textarea', { key: 'F6' }).reached).toBe(false)
    expect(runShortcut).toHaveBeenLastCalledWith('focus-next', undefined)
    expect(pressIn('textarea', { key: '3', code: 'Digit3', altKey: true }).reached).toBe(false)
    expect(runShortcut).toHaveBeenLastCalledWith('go-to-session', 3)
  })

  it('leaves every plain Ctrl+letter, and the keys a terminal or a text box needs, to the field', () => {
    const runShortcut = listen()
    for (const key of 'abcdefghijklmnopqrstuvwxyz') expect(pressIn('textarea', { key, ctrlKey: true }).reached, `Ctrl+${key}`).toBe(true)
    for (const key of ['a', 'c', 'v', 'x', 'z', 'k', 'o', 'w', 'Backspace']) expect(pressIn('textarea', { key, ctrlKey: true }).prevented, `Ctrl+${key}`).toBe(false)
    for (const key of ['C', 'V', 'Z']) expect(pressIn('textarea', { key, ctrlKey: true, shiftKey: true }), `Ctrl+Shift+${key}`).toEqual({ reached: true, prevented: false })
    for (const key of ['Tab', 'Enter']) expect(pressIn('textarea', { key, shiftKey: true }), `Shift+${key}`).toEqual({ reached: true, prevented: false })
    expect(runShortcut).not.toHaveBeenCalled()
  })

  it('stops the web view reloading, printing or opening its own find bar, and still passes the key on', () => {
    const runShortcut = listen()
    for (const init of [{ key: 'r', ctrlKey: true }, { key: 'F5' }, { key: 'p', ctrlKey: true }, { key: 'f', ctrlKey: true }, { key: 'g', ctrlKey: true }, { key: 'R', ctrlKey: true, shiftKey: true }]) {
      expect(pressIn('textarea', init), init.key).toEqual({ reached: true, prevented: true })
    }
    expect(runShortcut).not.toHaveBeenCalled()
  })
})

describe('the window\'s keys under something open', () => {
  it('answers only its own key while the shortcut sheet is open', () => {
    const runShortcut = listen({}, { shortcutsOpen: true })
    pressIn('div', { key: 'P', ctrlKey: true, shiftKey: true })
    expect(runShortcut).not.toHaveBeenCalled()
    pressIn('div', { key: '/', code: 'Slash', ctrlKey: true })
    expect(runShortcut).toHaveBeenCalledExactlyOnceWith('shortcuts')
  })

  it('answers only the palette\'s key while the command palette is open', () => {
    const runShortcut = listen({}, { paletteOpen: true })
    pressIn('input', { key: 'T', ctrlKey: true, shiftKey: true })
    pressIn('input', { key: 'ArrowDown', altKey: true })
    expect(runShortcut).not.toHaveBeenCalled()
    pressIn('input', { key: 'P', ctrlKey: true, shiftKey: true })
    expect(runShortcut).toHaveBeenCalledExactlyOnceWith('palette')
  })

  it('answers none under a dialog, and on the New session draft only the keys that go somewhere else', () => {
    const under = listen({}, { dialogOpen: true })
    pressIn('input', { key: 'ArrowDown', altKey: true })
    pressIn('input', { key: 'B', ctrlKey: true, shiftKey: true })
    expect(under).not.toHaveBeenCalled()
    document.body.replaceChildren()

    const draft = listen({}, { dialogOpen: true, onNewChatPage: true })
    pressIn('textarea', { key: 'B', ctrlKey: true, shiftKey: true })
    expect(draft).not.toHaveBeenCalled()
    pressIn('textarea', { key: 'ArrowDown', altKey: true })
    expect(draft).toHaveBeenCalledExactlyOnceWith('session-next', undefined)
  })
})
