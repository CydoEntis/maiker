import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RemoteIndex, RemoteListing } from '@/api/fileGets'
import { toSessionView } from '../model/session'
import { GetFileDialog, type Browse } from './GetFileDialog'

const session = toSessionView(
  { id: 't2', generation: 0, kind: 'terminal', title: '', project: '', folder: '/srv/app', cwd: '/srv/app', repo: null, branch: 'working tree', provider: 'Codex', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: 2, hasDiff: false, agent: null, machine: 4, machineName: 'devbox' },
  '/home/me',
)

function open() {
  const onGet = vi.fn()
  const onCancel = vi.fn()
  render(<GetFileDialog session={session} onGet={onGet} onCancel={onCancel} />)
  return { onGet, onCancel, box: screen.getByRole<HTMLInputElement>('textbox', { name: 'Path on devbox' }) }
}

describe('the Get a file dialog', () => {

  it('gets the path that was typed, trimmed', async () => {
    const user = userEvent.setup()
    const { onGet, box } = open()
    await user.type(box, 'out.log  ')
    await user.click(screen.getByRole('button', { name: 'Get file' }))
    expect(onGet).toHaveBeenCalledWith('/srv/app/out.log')
  })
})

const listingOf = (folder: string, dirs: string[], files: string[], more: Partial<RemoteListing> = {}): RemoteListing => ({ folder, dirs, files, truncated: false, hidden: 0, ...more })

const FOLDERS: Record<string, RemoteListing> = {
  '/srv/app': listingOf('/srv/app', ['docs', 'src'], ['Makefile', 'README.md']),
  '/srv/app/src': listingOf('/srv/app/src', ['deep'], ['main.rs']),
  '/srv': listingOf('/srv', ['app', 'logs'], []),
}

const INDEX: RemoteIndex = { folder: '/srv/app', files: ['Makefile', 'README.md', 'src/deep/lib.rs', 'src/main.rs'], truncated: false, hidden: 0 }

function browsing(over: Partial<Browse> = {}) {
  const browse: Browse = {
    list: vi.fn((path: string) => {
      const found = FOLDERS[path]
      return found === undefined ? Promise.reject(new Error(`${path} does not exist on devbox`)) : Promise.resolve(found)
    }),
    index: vi.fn(() => Promise.resolve(INDEX)),
    ...over,
  }
  const onGet = vi.fn()
  const onCancel = vi.fn()
  render(<GetFileDialog session={session} onGet={onGet} onCancel={onCancel} browse={browse} />)
  return { browse, onGet, onCancel }
}

describe('browsing a machine in the Get a file dialog', () => {

  it('opens a folder when it is clicked, and goes back up', async () => {
    const user = userEvent.setup()
    const { browse } = browsing()
    await user.click(await screen.findByRole('option', { name: 'src, folder' }))
    await screen.findByRole('option', { name: 'main.rs' })
    expect(browse.list).toHaveBeenLastCalledWith('/srv/app/src')
    await user.click(screen.getByRole('button', { name: 'Go up one folder' }))
    await screen.findByRole('option', { name: 'README.md' })
    expect(browse.list).toHaveBeenLastCalledWith('/srv/app')
  })

  it('gets a file when it is clicked', async () => {
    const user = userEvent.setup()
    const { onGet } = browsing()
    await user.click(await screen.findByRole('option', { name: 'README.md' }))
    expect(onGet).toHaveBeenCalledWith('/srv/app/README.md')
  })

  it('searches the session folder as letters are typed, marks them, and gets the match with Enter', async () => {
    const user = userEvent.setup()
    const { onGet } = browsing()
    await screen.findByRole('option', { name: 'README.md' })
    await user.type(screen.getByRole('textbox', { name: 'Search in /srv/app' }), 'main')
    const match = await screen.findByRole('option', { name: 'src/main.rs' })
    expect(Array.from(match.querySelectorAll('mark')).map((mark) => mark.textContent).join('')).toBe('main')
    expect(within(screen.getByRole('listbox', { name: 'Matches' })).getAllByRole('option')).toHaveLength(1)
    await user.keyboard('{Enter}')
    expect(onGet).toHaveBeenCalledWith('/srv/app/src/main.rs')
  })

  it('moves the highlight with the arrow keys and opens a highlighted folder with Enter', async () => {
    const user = userEvent.setup()
    const { browse } = browsing()
    await screen.findByRole('option', { name: 'docs, folder' })
    await user.click(screen.getByRole('textbox', { name: 'Search in /srv/app' }))
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'src, folder' }).getAttribute('aria-selected')).toBe('true')
    await user.keyboard('{Enter}')
    await screen.findByRole('option', { name: 'main.rs' })
    expect(browse.list).toHaveBeenLastCalledWith('/srv/app/src')
  })

  it('gets the whole folder it is showing, and a folder in the list still just opens', async () => {
    const user = userEvent.setup()
    const { onGet, browse } = browsing()
    await user.click(await screen.findByRole('option', { name: 'src, folder' }))
    await screen.findByRole('option', { name: 'main.rs' })
    expect(onGet).not.toHaveBeenCalled()
    expect(browse.list).toHaveBeenLastCalledWith('/srv/app/src')
    await user.click(screen.getByRole('button', { name: 'Get this folder, /srv/app/src' }))
    expect(onGet).toHaveBeenCalledWith('/srv/app/src')
  })

  it("shows the host's words when the listing fails, and a typed path still works", async () => {
    const user = userEvent.setup()
    const { onGet } = browsing({ list: vi.fn(() => Promise.reject(new Error('/srv/app does not exist on devbox'))) })
    expect((await screen.findByRole('alert')).textContent).toContain('/srv/app does not exist on devbox. You can still type a path below.')
    await user.type(screen.getByRole('textbox', { name: 'Path on devbox' }), 'out.log')
    await user.click(screen.getByRole('button', { name: 'Get file' }))
    expect(onGet).toHaveBeenCalledWith('/srv/app/out.log')
  })

  it('says when the listing was cut or names were left out', async () => {
    browsing({ list: vi.fn(() => Promise.resolve(listingOf('/srv/app', ['a'], ['b'], { truncated: true, hidden: 2 }))) })
    expect(await screen.findByText('Showing the first 2 entries only.')).toBeTruthy()
    expect(screen.getByText('2 entries with unusual names are left out.')).toBeTruthy()
  })
})
