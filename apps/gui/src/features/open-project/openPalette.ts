import type { FolderEntry, FolderListing } from '@/api/folders'
import { folderNameProblem } from '@/features/workspace/model/folderName'
import { baseName, isPathQuery, isRoot, joinPath, niceOf, parentOf, separatorOf } from '@/features/workspace/model/folderPick'
import type { GitUrl } from './repoUrl'

/**
 * The Open a project palette as data: its levels, the rows each level lists, what a key does and how paths compare.
 * Pure, so the palette component only draws rows and runs the action a row or a key names.
 */

/** Where browsing a machine starts when nothing better is known: its home folder, which its daemon resolves. */
export const HOME_FOLDER = '~'

/** A machine the palette can browse or clone onto. `start` is the folder browsing begins in there. */
export type PaletteMachine = {
  machine: number
  /** Null for this computer, as on a session. */
  name: string | null
  label: string
  /** How it is reached (`user@host`); null for this computer or when it is not known. */
  address: string | null
  ready: boolean
  /** Why it cannot be asked, in the host's words; null when it can or when the host gave none. */
  why: string | null
  start: string
}

export type Level =
  | { kind: 'sources' }
  | { kind: 'browse'; machine: number; path: string }
  | { kind: 'url' }
  | { kind: 'github' }
  | { kind: 'machine' }

/** `open` brings a project in and offers every source; `pick` only answers with a folder, so it only browses. */
export type PaletteMode = 'open' | 'pick'

export type RowIcon = 'repo' | 'folder' | 'up' | 'monitor' | 'server' | 'link' | 'github' | 'plus' | 'copy'

export type RowAction =
  | { do: 'open'; machine: number; folder: string }
  | { do: 'browse'; machine: number; path: string }
  | { do: 'level'; level: 'url' | 'github' | 'machine' }
  /** Adds a remote machine: the host of the SSH config named, or what is typed when `alias` is null. */
  | { do: 'add'; alias: string | null }
  | { do: 'clone'; label: string; address: string }
  | { do: 'create-folder'; name: string }
  | { do: 'sign-in' }
  | { do: 'open-link'; link: string }
  | { do: 'copy-code'; code: string }
  | { do: 'cancel-sign-in' }
  | { do: 'sign-out' }

export type Row = {
  id: string
  /** The heading the row sits under; a heading is drawn where it changes. */
  group: string | null
  title: string
  detail: string | null
  icon: RowIcon
  tag: string | null
  /** A row that is a way out of the list rather than a thing in it: `..`, Add a remote machine. */
  quiet: boolean
  action: RowAction
  /** The folder Right arrow or Tab goes into, for a row that Enter opens instead; null when Enter already goes in. */
  into: string | null
}

const row = (fields: Pick<Row, 'id' | 'title' | 'action'> & Partial<Row>): Row => ({ group: null, detail: null, icon: 'folder', tag: null, quiet: false, into: null, ...fields })

// ---- how paths compare

/** The system a machine runs, when the window knows it: only this computer's is known. */
export type MachineOs = 'windows' | 'macos' | 'linux' | null

const WINDOWS_PATH = /^(?:[A-Za-z]:(?:[\\/]|$)|\\\\)/

/**
 * Whether names on the machine holding `path` compare without case. Windows and macOS file systems do by default, Linux
 * does not; a Windows path says so by its shape, so a Windows machine reached over SSH is covered though its system is
 * not known here.
 */
export function ignoresCase(path: string, os: MachineOs): boolean {
  return os === 'windows' || os === 'macos' || WINDOWS_PATH.test(path)
}

function folderKey(path: string, ignoreCase: boolean): string {
  const windows = WINDOWS_PATH.test(path)
  const spelled = windows ? path.replaceAll('/', '\\') : path
  const trimmed = spelled.length > 1 ? spelled.replace(/[\\/]+$/, '') : spelled
  return ignoreCase ? trimmed.toLowerCase() : trimmed
}

/** `a` and `b` name one folder on a machine whose names compare as `ignoreCase` says. */
export function sameFolder(a: string, b: string, ignoreCase: boolean): boolean {
  return folderKey(a, ignoreCase) === folderKey(b, ignoreCase)
}

function sameName(a: string, b: string, ignoreCase: boolean): boolean {
  return ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b
}

// ---- sources

export type RecentProject = { machine: number; machineLabel: string; name: string; folder: string }

