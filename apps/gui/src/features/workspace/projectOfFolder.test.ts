import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderBranchList } from '@/api/folderGit'
import type { FolderListing } from '@/api/folders'
import { projectOfFolder } from './projectOfFolder'

const git = vi.hoisted(() => ({ next: (): Promise<FolderBranchList | null> => Promise.resolve(null) }))
const folders = vi.hoisted(() => ({ next: (): Promise<FolderListing> => Promise.reject(new Error('not asked')) }))
vi.mock('@/api/folderGit', () => ({ loadFolderBranches: () => git.next() }))
vi.mock('@/api/folders', () => ({ listFolders: () => folders.next() }))

const listed = (exists: boolean): FolderListing => ({ path: '/srv/app', exists, entries: [], truncated: false, can_create: true })

describe('the project a folder opens as', () => {
  beforeEach(() => {
    git.next = () => Promise.resolve(null)
    folders.next = () => Promise.reject(new Error('not asked'))
  })

  it('is the repository’s main checkout for a folder in git, and the folder itself otherwise', async () => {
    git.next = () => Promise.resolve({ current: 'main', branches: [], worktrees: [{ path: '/srv/app', branch: 'main', main: true, when: null }, { path: '/srv/app-fix', branch: 'fix', main: false, when: null }] })
    expect(await projectOfFolder(4, 'devbox', '/srv/app-fix')).toEqual({ machineName: 'devbox', folder: '/srv/app' })
    git.next = () => Promise.resolve(null)
    expect(await projectOfFolder(0, null, '/srv/notes')).toEqual({ machineName: null, folder: '/srv/notes' })
  })

  it('still opens a folder the machine can list when git cannot be asked there', async () => {
    git.next = () => Promise.reject(new Error('git is not installed on this machine'))
    folders.next = () => Promise.resolve(listed(true))
    expect(await projectOfFolder(4, 'devbox', '/srv/app')).toEqual({ machineName: 'devbox', folder: '/srv/app' })
  })

  it('refuses with the first reason when the folder cannot be listed either', async () => {
    git.next = () => Promise.reject(new Error('there is no folder /srv/gone'))
    folders.next = () => Promise.resolve(listed(false))
    await expect(projectOfFolder(4, 'devbox', '/srv/gone')).rejects.toThrow('there is no folder /srv/gone')
    folders.next = () => Promise.reject(new Error('The machine did not answer in time'))
    await expect(projectOfFolder(4, 'devbox', '/srv/gone')).rejects.toThrow('there is no folder /srv/gone')
  })
})
