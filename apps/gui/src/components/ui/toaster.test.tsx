import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetToasts, toast, TOAST_HIDE_MS } from '@/lib/toast'
import { Toaster } from './toaster'

describe('the toaster', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); resetToasts() })
  afterEach(() => { resetToasts(); vi.useRealTimers() })

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
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // It fades out for a moment, then is gone.
    act(() => { vi.advanceTimersByTime(TOAST_HIDE_MS) })
    expect(screen.queryByText('Put away Parser fix')).not.toBeInTheDocument()
  })
})