/** The most recent projects the first level offers: more is a list to read, not a shortcut. */
export const MOST_RECENT = 5

/**
 * The folders of sessions that closed, newest first, as projects to open again: one row per folder, none that is open
 * already, and none whose folder is gone.
 */
export function recentProjects(closed: ReadonlyArray<{ folder: string; present: boolean }>, open: readonly string[], machine: Pick<PaletteMachine, 'machine' | 'label'>, ignoreCase: boolean): RecentProject[] {
  const kept: RecentProject[] = []
  for (const { folder, present } of closed) {
    if (kept.length === MOST_RECENT) break
    if (!present || open.some((other) => sameFolder(other, folder, ignoreCase)) || kept.some((other) => sameFolder(other.folder, folder, ignoreCase))) continue
    kept.push({ machine: machine.machine, machineLabel: machine.label, name: baseName(folder), folder })
  }
  return kept
}

const matches = (query: string, ...words: readonly string[]): boolean => {
  const needle = query.trim().toLowerCase()
  return needle === '' || words.some((word) => word.toLowerCase().includes(needle))
}

/**
 * The first level: recent projects, a browse row per machine, the two ways to clone, and adding a machine (left out
 * where the palette was given no way to add one). Typing filters.
 */
export function sourceRows({ mode, recent, machines, query, canAddMachine = true }: { mode: PaletteMode; recent: readonly RecentProject[]; machines: readonly PaletteMachine[]; query: string; canAddMachine?: boolean }): Row[] {
  const browse = machines.filter((machine) => matches(query, machine.label, 'browse folders')).map((machine) => row({
    id: `browse:${String(machine.machine)}`,
    group: 'Browse folders on',
    title: machine.label,
    detail: machine.address === null ? machine.start : `${machine.address} · ${machine.start}`,
    icon: machine.name === null ? 'monitor' : 'server',
    tag: machine.ready ? null : 'Offline',
    action: { do: 'browse', machine: machine.machine, path: machine.start },
  }))
  if (mode === 'pick') return browse
  const recents = recent.filter((project) => matches(query, project.name, project.folder)).map((project) => row({
    id: `recent:${String(project.machine)}:${project.folder}`,
    group: 'Recent',
    title: project.name,
    detail: `${project.machineLabel} · ${project.folder}`,
    icon: 'repo',
    action: { do: 'open', machine: project.machine, folder: project.folder },
  }))
  const clone = [
    matches(query, 'Git URL', 'clone git url link') ? [row({ id: 'clone:url', group: 'Clone', title: 'Git URL', detail: 'Clone from a link', icon: 'link', action: { do: 'level', level: 'url' } })] : [],
    matches(query, 'GitHub repository', 'clone github repo') ? [row({ id: 'clone:github', group: 'Clone', title: 'GitHub repository', detail: 'Pick from your repositories', icon: 'github', action: { do: 'level', level: 'github' } })] : [],
  ].flat()
  const add = canAddMachine && matches(query, 'Add a remote machine') ? [row({ id: 'add-machine', title: 'Add a remote machine…', icon: 'plus', quiet: true, action: { do: 'level', level: 'machine' } })] : []
  return [...recents, ...browse, ...clone, ...add]
}

// ---- the folder browser

/** What the folder level shows when it lists no folder. */
export type FolderNote = 'empty' | 'no-match' | null

/** The name before a trailing separator, when the text is one name and a separator: `code/`, `code\`. */
function typedName(text: string): string | null {
  if (isPathQuery(text) || !/[\\/]$/.test(text)) return null
  const name = text.slice(0, -1)
  return name === '' || /[\\/]/.test(name) ? null : name
}

/**
 * The folder a typed `name/` or `name\` goes into: the entry of that name, or `..` for the folder above. An exact
 * spelling wins; another case is taken only where the machine's names ignore case. Null when the text is not a name and
 * a separator, or names nothing here.
 */
export function typedFolder(entries: readonly FolderEntry[], text: string, ignoreCase: boolean): string | null {
  const name = typedName(text)
  if (name === null) return null
  if (name === '..') return name
  return (entries.find((entry) => entry.name === name) ?? entries.find((entry) => sameName(entry.name, name, ignoreCase)))?.name ?? null
}

