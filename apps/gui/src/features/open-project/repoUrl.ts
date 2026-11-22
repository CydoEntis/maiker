import { carriesCredentials } from '@/features/workspace/model/repoAddress'

/**
 * Reading what a person pastes into the palette's Git URL field. Pure. The daemon's own check on the address stays as it is
 * (https://, ssh://, git:// or `git@host:path`); this only turns the three forms people paste into one of the two it takes,
 * and builds the address again from checked parts, so a pasted user name, password or token is never carried on.
 */

/** A repository read from pasted text. */
export type GitUrl = {
  host: string
  /** The path before the name: one name on GitHub, possibly a group and subgroups elsewhere. */
  owner: string
  name: string
  /** What the daemon is given: `https://host/owner/name.git` or `git@host:owner/name.git`. */
  address: string
}

export type GitUrlReading =
  | { kind: 'empty' }
  | { kind: 'repo'; repo: GitUrl }
  | { kind: 'credentials' }
  | { kind: 'not-a-url' }

const MOST_PART_CHARS = 100
const GITHUB_HOST = 'github.com'
const SSH_SHORT_FORM = /^git@([^:/\s]+):(.+)$/
const SCHEME = /^https?:\/\//i
const HOST_SHAPE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{1,5})?$/i
const GIT_SUFFIX = /\.git$/i
/** GitHub's repository addresses are `/owner/name`; anything after is a page inside it (`/tree/main`). */
const GITHUB_PATH_PARTS = 2
/** At least an owner and a name. */
const OWNER_AND_NAME = 2
const MOST_PATH_PARTS = 10

/** A name that is one folder and never an option: not starting with `-` or `.`, no slash, space, colon or `@`. */
function safePart(part: string): boolean {
  return part !== '' && part.length <= MOST_PART_CHARS && !/^[-.]/.test(part) && /^[A-Za-z0-9._-]+$/.test(part)
}

function repoOf(host: string, rawPath: string, ssh: boolean): GitUrl | null {
  if (!HOST_SHAPE.test(host)) return null
  const lowerHost = host.toLowerCase()
  const parts = (rawPath.split(/[?#]/)[0] ?? '').split('/').filter((part) => part !== '')
  const kept = lowerHost === GITHUB_HOST ? parts.slice(0, GITHUB_PATH_PARTS) : parts
  if (kept.length < OWNER_AND_NAME ||kept.length > MOST_PATH_PARTS) return null
  const cleaned = kept.map((part, at) => (at === kept.length - 1 ? part.replace(GIT_SUFFIX, '') : part))
  if (!cleaned.every(safePart)) return null
  const name = cleaned.at(-1) ?? ''
  const owner = cleaned.slice(0, -1).join('/')
  const address = ssh ? `git@${lowerHost}:${owner}/${name}.git` : `https://${lowerHost}/${owner}/${name}.git`
  return { host: lowerHost, owner, name, address }
}

/** Reads `https://host/owner/repo`, `git@host:owner/repo.git` or `host/owner/repo`. */
export function readGitUrl(input: string): GitUrlReading {
  const text = input.trim()
  if (text === '') return { kind: 'empty' }
  if (carriesCredentials(text)) return { kind: 'credentials' }
  const short = SSH_SHORT_FORM.exec(text)
  const bare = text.replace(SCHEME, '')
  const slash = bare.indexOf('/')
  const repo = short !== null
    ? repoOf(short[1] ?? '', short[2] ?? '', true)
    : slash < 0 ? null : repoOf(bare.slice(0, slash), bare.slice(slash + 1), false)
  return repo === null ? { kind: 'not-a-url' } : { kind: 'repo', repo }
}
