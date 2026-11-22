/** The parts of a machine's ssh destination as the forms take them. The host checks the same rules again; these only keep a bad value from being sent. */

const MOST_USER_CHARS = 64
const MOST_HOST_CHARS = 253
const USER_CHARS = /^[A-Za-z0-9._\\+-]+$/
const HOST_CHARS = /^[A-Za-z0-9._:%-]+$/
const MOST_PORT = 65535

export function userProblem(user: string): string | null {
  if (user === '') return null
  if (user.startsWith('-')) return 'A user name cannot start with a dash.'
  if (user.length > MOST_USER_CHARS || !USER_CHARS.test(user)) return 'A user name has letters, digits, dots, dashes and underscores.'
  return null
}

export function hostProblem(host: string): string | null {
  if (host === '') return null
  if (host.startsWith('-')) return 'A host cannot start with a dash.'
  if (host.length > MOST_HOST_CHARS || !HOST_CHARS.test(host)) return 'A host is a name or an address: letters, digits, dots and dashes.'
  return null
}

/** The port as a number; null when blank or the default; undefined when it is not a port. */
export function portOf(port: string): number | null | undefined {
  if (port === '') return null
  if (!/^\d{1,5}$/.test(port)) return undefined
  const value = Number(port)
  return value >= 1 && value <= MOST_PORT ? value : undefined
}

/** `user@host`, or `host` when the user is blank: how the config keeps a destination. */
export function targetOf(user: string, host: string): string {
  return user === '' ? host : `${user}@${host}`
}
