import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { LOCAL_MACHINE } from './machines'
import { taggedAnswers } from './taggedAnswers'

/**
 * Tickets, read through this computer's daemon (`Query::Tickets`, `Query::TicketKeys`). Reading changes nothing. The
 * only writes are `writeTicket`'s two (a comment, or closing), which the daemon performs only for a request marked
 * confirmed, so `writeTicket` is called from the confirm button of the write dialog and nowhere else. Every string
 * was cleaned and cut by the daemon; it is still other people's text, so the window shows it as text and never as
 * markup.
 */

const StateCategorySchema = z.enum(['Open', 'Started', 'Closed'])
const GroupKindSchema = z.enum(['Project', 'Module', 'Milestone', 'Cycle'])

const GroupSchema = z.object({
  id: z.string(),
  kind: GroupKindSchema,
  name: z.string(),
  parent: z.string().nullable(),
  ticket_count: z.number().int().nullable(),
})

const SummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  state: z.object({ name: z.string(), category: StateCategorySchema }),
  labels: z.array(z.string()),
  assignee: z.string().nullable(),
  url: z.string(),
  groups: z.array(z.string()),
  updated_at: z.string(),
})

const TicketSchema = z.object({
  summary: SummarySchema,
  body: z.string(),
  comments: z.array(z.object({ author: z.string(), body: z.string(), created_at: z.string() })),
  comments_more: z.boolean(),
  links: z.array(z.string()),
  blocked_by: z.array(z.string()),
})

const ReplySchema = z.union([
  z.object({ Groups: z.array(GroupSchema) }),
  z.object({ List: z.object({ tickets: z.array(SummarySchema), more: z.boolean() }) }),
  z.object({ Ticket: TicketSchema }),
])

const ErrorSchema = z.union([
  z.enum(['NotInstalled', 'SignedOut', 'NotFound', 'RateLimited']),
  z.object({ Unreachable: z.string() }),
  z.object({ Invalid: z.string() }),
])

const TicketsAnswerSchema = z.object({
  machine: z.number().int(),
  tag: z.number().int(),
  answer: z.union([z.object({ Ok: ReplySchema }), z.object({ Err: ErrorSchema })]),
})

const KeyStateSchema = z.object({ provider: z.enum(['Plane', 'Linear']), set: z.boolean(), address: z.string(), workspace: z.string() })
const KeysAnswerSchema = z.object({
  machine: z.number().int(),
  tag: z.number().int(),
  answer: z.union([z.object({ Ok: z.array(KeyStateSchema) }), z.object({ Err: ErrorSchema })]),
})

const WriteAnswerSchema = z.object({
  machine: z.number().int(),
  tag: z.number().int(),
  answer: z.union([z.object({ Ok: z.enum(['Commented', 'Closed']) }), z.object({ Err: ErrorSchema })]),
})

export type StateCategory = z.infer<typeof StateCategorySchema>
export type GroupKind = z.infer<typeof GroupKindSchema>

/** A place a provider keeps tickets: a repository or project (`Project`), a module, a milestone or a cycle. */
export type TicketGroup = { id: string; kind: GroupKind; name: string; parent: string | null; count: number | null }

/** One ticket as a list shows it. `id` is `provider:key`; `url` is empty when the provider gave none. */
export type TicketSummary = {
  id: string
  title: string
  stateName: string
  category: StateCategory
  labels: string[]
  assignee: string | null
  url: string
  groups: string[]
  updatedAt: string
}

export type TicketComment = { author: string; body: string; createdAt: string }

/** One ticket whole: its summary, its words and its comments (at most 50, oldest first), its links and blockers. */
export type TicketDetail = TicketSummary & { body: string; comments: TicketComment[]; commentsMore: boolean; links: string[]; blockedBy: string[] }

/** What a read could not do, in the words the window shows. */
export type TicketFailure =
  | { kind: 'no-key' }
  | { kind: 'signed-out' }
  | { kind: 'not-found' }
  | { kind: 'rate-limited' }
  | { kind: 'unreachable'; line: string }
  | { kind: 'invalid'; line: string }

