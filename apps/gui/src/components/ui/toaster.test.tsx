import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetToasts, toast, TOAST_HIDE_MS } from '@/lib/toast'
import { Toaster } from './toaster'

describe('the toaster', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); resetToasts() })
  afterEach(() => { resetToasts(); vi.useRealTimers() })

  it('shows the context under the title', () => {
    render(<Toaster />)
    act(() => { toast.needs('Parser fix needs you', { context: 'devbox', description: 'It wants to run a command.' }) })
    expect(screen.getByText('devbox')).toBeInTheDocument()
  })

  it('shows two toasts in full, and from three on only the newest with how many more', () => {
    render(<Toaster />)
    act(() => { toast.error('One'); toast.error('Two') })
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    act(() => { toast.error('Three') })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByText('Three')).toBeInTheDocument()
    expect(screen.getByText('2 more, hover to see all')).toBeInTheDocument()
  })

  it('opens the whole stack while the pointer is on it and closes it after', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Toaster />)
    act(() => { toast.error('One'); toast.error('Two'); toast.error('Three'); toast.error('Four') })
    await user.hover(screen.getByText('Four'))
    expect(screen.getAllByRole('alert')).toHaveLength(4)
    expect(screen.queryByText(/more, hover to see all/)).not.toBeInTheDocument()
    await user.unhover(screen.getByText('Four'))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByText('3 more, hover to see all')).toBeInTheDocument()
  })

  it('does not hide a note while the pointer is on the stack', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Toaster />)
    act(() => { toast.info('Put away Parser fix') })
    await user.hover(screen.getByText('Put away Parser fix'))
    act(() => { vi.advanceTimersByTime(TOAST_HIDE_MS * 2) })
    expect(screen.getByText('Put away Parser fix')).toBeInTheDocument()
    await user.unhover(screen.getByText('Put away Parser fix'))
    act(() => { vi.advanceTimersByTime(TOAST_HIDE_MS) })
    expect(screen.queryByText('Put away Parser fix')).not.toBeInTheDocument()
  })
})
