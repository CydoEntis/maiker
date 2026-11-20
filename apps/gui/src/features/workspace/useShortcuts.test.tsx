import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEY_CAPTURE_ATTRIBUTE, type KeyOverrides, type ShortcutView } from './model/shortcuts'
import { useShortcutKeys } from './useShortcuts'

function listen(canUndoClose: boolean, keyOverrides: KeyOverrides = {}, open: { addMachineOpen?: boolean; setAddMachineOpen?: () => void; view?: ShortcutView } = {}) {
  const runShortcut = vi.fn()
  renderHook(() => {
    useShortcutKeys({
      view: open.view ?? 'terminal',
      runShortcut,
      canUndoClose,
      dialogOpen: open.addMachineOpen === true,
      addMachineOpen: open.addMachineOpen === true,
      onNewChatPage: false,
      overlayOpen: false,
      paletteOpen: false,
      focusMode: false,
      drawerShown: false,
      welcomeOpen: false,
      shortcutsOpen: false,
      setPaletteOpen: vi.fn(),
      setAddMachineOpen: open.setAddMachineOpen ?? vi.fn(),
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

function pressUndoIn(className: string) {
  const field = document.createElement('textarea')
  field.className = className
  document.body.append(field)
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
}

describe('the undo close shortcut', () => {
  afterEach(() => { document.body.replaceChildren() })

  it('undoes a close while the keys are in a terminal', () => {
    const runShortcut = listen(true)
    pressUndoIn('xterm-helper-textarea')
    expect(runShortcut).toHaveBeenCalledWith('undo-close')
  })

  it('leaves undo to a text field', () => {
    const runShortcut = listen(true)
    pressUndoIn('')
    expect(runShortcut).not.toHaveBeenCalled()
  })

  it('leaves the key to the terminal when nothing was just closed', () => {
    const runShortcut = listen(false)
    pressUndoIn('xterm-helper-textarea')
    expect(runShortcut).not.toHaveBeenCalled()
  })
})

describe('a key chosen in Settings', () => {
  afterEach(() => { document.body.replaceChildren() })

  const press = (target: HTMLElement, key: string, held: KeyboardEventInit) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held }))
  }

  it('runs its action, and the action\'s old key no longer does', () => {
    const runShortcut = listen(false, { palette: { mods: ['ctrl', 'alt'], key: 'P' } })

    press(document.body, 'K', { ctrlKey: true, shiftKey: true })
    expect(runShortcut).not.toHaveBeenCalled()
    press(document.body, 'p', { ctrlKey: true, altKey: true })
    expect(runShortcut).toHaveBeenCalledExactlyOnceWith('palette')
  })

  it('is not acted on while Settings is taking down a new key', () => {
    const runShortcut = listen(false)
    const field = document.createElement('button')
    field.setAttribute(KEY_CAPTURE_ATTRIBUTE, '')
    document.body.append(field)

    press(field, 'K', { ctrlKey: true, shiftKey: true })

    expect(runShortcut).not.toHaveBeenCalled()
  })
})

describe('the Add a remote machine dialog', () => {
  afterEach(() => { document.body.replaceChildren() })

  it('holds the app’s shortcuts while it is open, and Esc closes it', () => {
    const close = vi.fn()
    const runShortcut = listen(false, {}, { addMachineOpen: true, setAddMachineOpen: close })
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    expect(runShortcut).not.toHaveBeenCalled()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(close).toHaveBeenCalledWith(false)
  })
})

describe('the keys by view', () => {
  afterEach(() => { document.body.replaceChildren() })

  function pressIn(target: string, init: KeyboardEventInit) {
    const field = document.createElement(target)
    document.body.append(field)
    field.focus()
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    field.dispatchEvent(event)
    return event
  }

  it('takes plain Ctrl+K from a chat text box and keeps the box its own for Ctrl+A, C, V, X, Z and Backspace', () => {
    const runShortcut = listen(false, {}, { view: 'chat' })
    expect(pressIn('textarea', { key: 'k', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(runShortcut).toHaveBeenCalledWith('palette')
    runShortcut.mockClear()
    for (const key of ['a', 'c', 'v', 'x', 'z', 'Backspace']) expect(pressIn('textarea', { key, ctrlKey: true }).defaultPrevented, key).toBe(false)
    expect(runShortcut).not.toHaveBeenCalled()
  })

  it('leaves plain Ctrl+K to the terminal in the terminal view and takes Ctrl+Shift+K', () => {
    const runShortcut = listen(false, {}, { view: 'terminal' })
    expect(pressIn('textarea', { key: 'k', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(runShortcut).not.toHaveBeenCalled()
    pressIn('textarea', { key: 'K', ctrlKey: true, shiftKey: true })
    expect(runShortcut).toHaveBeenCalledWith('palette')
  })

  it('still takes the Ctrl+Shift form in the chat view', () => {
    const runShortcut = listen(false, {}, { view: 'chat' })
    pressIn('textarea', { key: 'K', ctrlKey: true, shiftKey: true })
    expect(runShortcut).toHaveBeenCalledWith('palette')
  })
})
