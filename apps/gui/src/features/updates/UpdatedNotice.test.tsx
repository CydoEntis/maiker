import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markRestarting, takeRestarted } from './updateMemory'
import { UpdatedNotice } from './UpdatedNotice'
import { Toaster } from '@/components/ui/toaster'
import { resetToasts, TOAST_HIDE_MS } from '@/lib/toast'

const update = { version: '0.65.0', previous: '0.64.0', notes: '- Faster switching\n- Idle updates', automatic: true }

describe('updated notice', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); resetToasts() })
  afterEach(() => { resetToasts(); vi.useRealTimers() })

  function show(onDone = vi.fn()) {
    render(<><UpdatedNotice update={update} onDone={onDone} /><Toaster /></>)
    return onDone
  }

  it('says so in a success toast that goes after four seconds, as every success does', () => {
    const onDone = show()
    expect(screen.getByRole('status')).toHaveTextContent('Updated to 0.65.0')

    act(() => { vi.advanceTimersByTime(TOAST_HIDE_MS - 1) })
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(onDone).toHaveBeenCalled()
  })

  it('can be dismissed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('opens What\'s new with the release notes and says nothing was interrupted', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onDone = show()

    await user.click(screen.getByRole('button', { name: 'What’s new' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent('Faster switching')
    expect(screen.getByRole('dialog')).toHaveTextContent('Installed while nothing was running. No session was interrupted.')
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('update memory across a relaunch', () => {
  beforeEach(() => { localStorage.clear() })

  it('remembers the version, the one before it and the notes once', () => {
    markRestarting(update)
    expect(takeRestarted()).toEqual(update)
    expect(takeRestarted()).toBeNull()
  })

  it('reads the plain version an older launch stored', () => {
    localStorage.setItem('maiker.gui.update.restarted', '0.63.0')
    expect(takeRestarted()).toEqual({ version: '0.63.0', previous: null, notes: '', automatic: false })
  })
})
