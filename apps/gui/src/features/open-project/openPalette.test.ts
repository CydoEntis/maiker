import { describe, expect, it } from 'vitest'
import type { FolderEntry, FolderListing } from '@/api/folders'
import { crumbOf, filterFolders, folderOfRow, folderRows, ignoresCase, keyAction, moveIndex, recentProjects, sameFolder, sourceRows, typedFolder, type KeyContext, type PaletteMachine, type Row } from './openPalette'

const entry = (name: string, git: string | null = null): FolderEntry => ({ name, git, has_children: true })
const listing = (path: string, entries: FolderEntry[], can_create = true): FolderListing => ({ path, exists: true, entries, truncated: false, can_create })
const LOCAL: PaletteMachine = { machine: 0, name: null, label: 'This computer', address: null, ready: true, why: null, start: '/home/me/code' }
const DEVBOX: PaletteMachine = { machine: 4, name: 'devbox', label: 'devbox', address: 'me@devbox', ready: false, why: null, start: '~' }
const actions = (rows: readonly Row[]) => rows.map((row) => row.action)
const press = (key: string, more: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) => ({ key, ctrl: false, shift: false, alt: false, ...more })
const at = (context: Partial<KeyContext>): KeyContext => ({ level: 'browse', empty: true, caretAtEnd: true, row: null, ...context })

describe('how folder paths compare', () => {
  it('ignores case on Windows and macOS and keeps it on Linux', () => {
    expect(ignoresCase('/Users/me', 'macos')).toBe(true)
    expect(ignoresCase('/home/me', 'linux')).toBe(false)
    expect(ignoresCase('/home/me', null)).toBe(false)
    expect(sameFolder('/Users/Me/Code', '/users/me/code', true)).toBe(true)
    expect(sameFolder('/home/me/Code', '/home/me/code', false)).toBe(false)
  })

  it('knows a Windows path by its shape, whatever machine it came from', () => {
    expect(ignoresCase('C:\\Users\\me', null)).toBe(true)
    expect(ignoresCase('\\\\server\\share', 'linux')).toBe(true)
    const windows = ignoresCase('C:\\dev', null)
    expect(sameFolder('C:\\Dev\\App', 'c:/dev/app/', windows)).toBe(true)
    expect(sameFolder('C:\\dev\\app', 'D:\\dev\\app', windows)).toBe(false)
  })
})

describe('the sources level', () => {
  it('offers recent projects, each machine, both ways to clone and adding a machine, and filters by what is typed', () => {
    const recent = [{ machine: 0, machineLabel: 'This computer', name: 'maiker', folder: '/home/me/code/maiker' }]
    const all = sourceRows({ mode: 'open', recent, machines: [LOCAL, DEVBOX], query: '' })
    expect(actions(all)).toEqual([
      { do: 'open', machine: 0, folder: '/home/me/code/maiker' },
      { do: 'browse', machine: 0, path: '/home/me/code' },
      { do: 'browse', machine: 4, path: '~' },
      { do: 'level', level: 'url' },
      { do: 'level', level: 'github' },
      { do: 'add-machine' },
    ])
    expect(actions(sourceRows({ mode: 'open', recent, machines: [LOCAL, DEVBOX], query: 'devb' }))).toEqual([{ do: 'browse', machine: 4, path: '~' }])
    expect(actions(sourceRows({ mode: 'open', recent, machines: [LOCAL, DEVBOX], query: 'GITHUB' }))).toEqual([{ do: 'level', level: 'github' }])
    expect(sourceRows({ mode: 'open', recent, machines: [LOCAL, DEVBOX], query: 'zzz' })).toEqual([])
  })

  it('only browses when a folder is being picked', () => {
    const rows = sourceRows({ mode: 'pick', recent: [{ machine: 0, machineLabel: 'This computer', name: 'x', folder: '/x' }], machines: [LOCAL, DEVBOX], query: '' })
    expect(rows.every((row) => row.action.do === 'browse')).toBe(true)
    expect(rows).toHaveLength(2)
  })

  it('lists a closed session’s folder once, newest first, and not when it is open or gone', () => {
    const closed = [
      { folder: '/home/me/code/app', present: true },
      { folder: '/home/me/code/app', present: true },
      { folder: '/home/me/code/open', present: true },
      { folder: '/home/me/code/gone', present: false },
      { folder: '/home/me/code/old', present: true },
    ]
    expect(recentProjects(closed, ['/home/me/code/open'], LOCAL, false).map((project) => project.folder)).toEqual(['/home/me/code/app', '/home/me/code/old'])
    expect(recentProjects([{ folder: 'C:\\Dev\\App', present: true }], ['c:\\dev\\app'], LOCAL, true)).toEqual([])
  })
})

