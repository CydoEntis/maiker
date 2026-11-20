import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEY_CAPTURE_ATTRIBUTE, type KeyOverrides } from './model/shortcuts'
import { useShortcutKeys } from './useShortcuts'

function listen(canUndoClose: boolean, keyOverrides: KeyOverrides = {}, open: { addMachineOpen?: boolean; setAddMachineOpen?: () => void } = {}) {
  const runShortcut = vi.fn()
  renderHook(() => {
    useShortcutKeys({
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
