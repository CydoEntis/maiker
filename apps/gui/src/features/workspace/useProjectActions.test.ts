import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/data/preview'
import { groupByProject, type OpenedProject } from './model/openedProjects'
import { toSessionView, type SessionView } from './model/session'
import { useOpenWorktreeDialog, useProjectActions, type OpenWorktreeFor } from './useProjectActions'

const workspace = vi.hoisted(() => {
  const current: Record<string, unknown> = {}
  return { current }
})
vi.mock('./workspaceContext', () => ({ useWorkspace: () => workspace.current }))

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
    setSettingsSection: vi.fn(),
    setNewChatMachine: vi.fn(),
    setNewChatSeed: vi.fn(),
    setNewChatOpen: vi.fn(),
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
    expect(parts.setNewChatMachine).toHaveBeenCalledWith(0)
    expect(parts.setNewChatSeed).toHaveBeenCalledWith({ folder: WORKTREE, message: '' })
    expect(parts.setNewChatOpen).toHaveBeenCalledWith(true)
    expect(parts.setSettingsSection).toHaveBeenCalledWith(null)
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
    expect(empty.setNewChatSeed).toHaveBeenCalledWith({ folder: SHOP.folder, message: '', worktree: true })
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
    expect(parts.setNewChatOpen).not.toHaveBeenCalled()
    result.current(vi.fn()).onNewWorktree(0, SHOP, null)
    expect(parts.setNewChatMachine).toHaveBeenCalledWith(0)
    expect(parts.setNewChatSeed).toHaveBeenCalledWith({ folder: SHOP.folder, message: '', worktree: true })
    expect(parts.setNewChatOpen).toHaveBeenCalledWith(true)
  })

  it('starts a terminal in the project\'s folder in the Terminal view, and offers none in the Chat view', () => {
    const newTerminal = vi.fn()
    workspace.current = { ...windowWith(null, []), chatView: false, newTerminal }
    renderHook(() => useProjectActions()).result.current(vi.fn()).onNewTerminal?.(4, { machineName: 'devbox', folder: '/srv/api' })
    expect(newTerminal).toHaveBeenCalledWith(4, '/srv/api')
    workspace.current = { ...windowWith(null, []), chatView: true, newTerminal }
    expect(renderHook(() => useProjectActions()).result.current(vi.fn()).onNewTerminal).toBeUndefined()
  })
})
