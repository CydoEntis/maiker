import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TicketSetupAsk } from '@/api/ticketSetup'
import { useTicketSetupAsks } from './useTicketSetupAsks'

const heard = vi.hoisted(() => ({ onAsk: null as ((ask: TicketSetupAsk) => void) | null }))
vi.mock('@/api/ticketSetup', () => ({
  listenTicketSetup: (onAsk: (ask: TicketSetupAsk) => void) => { heard.onAsk = onAsk; return Promise.resolve(() => { heard.onAsk = null }) },
}))

const SESSIONS = [{ id: 's1', pane: 4, machine: 0 }, { id: 's2', pane: 4, machine: 2 }]

describe("an agent's ask for its project's ticket setup", () => {
  it("brings the asking agent's chat to the front and opens Tickets with what it suggested, until Tickets closes", async () => {
    const showSessionById = vi.fn()
    const setInspectOpen = vi.fn()
    const setTicketsOpen = vi.fn()
    const { result, rerender } = renderHook(({ open }: { open: boolean }) => useTicketSetupAsks({ sessions: SESSIONS, ticketsOpen: open, showSessionById, setInspectOpen, setTicketsOpen }), { initialProps: { open: false } })
    await vi.waitFor(() => { expect(heard.onAsk).not.toBeNull() })
    act(() => { heard.onAsk?.({ term: 4, folder: '/repo', source: 'linear', link: 'https://linear.app/acme/team/ENG' }) })
    expect(showSessionById).toHaveBeenCalledWith('s1')
    expect(setInspectOpen).toHaveBeenCalledWith(false)
    expect(setTicketsOpen).toHaveBeenCalledWith(true)
    rerender({ open: true })
    expect(result.current).toEqual({ source: 'linear', link: 'https://linear.app/acme/team/ENG' })
    rerender({ open: false })
    expect(result.current).toBeNull()
  })

  it('opens nothing for a pane this window does not show', async () => {
    const showSessionById = vi.fn()
    const setTicketsOpen = vi.fn()
    renderHook(() => useTicketSetupAsks({ sessions: SESSIONS, ticketsOpen: false, showSessionById, setInspectOpen: vi.fn(), setTicketsOpen }))
    await vi.waitFor(() => { expect(heard.onAsk).not.toBeNull() })
    act(() => { heard.onAsk?.({ term: 99, folder: '/repo', source: null, link: '' }) })
    expect(showSessionById).not.toHaveBeenCalled()
    expect(setTicketsOpen).not.toHaveBeenCalled()
  })
})