describe('the folder browser', () => {
  const here = listing('/home/me/code', [entry('notes'), entry('maiker', 'dev'), entry('api-server', 'main'), entry('.config')])
  const rowsOf = (query: string, more: Partial<Parameters<typeof folderRows>[0]> = {}) => folderRows({ mode: 'open', machine: 0, listing: here, query, open: [], ignoreCase: false, home: '/home/me', ...more })

  it('lists .. and then the folders: Enter opens a repository and goes into any other folder', () => {
    const { rows, note } = rowsOf('')
    expect(note).toBeNull()
    expect(actions(rows)).toEqual([
      { do: 'browse', machine: 0, path: '/home/me' },
      { do: 'open', machine: 0, folder: '/home/me/code/api-server' },
      { do: 'open', machine: 0, folder: '/home/me/code/maiker' },
      { do: 'browse', machine: 0, path: '/home/me/code/notes' },
    ])
    expect(rows.map(folderOfRow)).toEqual(['/home/me', '/home/me/code/api-server', '/home/me/code/maiker', '/home/me/code/notes'])
  })

  it('has no .. at a root, on either kind of path', () => {
    expect(folderRows({ mode: 'open', machine: 0, listing: listing('/', [entry('home')]), query: '', open: [], ignoreCase: false, home: null }).rows.map((row) => row.title)).toEqual(['home'])
    expect(folderRows({ mode: 'open', machine: 0, listing: listing('C:\\', [entry('Users')]), query: '', open: [], ignoreCase: true, home: null }).rows.map((row) => row.title)).toEqual(['Users'])
  })

  it('joins Windows folders with a backslash and goes up to the drive', () => {
    const windows = folderRows({ mode: 'open', machine: 0, listing: listing('C:\\Users', [entry('me')]), query: '', open: [], ignoreCase: true, home: null })
    expect(actions(windows.rows)).toEqual([{ do: 'browse', machine: 0, path: 'C:\\' }, { do: 'browse', machine: 0, path: 'C:\\Users\\me' }])
  })

  it('tags a folder that is open as a project, by the machine’s case rule', () => {
    const tagged = (open: string[], ignoreCase: boolean) => rowsOf('', { open, ignoreCase }).rows.filter((row) => row.tag !== null).map((row) => row.title)
    expect(tagged(['/home/me/code/maiker'], false)).toEqual(['maiker'])
    expect(tagged(['/home/me/code/MAIKER'], false)).toEqual([])
    expect(tagged(['/home/me/code/MAIKER'], true)).toEqual(['maiker'])
    expect(rowsOf('', { mode: 'pick', open: ['/home/me/code/maiker'] }).rows.every((row) => row.tag === null)).toBe(true)
  })

  it('filters by what is typed without regard to case, names starting with it first, and drops ..', () => {
    expect(rowsOf('E').rows.map((row) => row.title)).toEqual(['api-server', 'maiker', 'notes'])
    expect(rowsOf('no').rows.map((row) => row.title)).toEqual(['notes'])
    expect(filterFolders(here.entries, 'a').map((folder) => folder.name)).toEqual(['api-server', 'maiker'])
  })

  it('shows dot folders only to a filter that starts with a dot', () => {
    expect(rowsOf('onfi').rows.map((row) => row.title)).not.toContain('.config')
    expect(rowsOf('.conf').rows.map((row) => row.title)).toEqual(['.config'])
  })

  it('says an empty folder is empty and a filter with no match matches nothing', () => {
    expect(folderRows({ mode: 'open', machine: 0, listing: listing('/srv/x', []), query: '', open: [], ignoreCase: false, home: null }).note).toBe('empty')
    expect(rowsOf('zzz').note).toBe('no-match')
  })

  it('offers to make a folder of a name that matches nothing, only where the machine allows it and the name is one', () => {
    expect(actions(rowsOf('fresh').rows)).toEqual([{ do: 'create-folder', name: 'fresh' }])
    expect(folderRows({ mode: 'open', machine: 0, listing: { ...here, can_create: false }, query: 'fresh', open: [], ignoreCase: false, home: null }).rows).toEqual([])
    expect(rowsOf('a:b').rows).toEqual([])
  })

  it('takes text that is a path as one row that goes there, home written out', () => {
    expect(actions(rowsOf('/srv/www').rows)).toEqual([{ do: 'browse', machine: 0, path: '/srv/www' }])
    expect(actions(rowsOf('~/work').rows)).toEqual([{ do: 'browse', machine: 0, path: '/home/me/work' }])
    expect(actions(rowsOf('D:\\work').rows)).toEqual([{ do: 'browse', machine: 0, path: 'D:\\work' }])
  })
})

