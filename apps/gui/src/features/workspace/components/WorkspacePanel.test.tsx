import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { loadFolderBranches } from '@/api/folderGit'
import { removeWorktrees, type WorktreeStanding } from '@/features/worktrees/api'
import { toSessionView, type SessionView } from '../model/session'
import { WorkspacePanel } from './WorkspacePanel'

const standing = vi.hoisted(() => {
  let answer: (value: WorktreeStanding) => void = () => undefined
  const asked = new Promise<WorktreeStanding>((resolve) => { answer = resolve })
  return { asked, answer: (value: WorktreeStanding) => { answer(value) }, calls: [] as [string, string, number][] }
})

vi.mock('@/api/daemon', async (original) => ({ ...await original<typeof import('@/api/daemon')>(), savedWorkspace: vi.fn(() => Promise.resolve([])) }))
vi.mock('@/api/folderGit', async (original) => ({
  ...await original<typeof import('@/api/folderGit')>(),
  loadFolderBranches: vi.fn(() => Promise.resolve({
    current: 'main',
    branches: [],
    worktrees: [
      { path: '/code/shop', branch: 'main', main: true, when: null },
      { path: '/code/shop-dark-mode', branch: 'dark-mode', main: false, when: null },
    ],
  })),
}))
vi.mock('@/features/worktrees/api', async (original) => ({
  ...await original<typeof import('@/features/worktrees/api')>(),
  worktreeStanding: vi.fn((repo: string, folder: string, machine: number) => {
    standing.calls.push([repo, folder, machine])
    return standing.asked
  }),
  removeWorktrees: vi.fn(() => Promise.resolve({ removed: [], kept: [{ path: '/code/shop-dark-mode', why: 'something is running in it' }] })),
}))

/** A terminal session of the window working in `cwd`, in the checkout `checkout`. */
function sessionIn(cwd: string, checkout: string): SessionView {
  return {
    ...toSessionView(
      { id: 't9', generation: 0, kind: 'terminal', title: 'Dark mode', named: true, project: '', folder: cwd, cwd, repo: 'shop', branch: 'dark-mode', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: 9, hasDiff: false, agent: 'claude' },
      '/home/me',
    ),
    checkout,
  }
}

function showPanel(windowSessions: readonly SessionView[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <div className="mx-app">
        <WorkspacePanel target={{ project: { machineName: null, folder: '/code/shop/web' }, name: 'web' }} sessions={[]} windowSessions={windowSessions} opening={false} onOpen={vi.fn()} onClose={vi.fn()} onCancel={vi.fn()} />
      </div>
    </QueryClientProvider>,
  )
}

describe('a project’s workspace panel, reading its worktrees', () => {
  it('lists them from this computer’s daemon, asks each linked one’s standing of the main checkout, and each says checking until its standing arrives', async () => {
    showPanel([])

    const row = await screen.findByRole('checkbox', { name: /dark-mode/ })
    expect(row).toHaveAccessibleName(/checking…/)
    expect(screen.getByText('main checkout · stays')).toBeInTheDocument()
    expect(loadFolderBranches).toHaveBeenCalledWith(0, '/code/shop/web')
    expect(standing.calls).toEqual([['/code/shop', '/code/shop-dark-mode', 0]])

    standing.answer({ dirty: 2, branch: 'dark-mode', merged: false, last_commit: '4 days ago', inactive_days: null, missing: false })
    expect(await screen.findByRole('checkbox', { name: /2 uncommitted changes · not merged/ })).toHaveAccessibleName(/4 days ago/)
    expect(screen.queryByText('checking…')).toBeNull()
  })

  it('gives no tick to a worktree a session of the window runs in, on any project', async () => {
    showPanel([sessionIn('/code/shop-dark-mode/src', '/code/shop-dark-mode')])
    expect(await screen.findByRole('checkbox', { name: /dark-mode/ })).toBeDisabled()
  })

  it('removes the ticked worktrees with this computer’s daemon, then reads the list again and shows why one stayed', async () => {
    const user = userEvent.setup()
    showPanel([])
    await user.click(await screen.findByRole('checkbox', { name: /dark-mode/ }))
    await user.click(screen.getByRole('button', { name: 'Remove 1 ticked worktree' }))
    await user.click(screen.getByRole('checkbox', { name: /Remove it too/ }))
    const listed = vi.mocked(loadFolderBranches).mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Remove 1 ticked worktree' }))

    expect(removeWorktrees).toHaveBeenCalledWith([{ path: '/code/shop-dark-mode', force: true }], 0)
    expect(await screen.findByRole('checkbox', { name: /Not removed: something is running in it/ })).toBeInTheDocument()
    await waitFor(() => { expect(vi.mocked(loadFolderBranches).mock.calls.length).toBeGreaterThan(listed) })
  })
})
