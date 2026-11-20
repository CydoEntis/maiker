import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NewWorktreeDialog } from './NewWorktreeDialog'

const worktrees = vi.hoisted(() => [
  { path: '/code/maitty', branch: 'main', main: true, repo: 'maitty' },
  { path: '/code/maitty-bright-owl', branch: 'bright-owl', main: false, repo: 'maitty' },
  { path: '/code/maitty-deep-pike', branch: 'deep-pike', main: false, repo: 'maitty' },
])

vi.mock('@/features/inspect/api', () => ({
  repoBranches: vi.fn(() => Promise.resolve([{ name: 'main' }, { name: 'dev' }])),
  repoWorktrees: vi.fn(() => Promise.resolve(worktrees)),
}))

const removeWorktrees = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('./api', () => ({
  worktreeStanding: vi.fn((_repo: string, folder: string) => Promise.resolve(folder.endsWith('deep-pike')
    ? { dirty: 3, branch: 'deep-pike', merged: false, last_commit: '2 weeks ago', inactive_days: null, missing: false }
    : { dirty: 0, branch: 'bright-owl', merged: true, last_commit: '9 weeks ago', inactive_days: 16, missing: false })),
  worktreeOverlaps: vi.fn(() => Promise.resolve([])),
  mergeWorktree: vi.fn(() => Promise.resolve(null)),
  recreateWorktree: vi.fn(() => Promise.resolve('')),
  removeWorktrees,
}))

// jsdom has no pointer capture, which the dropdown reads on a press; every real browser does.
Element.prototype.hasPointerCapture = () => false

async function open(onCreate = vi.fn<(branch: string, base: string | null) => Promise<void>>(() => Promise.resolve()), task?: string, extra: { fromBranch?: string; move?: { blocked: string | null; run: (branch: string) => Promise<void> } } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <NewWorktreeDialog term={2} repoName="maitty" machine={0} {...(task === undefined ? {} : { task })} {...extra} onCreate={onCreate} onCancel={vi.fn()} />
    </QueryClientProvider>,
  )
  const field = screen.getByRole('textbox', { name: 'Branch name' })
  // The suggested name arrives with the branch lists.
  await waitFor(() => { expect(field).not.toHaveValue('') })
  return { onCreate, field }
}