/** The folders a filter keeps: names holding it, those starting with it first. Dot folders show only when it starts with a dot. */
export function filterFolders(entries: readonly FolderEntry[], query: string): FolderEntry[] {
  const needle = query.trim().toLowerCase()
  const plain = (name: string) => name.replace(/^\./, '').toLowerCase()
  const kept = entries.filter((entry) => (needle.startsWith('.') || !entry.name.startsWith('.')) && entry.name.toLowerCase().includes(needle))
  const starts = (entry: FolderEntry) => (needle !== '' && entry.name.toLowerCase().startsWith(needle) ? 0 : 1)
  return kept.sort((a, b) => starts(a) - starts(b) || plain(a.name).localeCompare(plain(b.name)))
}

type FolderRowsInput = {
  mode: PaletteMode
  machine: number
  /** A listing whose folder exists. */
  listing: FolderListing
  query: string
  /** The folders open as projects on this machine. */
  open: readonly string[]
  ignoreCase: boolean
  home: string | null
}

/**
 * The folder level's rows: `..` unless filtering or at a root, then the folders. A repository opens on Enter and is
 * gone into with Right or Tab; any other folder is gone into. Text that is a path (`/srv`, `~/x`, `D:\x`) is one row
 * that goes there, and a name matching nothing can be made as a new folder where the machine allows it.
 */
export function folderRows({ mode, machine, listing, query, open, ignoreCase, home }: FolderRowsInput): { rows: Row[]; note: FolderNote } {
  const here = listing.path
  if (isPathQuery(query)) {
    const typed = query.trim()
    const path = home !== null && (typed === '~' || /^~[\\/]/.test(typed)) ? `${home}${typed.slice(1)}` : typed
    return { rows: [row({ id: `goto:${path}`, title: `Go to ${niceOf(path, home)}`, icon: 'folder', action: { do: 'browse', machine, path } })], note: null }
  }
  const rows: Row[] = []
  const filter = query.trim()
  if (filter === '' && !isRoot(here)) {
    const parent = parentOf(here)
    rows.push(row({ id: 'up', title: '..', detail: `Up to ${isRoot(parent) ? parent : baseName(parent)}`, icon: 'up', quiet: true, action: { do: 'browse', machine, path: parent } }))
  }
  const folders = filterFolders(listing.entries, filter)
  for (const entry of folders) {
    const path = joinPath(here, entry.name)
    const repo = entry.git !== null
    const isOpen = open.some((other) => sameFolder(other, path, ignoreCase))
    rows.push(row({
      id: `folder:${entry.name}`,
      title: entry.name,
      detail: repo ? `git · ${entry.git ?? ''}` : null,
      icon: repo ? 'repo' : 'folder',
      tag: mode === 'open' && isOpen ? 'Open' : null,
      action: repo ? { do: 'open', machine, folder: path } : { do: 'browse', machine, path },
      into: repo ? path : null,
    }))
  }
  if (folders.length > 0) return { rows, note: null }
  if (filter === '') return { rows, note: 'empty' }
  const taken = listing.entries.map((entry) => entry.name)
  if (listing.can_create && folderNameProblem(filter, taken) === null) rows.push(row({ id: `create:${filter}`, title: `New folder ${filter}`, detail: `Make it in ${niceOf(here, home)}`, icon: 'plus', action: { do: 'create-folder', name: filter } }))
  return { rows, note: 'no-match' }
}

/** The crumb shows a path whole up to this length; a longer one keeps only its last folders. */
const MOST_CRUMB_CHARS = 26
const CRUMB_PARTS_KEPT = 2

/** A folder as the field's crumb writes it: under home it reads `~`, it ends in its separator, and a long one keeps its last two parts. */
export function crumbOf(path: string, home: string | null): string {
  const nice = niceOf(path, home)
  const separator = separatorOf(path)
  const whole = /[\\/]$/.test(nice) ? nice : `${nice}${separator}`
  const parts = nice.split(/[\\/]/).filter(Boolean)
  return nice.length > MOST_CRUMB_CHARS && parts.length > CRUMB_PARTS_KEPT ? `…${separator}${parts.slice(-CRUMB_PARTS_KEPT).join(separator)}${separator}` : whole
}

// ---- clone

/** Makes a row of another level's model (New machine), with the same defaults as the rows here. */
export const rowOf = row

/** The row that clones the repository a pasted address names. */
export function cloneRow(repo: GitUrl, target: string, machineLabel: string): Row {
  return row({ id: `clone:${repo.address}`, title: `Clone ${repo.owner}/${repo.name}`, detail: `into ${target} on ${machineLabel}`, icon: 'link', action: { do: 'clone', label: `${repo.owner}/${repo.name}`, address: repo.address } })
}

