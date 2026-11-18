import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeSessionWithUndo } from '@/api/daemon'
import { toast } from '@/lib/toast'
import { wasClosed } from './closedSessions'
import { DraftGuardHost } from '@/features/documents/DraftGuardHost'
import { registerDraft, type DraftHandle } from '@/features/documents/draftGuard'
import { openArrangement, openDocumentBeside, splitPane, visibleSessionIds, type Layout } from './model/layout'
import type { SessionView } from './model/session'
import { useClosing } from './useClosing'

vi.mock('@/api/daemon', () => ({ closeSessionWithUndo: vi.fn(), undoCloseSession: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: Object.assign(vi.fn(() => 'toast'), { error: vi.fn() }) }))

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
    await waitFor(() => { expect(toast.error).toHaveBeenCalledWith('it is busy') })
    await waitFor(() => { expect(visibleSessionIds(layout)).toEqual(new Set(['b'])) })
    expect(wasClosed('b')).toBe(false)
    expect(wasClosed('a')).toBe(true)
  })
})

describe('closing with an unsaved draft in a document', () => {
  const makeIds = () => { let next = 0; return (prefix: string) => `${prefix}${String(next++)}` }
  const withDocument = () => {
    const makeId = makeIds()
    const opened = openArrangement({ arrangements: [], activeId: null }, 'chat', makeId)
    const layout = openDocumentBeside(opened, 'chat', 'README.md', makeId) ?? opened
    const doc = layout.arrangements[0]?.panes.find((pane) => pane.doc)
    const chat = layout.arrangements[0]?.panes.find((pane) => !pane.doc)
    if (doc === undefined || chat === undefined) throw new Error('no panes')
    return { layout, doc, chat }
  }
  const setup = (layout: Layout) => {
    let current = layout
    const setLayout = vi.fn((change: Layout | ((was: Layout) => Layout)) => { current = typeof change === 'function' ? change(current) : change })
    const hook = renderHook(() => useClosing({ setLayout, queryClient: new QueryClient(), layout, sessions: [session('chat')], flash: vi.fn(), paneSessions: new Map([['chat', session('chat')]]), agentTerminals: new Map() }))
    return { ...hook, setLayout, layoutNow: () => current }
  }
  const draft = (paneId: string): DraftHandle => ({ path: 'README.md', owner: { paneId, sessionId: 'chat' }, save: vi.fn(() => Promise.resolve(true)), discard: vi.fn() })
  const stop: (() => void)[] = []
  afterEach(() => { for (const forget of stop.splice(0)) forget() })

  it('asks before the document pane (its close or its menu) goes, and keeps it on Keep editing', async () => {
    const { layout, doc } = withDocument()
    stop.push(registerDraft('d', draft(doc.id)))
    const { result, setLayout } = setup(layout)
    render(<DraftGuardHost />)
    act(() => { result.current.closePaneById(doc.id) })
    expect(setLayout).not.toHaveBeenCalled()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Keep editing' }))
    expect(setLayout).not.toHaveBeenCalled()
  })

  it('takes the pane out after Discard', async () => {
    const { layout, doc } = withDocument()
    stop.push(registerDraft('d', draft(doc.id)))
    const { result, setLayout } = setup(layout)
    render(<DraftGuardHost />)
    act(() => { result.current.closePaneById(doc.id) })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Discard' }))
    await waitFor(() => { expect(setLayout).toHaveBeenCalled() })
  })

  it('closes a clean document pane at once', () => {
    const { layout, doc } = withDocument()
    const { result, setLayout } = setup(layout)
    act(() => { result.current.closePaneById(doc.id) })
    expect(setLayout).toHaveBeenCalled()
  })

  it('asks before ending the session that owns the document (the close shortcut, the sidebar, the palette, close session)', async () => {
    const { layout, doc } = withDocument()
    stop.push(registerDraft('d', draft(doc.id)))
    const { result } = setup(layout)
    render(<DraftGuardHost />)
    act(() => { result.current.endSessions(['chat']) })
    expect(await screen.findByRole('heading', { name: 'Discard changes to README.md?' })).toBeInTheDocument()
    expect(closeSessionWithUndo).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(closeSessionWithUndo).not.toHaveBeenCalled()
  })

  it('asks about the draft before the chat pane shrinks away, then closes it', async () => {
    const { layout, chat, doc } = withDocument()
    const stopDraft = registerDraft('d', draft(doc.id))
    stop.push(stopDraft)
    const { result } = setup(layout)
    render(<DraftGuardHost />)
    act(() => { result.current.closePaneById(chat.id) })
    expect(await screen.findByRole('heading', { name: 'Discard changes to README.md?' })).toBeInTheDocument()
    expect(result.current.closingPanes.size).toBe(0)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(closeSessionWithUndo).not.toHaveBeenCalled()
  })
})
