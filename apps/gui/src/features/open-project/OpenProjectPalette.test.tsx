import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { FolderEntry, FolderListing } from '@/api/folders'
import { OpenProjectPalette, type PaletteStart } from './OpenProjectPalette'
import type { PaletteMachine, PaletteMode } from './openPalette'
import { isOpenPaletteUp } from './paletteOpen'
import type { PaletteServices } from './paletteShell'

const LOCAL: PaletteMachine = { machine: 0, name: null, label: 'This computer', address: null, ready: true, why: null, start: '/home/me/code' }
const DEVBOX: PaletteMachine = { machine: 4, name: 'devbox', label: 'devbox', address: 'me@devbox', ready: true, why: null, start: '~' }
const AWAY: PaletteMachine = { machine: 5, name: 'build', label: 'build', address: 'ci@build', ready: false, why: 'build did not answer.', start: '~' }

const entry = (name: string, git: string | null = null): FolderEntry => ({ name, git, has_children: true })
const TREE: Readonly<Record<string, FolderEntry[]>> = {
  '0:/home/me/code': [entry('app', 'main'), entry('notes')],
  '0:/home/me/code/notes': [],
  '0:/home/me/code/app': [entry('src')],
  '0:/home/me': [entry('code')],
  '4:~': [entry('infra', 'main'), entry('sandbox')],
  '4:/home/dev/sandbox': [entry('deep')],
}
const HOMES: Readonly<Record<string, string>> = { '4:~': '/home/dev' }

function services(more: Partial<PaletteServices> = {}): PaletteServices & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    list: (machine, path) => {
      const key = `${String(machine)}:${path}`
      asked.push(key)
      const entries = TREE[key]
      const listing: FolderListing = { path: HOMES[key] ?? path, exists: entries !== undefined, entries: entries ?? [], truncated: false, can_create: true }
      return Promise.resolve(listing)
    },
    create: (_machine, parent, name) => Promise.resolve({ kind: 'created', path: `${parent}/${name}` }),
    closed: () => Promise.resolve([{ agent: 'claude', session: 's', cwd: '/home/me/code/old', branch: null, title: null, at: 1, folder_present: true, worktree: null, repo: null }]),
    chooseSystemFolder: null,
    ...more,
  }
}

type Shown = { mode?: PaletteMode; start?: PaletteStart; machines?: readonly PaletteMachine[]; using?: ReturnType<typeof services>; onTake?: (picked: { machine: number; folder: string }) => Promise<void> }

function show({ mode = 'open', start = { kind: 'sources' }, machines = [LOCAL, DEVBOX], using = services(), onTake = () => Promise.resolve() }: Shown = {}) {
  const took = vi.fn(onTake)
  const onClose = vi.fn()
  const { unmount } = render(<OpenProjectPalette mode={mode} start={start} machines={machines} localOs="linux" home="/home/me" opened={[{ machineName: null, folder: '/home/me/code/app' }]} onTake={took} onClose={onClose} services={using} />)
  return { took, onClose, using, unmount, user: userEvent.setup(), field: () => screen.getByRole('combobox') }
}

const options = () => screen.getAllByRole('option').map((option) => option.textContent)
const selected = () => screen.getAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true')

