import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CreateFolderOutcome, FolderListing } from '@/api/folders'
import { PickFolderDialog, type PickerMachine } from './PickFolderDialog'

const HOME = '/home/dev'
const MACHINES: PickerMachine[] = [
  { machine: 0, label: 'This computer', ready: true, word: null },
  { machine: 2, label: 'kingdom', ready: true, word: 'connected' },
  { machine: 3, label: 'macbook', ready: false, word: 'unreachable' },
]

function folder(path: string, names: string[], canCreate = true): FolderListing {
  return { path, exists: true, truncated: false, can_create: canCreate, entries: names.map((name) => ({ name, git: name === 'maiker' ? 'dev' : null, has_children: true })) }
}

/** A machine whose home holds two folders and a hidden one, one of them a repo with a folder inside. */
function disk() {
  return vi.fn((_machine: number, path: string): Promise<FolderListing> => {
    if (path === '~' || path === HOME) return Promise.resolve(folder(HOME, ['maiker', 'notes', '.cache']))
    if (path === `${HOME}/maiker`) return Promise.resolve(folder(`${HOME}/maiker`, ['src']))
    if (path === '/home') return Promise.resolve(folder('/home', ['dev']))
    return Promise.resolve({ path, exists: false, truncated: false, can_create: true, entries: [] })
  })
}

type Create = (machine: number, parent: string, name: string) => Promise<CreateFolderOutcome>

function open(list = disk(), create: Create = vi.fn(() => Promise.resolve({ kind: 'created', path: `${HOME}/fresh` } as const)), machine = 2) {
  const onPick = vi.fn()
  const onCancel = vi.fn()
  const root = document.createElement('div')
  root.className = 'mx-app'
  document.body.appendChild(root)
  render(<PickFolderDialog machines={MACHINES} machine={machine} list={list} create={create} onPick={onPick} onCancel={onCancel} />, { container: root })
  return { onPick, onCancel, list, create }
}

const finder = () => screen.getByRole('textbox', { name: 'Find a folder or type a path' })

