/** A git repository the machine's daemon has indexed. `lastUsed` is in seconds since the epoch, null for one never used from here. */
export type Repository = { path: string; branch: string | null; lastUsed: number | null }

/** The daemon's repository index for one machine: the repositories, and when it was built (seconds since the epoch; null when it does not say). */
export type RepositoryIndex = { repos: readonly Repository[]; indexedAt: number | null }

/** Where the folder picker asks for the index. A machine whose daemon predates it has no source (`null`), and the tab says so. */
export type RepositorySource = {
  list: (machine: number) => Promise<RepositoryIndex>
  /** Asks the daemon to look again, and answers with the new index. */
  rescan: (machine: number) => Promise<RepositoryIndex>
}

/** What the folder picker answers: a folder, and the machine it is on. */
export type PickedFolder = { machine: number; folder: string }

/** The separator a path uses: Windows paths keep their backslashes. */
export function separatorOf(path: string): '/' | '\\' {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/'
}

/** Whether a path is a filesystem root: `/`, or a Windows drive. */
export function isRoot(path: string): boolean {
  return path === '/' || /^[A-Za-z]:[\\/]?$/.test(path)
}

/** `folder` and `name` joined with one separator. */
export function joinPath(folder: string, name: string): string {
  const separator = separatorOf(folder)
  return `${folder.replace(/[\\/]+$/, '')}${separator}${name}`
}

/** The folder above `path`; a root stays itself. */
export function parentOf(path: string): string {
  if (isRoot(path)) return path
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut < 0) return path
  const parent = trimmed.slice(0, cut)
  if (parent === '') return '/'
  return /^[A-Za-z]:$/.test(parent) ? `${parent}${separatorOf(path)}` : parent
}

/** The last part of a path, which is a folder's name. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

/** A path as a person writes it: under the home folder it reads `~/…`. */
export function niceOf(path: string, home: string | null): string {
  if (home === null || home === '') return path
  if (path === home) return '~'
  const separator = separatorOf(home)
  return path.startsWith(`${home}${separator}`) ? `~${path.slice(home.length)}` : path
}

/** One clickable part of the Browse tab's path. */
export type Crumb = { label: string; path: string }

/** The parts of `dir` from the home folder (`~`) or the root down. */
export function crumbsOf(dir: string, home: string | null): Crumb[] {
  const separator = separatorOf(dir)
  const inHome = home !== null && home !== '' && (dir === home || dir.startsWith(`${home}${separator}`))
  const crumbs: Crumb[] = []
  let base: string
  let rest: string
  if (inHome) {
    crumbs.push({ label: '~', path: home })
    base = home
    rest = dir.slice(home.length)
  } else {
    const drive = /^[A-Za-z]:/.exec(dir)?.[0]
    base = drive === undefined ? '' : drive
    crumbs.push({ label: drive ?? '/', path: drive === undefined ? '/' : `${drive}${separator}` })
    rest = dir.slice(base.length)
  }
  for (const part of rest.split(/[\\/]/).filter(Boolean)) {
    base = `${base}${separator}${part}`
    crumbs.push({ label: part, path: base })
  }
  return crumbs
}

/** Whether the text is a path to go to, not a name to filter by: it starts with `/`, `~` or a drive. */
export function isPathQuery(text: string): boolean {
  return /^(~|\/|[A-Za-z]:[\\/])/.test(text.trim())
}

/** Hidden folders (a leading dot) show only when asked for, or when what is typed starts the same way. */
export function visibleFolders<Entry extends { name: string }>(entries: readonly Entry[], filter: string, hidden: boolean): Entry[] {
  const needle = filter.trim().toLowerCase()
  const byName = [...entries].sort((a, b) => a.name.replace(/^\./, '').toLowerCase().localeCompare(b.name.replace(/^\./, '').toLowerCase()))
  return byName.filter((entry) => (hidden || !entry.name.startsWith('.') || (needle !== '' && entry.name.toLowerCase().startsWith(needle))) && (needle === '' || entry.name.toLowerCase().includes(needle)))
}

/** The repository rows in the order they are drawn: those used from here first, most recent first, then the rest by name. */
export function groupRepositories(repos: readonly Repository[], filter: string): { recent: Repository[]; rest: Repository[] } {
  const needle = filter.trim().toLowerCase()
  const kept = repos.filter((repo) => needle === '' || repo.path.toLowerCase().includes(needle))
  const recent = kept.filter((repo) => repo.lastUsed !== null).sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
  const rest = kept.filter((repo) => repo.lastUsed === null).sort((a, b) => baseName(a.path).toLowerCase().localeCompare(baseName(b.path).toLowerCase()))
  return { recent, rest }
}

/** Seconds in a minute, an hour and a day, for how long ago something was. */
const MINUTE = 60
const HOUR = 3600
const DAY = 86400

/** How long ago, as the picker's rows say it: "just now", "4m ago", "2h ago", "yesterday", "5d ago". */
export function agoOf(then: number, now: number): string {
  const seconds = Math.max(0, now - then)
  if (seconds < MINUTE) return 'just now'
  if (seconds < HOUR) return `${String(Math.floor(seconds / MINUTE))}m ago`
  if (seconds < DAY) return `${String(Math.floor(seconds / HOUR))}h ago`
  const days = Math.floor(seconds / DAY)
  return days === 1 ? 'yesterday' : `${String(days)}d ago`
}
