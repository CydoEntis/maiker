import { machineLabel } from '@/data/machineNicknames'
import { messagePreview } from '@/features/chat/messagePreview'
import type { StatusMarkKind } from '@/lib/statusMark'
import type { MachineHead } from './machines'
import { agentLabel, askWords, SHELL_PROCESS, STATUS_WORD, type SessionView } from './session'
import { happenedLine, projectOf, sectionOf } from './sidebar'
import { helpersWord, WAITING_FOR_SLOT, waitingOnHelpers, type HelperCount } from './helpers'
import { formatAgo } from './tracking'

export const HOVER_CARD_DELAY_MS = 380
export const HOVER_CARD_WIDTH_PX = 290
const GAP_PX = 8
const EDGE_PX = 8
/** The card starts a little above its row, so the row's own line reads beside the card's name. */
const ABOVE_ROW_PX = 8
const SAID_CHARS = 140
const HALF = 2
const PERCENT_MAX = 100
/** From this share of its context on, the bar is drawn in the needs-you colour. */
const CONTEXT_HOT_FROM = 80

/** A status word as the card writes it: "needs you" is "Needs you". */
const sentence = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

function clipped(text: string): string {
  // One plain line: the paste tags and the attached-files block are transport, not what was said.
  const line = messagePreview(text)
  return line.length > SAID_CHARS ? `${line.slice(0, SAID_CHARS - 1)}…` : line
}

/** The last part of a path, whichever way its slashes lean. */
const lastPart = (path: string): string => path.split(/[\\/]/).filter((part) => part !== '').at(-1) ?? path

/** What a row of the card is about; the card picks the row's icon by it. */
export type HoverRowKind = 'starter' | 'place' | 'branch' | 'machine' | 'agent' | 'active' | 'helpers'

export type HoverRow =
  | {
      kind: Exclude<HoverRowKind, 'active'>
      text: string
      /** Dim, at the row's right: how a machine is reached, how many helpers need you. */
      detail?: string
      mono?: boolean
      /** `remote`: another machine that is up. `needs`: a machine that is not. */
      tone?: 'remote' | 'needs'
    }
  /** When the session's status last changed; the card writes it against the clock (`lastActiveWords`). */
  | { kind: 'active'; at: number }

export type HoverCardText = {
  title: string
  /** Which of the four states it is in, for the mark's and the word's colour. */
  state: StatusMarkKind
  word: string
  /** What the session asks or works on, or what happened to it, as the daemon reported it; null when it said nothing. */
  activity: string | null
  /** Top to bottom. A row the session has nothing to say for is not in the list. */
  rows: HoverRow[]
  /** How full the agent's context is; null when it has not said. */
  context: { percent: number; hot: boolean } | null
}

export type HoverCardFacts = {
  title: string
  /** The list names machines (another one is configured); with only this computer the machine row is left out. */
  namesMachine: boolean
  /** The name of the session whose agent started this one, while that session is listed. */
  starter?: string | null
  /** The helpers its agent started, while any is listed. */
  helpers?: HelperCount | null
  /** The session's machine as the sidebar heads it, when it is another one. */
  machine?: MachineHead | null
  now?: number
}

/** `Last active 3m ago`, or `Last active just now` in the first minute. */
export function lastActiveWords(ms: number): string {
  const ago = formatAgo(ms)
  return ago === 'now' ? 'Last active just now' : `Last active ${ago} ago`
}

function machineRow(session: SessionView, head: MachineHead | null): HoverRow {
  if (session.machineName === null) return { kind: 'machine', text: 'This computer' }
  const label = machineLabel(session.machineName)
  if (head?.down === true) return { kind: 'machine', text: `${label} · offline`, tone: 'needs' }
  return { kind: 'machine', text: label, tone: 'remote', ...(head?.target ? { detail: head.target } : {}) }
}

function helpersRow(helpers: HelperCount): HoverRow {
  return { kind: 'helpers', text: helpersWord(helpers.total), ...(helpers.needs > 0 ? { detail: `${String(helpers.needs)} ${helpers.needs === 1 ? 'needs' : 'need'} you` } : {}) }
}

