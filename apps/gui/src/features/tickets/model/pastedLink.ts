/**
 * A link pasted into ticket setup, read for what it names: a GitHub repository, a Plane workspace (and project), or a
 * Linear team. The text is untrusted: it is only split and checked, never fetched or shown as markup. The terminal app
 * reads the same links in `maitty-shared/src/ticket_paste.rs`.
 */

/** The longest text read; a longer paste is refused, not cut. */
export const PASTED_LINK_MAX_CHARS = 2048
const WORKSPACE_MAX_CHARS = 64
/** Linear allows five; this leaves room. */
const TEAM_KEY_MAX_CHARS = 10
const GITHUB_HOST = 'github.com'
const LINEAR_HOST = 'linear.app'
/** The path segment a Plane project's pages start with: `/<workspace>/projects/<id>/…`. */
const PLANE_PROJECTS = 'projects'
const REPO_NAME_MAX_CHARS = 100
/** `owner/name`: the first two segments of a GitHub path. */
const REPO_SEGMENTS = 2

export type PastedLink =
  | { kind: 'github'; repo: string }
  /** `address` is `http(s)://host[:port][/prefix]`; `project` is the Plane project's id when the link was to one. */
  | { kind: 'plane'; address: string; workspace: string; project: string | null }
  /** The team's key, as in its issue keys (`ENG` of `ENG-123`). */
  | { kind: 'linear'; teamKey: string }

export type PastedLinkResult = { ok: true; link: PastedLink } | { ok: false; reason: string }

const refused = (reason: string): PastedLinkResult => ({ ok: false, reason })
const found = (link: PastedLink): PastedLinkResult => ({ ok: true, link })

// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL = /[\u0000-\u001f\u007f]/
const HOST = /^[A-Za-z0-9.\-:[\]]{1,255}$/
const SLUG = /^[A-Za-z0-9_-]+$/
const TEAM_KEY = /^[A-Za-z0-9]+$/
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO_NAME = /^[A-Za-z0-9._-]+$/

const isWorkspace = (slug: string) => slug.length <= WORKSPACE_MAX_CHARS && SLUG.test(slug)

function github(path: string): PastedLinkResult {
  const trimmed = path.replace(/\/+$/, '')
  const repo = trimmed.endsWith('.git') ? trimmed.slice(0, -'.git'.length) : trimmed
  const [owner = '', name = '', ...extra] = repo.split('/')
  const ok = extra.length === 0 && OWNER.test(owner) && name !== '.' && name !== '..' && name.length <= REPO_NAME_MAX_CHARS && REPO_NAME.test(name)
  return ok ? found({ kind: 'github', repo }) : refused('That GitHub link names no repository')
}

function linear(segments: readonly string[]): PastedLinkResult {
  const [, kind = '', value = ''] = segments
  const key = kind === 'team' ? value : kind === 'issue' && value.includes('-') ? value.slice(0, value.indexOf('-')) : ''
  return key !== '' && key.length <= TEAM_KEY_MAX_CHARS && TEAM_KEY.test(key)
    ? found({ kind: 'linear', teamKey: key.toUpperCase() })
    : refused('That Linear link names no team: paste a link to a team or one of its issues')
}

function plane(scheme: string, host: string, segments: readonly string[]): PastedLinkResult {
  const at = segments.indexOf(PLANE_PROJECTS)
  if (at === 0) return refused('That Plane link names no workspace')
  const prefix = at > 0 ? segments.slice(0, at - 1) : []
  const workspace = at > 0 ? segments[at - 1] : segments[0]
  if (workspace === undefined) return refused('That link names no Plane workspace')
  if (!isWorkspace(workspace) || !prefix.every(isWorkspace)) return refused('That link names no Plane workspace')
  const id = at > 0 ? segments[at + 1] : undefined
  if (id !== undefined && !UUID.test(id)) return refused('That Plane link names no project')
  const address = [`${scheme}://${host}`, ...prefix].join('/')
  return found({ kind: 'plane', address, workspace, project: id === undefined ? null : id.toLowerCase() })
}

/** What `text` names, or why it names nothing ticket setup can use, in a short plain sentence. */
export function parseTicketLink(text: string): PastedLinkResult {
  const typed = text.trim()
  if (typed === '') return refused('Paste a link first')
  if (typed.length > PASTED_LINK_MAX_CHARS || CONTROL.test(typed)) return refused('That is not a link')
  if (typed.startsWith('git@github.com:')) return github(typed.slice('git@github.com:'.length))
  const scheme = typed.startsWith('https://') ? 'https' : typed.startsWith('http://') ? 'http' : null
  if (scheme === null) return refused('A link starts with http:// or https://')
  const rest = typed.slice(scheme.length + '://'.length).split(/[?#]/)[0] ?? ''
  const slash = rest.indexOf('/')
  const host = slash === -1 ? rest : rest.slice(0, slash)
  if (!HOST.test(host)) return refused('That link has no address Maiker can use')
  const segments = (slash === -1 ? '' : rest.slice(slash + 1)).split('/').filter((segment) => segment !== '')
  const bare = host.toLowerCase().replace(/^www\./, '')
  if (bare === GITHUB_HOST) return github(segments.slice(0, REPO_SEGMENTS).join('/'))
  if (bare === LINEAR_HOST) return linear(segments)
  return plane(scheme, host, segments)
}

/** The Plane group id the daemon gives the project a link names (`plane:<id>`). */
export function planeGroupId(project: string): string {
  return `plane:${project}`
}
