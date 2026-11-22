import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloneProgress } from '@/api/cloneRepository'
import type { SignInState } from '@/api/agentSignIn'
import type { GitHubReport } from '@/api/githubAccounts'
import type { GitHubList, GitHubRepoList } from '@/api/githubRepos'
import type { FolderListing } from '@/api/folders'
import { OpenProjectDialog, type OpenProjectTab } from './OpenProjectDialog'

const api = vi.hoisted(() => ({
  clone: vi.fn<(machine: number, address: string, parent: string, onProgress?: (progress: CloneProgress) => void) => Promise<string>>(),
  accounts: vi.fn<() => Promise<GitHubReport>>(),
  signIn: vi.fn<(agent: string, request: string) => Promise<SignInState>>(),
  repos: vi.fn<() => Promise<GitHubList<GitHubRepoList>>>(),
  owners: vi.fn<() => Promise<GitHubList<string[]>>>(),
  folders: vi.fn<(machine: number, path: string) => Promise<FolderListing>>(),
  copy: vi.fn<(text: string) => Promise<void>>(),
}))
vi.mock('@/api/cloneRepository', () => ({ cloneRepository: api.clone }))
vi.mock('@/api/githubAccounts', () => ({ loadGitHubAccounts: api.accounts }))
vi.mock('@/api/agentSignIn', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/agentSignIn')>()), agentSignIn: api.signIn }))
vi.mock('@/api/githubRepos', () => ({ loadGitHubRepos: api.repos, loadGitHubOwners: api.owners }))
vi.mock('@/api/folders', () => ({ listFolders: api.folders }))
vi.mock('@/api/daemon', () => ({ openLink: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/clipboard', () => ({ copyText: api.copy }))

const HOME = 'C:\\Users\\cstin'
const signedIn: GitHubReport = { installed: true, accounts: [{ login: 'cstin', active: true }], problem: null }
const repoList: GitHubList<GitHubRepoList> = {
  state: 'listed',
  listed: {
    more: false,
    repos: [
      { name: 'cstin/chameleon', description: 'A theme tool', private: true, pushedAt: '2026-11-10T10:00:00Z', cloneUrl: 'https://github.com/cstin/chameleon.git' },
      { name: 'cstin/dotfiles', description: '', private: false, pushedAt: '2026-11-01T10:00:00Z', cloneUrl: 'https://github.com/cstin/dotfiles.git' },
    ],
  },
}

function listing(path: string, names: string[]): FolderListing {
  return { path, exists: true, entries: names.map((name) => ({ name, git: 'main', has_children: true })), truncated: false, can_create: false }
}

function show(tab: OpenProjectTab = 'url', purpose: 'session' | 'project' = 'session') {
  const onStartSession = vi.fn()
  const onOpenProject = vi.fn<(folder: string) => Promise<void>>(() => Promise.resolve())
  const onClose = vi.fn()
  const chooseFolder = vi.fn<(current: string) => Promise<string | null>>(() => Promise.resolve(null))
  const folderExists = vi.fn<(path: string) => Promise<boolean>>(() => Promise.resolve(true))
  render(<OpenProjectDialog tab={tab} home={HOME} chooseFolder={chooseFolder} folderExists={folderExists} purpose={purpose === 'session' ? { kind: 'session', onStartSession } : { kind: 'project', onOpenProject }} onClose={onClose} />)
  return { onStartSession, onOpenProject, onClose, chooseFolder, folderExists, user: userEvent.setup() }
}

beforeEach(() => {
  vi.resetAllMocks()
  api.accounts.mockResolvedValue(signedIn)
  api.signIn.mockResolvedValue({ kind: 'idle' })
  api.repos.mockResolvedValue(repoList)
  api.owners.mockResolvedValue({ state: 'listed', listed: ['cstin'] })
  api.folders.mockImplementation((_machine, path) => Promise.resolve(path === `${HOME}\\code` ? listing(path, ['chameleon', 'notes']) : { path, exists: false, entries: [], truncated: false, can_create: false }))
  api.copy.mockResolvedValue(undefined)
})

describe('Clone from URL', () => {

  it('refuses an address with a password in it without sending it anywhere', async () => {
    const { user } = show()
    await user.type(screen.getByLabelText('Repository URL'), 'https://me:secret@github.com/o/r')
    expect(await screen.findByRole('alert')).toHaveTextContent('Leave the user name and password out')
    expect(api.clone).not.toHaveBeenCalled()
  })

  it('clones the normalised address into the parent of the folder, follows the progress, then offers to start a session', async () => {
    let finish: (folder: string) => void = () => undefined
    api.clone.mockImplementation((_machine, _address, _parent, onProgress) => new Promise<string>((resolve) => {
      onProgress?.({ phase: 'receiving', percent: 42 })
      finish = resolve
    }))
    const { user, onStartSession, onClose } = show()
    await user.type(screen.getByLabelText('Repository URL'), 'git@github.com:linkables/linkables-web.git')
    await user.click(screen.getByRole('button', { name: 'Clone' }))

    expect(api.clone).toHaveBeenCalledWith(0, 'git@github.com:linkables/linkables-web.git', HOME, expect.any(Function))
    expect(await screen.findByText('Receiving · 42%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Clone progress' })).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByRole('button', { name: 'Cloning…' })).toBeDisabled()

    finish(`${HOME}/linkables-web`)
    const ready = await screen.findByText(/is ready in/)
    expect(ready).toHaveTextContent(`linkables-web is ready in ${HOME}/linkables-web`)
    await user.click(screen.getByRole('button', { name: 'Start a session in linkables-web' }))
    expect(onStartSession).toHaveBeenCalledWith(`${HOME}/linkables-web`)
    expect(onClose).toHaveBeenCalled()
  })

  it('says why a clone did not happen and offers the folder that is already there', async () => {
    api.clone.mockRejectedValue(new Error(`${HOME}/r is already there`))
    const { user } = show()
    await user.type(screen.getByLabelText('Repository URL'), 'https://github.com/o/r')
    await user.click(screen.getByRole('button', { name: 'Clone' }))
    expect(await screen.findByText('Could not clone the repository')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use it' }))
    expect(await screen.findByRole('button', { name: 'Start a session in r' })).toBeEnabled()
  })
})

describe('GitHub', () => {
  it('offers Sign in with GitHub when nobody is signed in, and shows the code and link the daemon read', async () => {
    api.accounts.mockResolvedValue({ installed: true, accounts: [], problem: null })
    api.signIn.mockResolvedValue({ kind: 'waiting', link: 'https://github.com/login/device', code: 'WDJB-MJHT' })
    const { user } = show('github')
    await user.click(await screen.findByRole('button', { name: 'Sign in with GitHub' }))

    expect(api.signIn).toHaveBeenCalledWith('github', 'start')
    expect(await screen.findByLabelText('One-time code')).toHaveTextContent('WDJB-MJHT')
    expect(screen.getByText('Waiting for GitHub…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open link' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy code' }))
    expect(api.copy).toHaveBeenCalledWith('WDJB-MJHT')
  })

  it('says GitHub signed in after the sign-in ends, by asking who is signed in', async () => {
    api.accounts.mockResolvedValueOnce({ installed: true, accounts: [], problem: null })
    api.signIn.mockResolvedValue({ kind: 'signed-in' })
    const { user } = show('github')
    await user.click(await screen.findByRole('button', { name: 'Sign in with GitHub' }))
    api.accounts.mockResolvedValue(signedIn)
    expect(await screen.findByText('cstin')).toBeInTheDocument()
  })

  it('lists the account, marks private repositories, and clones the one picked into the home folder', async () => {
    api.clone.mockResolvedValue(`${HOME}/dotfiles`)
    const { user } = show('github')
    expect(await screen.findByText('cstin')).toBeInTheDocument()
    const row = (await screen.findByText('cstin/chameleon')).closest('li')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Private')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Clone cstin/dotfiles' }))
    expect(api.clone).toHaveBeenCalledWith(0, 'https://github.com/cstin/dotfiles.git', HOME, expect.any(Function))
    expect(await screen.findByText(/is ready in/)).toHaveTextContent('dotfiles')
  })

  it('shows Open, not Clone, for a repository already on this computer', async () => {
    const { user } = show('github')
    await user.click(await screen.findByRole('button', { name: 'Open cstin/chameleon' }))
    expect(await screen.findByRole('button', { name: 'Start a session in chameleon' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Clone cstin/dotfiles' })).toBeInTheDocument()
  })

  it('signs out through gh and asks who is signed in again', async () => {
    const { user } = show('github')
    api.accounts.mockResolvedValue({ installed: true, accounts: [], problem: null })
    api.signIn.mockResolvedValue({ kind: 'idle' })
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(api.signIn).toHaveBeenCalledWith('github', 'sign-out')
    expect(await screen.findByRole('button', { name: 'Sign in with GitHub' })).toBeInTheDocument()
  })
})

describe('On this computer', () => {
  it('lists the git projects found near home and fills the folder when one is picked', async () => {
    const { user } = show('folder')
    const list = await screen.findByRole('list', { name: 'Git projects on this computer' })
    await user.click(within(list).getByRole('button', { name: /chameleon/ }))
    expect(screen.getByLabelText('Folder')).toHaveValue(`${HOME}\\code\\chameleon`)
  })

  it('puts a folder chosen with Browse into the field and opens it when it is there', async () => {
    const { user, chooseFolder, folderExists } = show('folder')
    chooseFolder.mockResolvedValue('D:\\work\\app')
    await user.click(screen.getByRole('button', { name: 'Browse…' }))
    await waitFor(() => { expect(screen.getByLabelText('Folder')).toHaveValue('D:\\work\\app') })
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(folderExists).toHaveBeenCalledWith('D:\\work\\app')
    expect(await screen.findByRole('button', { name: 'Start a session in app' })).toBeEnabled()
  })

  it('says so when the typed folder is not there', async () => {
    const { user, folderExists } = show('folder')
    folderExists.mockResolvedValue(false)
    await user.type(screen.getByLabelText('Folder'), 'D:\\nope')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That folder is not there')
  })
})

describe('opening a project without a session', () => {
  it('opens a folder that is there as soon as it is confirmed, and starts no session', async () => {
    const { user, onOpenProject, onStartSession, onClose } = show('folder', 'project')
    await user.type(screen.getByLabelText('Folder'), 'D:\\work\\app')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => { expect(onOpenProject).toHaveBeenCalledWith('D:\\work\\app') })
    await waitFor(() => { expect(onClose).toHaveBeenCalled() })
    expect(onStartSession).not.toHaveBeenCalled()
  })

  it('offers to open a cloned repository, not to start a session in it', async () => {
    api.clone.mockResolvedValue(`${HOME}/r`)
    const { user, onOpenProject, onStartSession } = show('url', 'project')
    await user.type(screen.getByLabelText('Repository URL'), 'https://github.com/o/r')
    await user.click(screen.getByRole('button', { name: 'Clone' }))
    expect(screen.queryByRole('button', { name: /Start a session/ })).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Open r' }))
    expect(onOpenProject).toHaveBeenCalledWith(`${HOME}/r`)
    expect(onStartSession).not.toHaveBeenCalled()
  })

  it('stays open with the reason when the folder cannot be opened', async () => {
    const { user, onOpenProject, onClose } = show('folder', 'project')
    onOpenProject.mockRejectedValue(new Error('There is no folder D:/work/gone'))
    await user.type(screen.getByLabelText('Folder'), 'D:\\work\\gone')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    const note = await screen.findByRole('alert')
    expect(note).toHaveTextContent('Could not open the project')
    expect(note).toHaveTextContent('There is no folder D:/work/gone')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled()
  })
})