describe('Open a folder on a machine', () => {
  it('names the machine in its title and opens on its home folder, with no tabs and the branch of a repository beside it', async () => {
    open()
    expect(screen.getByRole('dialog', { name: 'Open a folder on kingdom' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Machine: kingdom' })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByText(/Rescan|Indexed by/)).not.toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /maiker/ })).toHaveTextContent('dev')
    const path = within(screen.getByRole('navigation', { name: 'Path' }))
    expect(path.getByRole('button', { name: '~' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /notes/ })).toBeInTheDocument()
  })

  it('hides hidden folders until the switch is on', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByRole('option', { name: /notes/ })
    expect(screen.queryByRole('option', { name: /\.cache/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Hidden folders' }))
    expect(screen.getByRole('option', { name: /\.cache/ })).toBeInTheDocument()
  })

  it('filters the folders with the one input', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByRole('option', { name: /notes/ })
    await user.type(finder(), 'mai')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.clear(finder())
    await user.type(finder(), 'zzz')
    expect(await screen.findByText(/No folder here matches “zzz”/)).toBeInTheDocument()
  })

  it('goes into a folder with the arrow keys and Enter, up with Backspace, and chooses with Ctrl+Enter', async () => {
    const user = userEvent.setup()
    const { onPick } = open()
    await screen.findByRole('option', { name: /maiker/ })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(await screen.findByRole('option', { name: /src/ })).toBeInTheDocument()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onPick).toHaveBeenCalledWith({ machine: 2, folder: `${HOME}/maiker` })
    await user.keyboard('{Backspace}')
    expect(await screen.findByRole('option', { name: /notes/ })).toBeInTheDocument()
  })

  it('goes up one folder from the up button', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByRole('option', { name: /notes/ })
    await user.click(screen.getByRole('button', { name: 'Up one folder' }))
    expect(await screen.findByRole('option', { name: /dev/ })).toBeInTheDocument()
  })

  it('jumps to a path typed with a slash or a tilde, and says so when there is no folder there', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByRole('option', { name: /notes/ })
    await user.type(finder(), '/nowhere{Enter}')
    expect((await screen.findByRole('alert')).textContent).toContain('There is no folder /nowhere on kingdom')
    expect(screen.getByRole('button', { name: /^Open/ })).toBeDisabled()
  })

  it('clears the input on the first Escape and closes on the second', async () => {
    const user = userEvent.setup()
    const { onCancel } = open()
    await screen.findByRole('option', { name: /notes/ })
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
    await screen.findByRole('option', { name: /notes/ })
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
    open(vi.fn(() => Promise.reject(new Error('The machine did not answer in time'))))
    expect((await screen.findByRole('alert')).textContent).toContain('The machine did not answer in time')
  })
})

describe('Making a new folder', () => {
  const nameField = () => screen.getByRole('textbox', { name: 'New folder name' })

  it('opens an inline field from the button, creates on Enter in the folder shown, and selects the new folder', async () => {
    const user = userEvent.setup()
    const create = vi.fn<Create>(() => Promise.resolve({ kind: 'created', path: `${HOME}/fresh` }))
    const list = vi.fn(() => Promise.resolve(folder(HOME, create.mock.calls.length === 0 ? ['maiker', 'notes'] : ['fresh', 'maiker', 'notes'])))
    open(list, create)
    await screen.findByRole('option', { name: /notes/ })
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await user.type(nameField(), 'fresh{Enter}')
    expect(create).toHaveBeenCalledWith(2, HOME, 'fresh')
    expect(await screen.findByRole('option', { name: /fresh/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('textbox', { name: 'New folder name' })).not.toBeInTheDocument()
    expect(screen.getByTitle(`${HOME}/fresh`)).toBeEnabled()
  })

  it('opens from Ctrl+Shift+N and closes on Escape without closing the dialog or creating anything', async () => {
    const user = userEvent.setup()
    const { onCancel, create } = open()
    await screen.findByRole('option', { name: /notes/ })
    await user.keyboard('{Control>}{Shift>}n{/Shift}{/Control}')
    expect(await screen.findByRole('textbox', { name: 'New folder name' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'New folder name' })).not.toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(finder()).toHaveFocus()
  })

  it('keeps arrow keys and Backspace inside the field', async () => {
    const user = userEvent.setup()
    const { list } = open()
    await screen.findByRole('option', { name: /notes/ })
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await user.type(nameField(), 'ab{Backspace}{Backspace}{Backspace}{ArrowDown}')
    expect(nameField()).toHaveValue('')
    expect(list).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['my/folder', 'one folder, not a path'],
    ['..', 'cannot be called'],
    ['nul', 'device'],
    ['trailing.', 'end with a dot'],
    ['Notes', 'already here'],
  ])('shows the problem with %j under the field and sends nothing', async (typed, words) => {
    const user = userEvent.setup()
    const { create } = open()
    await screen.findByRole('option', { name: /notes/ })
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await user.type(nameField(), `${typed}{Enter}`)
    expect((await screen.findByRole('alert')).textContent).toContain(words)
    expect(nameField()).toHaveAttribute('aria-invalid', 'true')
    expect(create).not.toHaveBeenCalled()
  })

  it('asks for a name when Enter is pressed on an empty field', async () => {
    const user = userEvent.setup()
    const { create } = open()
    await screen.findByRole('option', { name: /notes/ })
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await user.keyboard('{Enter}')
    expect((await screen.findByRole('alert')).textContent).toContain('Type a name')
    expect(create).not.toHaveBeenCalled()
  })

  it.each<[string, CreateFolderOutcome, string]>([
    ['the daemon says it exists', { kind: 'exists' }, 'A folder called fresh is already here.'],
    ['the daemon refuses', { kind: 'not-allowed', reason: 'Windows keeps that name for a device.' }, 'Windows keeps that name for a device.'],
    ['the disk refuses', { kind: 'failed', reason: 'You do not have permission to make a folder here.' }, 'You do not have permission to make a folder here.'],
  ])('keeps the field open with the reason when %s', async (_case, outcome, words) => {
    const user = userEvent.setup()
    open(disk(), vi.fn(() => Promise.resolve(outcome)))
    await screen.findByRole('option', { name: /notes/ })
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await user.type(nameField(), 'fresh{Enter}')
    expect((await screen.findByRole('alert')).textContent).toBe(words)
    expect(nameField()).toHaveValue('fresh')
    expect(nameField()).toBeEnabled()
  })

  it('says so when the machine could not be asked, and lets the name be sent again', async () => {
    const user = userEvent.setup()
    open(disk(), vi.fn(() => Promise.reject(new Error('kingdom is not connected'))))
    await screen.findByRole('option', { name: /notes/ })
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await user.type(nameField(), 'fresh{Enter}')
    expect((await screen.findByRole('alert')).textContent).toContain('kingdom is not connected')
    expect(nameField()).toBeEnabled()
  })

  it('shows the button disabled, with the reason, when the machine\'s service is older', async () => {
    const user = userEvent.setup()
    const old = vi.fn(() => Promise.resolve(folder(HOME, ['maiker'], false)))
    const { create } = open(old)
    await screen.findByRole('option', { name: /maiker/ })
    const button = screen.getByRole('button', { name: 'New folder' })
    expect(button).toBeDisabled()
    expect(screen.getByText(/This machine.s service is older: restart it to create folders\./)).toBeInTheDocument()
    await user.keyboard('{Control>}{Shift>}n{/Shift}{/Control}')
    expect(screen.queryByRole('textbox', { name: 'New folder name' })).not.toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('works with a Windows folder: the parent is sent as shown', async () => {
    const user = userEvent.setup()
    const list = vi.fn(() => Promise.resolve(folder('C:/Users/me', ['code'])))
    const { create } = open(list)
    await screen.findByRole('option', { name: /code/ })
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await user.type(nameField(), 'new{Enter}')
    expect(create).toHaveBeenCalledWith(2, 'C:/Users/me', 'new')
  })
})
