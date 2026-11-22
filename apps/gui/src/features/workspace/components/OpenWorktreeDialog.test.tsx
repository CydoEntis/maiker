import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FolderBranchList } from '@/api/folderGit'
import type { Conversation } from '@/data/preview'
import { toSessionView, type SessionView } from '../model/session'
import { OpenWorktreeDialog } from './OpenWorktreeDialog'

const machine = vi.hoisted(() => ({
  listing: (): Promise<FolderBranchList | null> => Promise.resolve(null),
  gone: new Set<string>(),
  asked: [] as [number, string][],
}))
vi.mock('@/api/folderGit', () => ({
  loadFolderBranches: (on: number, folder: string) => { machine.asked.push([on, folder]); return machine.listing() },
}))
vi.mock('@/api/folders', () => ({
  listFolders: (_on: number, path: string) => Promise.resolve({ path, exists: !machine.gone.has(path), entries: [], truncated: false, can_create: true }),
}))

const SHOP = { machineName: null, folder: '/home/me/shop' }
const MAIN = { path: '/home/me/shop', branch: 'main', main: true, when: null }
const FEAT = { path: '/home/me/.maiker/shop/feat-x', branch: 'feat/x', main: false, when: null }
const DOCS = { path: '/home/me/.maiker/shop/tidy-docs', branch: 'docs/tidy', main: false, when: null }
const OLD = { path: '/home/me/.maiker/shop/old', branch: 'old', main: false, when: null }

function listing(...worktrees: FolderBranchList['worktrees']): FolderBranchList {
  return { current: 'main', branches: [], worktrees }
}

/** An agent named `title` working in the checkout at `checkout`. */
function agentIn(pane: number, title: string, checkout: string, extra: Partial<Conversation> = {}): SessionView {
  return toSessionView(
    { id: `t${String(pane)}`, generation: 0, kind: 'terminal', title, named: true, project: '', folder: '/home/me/shop', cwd: checkout, checkout, repo: 'shop', branch: 'feat/x', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: 'claude', linked: true, ...extra },
    '/home/me',
  )
}

function open(answer: FolderBranchList | null | Error, more: { sessions?: SessionView[]; gone?: string[]; canMake?: boolean } = {}) {
  machine.listing = () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer))
  machine.gone = new Set(more.gone ?? [])
  machine.asked = []
  const calls = { onStart: vi.fn(), onShow: vi.fn(), onCancel: vi.fn(), onNewWorktree: vi.fn() }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OpenWorktreeDialog machine={0} project={SHOP} name="shop" sessions={more.sessions ?? []} {...calls} onNewWorktree={more.canMake === false ? null : calls.onNewWorktree} />
    </QueryClientProvider>,
  )
  return calls
}

afterEach(() => { cleanup() })

describe('Open worktree', () => {

  it('starts a new-chat draft in the worktree picked', async () => {
    const { onStart, onShow } = open(listing(MAIN, FEAT))
    fireEvent.click(await screen.findByRole('button', { name: /feat-x/ }))
    expect(onStart).toHaveBeenCalledWith(FEAT.path)
    expect(onShow).not.toHaveBeenCalled()
  })

  it('says which session runs in a worktree and shows it instead of starting a second', async () => {
    const running = agentIn(3, 'Fix the parser', FEAT.path)
    const { onStart, onShow } = open(listing(MAIN, FEAT, DOCS), { sessions: [running] })
    const row = await screen.findByRole('button', { name: /feat-x/ })
    expect(row.textContent).toContain('In use by Fix the parser · Show')
    fireEvent.click(row)
    expect(onShow).toHaveBeenCalledWith('t3')
    expect(onStart).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /tidy-docs/ }).textContent).not.toContain('In use')
  })

  it('shows a worktree whose folder is gone as missing, and does not open it', async () => {
    const { onStart } = open(listing(MAIN, OLD), { gone: [OLD.path] })
    const row = await screen.findByRole('button', { name: /old/ })
    expect(row.textContent).toContain('Folder missing')
    expect(row.getAttribute('aria-disabled')).toBe('true')
    expect(row.title).toContain('Its folder is gone')
    fireEvent.click(row)
    expect(onStart).not.toHaveBeenCalled()
  })

  it('gives the machine\'s reason when the repository could not be read, and can ask again', async () => {
    open(new Error('no such folder'))
    expect((await screen.findByRole('alert')).textContent).toContain('Could not read the worktrees of shop: no such folder')
    machine.listing = () => Promise.resolve(listing(MAIN, FEAT))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: /feat-x/ })).toBeTruthy()
  })
})

describe('Open worktree on another machine', () => {
  const API = { machineName: 'devbox', folder: '/srv/api' }
  const THERE = { path: '/home/dev/.maiker/worktrees/api/feat-x', branch: 'feat/x', main: false, when: null }
  const GONE = { path: '/home/dev/.maiker/worktrees/api/old', branch: 'old', main: false, when: null }

  function openOnDevbox(more: { sessions?: SessionView[] } = {}) {
    machine.listing = () => Promise.resolve(listing({ ...MAIN, path: API.folder }, THERE, GONE))
    machine.gone = new Set([GONE.path])
    machine.asked = []
    const calls = { onStart: vi.fn(), onShow: vi.fn(), onCancel: vi.fn(), onNewWorktree: vi.fn() }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OpenWorktreeDialog machine={4} project={API} name="api" sessions={more.sessions ?? []} {...calls} />
      </QueryClientProvider>,
    )
    return calls
  }

  it('lists the worktrees that machine\'s daemon has, and starts a draft in one there', async () => {
    const { onStart } = openOnDevbox()
    fireEvent.click(await screen.findByRole('button', { name: /feat-x/ }))
    expect(machine.asked).toEqual([[4, '/srv/api']])
    expect(onStart).toHaveBeenCalledWith(THERE.path)
  })

  it('shows a session of that machine running in a worktree, not one of this computer in the same folder', async () => {
    const here = agentIn(2, 'Here', THERE.path)
    const there = agentIn(3, 'There', THERE.path, { machine: 4, machineName: 'devbox' })
    const { onShow } = openOnDevbox({ sessions: [here, there] })
    fireEvent.click(await screen.findByRole('button', { name: /feat-x/ }))
    expect(onShow).toHaveBeenCalledWith(there.id)
  })
})
