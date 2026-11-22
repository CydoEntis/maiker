/** What choosing a folder answers: the folder, and the machine it is on. */
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

/** Whether the text is a path to go to, not a name to filter by: it starts with `/`, `~` or a drive. */
export function isPathQuery(text: string): boolean {
  return /^(~|\/|[A-Za-z]:[\\/])/.test(text.trim())
}
