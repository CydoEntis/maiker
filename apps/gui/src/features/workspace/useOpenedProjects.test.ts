import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { conversationsFromSnapshot } from '@/api/daemon'
import { readOpenedProjects } from '@/data/openedProjects'
import type { OpenedProject } from './model/openedProjects'
import { toSessionView, type SessionView } from './model/session'
import { useOpenedProjectsState } from './useOpenedProjects'

const KEY = 'maiker.gui.opened-projects.v1'
const HOME = '/home/me'

/** One idle shell of this computer in `cwd`, in a repository whose main checkout is `root` when given. */
function sessionIn(id: number, cwd: string, root?: string): SessionView {
  const term = {
    id, cols: 80, rows: 24, title: 't', process: 'bash', agent: null, status: 'Idle', cwd, summary: '', name: 'n',
    label: '', pinned: false, archived: false, model: '', said: '', branch: root === undefined ? null : 'main', linked: false,
    conversation_id: null, popup: false, remote: null, root: root ?? null, top: root ?? null, since: 0, asleep: false, win32_input: false,
  }
  const snapshot = { terms: { [String(id)]: term }, workspaces: [], conversations: [] }
  return conversationsFromSnapshot(snapshot).map((conversation) => toSessionView(conversation, HOME))[0] as SessionView
}

const NO_SESSIONS: readonly SessionView[] = []

describe('the window\'s opened projects', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('adds a project with no session, selects it and keeps it for the next start', () => {
    const { result } = renderHook(() => useOpenedProjectsState(NO_SESSIONS))
    let opened: OpenedProject | null = null
    act(() => { opened = result.current.open({ machineName: 'devbox', folder: '/srv/shop' }) })
    expect(opened).toEqual({ machineName: 'devbox', folder: '/srv/shop' })
    expect(result.current.opened).toEqual([{ machineName: 'devbox', folder: '/srv/shop' }])
    expect(result.current.selected).toBe(opened)
    expect(result.current.machines).toEqual([{ machineName: 'devbox', projects: [{ project: opened, sessions: [] }] }])
    expect(readOpenedProjects()).toEqual([{ machineName: 'devbox', folder: '/srv/shop' }])
    const { result: next } = renderHook(() => useOpenedProjectsState(NO_SESSIONS))
    expect(next.current.opened).toEqual([{ machineName: 'devbox', folder: '/srv/shop' }])
  })

  it('selects a folder that is already open, in any spelling, and adds nothing', () => {
    localStorage.setItem(KEY, JSON.stringify({ 'this computer': ['C:\\dev\\shop', 'C:\\dev\\notes'] }))
    const { result } = renderHook(() => useOpenedProjectsState(NO_SESSIONS))
    const before = result.current.opened
    let opened: OpenedProject | null = null
    act(() => { opened = result.current.open({ machineName: null, folder: 'c:/DEV/shop/' }) })
    expect(opened).toBe(before[0])
    expect(result.current.opened).toBe(before)
    expect(result.current.selected).toBe(before[0])
    expect(JSON.parse(localStorage.getItem(KEY) ?? '')).toEqual({ 'this computer': ['C:\\dev\\shop', 'C:\\dev\\notes'] })
  })

  it('opens the project a session started in, and keeps it', () => {
    const { result } = renderHook(() => useOpenedProjectsState([sessionIn(1, '/code/shop/src', '/code/shop')]))
    expect(result.current.opened).toEqual([{ machineName: null, folder: '/code/shop' }])
    expect(readOpenedProjects()).toEqual([{ machineName: null, folder: '/code/shop' }])
    expect(result.current.selected).toBeNull()
  })

  it('leaves a kept record it could not read alone until something is opened', () => {
    localStorage.setItem(KEY, '{"this computer": 3}')
    renderHook(() => useOpenedProjectsState(NO_SESSIONS))
    expect(localStorage.getItem(KEY)).toBe('{"this computer": 3}')
  })
  it('closes a project with no session, unselects it, and it stays closed after the next list', () => {
    const { result, rerender } = renderHook(({ sessions }) => useOpenedProjectsState(sessions), { initialProps: { sessions: NO_SESSIONS } })
    let shop: OpenedProject | null = null
    act(() => { shop = result.current.open({ machineName: null, folder: '/code/shop' }) })
    act(() => { result.current.open({ machineName: null, folder: '/code/notes' }) })
    act(() => { result.current.select(shop) })
    act(() => { expect(result.current.close({ machineName: null, folder: '/code/shop/' }).ok).toBe(true) })
    expect(result.current.opened).toEqual([{ machineName: null, folder: '/code/notes' }])
    expect(result.current.selected).toBeNull()
    expect(readOpenedProjects()).toEqual([{ machineName: null, folder: '/code/notes' }])
    // A session in another project is listed: the closed one is not opened again by the list changing.
    rerender({ sessions: [sessionIn(2, '/code/notes')] })
    expect(result.current.opened).toEqual([{ machineName: null, folder: '/code/notes' }])
  })

  it('refuses to close a project a listed session is in, says which, and keeps it', () => {
    const running = sessionIn(1, '/code/shop/src', '/code/shop')
    const { result } = renderHook(() => useOpenedProjectsState([running]))
    let outcome: ReturnType<typeof result.current.close> | null = null
    act(() => { outcome = result.current.close({ machineName: null, folder: '/code/shop' }) })
    expect(outcome).toEqual({ ok: false, error: { code: 'sessions-running', running: [running] } })
    expect(result.current.opened).toEqual([{ machineName: null, folder: '/code/shop' }])
  })
})
