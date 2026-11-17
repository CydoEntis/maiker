import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { taggedAnswers } from './taggedAnswers'
import { failureOf, type KeyedProvider, type TicketsResult } from './tickets'

/**
 * Which ticket sources each project reads, kept by this computer's daemon (`Query::TicketLinks`) so the desktop app and
 * the terminal app show a project the same tickets. A provider's key is set once for every project (`ticket_keys`); a
 * link says which repository, Plane project and Linear team one project reads. A project is this computer's repository
 * main checkout, so every worktree of it shares the link; another machine's folder is kept under that machine's name.
 * Nothing here is secret.
 */

/** A Plane project or a Linear team a project reads, and the name it was picked by. */
export type TicketPick = { id: string; name: string }
/** `null` follows the folder's `origin`; an empty string turns GitHub off for the project; else `owner/name`. */
export type ProjectLink = { github: string | null; plane: TicketPick | null; linear: TicketPick | null }
/** A folder a session works in, on a machine (`null`: this computer). */
export type TicketPlace = { machine: string | null; folder: string }
export type LinkedProject = TicketPlace & { link: ProjectLink }
export type TicketMe = { plane: string; linear: string }
/**
 * What the asked project's repository file (`.maitty/tickets.toml`) gave it: which sources of its link came from the file
 * (only ones not linked here) and why any part was not used, in the daemon's plain words.
 */
export type RepoTicketFile = { github: boolean; plane: boolean; linear: boolean; notes: string[] }
export type TicketLinksAnswer = { project: LinkedProject | null; projects: LinkedProject[]; me: TicketMe; repoFile: RepoTicketFile | null }

/** Where a repository names its ticket sources, relative to its root. */
export const REPO_TICKETS_FILE = '.maitty/tickets.toml'

export const NO_LINK: ProjectLink = { github: null, plane: null, linear: null }

const PickSchema = z.object({ id: z.string(), name: z.string() })
const GitHubSchema = z.union([z.literal('Origin'), z.literal('Off'), z.object({ Repo: z.string() })])
const LinkSchema = z.object({ github: GitHubSchema, plane: PickSchema.nullable(), linear: PickSchema.nullable() })
const ProjectSchema = z.object({ machine: z.string().nullable(), folder: z.string(), link: LinkSchema })
const MeSchema = z.object({ plane: z.string(), linear: z.string() })
/** The most notes the daemon gives about a repository file (`REPO_TICKETS_NOTES_MAX`). */
const REPO_FILE_NOTES_MAX = 4
const RepoFileSchema = z.object({ github: z.boolean(), plane: z.boolean(), linear: z.boolean(), notes: z.array(z.string()).max(REPO_FILE_NOTES_MAX) })
const ErrorSchema = z.union([
  z.enum(['NotInstalled', 'SignedOut', 'NotFound', 'RateLimited']),
  z.object({ Unreachable: z.string() }),
  z.object({ Invalid: z.string() }),
])
const AnswerSchema = z.object({
  machine: z.number().int(),
  tag: z.number().int(),
  answer: z.union([
    z.object({ Ok: z.object({ project: ProjectSchema.nullable(), projects: z.array(ProjectSchema), me: MeSchema, repo_file: RepoFileSchema.nullish() }) }),
    z.object({ Err: ErrorSchema }),
  ]),
})

type WireLink = z.infer<typeof LinkSchema>
type WireGitHub = z.infer<typeof GitHubSchema>

function linkOf(wire: WireLink): ProjectLink {
  const github = wire.github === 'Origin' ? null : wire.github === 'Off' ? '' : wire.github.Repo
  return { github, plane: wire.plane, linear: wire.linear }
}

function wireOf(link: ProjectLink): WireLink {
  const github: WireGitHub = link.github === null ? 'Origin' : link.github === '' ? 'Off' : { Repo: link.github }
  return { github, plane: link.plane, linear: link.linear }
}

function projectOf(wire: z.infer<typeof ProjectSchema>): LinkedProject {
  return { machine: wire.machine, folder: wire.folder, link: linkOf(wire.link) }
}

type Change =
  | 'Read'
  | { Set: { place: TicketPlace; link: WireLink } }
  | { Unlink: { place: TicketPlace } }
  | { SetMe: { provider: KeyedProvider; name: string } }
  | { Import: { projects: Array<TicketPlace & { link: WireLink }>; me: TicketMe } }

/** How long the daemon is given; it reads a small file and asks git one question. */
const LINKS_ANSWER_MS = 20_000
const NOT_ANSWERED = 'The Maiker service did not answer about ticket links. Restart it if this keeps happening.'
const askLinks = taggedAnswers('ticket-links', AnswerSchema)

async function changeLinks(place: TicketPlace | null, change: Change): Promise<TicketsResult<TicketLinksAnswer>> {
  const send = (tag: number) => invoke('ticket_links', { place, change, tag })
  const told = await askLinks(send, LINKS_ANSWER_MS, NOT_ANSWERED)
  if ('Err' in told.answer) return { ok: false, failure: failureOf(told.answer.Err) }
  const ok = told.answer.Ok
  return { ok: true, value: { project: ok.project === null ? null : projectOf(ok.project), projects: ok.projects.map(projectOf), me: ok.me, repoFile: ok.repo_file ?? null } }
}

/** Every linked project and your names; with `place`, also the project that folder is and what it reads. */
export function loadTicketLinks(place: TicketPlace | null): Promise<TicketsResult<TicketLinksAnswer>> {
  return changeLinks(place, 'Read')
}

/** Keeps `link` for the project `place` is (and every worktree of it). */
export function saveTicketLink(place: TicketPlace, link: ProjectLink): Promise<TicketsResult<TicketLinksAnswer>> {
  return changeLinks(place, { Set: { place, link: wireOf(link) } })
}

/** Forgets what the project `place` is reads: it follows its `origin` again and nothing else. */
export function unlinkTicketProject(place: TicketPlace): Promise<TicketsResult<TicketLinksAnswer>> {
  return changeLinks(place, { Unlink: { place } })
}

/** Keeps the name you go by in Plane or Linear, for Mine. */
export function saveTicketName(provider: KeyedProvider, name: string): Promise<TicketsResult<TicketLinksAnswer>> {
  return changeLinks(null, { SetMe: { provider, name: name.trim() } })
}

/** Hands the daemon the links this window kept before the daemon kept them; it adds only what it has not got. */
export function importTicketLinks(projects: readonly LinkedProject[], me: TicketMe): Promise<TicketsResult<TicketLinksAnswer>> {
  return changeLinks(null, { Import: { projects: projects.map((project) => ({ machine: project.machine, folder: project.folder, link: wireOf(project.link) })), me } })
}
