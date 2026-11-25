import { samePath } from './openedProjects'

const HOME_PREFIX = '~/'
const HOME = '~'

/** Turns the start-folder setting into a path the daemon can open: empty or `~` is the home folder. */
export function resolveStartFolder(setting: string, home: string): string {
  const typed = setting.trim()
  if (!typed || typed === '~') return home
  if (typed.startsWith('~/') || typed.startsWith('~\\')) {
    const separator = home.includes('\\') && !home.includes('/') ? '\\' : '/'
    return `${home.replace(/[\\/]+$/, '')}${separator}${typed.slice(HOME_PREFIX.length)}`
  }
  return typed
}

/**
 * The start folder, or null while it cannot be known yet: the setting names the home folder (empty, `~` or under `~`)
 * and the home folder has not been read (`homeRead` false).
 */
export function knownStartFolder(setting: string, home: string, homeRead: boolean): string | null {
  const typed = setting.trim()
  if (!homeRead && (typed === '' || typed.startsWith(HOME))) return null
  return resolveStartFolder(setting, home)
}

/**
 * The Bypass Permissions choice a start in `folder` is made with when the person made none (`bypass` undefined): none in
 * the start folder (`startFolder`, '' when not known), which usually holds every repository, else Settings' (undefined).
 * A choice made for the session is kept as it is.
 */
export function bypassFor(bypass: boolean | undefined, folder: string, startFolder: string): boolean | undefined {
  if (bypass !== undefined || startFolder === '') return bypass
  return samePath(folder, startFolder) ? false : undefined
}
