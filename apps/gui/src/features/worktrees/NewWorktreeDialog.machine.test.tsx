import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { FolderBranchList } from '@/api/folderGit'
import { NewWorktreeDialog } from './NewWorktreeDialog'

/** A fake machine 4, `devbox`: what its daemon lists for a folder, and every folder it was asked about. */
const devbox = vi.hoisted(() => ({
  listing: (): Promise<FolderBranchList | null> => Promise.resolve(null),
  asked: [] as [number, string][],
}))
vi.mock('@/api/folderGit', async (original) => ({
  ...await original<typeof import('@/api/folderGit')>(),
  loadFolderBranches: (machine: number, folder: string) => { devbox.asked.push([machine, folder]); return devbox.listing() },
}))

// A pane of another machine is never asked about its repository from here (`remote_repo::may_ask`).
const repoAsked = vi.hoisted(() => vi.fn(() => Promise.reject(new Error('Inspect is local-only in v1'))))
vi.mock('@/features/inspect/api', () => ({ repoBranches: repoAsked, repoWorktrees: repoAsked }))

// jsdom has no pointer capture, which the dropdown reads on a press; every real browser does.
Element.prototype.hasPointerCapture = () => false

const DEVBOX = 4
const API = '/srv/api'
const LISTED: FolderBranchList = {
  current: 'main',
  branches: [
    { name: 'main', current: true, when: null, remote: false },
    { name: 'dev', current: false, when: null, remote: false },
    { name: 'origin/main', current: false, when: null, remote: true },
  ],
  worktrees: [
    { path: API, branch: 'main', main: true, when: null },
    { path: '/home/me/.maiker/worktrees/api/fix-login', branch: 'fix-login', main: false, when: null },
  ],
}

function openOnDevbox(onCreate: (branch: string, base: string | null) => Promise<void>, listing: () => Promise<FolderBranchList | null> = () => Promise.resolve(LISTED)) {
  devbox.listing = listing
  devbox.asked = []
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <NewWorktreeDialog term={7} repoName="api" machine={DEVBOX} folder={API} fromBranch="main" onCreate={onCreate} onCancel={vi.fn()} />
    </QueryClientProvider>,
  )
  return screen.getByRole('textbox', { name: 'Branch name' })
}

describe('the new worktree dialog for a session on another machine', () => {
  it('lists that machine\'s branches by the repository\'s folder, and starts the branch from one of them there', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn<(branch: string, base: string | null) => Promise<void>>(() => Promise.resolve())
    const field = openOnDevbox(onCreate)
    await waitFor(() => { expect(field).not.toHaveValue('') })
    expect(devbox.asked).toEqual([[DEVBOX, API]])
    expect(repoAsked).not.toHaveBeenCalled()
    await user.clear(field)
    await user.type(field, 'feat/login')
    await user.click(screen.getByRole('combobox', { name: 'Start from' }))
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['The current commit of main', 'main', 'dev'])
    await user.click(screen.getByRole('option', { name: 'dev' }))
    await user.click(screen.getByRole('button', { name: 'Create worktree' }))
    expect(onCreate).toHaveBeenCalledWith('feat/login', 'dev')
  })

  it('knows a branch of that machine, or one its worktrees have out, is taken', async () => {
    const user = userEvent.setup()
    const field = openOnDevbox(vi.fn(() => Promise.resolve()))
    await waitFor(() => { expect(field).not.toHaveValue('') })
    expect(['main', 'dev', 'fix-login']).not.toContain((field as HTMLInputElement).value)
    await user.clear(field)
    await user.type(field, 'dev')
    expect(screen.getByText('That branch exists; the worktree checks it out.')).toBeInTheDocument()
  })

  it('offers no removing or merging of that machine\'s worktrees, which stay this computer\'s', async () => {
    const field = openOnDevbox(vi.fn(() => Promise.resolve()))
    await waitFor(() => { expect(field).not.toHaveValue('') })
    expect(screen.queryByRole('button', { name: /Existing worktrees/ })).toBeNull()
  })

  it('says the machine\'s refusal under the field and stays open when the machine is down or too old', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn(() => Promise.reject(new Error('devbox is not connected')))
    const field = openOnDevbox(onCreate, () => Promise.reject(new Error('devbox is not connected')))
    await user.type(field, 'feat/login')
    await user.click(screen.getByRole('button', { name: 'Create worktree' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('devbox is not connected')
    expect(screen.getByRole('heading', { name: 'New worktree' })).toBeInTheDocument()
    expect(onCreate).toHaveBeenCalledTimes(1)
  })
})
