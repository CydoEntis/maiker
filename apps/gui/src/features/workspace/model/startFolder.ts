const HOME_PREFIX = '~/'

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
