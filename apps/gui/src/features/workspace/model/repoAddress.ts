/**
 * Reading a pasted repository address, and what a failed clone means. Pure: the window decides what to show, these only
 * say what the text is. The address handed on is always built again from checked names, so a pasted user name,
 * password or token is dropped rather than carried into a command line, a log or a URL.
 */

/** A GitHub repository as read from pasted text. */
export type RepoAddress = {
  owner: string
  name: string
  /** The address git is given: built from the two names, never the pasted text. */
  address: string
  /** It was an SSH address (`git@github.com:`), so it is cloned over SSH with the person's own keys. */
  ssh: boolean
  /** Only `owner/name` was typed: it may be a search for a project, so it is not offered first on its own. */
  bare: boolean
}

/** GitHub's own limit on an owner's and a repository's name. */
const MOST_NAME_CHARS = 100
/** `owner/name`: the two parts a repository's address needs. */
const OWNER_AND_NAME = 2
const SSH_PREFIX = 'git@github.com:'
const HTTPS_PREFIXES = ['https://github.com/', 'https://www.github.com/', 'github.com/']
const GIT_SUFFIX = /\.git$/i

/** A name GitHub allows and a file system takes as one folder: not starting with `-` or `.`, so never an option, `.` or `..`. */
function safeName(name: string): boolean {
  return name !== '' && name.length <= MOST_NAME_CHARS && !/^[-.]/.test(name) && /^[A-Za-z0-9._-]+$/.test(name)
}

/** Reads `owner/name`, a github.com page, or an HTTPS or SSH clone address; null for anything else. */
export function parseRepoAddress(input: string): RepoAddress | null {
  const text = input.trim()
  let rest: string
  let ssh = false
  let bare = false
  if (text.startsWith(SSH_PREFIX)) {
    rest = text.slice(SSH_PREFIX.length)
    ssh = true
  } else {
    const prefix = HTTPS_PREFIXES.find((candidate) => text.toLowerCase().startsWith(candidate))
    if (prefix !== undefined) rest = text.slice(prefix.length)
    else if (/[:@\s]/.test(text) || text.includes('://')) return null
    else {
      rest = text
      bare = true
    }
  }
  const path = rest.split(/[?#]/)[0] ?? ''
  const parts = path.split('/').filter((part) => part !== '')
  // A bare `a/b` is exactly two parts; a link may carry a page under the repository (`/tree/main`).
  if (parts.length < OWNER_AND_NAME || (bare && parts.length !== OWNER_AND_NAME)) return null
  const owner = parts[0] ?? ''
  const name = (parts[1] ?? '').replace(GIT_SUFFIX, '')
  if (!safeName(owner) || !safeName(name)) return null
  const address = ssh ? `${SSH_PREFIX}${owner}/${name}.git` : `https://github.com/${owner}/${name}.git`
  return { owner, name, address, ssh, bare }
}

/** An address with a user name or password in it (`https://user:token@host/…`): it is never sent, the person is told. */
export function carriesCredentials(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i.test(input.trim())
}

/** Where a clone goes on a machine that has no remembered folder: made on first use. */
export const DEFAULT_CLONE_PARENT = '~/Projects'

/** The folder a clone goes inside: the last one used on that machine, else `~/Projects`. */
export function cloneParentFor(last: string | null): string {
  return last === null || last.trim() === '' ? DEFAULT_CLONE_PARENT : last
}

/** What a clone would make, for the top row: `~/Projects/name`. */
export function cloneTargetOf(parent: string, name: string): string {
  return `${parent.replace(/[\\/]+$/, '')}/${name}`
}

export type CloneProblem = {
  kind: 'exists' | 'auth' | 'bad-address' | 'unreachable' | 'no-folder' | 'other'
  /** A plain sentence for the person. */
  message: string
  /** For `exists`: the folder that is already there, as the daemon named it. */
  folder?: string
}

const EXISTS = /^(.+) is already there$/s
const AUTH = /authentication failed|could not read (?:username|password)|terminal prompts disabled|permission denied \(publickey\)|could not read from remote repository|returned error: (?:401|403|404)|repository .*not found|invalid username or password/i
const UNREACHABLE = /could not resolve host|unable to access|network is unreachable|connection (?:timed out|refused)|timed out|stopped after/i
const BAD_ADDRESS = /not a git repository|does not appear to be a git repository|use an https|does not end in a repository name|no spaces or line breaks|does not start with a dash|give the address|too long to clone|unable to find remote helper/i
const NO_FOLDER = /^there is no folder/i

/**
 * What git or the daemon said when a clone failed, as a sentence for a person and what can be done. Their own words are
 * matched, not shown raw; a reason nothing here knows is shown as it came.
 */
export function explainCloneFailure(raw: string): CloneProblem {
  const said = raw.trim()
  const exists = EXISTS.exec(said)
  if (exists?.[1] !== undefined) {
    const folder = exists[1]
    const base = folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder
    return { kind: 'exists', message: `There is already a folder called ${base} there. Use it, or pick another folder.`, folder }
  }
  if (NO_FOLDER.test(said)) return { kind: 'no-folder', message: 'That folder does not exist. Pick another folder to clone into.' }
  if (BAD_ADDRESS.test(said)) return { kind: 'bad-address', message: 'That does not look like a repository link. Paste a github.com link, owner/name, or an https:// or ssh:// address.' }
  if (AUTH.test(said)) return { kind: 'auth', message: 'The repository was not found, or it is private and git on that machine has no sign-in for it. Maiker cannot sign you in to GitHub yet: it uses the sign-in git already has there. Check the link, or open GitHub settings.' }
  if (UNREACHABLE.test(said)) return { kind: 'unreachable', message: 'Could not reach the server. Check the connection and the link, then try again.' }
  return { kind: 'other', message: said === '' ? 'The repository was not cloned.' : said }
}
