import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderBranchList } from '@/api/folderGit'
import { currentToasts } from '@/lib/toast'
import { SessionBar, type SessionPlace } from '../components/SessionBar'
import { PlaceActionsContext } from './placeActions'

const git = vi.hoisted(() => ({
  load: vi.fn(),
  switchTo: vi.fn(),
  create: vi.fn(),
  checkoutRemote: vi.fn(),
  syncState: vi.fn(),
  sync: vi.fn(),
  reveal: vi.fn(),
  copy: vi.fn(),
}))

vi.mock('@/api/folderGit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/folderGit')>()),
  loadFolderBranches: git.load,
  switchFolderBranch: git.switchTo,
  createFolderBranch: git.create,
  checkoutRemoteBranch: git.checkoutRemote,
}))
vi.mock('@/api/daemon', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/daemon')>()), folderSyncState: git.syncState }))
vi.mock('@/features/inspect/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/features/inspect/api')>()), syncRemote: git.sync }))
vi.mock('@/api/reveal', () => ({ revealInExplorer: git.reveal }))
vi.mock('@/lib/clipboard', () => ({ copyText: git.copy }))

const PLACE: SessionPlace = { machine: null, project: 'chameleon', branch: 'fix/cart-total', worktree: true, folder: '/dev/chameleon-trees/amber-fox', machineId: 0, pane: 3, worktreeName: 'amber-fox' }
const LIST: FolderBranchList = {
  current: 'fix/cart-total',
  branches: [
    { name: 'fix/cart-total', current: true, when: 5, remote: false },
    { name: 'main', current: false, when: 4, remote: false },
    { name: 'origin/main', current: false, when: 4, remote: true },
    { name: 'origin/feature/search', current: false, when: 3, remote: true },
  ],
  worktrees: [],
}
const FOLDER_NAME = /^\/dev\/chameleon-trees\/amber-fox/
const SYNC = { branch: 'fix/cart-total', upstream: 'origin/fix/cart-total', behind: 2, ahead: 1, dirty: false, fetched: true }

beforeEach(() => {
  vi.clearAllMocks()
  git.load.mockResolvedValue(LIST)
  git.syncState.mockResolvedValue(SYNC)
  git.sync.mockResolvedValue('Pulled 2 commits')
  git.copy.mockResolvedValue(undefined)
  git.reveal.mockResolvedValue(undefined)
})
afterEach(cleanup)

const titles = () => currentToasts().items.map((item) => item.title)

async function openBranch() {
  const user = userEvent.setup()
  render(<SessionBar place={PLACE} />)
  await user.click(screen.getByRole('button', { name: /^Branch fix\/cart-total/ }))
  await screen.findByRole('radio', { name: /^main/ })
  return user
}

