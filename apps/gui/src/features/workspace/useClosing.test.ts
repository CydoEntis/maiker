import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { closeSessionWithUndo } from '@/api/daemon'
import { toast } from '@/lib/toast'
import { wasClosed } from './closedSessions'
import { openArrangement, splitPane, visibleSessionIds, type Layout } from './model/layout'
import type { SessionView } from './model/session'
import { useClosing } from './useClosing'

vi.mock('@/api/daemon', () => ({ closeSessionWithUndo: vi.fn(), undoCloseSession: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: Object.assign(vi.fn(() => 'toast'), { error: vi.fn(), failure: vi.fn() }) }))

const session = (id: string) => ({ id, name: id, title: id, process: 'shell', conversation: { id }, ended: false }) as unknown as SessionView

describe('closing several sessions', () => {
  it('keeps the one that failed, and still closes the others', async () => {
    let next = 0
    const makeId = (prefix: string) => `${prefix}${String(next++)}`
    let layout: Layout = openArrangement({ arrangements: [], activeId: null }, 'a', makeId)
    layout = splitPane(layout, null, 'right', 'b', makeId)
    vi.mocked(closeSessionWithUndo).mockImplementation((conversation) => ((conversation as unknown as { id: string }).id === 'b' ? Promise.reject(new Error('it is busy')) : Promise.resolve()))
    const setLayout = vi.fn((change: Layout | ((current: Layout) => Layout)) => { layout = typeof change === 'function' ? change(layout) : change })
    const sessions = [session('a'), session('b')]
    const { result } = renderHook(() => useClosing({ setLayout, queryClient: new QueryClient(), layout, sessions, flash: vi.fn(), paneSessions: new Map(), agentTerminals: new Map() }))
    act(() => { result.current.endSessions(['a', 'b']) })
    await waitFor(() => { expect(toast.failure).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^Could not end /)) })
    await waitFor(() => { expect(visibleSessionIds(layout)).toEqual(new Set(['b'])) })
    expect(wasClosed('b')).toBe(false)
    expect(wasClosed('a')).toBe(true)
  })
})