/** A read's result: what was read, or why nothing was. */
export type TicketsResult<T> = { ok: true; value: T } | { ok: false; failure: TicketFailure }

export type TicketFilter = { group: string | null; state: StateCategory | null; assignee: string | null; label: string | null; search: string | null; page: number }

/** The providers whose key the daemon keeps. GitHub has none: it reads through the user's own `gh`. */
export type KeyedProvider = 'Plane' | 'Linear'
export type TicketKeyState = { provider: KeyedProvider; set: boolean; address: string; workspace: string }

/** The pages a list may be read to, as the daemon allows (`TICKETS_PAGE_MAX`), and the size of one. */
export const TICKETS_PAGE_MAX = 9
export const TICKETS_PAGE_SIZE = 30

/** A ticket read runs `gh` up to twice (thirty seconds each); the host waits that long and a little more. */
export const TICKETS_ANSWER_MS = 95_000
const KEYS_ANSWER_MS = 20_000
const NOT_ANSWERED = 'The Maitty service did not answer in time'

const askTickets = taggedAnswers('tickets', TicketsAnswerSchema)
const askKeys = taggedAnswers('ticket-keys', KeysAnswerSchema)
const askWrite = taggedAnswers('ticket-write', WriteAnswerSchema)
/** A write runs `gh` or up to two requests (thirty and twenty seconds); the host waits that long and a little more. */
const WRITE_ANSWER_MS = 95_000

function summaryOf(summary: z.infer<typeof SummarySchema>): TicketSummary {
  return {
    id: summary.id,
    title: summary.title,
    stateName: summary.state.name,
    category: summary.state.category,
    labels: summary.labels,
    assignee: summary.assignee,
    url: summary.url,
    groups: summary.groups,
    updatedAt: summary.updated_at,
  }
}

function failureOf(error: z.infer<typeof ErrorSchema>): TicketFailure {
  if (error === 'NotInstalled') return { kind: 'no-key' }
  if (error === 'SignedOut') return { kind: 'signed-out' }
  if (error === 'NotFound') return { kind: 'not-found' }
  if (error === 'RateLimited') return { kind: 'rate-limited' }
  if ('Unreachable' in error) return { kind: 'unreachable', line: error.Unreachable }
  return { kind: 'invalid', line: error.Invalid }
}

type Request = 'Groups' | { List: TicketFilter } | { Get: { id: string } }
type Reply = z.infer<typeof ReplySchema>

async function read(source: string, request: Request): Promise<TicketsResult<Reply>> {
  const send = (tag: number) => invoke('tickets', { source, request, tag })
  const told = await askTickets(send, TICKETS_ANSWER_MS, NOT_ANSWERED)
  return 'Ok' in told.answer ? { ok: true, value: told.answer.Ok } : { ok: false, failure: failureOf(told.answer.Err) }
}

function unexpected<T>(): TicketsResult<T> {
  return { ok: false, failure: { kind: 'invalid', line: 'The service gave an answer to another question' } }
}

/** The groups of a source: a GitHub repository and its milestones, Plane projects and modules, Linear teams, projects and cycles. */
export async function loadTicketGroups(source: string): Promise<TicketsResult<TicketGroup[]>> {
  const told = await read(source, 'Groups')
  if (!told.ok) return told
  if (!('Groups' in told.value)) return unexpected()
  return { ok: true, value: told.value.Groups.map((group) => ({ id: group.id, kind: group.kind, name: group.name, parent: group.parent, count: group.ticket_count })) }
}

/** One page of a source's tickets that match `filter`, and whether there are more after it. */
export async function loadTicketPage(source: string, filter: TicketFilter): Promise<TicketsResult<{ tickets: TicketSummary[]; more: boolean }>> {
  const told = await read(source, { List: filter })
  if (!told.ok) return told
  if (!('List' in told.value)) return unexpected()
  return { ok: true, value: { tickets: told.value.List.tickets.map(summaryOf), more: told.value.List.more } }
}