describe('the branch chip', () => {
  it('heads its menu with the branch and the worktree, and highlights the current branch', async () => {
    await openBranch()
    expect(screen.getByText('Worktree amber-fox · chameleon')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^fix\/cart-total/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /^main/ })).toHaveAttribute('aria-checked', 'false')
    // origin/main is already followed by the local main, so only the other remote branch is offered.
    expect(screen.queryByRole('radio', { name: /^origin\/main/ })).toBeNull()
    expect(screen.getByRole('radio', { name: /^origin\/feature\/search/ })).toBeInTheDocument()
  })

  it('switches to a local branch, shows the new branch on the chip and says so in a toast', async () => {
    git.switchTo.mockResolvedValue('main')
    const user = await openBranch()
    await user.click(screen.getByRole('radio', { name: /^main/ }))
    expect(git.switchTo).toHaveBeenCalledWith(0, PLACE.folder, 'main')
    await waitFor(() => { expect(titles()).toContain('Switched to main') })
    expect(screen.getByRole('button', { name: /^Branch main/ })).toBeInTheDocument()
  })

  it('checks out a remote branch and tracks it', async () => {
    git.checkoutRemote.mockResolvedValue('feature/search')
    const user = await openBranch()
    await user.click(screen.getByRole('radio', { name: /^origin\/feature\/search/ }))
    expect(git.checkoutRemote).toHaveBeenCalledWith(0, PLACE.folder, 'origin/feature/search')
    await waitFor(() => { expect(titles()).toContain('Checked out feature/search, tracking origin/feature/search') })
  })

  it('offers to create a typed name that is not a branch yet, and creates it on Enter', async () => {
    git.create.mockResolvedValue('fix/rounding')
    const user = await openBranch()
    await user.type(screen.getByRole('textbox', { name: 'Find or switch branch' }), 'fix/rounding')
    expect(screen.getByRole('radio', { name: 'Create branch fix/rounding' })).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(git.create).toHaveBeenCalledWith(0, PLACE.folder, 'fix/rounding')
    await waitFor(() => { expect(titles()).toContain('Created fix/rounding and switched to it') })
  })

  it('does not offer to create a name that exists or that git refuses', async () => {
    const user = await openBranch()
    const search = screen.getByRole('textbox', { name: 'Find or switch branch' })
    await user.type(search, 'main')
    expect(screen.queryByRole('radio', { name: /^Create branch/ })).toBeNull()
    await user.clear(search)
    await user.type(search, 'two words')
    expect(screen.getByRole('alert')).toHaveTextContent("Branch names can't have spaces")
  })

  it('makes a branch from the current one with an inline name field', async () => {
    git.create.mockResolvedValue('wip')
    const user = await openBranch()
    await user.click(screen.getByRole('button', { name: /New branch from/ }))
    await user.type(await screen.findByRole('textbox', { name: 'New branch name' }), 'wip{Enter}')
    expect(git.create).toHaveBeenCalledWith(0, PLACE.folder, 'wip')
    await waitFor(() => { expect(titles()).toContain('Created wip and switched to it') })
  })

  it('reads another machine\'s folder through that machine', async () => {
    const user = userEvent.setup()
    render(<SessionBar place={{ ...PLACE, machine: 'devbox', machineId: 2 }} />)
    await user.click(screen.getByRole('button', { name: /^Branch fix\/cart-total/ }))
    await screen.findByRole('radio', { name: /^main/ })
    expect(git.load).toHaveBeenCalledWith(2, PLACE.folder)
  })

  it('says why a switch failed in a toast and leaves the chip alone', async () => {
    git.switchTo.mockRejectedValue(new Error('Your changes would be overwritten'))
    const user = await openBranch()
    await user.click(screen.getByRole('radio', { name: /^main/ }))
    await waitFor(() => { expect(titles()).toContain('Could not switch to main') })
    expect(screen.getByRole('button', { name: /^Branch fix\/cart-total/ })).toBeInTheDocument()
  })
})

