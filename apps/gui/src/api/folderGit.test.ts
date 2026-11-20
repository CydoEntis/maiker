import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkoutRemoteBranch, createFolderBranch, loadFolderBranches, localNameOf, switchFolderBranch, untrackedRemoteBranches, type FolderBranchList } from './folderGit'

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args: { tag: number }) => Promise<unknown>>(),
  handler: null as null | ((event: { payload: unknown }) => void),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (_name: string, handler: (event: { payload: unknown }) => void) => {
    shell.handler = handler
    return Promise.resolve(() => undefined)
  },
}))

function lastTag(): number {
  const tag = shell.invoke.mock.lastCall?.[1].tag
  if (tag === undefined) throw new Error('nothing was asked')
  return tag
}

function answer(machine: number, fields: Record<string, unknown>) {
  shell.handler?.({ payload: { machine, tag: lastTag(), why: null, listing: null, branch: null, ...fields } })
}

const LISTING: FolderBranchList = {
  current: 'main',
  branches: [
    { name: 'main', current: true, when: 5, remote: false },
    { name: 'origin/main', current: false, when: 5, remote: true },
    { name: 'origin/feature', current: false, when: 4, remote: true },
  ],
  worktrees: [],
}

beforeEach(() => {
  shell.invoke.mockReset()
  shell.invoke.mockResolvedValue(undefined)
})

describe('a folder\'s branches on a machine', () => {
  it('asks this computer without naming a machine and gives the listing', async () => {
    const loaded = loadFolderBranches(0, '/code/shop')
    await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
    expect(shell.invoke).toHaveBeenCalledWith('folder_git', { folder: '/code/shop', request: 'Branches', tag: lastTag() })
    answer(0, { state: 'branches', listing: LISTING })
    await expect(loaded).resolves.toEqual(LISTING)
  })

  it('names another machine and gives null for a folder that is not a repository', async () => {
    const loaded = loadFolderBranches(3, '~/notes')
    await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
    expect(shell.invoke).toHaveBeenCalledWith('folder_git', { machine: 3, folder: '~/notes', request: 'Branches', tag: lastTag() })
    answer(3, { state: 'not-a-repo' })
    await expect(loaded).resolves.toBeNull()
  })

  it('switches, makes and checks out by the request the daemon reads, and gives the local branch', async () => {
    const cases = [
      { run: () => switchFolderBranch(0, '/c', 'dev'), request: { Switch: { branch: 'dev' } } },
      { run: () => createFolderBranch(0, '/c', 'topic'), request: { Create: { branch: 'topic' } } },
      { run: () => checkoutRemoteBranch(0, '/c', 'origin/feature'), request: { CheckoutRemote: { remote_branch: 'origin/feature' } } },
    ]
    for (const { run, request } of cases) {
      shell.invoke.mockClear()
      const done = run()
      await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
      expect(shell.invoke).toHaveBeenCalledWith('folder_git', { folder: '/c', request, tag: lastTag() })
      answer(0, { state: 'switched', branch: 'result' })
      await expect(done).resolves.toBe('result')
    }
  })

  it('rejects with the machine\'s own reason when git refused', async () => {
    const done = checkoutRemoteBranch(3, '/c', 'origin/feature')
    await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
    answer(3, { state: 'failed', why: "fatal: a branch named 'feature' already exists" })
    await expect(done).rejects.toThrow("a branch named 'feature' already exists")
  })

  it('passes on the words the host refuses with', async () => {
    shell.invoke.mockRejectedValue('kingdom is not connected')
    await expect(loadFolderBranches(3, '/c')).rejects.toThrow('kingdom is not connected')
  })
})

describe('reading a listing', () => {
  it('offers the remote branches no local branch has the name of', () => {
    expect(untrackedRemoteBranches(LISTING).map((branch) => branch.name)).toEqual(['origin/feature'])
    expect(localNameOf('origin/feature/x')).toBe('feature/x')
  })
})