describe('typing a folder name and a separator', () => {
  const entries = [entry('Code'), entry('code'), entry('Notes')]

  it('goes into the folder of that name, with either separator', () => {
    expect(typedFolder(entries, 'Notes/', false)).toBe('Notes')
    expect(typedFolder(entries, 'Notes\\', false)).toBe('Notes')
    expect(typedFolder(entries, '../', false)).toBe('..')
  })

  it('needs the exact case on Linux and takes any case on Windows and macOS, an exact spelling first', () => {
    expect(typedFolder(entries, 'notes/', false)).toBeNull()
    expect(typedFolder(entries, 'notes/', true)).toBe('Notes')
    expect(typedFolder(entries, 'code/', true)).toBe('code')
    expect(typedFolder(entries, 'Code/', true)).toBe('Code')
  })

  it('leaves alone text with no separator, a path, and a name that is not here', () => {
    expect(typedFolder(entries, 'Notes', true)).toBeNull()
    expect(typedFolder(entries, '/', true)).toBeNull()
    expect(typedFolder(entries, '~/', true)).toBeNull()
    expect(typedFolder(entries, 'C:\\', true)).toBeNull()
    expect(typedFolder(entries, 'a/b/', true)).toBeNull()
    expect(typedFolder(entries, 'missing/', true)).toBeNull()
  })
})

describe('the keys', () => {
  const repo = { into: '/code/app', action: { do: 'open', machine: 0, folder: '/code/app' } } as const
  const folder = { into: null, action: { do: 'browse', machine: 0, path: '/code/notes' } } as const
  const other = { into: null, action: { do: 'add-machine' } } as const

  it('Enter does what the row says, and Ctrl+Enter takes the folder shown only in the folder browser', () => {
    expect(keyAction(press('Enter'), at({ row: repo }))).toBe('activate')
    expect(keyAction(press('Enter', { ctrl: true }), at({ row: repo }))).toBe('open-here')
    expect(keyAction(press('Enter', { ctrl: true }), at({ level: 'sources' }))).toBeNull()
  })

  it('Backspace on an empty field goes up a folder or back a level, and deletes text otherwise', () => {
    expect(keyAction(press('Backspace'), at({ level: 'browse' }))).toBe('up')
    expect(keyAction(press('Backspace'), at({ level: 'url' }))).toBe('back')
    expect(keyAction(press('Backspace'), at({ level: 'github' }))).toBe('back')
    expect(keyAction(press('Backspace'), at({ level: 'sources' }))).toBeNull()
    expect(keyAction(press('Backspace'), at({ level: 'browse', empty: false }))).toBeNull()
  })

  it('Right arrow and Tab go into the highlighted folder in the folder browser only', () => {
    expect(keyAction(press('ArrowRight'), at({ row: repo }))).toBe('into')
    expect(keyAction(press('Tab'), at({ row: repo }))).toBe('into')
    expect(keyAction(press('Tab'), at({ row: folder }))).toBe('into')
    expect(keyAction(press('ArrowRight'), at({ row: repo, caretAtEnd: false }))).toBeNull()
    expect(keyAction(press('Tab', { shift: true }), at({ row: repo }))).toBeNull()
    expect(keyAction(press('Tab'), at({ row: other }))).toBeNull()
    expect(keyAction(press('Tab'), at({ level: 'url', row: repo }))).toBeNull()
  })

  it('the arrows move the list; Home and End do while the field is empty; Esc closes', () => {
    expect(keyAction(press('ArrowDown'), at({}))).toBe('next')
    expect(keyAction(press('ArrowUp'), at({}))).toBe('previous')
    expect(keyAction(press('Home'), at({}))).toBe('first')
    expect(keyAction(press('End'), at({}))).toBe('last')
    expect(keyAction(press('End'), at({ empty: false }))).toBeNull()
    expect(keyAction(press('Escape'), at({ level: 'github' }))).toBe('close')
  })

  it('takes no plain letter and no Ctrl or Alt chord, so typing and the app’s keys are never eaten', () => {
    expect(keyAction(press('o'), at({}))).toBeNull()
    expect(keyAction(press('o', { ctrl: true }), at({}))).toBeNull()
    expect(keyAction(press('ArrowDown', { alt: true }), at({}))).toBeNull()
  })

  it('stops at the ends of the list', () => {
    expect(moveIndex(0, 3, 'previous')).toBe(0)
    expect(moveIndex(2, 3, 'next')).toBe(2)
    expect(moveIndex(0, 3, 'next')).toBe(1)
    expect(moveIndex(1, 3, 'last')).toBe(2)
    expect(moveIndex(2, 3, 'first')).toBe(0)
    expect(moveIndex(0, 0, 'next')).toBe(0)
  })
})

describe('the crumb before the field', () => {
  it('writes a folder under home with a tilde, ends in its separator and cuts a long path to its last two folders', () => {
    expect(crumbOf('/home/me/code', '/home/me')).toBe('~/code/')
    expect(crumbOf('C:\\Users\\me', null)).toBe('C:\\Users\\me\\')
    expect(crumbOf('/', null)).toBe('/')
    expect(crumbOf('C:\\Users\\cstin\\Documents\\Projects\\old-portfolio', null)).toBe('…\\Projects\\old-portfolio\\')
  })
})
