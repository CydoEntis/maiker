import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { loadFolderBranches } from '@/api/folderGit'
import type { WorktreeStanding } from '@/features/worktrees/api'
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
}))

describe('a project’s workspace panel, reading its worktrees', () => {
  it('lists them from this computer’s daemon, asks each linked one’s standing of the main checkout, and each says checking until its standing arrives', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <div className="mx-app">
          <WorkspacePanel target={{ project: { machineName: null, folder: '/code/shop/web' }, name: 'web' }} sessions={[]} onCancel={vi.fn()} />
        </div>
      </QueryClientProvider>,
    )

    const row = await screen.findByRole('checkbox', { name: /dark-mode/ })
    expect(row).toHaveAccessibleName(/checking…/)
    expect(screen.getByText('main checkout · stays')).toBeInTheDocument()
    expect(loadFolderBranches).toHaveBeenCalledWith(0, '/code/shop/web')
    expect(standing.calls).toEqual([['/code/shop', '/code/shop-dark-mode', 0]])

    standing.answer({ dirty: 2, branch: 'dark-mode', merged: false, last_commit: '4 days ago', inactive_days: null, missing: false })
    expect(await screen.findByRole('checkbox', { name: /2 uncommitted changes · not merged/ })).toHaveAccessibleName(/4 days ago/)
    expect(screen.queryByText('checking…')).toBeNull()
  })
})