/** One ticket with its words, comments, links and blockers. */
export async function loadTicket(source: string, id: string): Promise<TicketsResult<TicketDetail>> {
  const told = await read(source, { Get: { id } })
  if (!told.ok) return told
  if (!('Ticket' in told.value)) return unexpected()
  const ticket = told.value.Ticket
  return {
    ok: true,
    value: {
      ...summaryOf(ticket.summary),
      body: ticket.body,
      comments: ticket.comments.map((comment) => ({ author: comment.author, body: comment.body, createdAt: comment.created_at })),
      commentsMore: ticket.comments_more,
      links: ticket.links,
      blockedBy: ticket.blocked_by,
    },
  }
}

type KeyChange = 'Status' | { Set: { provider: KeyedProvider; address: string; workspace: string; key: string } } | { Remove: { provider: KeyedProvider } }

async function changeKeys(change: KeyChange): Promise<TicketsResult<TicketKeyState[]>> {
  const send = (tag: number) => invoke('ticket_keys', { change, tag })
  const told = await askKeys(send, KEYS_ANSWER_MS, NOT_ANSWERED)
  return 'Ok' in told.answer ? { ok: true, value: told.answer.Ok } : { ok: false, failure: failureOf(told.answer.Err) }
}

/** Which keyed providers have a key on this computer. Never the key. */
export function loadTicketKeys(): Promise<TicketsResult<TicketKeyState[]>> {
  return changeKeys('Status')
}

/** Gives the daemon a provider's key (and Plane's address and workspace). The answer says only that one is set. */
export function saveTicketKey(provider: KeyedProvider, address: string, workspace: string, key: string): Promise<TicketsResult<TicketKeyState[]>> {
  return changeKeys({ Set: { provider, address: address.trim(), workspace: workspace.trim(), key: key.trim() } })
}

export function removeTicketKey(provider: KeyedProvider): Promise<TicketsResult<TicketKeyState[]>> {
  return changeKeys({ Remove: { provider } })
}

/** The two changes a person may confirm: a comment with exactly this text, or closing the ticket. Nothing else. */
export type TicketWrite = { kind: 'comment'; text: string } | { kind: 'close' }
export type TicketWritten = 'Commented' | 'Closed'

/** The most characters of a comment, as the daemon allows (`TICKET_COMMENT_MAX_CHARS`). */
export const TICKET_COMMENT_MAX_CHARS = 4000

/** The line breaks in a comment are `\n` and its ends are trimmed. */
export function trimmedComment(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

/** How many characters a comment has, as the daemon counts them: whole characters, not UTF-16 halves. */
export function commentLength(text: string): number {
  return (text.match(/[\s\S]/gu) ?? []).length
}

/** Why a comment cannot be sent, or null when it can. The daemon checks it again and has the last word. */
export function commentProblem(text: string): string | null {
  const comment = trimmedComment(text)
  if (comment === '') return 'Write something to say.'
  if (commentLength(comment) > TICKET_COMMENT_MAX_CHARS) return `A comment can be at most ${String(TICKET_COMMENT_MAX_CHARS)} characters.`
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(comment.replace(/\n/g, ''))) return 'A comment cannot hold tabs or hidden characters.'
  return null
}

/**
 * Adds a comment to a ticket or closes it, once the person has seen exactly what will be written and clicked to
 * confirm: `confirmed` can only be `true`, which is the click. The daemon refuses anything else and writes nothing.
 * It is sent once, never retried. A write that was not answered in time may or may not have happened.
 */
export async function writeTicket(source: string, id: string, write: TicketWrite, confirmed: true): Promise<TicketsResult<TicketWritten>> {
  const sent = write.kind === 'close' ? 'Close' : { Comment: { text: trimmedComment(write.text) } }
  const send = (tag: number) => invoke('ticket_write', { source, id, write: sent, confirmed, tag })
  const told = await askWrite(send, WRITE_ANSWER_MS, NOT_ANSWERED)
  return 'Ok' in told.answer ? { ok: true, value: told.answer.Ok } : { ok: false, failure: failureOf(told.answer.Err) }
}

/** The GitHub repository a folder of this computer pushes to (`owner/name`), or null when it has none. */
export async function githubRepoOf(folder: string): Promise<string | null> {
  const told: unknown = await invoke('github_repo_of', { machine: LOCAL_MACHINE, folder })
  return typeof told === 'string' ? told : null
}
