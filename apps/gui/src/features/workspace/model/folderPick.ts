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