describe('the sync chip', () => {
  const openSync = async () => {
    const user = userEvent.setup()
    render(<SessionBar place={PLACE} />)
    await user.click(await screen.findByRole('button', { name: /^Sync with origin/ }))
    return user
  }

  it('shows the counts and heads its menu with the branch and its upstream', async () => {
    await openSync()
    expect(screen.getByRole('button', { name: 'Sync with origin: ↓2 ↑1' })).toBeInTheDocument()
    expect(screen.getByText('fix/cart-total ⇄ origin/fix/cart-total')).toBeInTheDocument()
    expect(screen.getByText(/2 to pull · 1 to push · not fetched yet/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Pull 2 commits/ })).toBeEnabled()
    expect(screen.getByRole('radio', { name: /Push 1 commit$/ })).toBeEnabled()
  })

  it('reads Pulling… while it runs, then confirms in a toast and reads the counts again', async () => {
    let finish: (said: string) => void = () => undefined
    git.sync.mockReturnValue(new Promise<string>((resolve) => { finish = resolve }))
    git.syncState.mockResolvedValue({ ...SYNC, ahead: 0 })
    const user = await openSync()
    git.syncState.mockResolvedValue({ ...SYNC, ahead: 0, behind: 0 })
    await user.click(screen.getByRole('radio', { name: /Pull 2 commits/ }))
    expect(git.sync).toHaveBeenCalledWith(PLACE.folder, 'pull', 0, 3)
    expect(await screen.findByRole('button', { name: /^Sync with origin: Pulling…/ })).toBeInTheDocument()
    finish('Pulled 2 commits')
    await waitFor(() => { expect(titles()).toContain('Pulled 2 commits') })
    expect(await screen.findByRole('button', { name: 'Sync with origin: Synced' })).toBeInTheDocument()
  })

  it('reads Synced with nothing to pull or push, and disables Pull and Push', async () => {
    git.syncState.mockResolvedValue({ ...SYNC, behind: 0, ahead: 0 })
    await openSync()
    expect(screen.getByRole('button', { name: 'Sync with origin: Synced' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Pull 0 commits/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Push 0 commits/ })).toBeDisabled()
  })

  it('does not force a pull that cannot fast-forward: it says so and runs nothing', async () => {
    const user = await openSync()
    git.sync.mockClear()
    // Ahead 1 and behind 2 at once is diverged.
    await user.click(screen.getByRole('radio', { name: /Pull 2 commits/ }))
    expect(git.sync).not.toHaveBeenCalled()
    expect(titles()).toContain('Pull needs your say')
  })

  it('is not drawn for a folder the daemon cannot read the state of', () => {
    render(<SessionBar place={{ ...PLACE, machine: 'devbox', machineId: 2 }} />)
    expect(screen.queryByRole('button', { name: /^Sync with origin/ })).toBeNull()
    expect(git.syncState).not.toHaveBeenCalled()
  })
})

describe('the folder chip', () => {
  const openFolder = async (projects = [{ name: 'shop', folder: '/dev/shop' }], onNewSessionIn = vi.fn()) => {
    const user = userEvent.setup()
    render(
      <PlaceActionsContext.Provider value={{ projects, onNewSessionIn }}>
        <SessionBar place={PLACE} />
      </PlaceActionsContext.Provider>,
    )
    await user.click(screen.getByRole('button', { name: FOLDER_NAME }))
    return { user, onNewSessionIn }
  }

  it('shortens to the project and worktree, keeps the full path on hover, and lets the folder give way first', async () => {
    await openFolder()
    const chip = screen.getByRole('button', { name: FOLDER_NAME })
    expect(chip).toHaveTextContent('chameleon / amber-fox')
    expect(chip).toHaveAttribute('title', PLACE.folder)
    expect(chip).toHaveClass('is-folder')
    expect(screen.getByText('This session runs here')).toBeInTheDocument()
  })

  it('copies the path and shows the folder in the file manager', async () => {
    const { user } = await openFolder()
    await user.click(screen.getByRole('radio', { name: /Copy path/ }))
    expect(git.copy).toHaveBeenCalledWith(PLACE.folder)
    await user.click(screen.getByRole('button', { name: FOLDER_NAME }))
    await user.click(screen.getByRole('radio', { name: /Show in Explorer/ }))
    expect(git.reveal).toHaveBeenCalledWith(PLACE.folder)
  })

  it('starts a session in one of your projects', async () => {
    const { user, onNewSessionIn } = await openFolder()
    await user.click(screen.getByRole('radio', { name: 'shop' }))
    expect(onNewSessionIn).toHaveBeenCalledWith('/dev/shop')
  })

  it('does not offer to change the folder of a session that has started', async () => {
    await openFolder()
    expect(screen.queryByRole('radio', { name: /Open folder…/ })).toBeNull()
    expect(screen.queryByRole('radio', { name: /Clone a repository…/ })).toBeNull()
  })

  it('leaves Show in Explorer out for a folder on another machine', async () => {
    const user = userEvent.setup()
    render(<SessionBar place={{ ...PLACE, machine: 'devbox', machineId: 2 }} />)
    await user.click(screen.getByRole('button', { name: FOLDER_NAME }))
    expect(screen.getByRole('radio', { name: /Copy path/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Show in Explorer/ })).toBeNull()
  })
})
