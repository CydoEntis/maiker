import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/data/preview'
import { groupByProject, type OpenedProject } from './model/openedProjects'
import { toSessionView, type SessionView } from './model/session'
import { useOpenWorktreeDialog, useProjectActions, type OpenWorktreeFor } from './useProjectActions'

const workspace = vi.hoisted(() => {
  const current: Record<string, unknown> = {}
  return { current }
})
vi.mock('./workspaceContext', () => ({ useWorkspace: () => workspace.current }))
const service = vi.hoisted(() => ({ saveWorkspace: vi.fn<(project: string, sessions: readonly unknown[]) => Promise<boolean>>() }))
vi.mock('@/api/daemon', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/daemon')>(), saveWorkspace: service.saveWorkspace }))
const toast = vi.hoisted(() => ({ failed: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast }))

const SHOP: OpenedProject = { machineName: null, folder: '/home/me/shop' }
const WORKTREE = '/home/me/.maiker/shop/feat-x'

/** An agent of this computer in the shop repository's main checkout. */
function onMain(extra: Partial<Conversation> = {}): SessionView {
  return toSessionView(
    { id: 't1', generation: 0, kind: 'terminal', title: 'On main', named: true, project: '', folder: '/home/me/shop', cwd: '/home/me/shop', repo: 'shop', branch: 'main', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: 1, hasDiff: false, agent: 'claude', ...extra },
    '/home/me',
  )
}

/** The window's parts these hooks use, each a spy, with the Open worktree dialog open for `open` over `sessions`. */
function windowWith(open: OpenWorktreeFor | null, sessions: readonly SessionView[]) {
  const parts = {
    openWorktreeFor: open,
    sessions,
    openedProjects: { machines: groupByProject(sessions, [SHOP]).machines, close: vi.fn() },
    setOpenWorktreeFor: vi.fn(),
    setProjectWorktreeFrom: vi.fn(),
    openDraft: vi.fn(),
    showSessionById: vi.fn(),
  }
  workspace.current = parts
  return parts
}

beforeEach(() => { workspace.current = {} })

describe('Open worktree in the window', () => {

  it('starts the new-chat draft in the worktree picked, on the project\'s machine, and closes', () => {
    const parts = windowWith({ machine: 0, project: SHOP, name: 'shop' }, [])
    renderHook(() => useOpenWorktreeDialog()).result.current?.onStart(WORKTREE)
    expect(parts.openDraft).toHaveBeenCalledWith(0, { folder: WORKTREE, message: '' })
    expect(parts.setOpenWorktreeFor).toHaveBeenCalledWith(null)
  })

  it('hands over to New worktree made from the project\'s session, and without one to the draft with Own worktree on', () => {
    const main = onMain()
    const parts = windowWith({ machine: 0, project: SHOP, name: 'shop' }, [main])
    renderHook(() => useOpenWorktreeDialog()).result.current?.onNewWorktree?.()
    expect(parts.setProjectWorktreeFrom).toHaveBeenCalledWith(main)
    expect(parts.setOpenWorktreeFor).toHaveBeenCalledWith(null)
    const empty = windowWith({ machine: 0, project: SHOP, name: 'shop' }, [])
    renderHook(() => useOpenWorktreeDialog()).result.current?.onNewWorktree?.()
    expect(empty.setProjectWorktreeFrom).not.toHaveBeenCalled()
    expect(empty.openDraft).toHaveBeenCalledWith(0, { folder: SHOP.folder, message: '', worktree: true })
    expect(empty.setOpenWorktreeFor).toHaveBeenCalledWith(null)
  })
})

describe('a project heading\'s starts in the window', () => {
  it('makes a new worktree from the project\'s session, and with none opens the draft with Own worktree on', () => {
    const main = onMain()
    const parts = windowWith(null, [main])
    const { result } = renderHook(() => useProjectActions())
    result.current(vi.fn()).onNewWorktree(0, SHOP, main)
    expect(parts.setProjectWorktreeFrom).toHaveBeenCalledWith(main)
    expect(parts.openDraft).not.toHaveBeenCalled()
    result.current(vi.fn()).onNewWorktree(0, SHOP, null)
    expect(parts.openDraft).toHaveBeenCalledWith(0, { folder: SHOP.folder, message: '', worktree: true })
  })

  it('starts a terminal in the project\'s folder in the Terminal view, and offers none in the Chat view', () => {
    const newTerminal = vi.fn()
    workspace.current = { ...windowWith(null, []), chatView: false, newTerminal }
    renderHook(() => useProjectActions()).result.current(vi.fn()).onNewTerminal?.(4, { machineName: 'devbox', folder: '/srv/api' })
    expect(newTerminal).toHaveBeenCalledWith(4, '/srv/api')
    workspace.current = { ...windowWith(null, []), chatView: true, newTerminal }
    expect(renderHook(() => useProjectActions()).result.current(vi.fn()).onNewTerminal).toBeUndefined()
  })

  it('asks before an empty project closes, by its name, and closes it only on the answer', () => {
    const confirm = vi.fn()
    const close = vi.fn()
    workspace.current = { ...windowWith(null, []), confirm, openedProjects: { machines: [], close, closeOnceEmpty: vi.fn() } }
    renderHook(() => useProjectActions()).result.current(vi.fn()).onClose(SHOP, 'shop')
    expect(close).not.toHaveBeenCalled()
    const [ask, run] = confirm.mock.calls[0] as [{ kind: string; title: string; confirmLabel: string }, () => void]
    expect(ask).toMatchObject({ kind: 'close-project', title: 'Close shop?', confirmLabel: 'Close project' })
    run()
    expect(close).toHaveBeenCalledWith(SHOP)
  })

  it('names the sessions running in a project, stops them on the answer, and closes it once they are gone', () => {
    const confirm = vi.fn()
    const endSessions = vi.fn()
    const closeOnceEmpty = vi.fn()
    const running = onMain()
    const gone = { ...onMain({ id: 't9', nativePane: 9 }), ended: true }
    workspace.current = { ...windowWith(null, []), confirm, endSessions, openedProjects: { machines: [{ machineName: null, projects: [{ project: SHOP, sessions: [running, gone] }] }], close: vi.fn(), closeOnceEmpty } }
    renderHook(() => useProjectActions()).result.current(vi.fn()).onClose(SHOP, 'shop')
    const [ask, run] = confirm.mock.calls[0] as [{ body: string }, () => void]
    expect(ask.body).toContain('stops')
    expect(endSessions).not.toHaveBeenCalled()
    run()
    expect(endSessions).toHaveBeenCalledWith([running.id, gone.id])
    expect(closeOnceEmpty).toHaveBeenCalledWith(SHOP)
  })
})

describe('closing a project keeps what was open in it', () => {
  const NOW = 1_780_000_000_000
  beforeEach(() => { service.saveWorkspace.mockReset(); toast.failed.mockReset() })
  afterEach(() => { vi.restoreAllMocks() })

  /** An agent in a linked worktree of the shop, a chat in its main checkout and a plain terminal: the project's sessions. */
  function openInShop(): SessionView[] {
    const agent = toSessionView({ ...onMain().conversation, id: 't2', nativePane: 2, cwd: WORKTREE, branch: 'feat-x', linked: true, checkout: WORKTREE, named: true, title: 'Login fix', details: { asking: '', interrupted: null, agentSession: 'claude-1', timeline: [], usage: { context: null, cost: null, tokens: null } } }, '/home/me')
    const chat = toSessionView({ id: '7', generation: 1, execution: 'Structured', title: 'Codex conversation 7', named: false, project: 'shop', folder: '/home/me/shop', cwd: '/home/me/shop', repo: 'shop', branch: 'main', provider: 'Codex', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: null, hasDiff: false, agent: 'codex', process: 'codex', chat: { conversation: 7, generation: 1, session: 'codex-7' } }, '/home/me')
    const shell = onMain({ id: 't3', nativePane: 3, agent: null, process: 'bash' })
    return [agent, chat, shell]
  }

  /** Close project on `sessions` of the shop, answered yes; the window's parts, each a spy. */
  function closeShop(sessions: readonly SessionView[]) {
    const parts = { confirm: vi.fn((_ask: unknown, run: () => void) => { run() }), endSessions: vi.fn(), closeOnceEmpty: vi.fn() }
    workspace.current = { ...windowWith(null, []), ...parts, openedProjects: { machines: [{ machineName: null, projects: [{ project: SHOP, sessions }] }], close: vi.fn(), closeOnceEmpty: parts.closeOnceEmpty } }
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    renderHook(() => useProjectActions()).result.current(vi.fn()).onClose(SHOP, 'shop')
    return parts
  }

  it('saves its agent and chat sessions, not its plain terminals, after the answer and before they end', () => {
    service.saveWorkspace.mockResolvedValue(true)
    const parts = closeShop(openInShop())
    expect(service.saveWorkspace).toHaveBeenCalledExactlyOnceWith(SHOP.folder, [
      { agent: 'claude', session: 'claude-1', cwd: WORKTREE, branch: 'feat-x', title: 'Login fix', at: NOW / 1000, worktree: WORKTREE, repo: '/home/me/shop' },
      { agent: 'codex', session: 'codex-7', cwd: '/home/me/shop', branch: 'main', title: null, at: NOW / 1000, worktree: null, repo: null },
    ])
    expect(service.saveWorkspace.mock.invocationCallOrder[0]).toBeLessThan(parts.endSessions.mock.invocationCallOrder[0] ?? 0)
    expect(parts.endSessions).toHaveBeenCalledWith(['t2', '7', 't3'])
    expect(parts.closeOnceEmpty).toHaveBeenCalledWith(SHOP)
  })

  it('still closes when the save fails, and says so in one toast', async () => {
    service.saveWorkspace.mockRejectedValue(new Error('The Maiker service is not running'))
    const parts = closeShop(openInShop())
    expect(parts.endSessions).toHaveBeenCalled()
    expect(parts.closeOnceEmpty).toHaveBeenCalledWith(SHOP)
    await waitFor(() => { expect(toast.failed).toHaveBeenCalledTimes(1) })
    expect(toast.failed.mock.calls[0]?.[0]).toContain('shop')
  })

  it('says nothing when the service is from before saved sets, and asks nothing with no session to keep', async () => {
    service.saveWorkspace.mockResolvedValue(false)
    const parts = closeShop(openInShop())
    expect(parts.closeOnceEmpty).toHaveBeenCalledWith(SHOP)
    await Promise.resolve()
    expect(toast.failed).not.toHaveBeenCalled()
    service.saveWorkspace.mockClear()
    closeShop([onMain({ id: 't3', nativePane: 3, agent: null, process: 'bash' })])
    expect(service.saveWorkspace).not.toHaveBeenCalled()
  })
})