describe('the Open a project palette', () => {
  it('is a dialog whose field keeps the focus over one list of options', async () => {
    const { field } = show()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await waitFor(() => { expect(field()).toHaveFocus() })
    expect(selected()).toBe(screen.getAllByRole('option')[0])
  })

  it('lists the sources and filters them as you type', async () => {
    const { user, field } = show()
    await screen.findByRole('option', { name: /old/ })
    expect(screen.getAllByRole('option').length).toBeGreaterThan(4)
    await user.type(field(), 'devb')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(selected()?.textContent).toContain('devbox')
  })

  it('opens a recent project with Enter and closes', async () => {
    const { user, field, took, onClose } = show()
    await screen.findByRole('option', { name: /old/ })
    await user.type(field(), '{Enter}')
    expect(took).toHaveBeenCalledWith({ machine: 0, folder: '/home/me/code/old' })
    await waitFor(() => { expect(onClose).toHaveBeenCalled() })
  })

  it('browses with the keyboard alone: down and Enter go in, Backspace goes up and then back to the sources', async () => {
    const { user, field } = show({ start: { kind: 'folder', machine: 0 } })
    await screen.findByRole('option', { name: /notes/ })
    await user.type(field(), '{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => { expect(screen.getByRole('status').textContent).not.toBe('') })
    expect(screen.queryByRole('option', { name: /app/ })).toBeNull()
    await user.type(field(), '{Backspace}')
    await screen.findByRole('option', { name: /app/ })
    await user.type(field(), '{Backspace}')
    await screen.findByRole('option', { name: /code/ })
    await user.type(field(), '{Backspace}{Backspace}{Backspace}')
    await screen.findByRole('group', { name: 'Clone' })
  })

  it('opens a repository with Enter and goes into it with Right arrow or Tab', async () => {
    const first = show({ start: { kind: 'folder', machine: 0 } })
    await screen.findByRole('option', { name: /app/ })
    await first.user.type(first.field(), '{ArrowDown}{ArrowRight}')
    await screen.findByRole('option', { name: /src/ })
    await first.user.type(first.field(), '{Backspace}')
    await screen.findByRole('option', { name: /app/ })
    await first.user.type(first.field(), '{ArrowDown}{Tab}')
    await screen.findByRole('option', { name: /src/ })
    await first.user.type(first.field(), '{Backspace}')
    await screen.findByRole('option', { name: /app/ })
    await first.user.type(first.field(), '{ArrowDown}{Enter}')
    expect(first.took).toHaveBeenCalledWith({ machine: 0, folder: '/home/me/code/app' })
  })

  it('goes into a folder when its name and a separator are typed, and opens the folder shown with Ctrl+Enter', async () => {
    const { user, field, took } = show({ start: { kind: 'folder', machine: 0 } })
    await screen.findByRole('option', { name: /notes/ })
    await user.type(field(), 'app/')
    await screen.findByRole('option', { name: /src/ })
    expect(field()).toHaveValue('')
    await user.type(field(), '{Control>}{Enter}{/Control}')
    expect(took).toHaveBeenCalledWith({ machine: 0, folder: '/home/me/code/app' })
  })

  it('browses another machine through the same list call, from its home', async () => {
    const { user, field, using, took } = show()
    await user.type(field(), 'devbox{Enter}')
    await screen.findByRole('option', { name: /infra/ })
    expect(using.asked).toContain('4:~')
    await user.type(field(), 'sandbox/')
    await screen.findByRole('option', { name: /deep/ })
    expect(using.asked).toContain('4:/home/dev/sandbox')
    await user.type(field(), '{Control>}{Enter}{/Control}')
    expect(took).toHaveBeenCalledWith({ machine: 4, folder: '/home/dev/sandbox' })
  })

  it('says a machine is away without asking it, and Enter tries again', async () => {
    const { user, field, using } = show({ machines: [LOCAL, AWAY], start: { kind: 'folder', machine: 5 } })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(using.asked).toEqual([])
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    await user.type(field(), '{Enter}')
    await waitFor(() => { expect(using.asked).toEqual(['5:~']) })
  })

  it('offers Try again when a machine does not answer', async () => {
    let fail = true
    const using = services()
    const list = using.list
    using.list = (machine, path) => (fail ? Promise.reject(new Error('The machine did not answer in time')) : list(machine, path))
    const { user } = show({ using, start: { kind: 'folder', machine: 0 } })
    const again = await screen.findByRole('button', { name: 'Try again' })
    fail = false
    await user.click(again)
    await screen.findByRole('option', { name: /notes/ })
  })

  it('makes a folder of a typed name that matches nothing and goes into it', async () => {
    const made: string[] = []
    const using = services({ create: (_machine, parent, name) => { made.push(`${parent}/${name}`); return Promise.resolve({ kind: 'created', path: `${parent}/${name}` }) } })
    const { user, field } = show({ using, start: { kind: 'folder', machine: 0 } })
    await screen.findByRole('option', { name: /notes/ })
    await user.type(field(), 'fresh{Enter}')
    await waitFor(() => { expect(made).toEqual(['/home/me/code/fresh']) })
    await waitFor(() => { expect(using.asked).toContain('0:/home/me/code/fresh') })
  })

  it('keeps the palette and gives the reason when the folder cannot be opened', async () => {
    const { user, field, onClose } = show({ start: { kind: 'folder', machine: 0 }, onTake: () => Promise.reject(new Error('permission denied')) })
    await screen.findByRole('option', { name: /app/ })
    await user.type(field(), '{ArrowDown}{Enter}')
    expect((await screen.findByRole('alert')).textContent).toContain('permission denied')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('option', { name: /app/ })).toBeInTheDocument()
  })

  it('tells the window it is up, so the window’s own keys stand down, and that it is gone', () => {
    expect(isOpenPaletteUp()).toBe(false)
    const { unmount } = show()
    expect(isOpenPaletteUp()).toBe(true)
    unmount()
    expect(isOpenPaletteUp()).toBe(false)
  })

  it('closes on Escape', async () => {
    const { user, field, onClose } = show()
    await user.type(field(), '{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('judges a pasted address at the field: a repository becomes the row Enter clones, anything else is refused in words', async () => {
    const { user, field } = show({ start: { kind: 'url' } })
    expect(screen.queryByRole('option')).toBeNull()
    await user.type(field(), 'not a repository')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('option')).toBeNull()
    await user.clear(field())
    await user.type(field(), 'github.com/owner/repo')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.clear(field())
    await user.type(field(), 'https://user:secret@github.com/owner/repo')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('option')).toBeNull()
  })
})

describe('the palette choosing a folder', () => {
  it('browses and answers with the folder, offering no way to clone', async () => {
    const { user, field, took } = show({ mode: 'pick', start: { kind: 'folder', machine: 0 } })
    await screen.findByRole('option', { name: /notes/ })
    expect(options().some((text) => text.includes('app'))).toBe(true)
    await user.type(field(), '{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => { expect(screen.queryByRole('option', { name: /app/ })).toBeNull() })
    await user.type(field(), '{Control>}{Enter}{/Control}')
    expect(took).toHaveBeenCalledWith({ machine: 0, folder: '/home/me/code/notes' })
  })

  it('lists only the machines above a root', async () => {
    const { user, field } = show({ mode: 'pick', start: { kind: 'folder', machine: 0, folder: '/home/me' } })
    await screen.findByRole('option', { name: /code/ })
    await user.type(field(), '{Backspace}{Backspace}{Backspace}{Backspace}')
    const list = await screen.findByRole('group', { name: 'Browse folders on' })
    expect(within(list).getAllByRole('option')).toHaveLength(2)
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })
})
