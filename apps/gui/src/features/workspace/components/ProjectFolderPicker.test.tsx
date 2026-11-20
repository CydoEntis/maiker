import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderBranchList } from '@/api/folderGit'
import type { CreateFolderOutcome, FolderListing } from '@/api/folders'
import { currentToasts, resetToasts } from '@/lib/toast'
import { LOCAL_HEAD, type MachineHead } from '../model/machines'
import { ProjectFolderPicker } from './ProjectFolderPicker'

const api = vi.hoisted(() => ({
  list: vi.fn<(machine: number, path: string) => Promise<FolderListing>>(),
  create: vi.fn<(machine: number, parent: string, name: string) => Promise<CreateFolderOutcome>>(),
  branches: vi.fn<(machine: number, folder: string) => Promise<FolderBranchList | null>>(),
}))
vi.mock('@/api/folders', () => ({ listFolders: api.list, createFolder: api.create }))
vi.mock('@/api/folderGit', () => ({ loadFolderBranches: api.branches }))

const HOME = '/home/me'
const DEVBOX: MachineHead = { ...LOCAL_HEAD, key: 'machine-4', machine: 4, name: 'devbox', label: 'devbox', chip: { glyph: '●', word: 'connected', tone: 'ok' } }

function folder(path: string, names: string[]): FolderListing {
  return { path, exists: true, truncated: false, can_create: true, entries: names.map((name) => ({ name, git: null, has_children: true })) }
}

/** A repository whose main checkout is `root`, as the machine's daemon lists it. */
function repository(root: string): FolderBranchList {
  return { current: 'main', branches: [], worktrees: [{ path: root, branch: 'main', main: true, when: null }, { path: `${root}-fix`, branch: 'fix', main: false, when: null }] }
}

function show() {
  const onOpen = vi.fn()
  const onClose = vi.fn()
  const root = document.createElement('div')
  root.className = 'mx-app'
  document.body.appendChild(root)
  render(<ProjectFolderPicker heads={[LOCAL_HEAD, DEVBOX]} machine={4} onOpen={onOpen} onClose={onClose} />, { container: root })
  return { onOpen, onClose, user: userEvent.setup() }
}

const finder = () => screen.getByRole('textbox', { name: 'Find a folder or type a path' })

beforeEach(() => {
  vi.resetAllMocks()
  api.list.mockImplementation((_machine, path) => {
    if (path === '~' || path === HOME) return Promise.resolve(folder(HOME, ['notes', 'shop']))
    if (path === '/srv/app/web') return Promise.resolve(folder(path, ['src']))
    return Promise.resolve({ path, exists: false, truncated: false, can_create: true, entries: [] })
  })
})

afterEach(() => { resetToasts() })

describe('opening a project on another machine', () => {
  it('opens on that machine and adds the folder picked there, starting nothing', async () => {
    api.branches.mockResolvedValue(null)
    const { onOpen, onClose, user } = show()
    expect(screen.getByRole('dialog', { name: 'Open a folder on devbox' })).toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: /notes/ }))
    await user.click(screen.getByRole('button', { name: /^Open notes\s*↵$/ }))
    await waitFor(() => { expect(onOpen).toHaveBeenCalledWith({ machineName: 'devbox', folder: `${HOME}/notes` }) })
    expect(api.branches).toHaveBeenCalledWith(4, `${HOME}/notes`)
    expect(onClose).toHaveBeenCalled()
  })

  it('takes a typed path, and opens the repository it is in by its main checkout', async () => {
    api.branches.mockResolvedValue(repository('/srv/app'))
    const { onOpen, user } = show()
    await screen.findByRole('option', { name: /notes/ })
    await user.type(finder(), '/srv/app/web{Enter}')
    await screen.findByRole('option', { name: /src/ })
    await user.click(screen.getByRole('button', { name: /^Open web\s*↵$/ }))
    await waitFor(() => { expect(onOpen).toHaveBeenCalledWith({ machineName: 'devbox', folder: '/srv/app' }) })
  })

  it('refuses a folder the machine cannot read, says why, adds nothing and stays to pick another', async () => {
    api.branches.mockRejectedValue(new Error('There is no folder /home/me/shop'))
    const { onOpen, onClose, user } = show()
    await user.click(await screen.findByRole('option', { name: /shop/ }))
    await user.click(screen.getByRole('button', { name: /^Open shop\s*↵$/ }))
    await waitFor(() => { expect(currentToasts().items).toHaveLength(1) })
    const [shown] = currentToasts().items
    expect(shown?.title).toBe(`Could not open ${HOME}/shop as a project`)
    // The machine's own words, as the reason or behind Copy details.
    const words = [shown?.description, shown?.details].filter((part) => typeof part === 'string')
    expect(words.join(' ')).toContain('There is no folder /home/me/shop')
    expect(onOpen).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Open a folder on devbox' })).toBeInTheDocument()
  })
})
