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

  it('draws each kind with the app status mark, never a letter or a coloured edge', () => {
    render(<Toaster />)
    const marks: Array<[string, string | null | undefined]> = []
    for (const kind of ['info', 'success', 'error', 'warning', 'needs', 'progress'] as const) {
      act(() => { toast[kind](`A ${kind}`) })
      const card = screen.getByText(`A ${kind}`).closest('.mx-toast')
      marks.push([kind, card?.querySelector('[data-slot="status-icon"]')?.getAttribute('data-status')])
      act(() => { resetToasts() })
    }
    expect(marks).toEqual([['info', 'idle'], ['success', 'done'], ['error', 'needs'], ['warning', 'needs'], ['needs', 'needs'], ['progress', 'working']])
    expect(document.querySelector('[class*="is-edge"]')).toBeNull()
  })

  it('puts a note\'s action on its one line and a card\'s actions on their own row', () => {
    render(<Toaster />)
    act(() => {
      toast.info('Closed chameleon', { action: { label: 'Undo', onClick: () => undefined } })
      toast.needs('Fix needs you', { description: 'Wants to run pnpm test', action: { label: 'Allow', onClick: () => undefined } })
    })
    const note = screen.getByText('Closed chameleon').closest('.mx-toast')
    const card = screen.getByText('Fix needs you').closest('.mx-toast')
    expect(note).toHaveClass('is-note')
    expect(note?.querySelector('.mx-toast-actions')).toBeNull()
    expect(card?.querySelector('.mx-toast-actions')).toHaveTextContent('Allow')
  })

  it('counts a toast that hides itself down with a line, and leaves one that stays without it', () => {
    render(<Toaster />)
    act(() => { toast.success('Pushed'); toast.error('Broke') })
    expect(screen.getByText('Pushed').closest('.mx-toast')?.querySelector('.mx-toast-bar')).toHaveStyle({ animationDuration: `${String(TOAST_HIDE_MS)}ms` })
    expect(screen.getByText('Broke').closest('.mx-toast')?.querySelector('.mx-toast-bar')).toBeNull()
  })

  it('shows two layers behind the newest toast while the stack is folded', () => {
    render(<Toaster />)
    act(() => { toast.error('One'); toast.error('Two'); toast.error('Three') })
    expect(document.querySelectorAll('.mx-toast-ghost')).toHaveLength(2)
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