describe('the new worktree dialog', () => {
  it('says which branch the current commit is on, and can move the chat there instead of starting a session', async () => {
    const user = userEvent.setup()
    const run = vi.fn<(branch: string) => Promise<void>>(() => Promise.resolve())
    const { field, onCreate } = await open(undefined, 'Add dark mode', { fromBranch: 'red-kite', move: { blocked: null, run } })
    expect(screen.getAllByText('The current commit of red-kite').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('checkbox', { name: /Move this chat there/ }))
    await user.click(screen.getByRole('button', { name: 'Move chat' }))
    expect(run).toHaveBeenCalledWith((field as HTMLInputElement).value)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('shows why a chat cannot move and keeps the box off', async () => {
    await open(undefined, undefined, { move: { blocked: 'Wait until the agent is idle', run: vi.fn(() => Promise.resolve()) } })
    expect(screen.getByRole('checkbox', { name: /Move this chat there/ })).toBeDisabled()
  })

  it('suggests a name made from what the session is working on, and uses the one you type instead', async () => {
    const user = userEvent.setup()
    const { field, onCreate } = await open(undefined, 'Fix the login redirect bug')
    expect(field).toHaveValue('fix-login-redirect-bug')
    await user.clear(field)
    await user.type(field, 'feat/My_Own.name')
    await user.click(screen.getByRole('button', { name: 'Create worktree' }))
    expect(onCreate).toHaveBeenCalledWith('feat/My_Own.name', null)
  })

  it('offers a free two-word name and creates it from the current commit', async () => {
    const user = userEvent.setup()
    const { field, onCreate } = await open()
    expect(field.getAttribute('value')).toMatch(/^[a-z]+-[a-z]+$/)
    await user.click(screen.getByRole('button', { name: 'Create worktree' }))
    expect(onCreate).toHaveBeenCalledWith((field as HTMLInputElement).value, null)
  })

  it('starts the branch from the one picked in the list', async () => {
    const user = userEvent.setup()
    const { field, onCreate } = await open()
    await user.clear(field)
    await user.type(field, 'feat/login')
    await user.click(screen.getByRole('combobox', { name: 'Start from' }))
    await user.click(await screen.findByRole('option', { name: 'dev' }))
    await user.click(screen.getByRole('button', { name: 'Create worktree' }))
    expect(onCreate).toHaveBeenCalledWith('feat/login', 'dev')
  })

  it('says it checks out a branch that already exists instead of asking where to start', async () => {
    const user = userEvent.setup()
    const { field } = await open()
    await user.clear(field)
    await user.type(field, 'dev')
    expect(screen.getByText('That branch exists; the worktree checks it out.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Start from' })).toBeNull()
  })

  it('says nothing while you type a name git refuses, and says why under the field once you leave it', async () => {
    const user = userEvent.setup()
    const { field } = await open()
    await user.clear(field)
    await user.type(field, 'feat new login')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(field).not.toHaveAttribute('aria-invalid')

    await user.tab()
    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('Branch names can’t contain spaces. Try feat-new-login.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAttribute('aria-describedby', error.id)
    // The field keeps what you typed.
    expect(field).toHaveValue('feat new login')
  })

  it('on Create, shows the problem, puts you back in the field and starts nothing', async () => {
    const user = userEvent.setup()
    const { field, onCreate } = await open()
    await user.clear(field)
    await user.type(field, 'a..b')
    await user.click(screen.getByRole('button', { name: 'Create worktree' }))
    expect(screen.getByRole('alert')).toHaveTextContent('A branch name cannot hold .. or // or @{')
    expect(field).toHaveFocus()
    expect(onCreate).not.toHaveBeenCalled()

    await user.clear(field)
    await user.type(field, 'feat/login')
    await user.click(screen.getByRole('button', { name: 'Create worktree' }))
    expect(onCreate).toHaveBeenCalledWith('feat/login', null)
  })
})

describe('the existing worktrees in the new worktree dialog', () => {
  it('stay folded away, so the Create button is never pushed off the screen', async () => {
    await open()
    expect(screen.getByRole('button', { name: /Other worktrees of maitty/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('bright-owl')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create worktree' })).toBeInTheDocument()
  })

  it('open to one line each: the name, one word for where it stands, and how long it has sat', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(screen.getByRole('button', { name: /Other worktrees of maitty/ }))
    const owl = (await screen.findByText('bright-owl')).closest('li')
    const pike = screen.getByText('deep-pike').closest('li')
    expect(owl).not.toBeNull()
    expect(pike).not.toBeNull()
    expect(await within(owl as HTMLElement).findByText('merged')).toBeInTheDocument()
    expect(within(owl as HTMLElement).getByText('inactive 16 days')).toBeInTheDocument()
    expect(await within(pike as HTMLElement).findByText('3 changes')).toBeInTheDocument()
  })

  it('ask before Remove throws away uncommitted changes, and remove nothing when you keep them', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(screen.getByRole('button', { name: /Other worktrees of maitty/ }))
    const pike = (await screen.findByText('deep-pike')).closest('li') as HTMLElement
    await within(pike).findByText('3 changes')
    await user.click(within(pike).getByRole('button', { name: 'Remove' }))
    expect(removeWorktrees).not.toHaveBeenCalled()
    await user.click(within(pike).getByRole('button', { name: 'Keep' }))
    expect(removeWorktrees).not.toHaveBeenCalled()

    await user.click(within(pike).getByRole('button', { name: 'Remove' }))
    await user.click(within(pike).getByRole('button', { name: /^Lose its 3 uncommitted changes\? Remove$/ }))
    expect(removeWorktrees).toHaveBeenCalledWith([{ path: '/code/maitty-deep-pike', force: true }], 0)
  })
})
