import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { FolderListing } from '@/api/folders'
import type { RepositoryIndex, RepositorySource } from '../model/folderPick'
import { PickFolderDialog, type PickerMachine } from './PickFolderDialog'
import { DAEMON_NAME } from '@/brand'

const HOME = '/home/dev'
const MACHINES: PickerMachine[] = [
  { machine: 0, label: 'This computer', ready: true, word: null },
  { machine: 2, label: 'kingdom', ready: true, word: 'connected' },
  { machine: 3, label: 'macbook', ready: false, word: 'unreachable' },
]
const NOW = Math.floor(Date.now() / 1000)
const INDEX: RepositoryIndex = {
  indexedAt: NOW - 240,
  repos: [
    { path: `${HOME}/code/maitty`, branch: 'dev', lastUsed: NOW - 7200 },
    { path: `${HOME}/code/notes`, branch: 'main', lastUsed: null },
    { path: `${HOME}/code/acme`, branch: 'main', lastUsed: NOW - 60 },
  ],
}

function folder(path: string, names: string[]): FolderListing {
  return { path, exists: true, truncated: false, entries: names.map((name) => ({ name, git: name === 'maitty' ? 'dev' : null, has_children: true })) }
}

/** A machine whose home holds two folders and a hidden one, one of them a repo with a folder inside. */
function disk() {
  return vi.fn((_machine: number, path: string): Promise<FolderListing> => {
    if (path === '~' || path === HOME) return Promise.resolve(folder(HOME, ['maitty', 'notes', '.cache']))
    if (path === `${HOME}/maitty`) return Promise.resolve(folder(`${HOME}/maitty`, ['src']))
    if (path === '/home') return Promise.resolve(folder('/home', ['dev']))
    return Promise.resolve({ path, exists: false, truncated: false, entries: [] })
  })
}

function source(index: RepositoryIndex = INDEX): RepositorySource & { list: ReturnType<typeof vi.fn>; rescan: ReturnType<typeof vi.fn> } {
  return { list: vi.fn(() => Promise.resolve(index)), rescan: vi.fn(() => Promise.resolve({ ...index, indexedAt: NOW })) }
}

function open(list = disk(), repositories: RepositorySource | null = source(), machine = 2) {
  const onPick = vi.fn()
  const onCancel = vi.fn()
  const root = document.createElement('div')
  root.className = 'mx-app'
  document.body.appendChild(root)
  render(<PickFolderDialog machines={MACHINES} machine={machine} list={list} repositories={repositories} onPick={onPick} onCancel={onCancel} />, { container: root })
  return { onPick, onCancel, list }
}

const finder = () => screen.getByRole('textbox', { name: 'Find a folder or type a path' })