/** A pasted address is not judged until it is this long: a shorter one is still being typed. */
export const MIN_URL_CHARS_TO_JUDGE = 8

/** The next choice after `current` in a list that is walked round, for a button that changes one value per press. */
export function nextOf<Value>(choices: readonly Value[], current: Value): Value {
  const at = choices.indexOf(current)
  return choices[(at + 1) % choices.length] ?? current
}

// ---- keys

export type KeyPress = { key: string; ctrl: boolean; shift: boolean; alt: boolean }

export type KeyContext = {
  level: Level['kind']
  /** Whether the field is empty: Backspace then goes back or up instead of deleting. */
  empty: boolean
  /** Whether the caret is at the end of the field: Right arrow then goes into a folder instead of moving the caret. */
  caretAtEnd: boolean
  /** The highlighted row, or null when the list has none. */
  row: Pick<Row, 'into' | 'action'> | null
}

export type KeyAction = 'close' | 'next' | 'previous' | 'first' | 'last' | 'activate' | 'open-here' | 'into' | 'up' | 'back'

/**
 * What a key does in the palette, or null when the key is the field's own. Enter does what the highlighted row says;
 * Backspace on an empty field goes up a folder or back a level; in the folder browser Right arrow and Tab go into the
 * highlighted folder and Ctrl+Enter takes the folder being shown. Home and End move the list only while the field is
 * empty, so they still move the caret in typed text.
 */
export function keyAction(press: KeyPress, context: KeyContext): KeyAction | null {
  const { key, ctrl, shift, alt } = press
  if (alt) return null
  if (key === 'Escape') return 'close'
  if (key === 'Enter') return ctrl && context.level === 'browse' ? 'open-here' : ctrl ? null : 'activate'
  if (ctrl) return null
  if (key === 'ArrowDown') return 'next'
  if (key === 'ArrowUp') return 'previous'
  if (key === 'Home' && context.empty) return 'first'
  if (key === 'End' && context.empty) return 'last'
  if (key === 'Backspace' && context.empty) return context.level === 'browse' ? 'up' : context.level === 'sources' ? null : 'back'
  if (context.level !== 'browse' || shift || context.row === null) return null
  const folder = context.row.into !== null || context.row.action.do === 'browse'
  if (key === 'Tab' && folder) return 'into'
  if (key === 'ArrowRight' && folder && context.caretAtEnd) return 'into'
  return null
}

/** The row a move lands on: the ends stop, they do not wrap, so holding a key rests on the last row. */
export function moveIndex(index: number, count: number, move: 'next' | 'previous' | 'first' | 'last'): number {
  if (count === 0) return 0
  if (move === 'first') return 0
  if (move === 'last') return count - 1
  return Math.min(count - 1, Math.max(0, index + (move === 'next' ? 1 : -1)))
}

/** The folder a row goes into: its own path for a folder, `into` for a repository; null for any other row. */
export function folderOfRow(target: Pick<Row, 'into' | 'action'>): string | null {
  if (target.into !== null) return target.into
  return target.action.do === 'browse' ? target.action.path : null
}

export type Hint = { keys: string; does: string }

/**
 * The footer's keys for a level and the row highlighted in it. `enter` replaces what Enter does when the list has no
 * row and its message has a button (Try again).
 */
export function hintsOf(level: Level['kind'], mode: PaletteMode, highlighted: Pick<Row, 'into'> | null, enter: string | null = null): Hint[] {
  const move: Hint = { keys: '↑↓', does: 'Move' }
  const close: Hint = { keys: 'Esc', does: 'Close' }
  switch (level) {
    case 'sources':
      return [move, { keys: 'Enter', does: enter ?? 'Choose' }, close]
    case 'browse':
      return highlighted !== null && highlighted.into !== null
        ? [{ keys: 'Enter', does: mode === 'open' ? 'Open' : 'Choose' }, { keys: '→', does: 'Go in' }, { keys: '⌫', does: 'Up' }]
        : [{ keys: 'Enter', does: enter ?? 'Go in' }, { keys: '⌫', does: 'Up' }]
    case 'url':
    case 'github':
      return [move, { keys: 'Enter', does: enter ?? 'Clone' }, { keys: '⌫', does: 'Back' }, close]
    case 'machine':
      return [{ keys: 'Enter', does: enter ?? 'Connect' }, { keys: '⌫', does: 'Back' }, close]
  }
}