/**
 * What the card beside a hovered row says: the name, the state and the activity, then one row each for who started it,
 * where it works, its branch, its machine, its agent and model, when it last changed and its helpers, and how full its
 * context is. Every line is something the daemon reported: what the agent asks when it needs you, the prompt it was last
 * given while it works, and what happened to one that stopped, is held by its plan limit or is out of reach
 * (`happenedLine`), since its mark only says idle.
 */
export function hoverCardText(session: SessionView, facts: HoverCardFacts): HoverCardText {
  const { starter = null, helpers = null, machine = null, now = Date.now() } = facts
  const asked = session.ask === null ? session.asking : askWords(session.ask)
  const said = session.status === 'needs' ? asked : session.status === 'working' ? session.lastPrompt : ''
  const shell = session.process === SHELL_PROCESS
  const happened = happenedLine(session, now)
  const agent = agentLabel(session.process)
  const used = session.usage.context
  const percent = used === null ? null : Math.max(0, Math.min(PERCENT_MAX, Math.round(used)))
  const rows: (HoverRow | null)[] = [
    starter === null ? null : { kind: 'starter', text: `Started by “${starter}”` },
    // A shell is where it stands; an agent is its project, and the worktree it has to itself.
    shell
      ? { kind: 'place', text: session.cwdLabel, mono: true }
      : { kind: 'place', text: session.worktree && session.checkout !== null ? `${projectOf(session)} / ${lastPart(session.checkout)}` : projectOf(session) },
    shell || session.branch === null ? null : { kind: 'branch', text: session.branch, mono: true },
    facts.namesMachine ? machineRow(session, machine) : null,
    { kind: 'agent', text: session.agentModel === '' ? agent : `${agent} · ${session.agentModel}` },
    session.statusSince === null ? null : { kind: 'active', at: session.statusSince },
    helpers === null ? null : helpersRow(helpers),
  ]
  return {
    title: facts.title,
    state: sectionOf(session),
    word: sentence(STATUS_WORD[sectionOf(session)]),
    activity: activityOf(session, helpers, happened, shell ? '' : clipped(said)),
    rows: rows.filter((row) => row !== null),
    context: percent === null ? null : { percent, hot: percent >= CONTEXT_HOT_FROM },
  }
}

/**
 * The card's activity line, first that applies: a helper the daemon holds for a free slot says so; what happened to a
 * session that stopped; a lead that works while its helpers do says it waits on them; else what it asks or was told.
 */
function activityOf(session: SessionView, helpers: HelperCount | null, happened: string, said: string): string | null {
  if (session.waitingForSlot) return WAITING_FOR_SLOT
  if (happened !== '') return sentence(happened)
  return waitingOnHelpers(session, helpers) ?? (said === '' ? null : said)
}

export type Box = { left: number; right: number; top: number; bottom: number }

/** Where a card sits: `left`, and `top` for a row in the upper half of the window or `bottom` for one in the lower half. */
export type CardPlace = { left: number } & ({ top: number } | { bottom: number })

/**
 * Where the card goes, worked out from the row alone (no measuring of the card): beside the row on the side away from
 * the window's edge. A row in the upper half hangs the card from 8px above the row's top; a row in the lower half stands
 * it on 8px below the row's bottom, so the card grows up and never runs past the window. The stylesheet caps its height
 * at the window's.
 */
export function placeHoverCard(row: Box, windowWidth: number, windowHeight: number): CardPlace {
  const fitsRight = row.right + GAP_PX + HOVER_CARD_WIDTH_PX <= windowWidth - EDGE_PX
  const left = fitsRight ? row.right + GAP_PX : Math.max(EDGE_PX, row.left - GAP_PX - HOVER_CARD_WIDTH_PX)
  if (row.top + (row.bottom - row.top) / HALF <= windowHeight / HALF) return { left, top: Math.max(EDGE_PX, row.top - ABOVE_ROW_PX) }
  return { left, bottom: Math.max(EDGE_PX, windowHeight - row.bottom - ABOVE_ROW_PX) }
}