describe('Open a folder on a machine', () => {
  it('names the machine in its title and opens on its repositories, those used from here first', async () => {
    open()
    expect(screen.getByRole('dialog', { name: 'Open a folder on kingdom' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Machine: kingdom' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Repositories/ })).toHaveAttribute('aria-selected', 'true')
    const rows = await screen.findAllByRole('option')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('acme'), expect.stringContaining('maitty'), expect.stringContaining('notes'),
    ])
    expect(rows[0]).toHaveTextContent('Used 1m ago')
    expect(rows[1]).toHaveTextContent('~/code/')
    expect(rows[1]).toHaveTextContent('dev')
    expect(screen.getByText(new RegExp(`Indexed by ${DAEMON_NAME} · 4m ago`))).toBeInTheDocument()
  })

  it('opens the highlighted repository with Enter, and the first one when none is highlighted', async () => {
    const user = userEvent.setup()
    const { onPick } = open()
    await screen.findAllByRole('option')
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith({ machine: 2, folder: `${HOME}/code/acme` })
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenLastCalledWith({ machine: 2, folder: `${HOME}/code/maitty` })
  })

  it('filters the repositories with the one input', async () => {
    const user = userEvent.setup()
    open()
    await screen.findAllByRole('option')
    await user.type(finder(), 'mai')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.clear(finder())
    await user.type(finder(), 'zzz')
    expect(await screen.findByText(/No repository matches “zzz”/)).toBeInTheDocument()
  })

  it('rescans on request and shows the new time', async () => {
    const user = userEvent.setup()
    const repositories = source()
    open(disk(), repositories)
    await screen.findAllByRole('option')
    await user.click(screen.getByRole('button', { name: 'Rescan' }))
    expect(await screen.findByText(new RegExp(`Indexed by ${DAEMON_NAME} · just now`))).toBeInTheDocument()
    expect(repositories.rescan).toHaveBeenCalledWith(2)
  })

  it('opens on Browse, with no Repositories tab, when the machine has no repository index', async () => {
    open(disk(), null)
    expect(screen.queryByRole('tab', { name: /^Repositories/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /maitty/ })).toBeInTheDocument()
  })

  it('says why when the repositories cannot be read', async () => {
    open(disk(), { list: () => Promise.reject(new Error('The machine did not answer in time')), rescan: () => Promise.reject(new Error('no')) })
    expect((await screen.findByRole('alert')).textContent).toContain('The machine did not answer in time')
  })

  it('switches to Browse with Tab, which starts in the home folder with its path as clickable parts', async () => {
    const user = userEvent.setup()
    open()
    await screen.findAllByRole('option')
    await user.keyboard('{Tab}')
    expect(screen.getByRole('tab', { name: 'Browse' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('option', { name: /maitty/ })).toHaveTextContent('dev')
    const path = within(screen.getByRole('navigation', { name: 'Path' }))
    expect(path.getByRole('button', { name: '~' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /notes/ })).toBeInTheDocument()
  })

  it('hides hidden folders until the switch is on', async () => {
    const user = userEvent.setup()
    open(disk(), null)
    await screen.findByRole('option', { name: /notes/ })
    expect(screen.queryByRole('option', { name: /\.cache/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Hidden folders' }))
    expect(screen.getByRole('option', { name: /\.cache/ })).toBeInTheDocument()
  })

  it('goes into a folder with the arrow keys and Enter, up with Backspace, and chooses with Ctrl+Enter', async () => {
    const user = userEvent.setup()
    const { onPick } = open(disk(), null)
    await screen.findByRole('option', { name: /maitty/ })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(await screen.findByRole('option', { name: /src/ })).toBeInTheDocument()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onPick).toHaveBeenCalledWith({ machine: 2, folder: `${HOME}/maitty` })
    await user.keyboard('{Backspace}')
    expect(await screen.findByRole('option', { name: /notes/ })).toBeInTheDocument()
  })

  it('goes up one folder from the up button', async () => {
    const user = userEvent.setup()
    open(disk(), null)
    await screen.findByRole('option', { name: /notes/ })
    await user.click(screen.getByRole('button', { name: 'Up one folder' }))
    expect(await screen.findByRole('option', { name: /dev/ })).toBeInTheDocument()
  })

  it('jumps to a path typed with a slash or a tilde, and says so when there is no folder there', async () => {
    const user = userEvent.setup()
    open(disk(), null)
    await screen.findByRole('option', { name: /notes/ })
    await user.type(finder(), '/nowhere{Enter}')
    expect((await screen.findByRole('alert')).textContent).toContain('There is no folder /nowhere on kingdom')
    expect(screen.getByRole('button', { name: /^Open/ })).toBeDisabled()
  })

  it('clears the input on the first Escape and closes on the second', async () => {
    const user = userEvent.setup()
    const { onCancel } = open()
    await screen.findAllByRole('option')
    await user.type(finder(), 'mai')
    await user.keyboard('{Escape}')
    expect(finder()).toHaveValue('')
    expect(onCancel).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })

  it('changes machine from the list in the title, and says an unreachable one is asleep', async () => {
    const user = userEvent.setup()
    const { list } = open()
    await screen.findAllByRole('option')
    await user.click(screen.getByRole('button', { name: 'Machine: kingdom' }))
    const menu = await screen.findByRole('dialog', { name: 'Machine' })
    expect(within(menu).getByRole('radio', { name: /macbook/ })).toHaveTextContent('unreachable')
    await user.click(within(menu).getByRole('radio', { name: /macbook/ }))
    expect(await screen.findByText('macbook is asleep. Wake it, or pick another machine.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Open/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Machine: macbook' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Machine' })).getByRole('radio', { name: /This computer/ }))
    await waitFor(() => { expect(list).toHaveBeenCalledWith(0, '~') })
  })

  it('says why when the machine cannot be asked', async () => {
    open(vi.fn(() => Promise.reject(new Error('The machine did not answer in time'))), null)
    expect((await screen.findByRole('alert')).textContent).toContain('The machine did not answer in time')
  })
})
