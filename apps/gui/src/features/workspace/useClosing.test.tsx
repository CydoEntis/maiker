import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeSession } from '@/api/daemon'
import { toast } from '@/lib/toast'
import { wasClosed } from './closedSessions'
import { DraftGuardHost } from '@/features/documents/DraftGuardHost'
import { registerDraft, type DraftHandle } from '@/features/documents/draftGuard'
import { openArrangement, openDocumentBeside, splitPane, visibleSessionIds, type Layout } from './model/layout'
import type { Conversation } from '@/data/preview'
import { toSessionView, type SessionView } from './model/session'
import { closeAsk, useClosing } from './useClosing'

vi.mock('@/api/daemon', () => ({ closeSession: vi.fn() }))
vi.mock('@/lib/toast', () => { const toast = { info: vi.fn(() => 'toast'), error: vi.fn() }; return { toast: Object.assign(toast, { failed: vi.fn((what: string, error: unknown, options?: object) => { const said = typeof error === 'string' ? error : error instanceof Error ? error.message : what; if (options === undefined) toast.error(said); else toast.error(said, options) }) }) } })

const session = (id: string) => ({ id, name: id, title: id, process: 'shell', conversation: { id }, ended: false }) as unknown as SessionView

describe('closing several sessions', () => {
  it('keeps the one that failed, and still closes the others', async () => {
    let next = 0
    const makeId = (prefix: string) => `${prefix}${String(next++)}`
    let layout: Layout = openArrangement({ arrangements: [], activeId: null }, 'a', makeId)
    layout = splitPane(layout, null, 'right', 'b', makeId)
    vi.mocked(closeSession).mockImplementation((conversation) => ((conversation as unknown as { id: string }).id === 'b' ? Promise.reject(new Error('it is busy')) : Promise.resolve()))
    const setLayout = vi.fn((change: Layout | ((current: Layout) => Layout)) => { layout = typeof change === 'function' ? change(layout) : change })
    const sessions = [session('a'), session('b')]
    const { result } = renderHook(() => useClosing({ setLayout, queryClient: new QueryClient(), layout, sessions, flash: vi.fn(), paneSessions: new Map(), agentTerminals: new Map(), confirm: (_ask, run) => { run() } }))
    act(() => { result.current.endSessions(['a', 'b']) })
    await waitFor(() => { expect(toast.error).toHaveBeenCalledWith('it is busy') })
    await waitFor(() => { expect(visibleSessionIds(layout)).toEqual(new Set(['b'])) })
    expect(wasClosed('b')).toBe(false)
    expect(wasClosed('a')).toBe(true)
  })
})

describe('what a close asks', () => {
  const listed = (extra: Partial<Conversation>) => toSessionView({ id: 't1', generation: 0, kind: 'terminal', title: 'Fix the cart', named: true, project: '', folder: '/home/me/shop', cwd: '/home/me/shop', repo: 'shop', branch: 'main', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: 1, hasDiff: false, ...extra }, '/home/me')
  const agent = (extra: Partial<SessionView> = {}): SessionView => ({ ...listed({ agent: 'claude' }), ...extra })
  const shell = (): SessionView => listed({})
  const asked = (paneSessions: Map<string, SessionView>) => {
    const confirm = vi.fn()
    const { result } = renderHook(() => useClosing({ setLayout: vi.fn(), queryClient: new QueryClient(), layout: { arrangements: [], activeId: null }, sessions: [], flash: vi.fn(), paneSessions, agentTerminals: new Map(), confirm }))
    const close = vi.fn()
    act(() => { result.current.askToClose([...paneSessions.keys()], close) })
    return { confirm, close }
  }

  it('asks about a session under one kind and about a plain shell under another, so each is remembered on its own', () => {
    expect(closeAsk([agent()]).kind).toBe('close-session')
    expect(closeAsk([shell()]).kind).toBe('close-terminal')
    expect(closeAsk([agent(), shell()]).kind).toBe('close-session')
  })

  it('says what closing interrupts: a turn in progress, or a question the agent waits on', () => {
    const quiet = closeAsk([agent()]).body
    expect(closeAsk([agent({ status: 'working' })]).body).not.toBe(quiet)
    expect(closeAsk([agent({ status: 'needs' })]).body).not.toBe(quiet)
    expect(closeAsk([agent({ status: 'needs' })]).body).not.toBe(closeAsk([agent({ status: 'working' })]).body)
  })

  it('names the worktree and branch that stay on disk', () => {
    const note = closeAsk([agent({ worktree: true, checkout: 'C:\\work\\shop-feat', branch: 'feat' })]).note
    expect(note).toContain('shop-feat')
    expect(note).toContain('feat')
  })

  it('asks before a running session closes, and closes an ended one without asking', () => {
    const running = asked(new Map([['a', session('a')]]))
    expect(running.confirm).toHaveBeenCalledTimes(1)
    expect(running.close).not.toHaveBeenCalled()
    const ended = asked(new Map([['a', { ...session('a'), ended: true }]]))
    expect(ended.confirm).not.toHaveBeenCalled()
    expect(ended.close).toHaveBeenCalledTimes(1)
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
    const hook = renderHook(() => useClosing({ setLayout, queryClient: new QueryClient(), layout, sessions: [session('chat')], flash: vi.fn(), paneSessions: new Map([['chat', session('chat')]]), agentTerminals: new Map(), confirm: (_ask, run) => { run() } }))
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

  it('asks before ending the session that owns the document (the close shortcut, the sidebar, the palette, close session)', async () => {
    const { layout, doc } = withDocument()
    stop.push(registerDraft('d', draft(doc.id)))
    const { result } = setup(layout)
    render(<DraftGuardHost />)
    act(() => { result.current.endSessions(['chat']) })
    expect(await screen.findByRole('heading', { name: 'Discard changes to README.md?' })).toBeInTheDocument()
    expect(closeSession).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(closeSession).not.toHaveBeenCalled()
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
    expect(closeSession).not.toHaveBeenCalled()
  })
})
