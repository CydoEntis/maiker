import { machineLabel } from '@/data/machineNicknames'
import { messagePreview } from '@/features/chat/messagePreview'
import { agentLabel, askWords, SHELL_PROCESS, STATUS_WORD, type SessionView } from './session'
import { projectOf } from './sidebar'
import { pullRequestHeadline, pullRequestTone, type PullRequestTone } from './pullRequest'

export const HOVER_CARD_DELAY_MS = 450
export const HOVER_CARD_WIDTH_PX = 300
const GAP_PX = 8
const EDGE_PX = 8
/** The card starts a little above its row, so the row's own line reads beside the card's first. */
const ABOVE_ROW_PX = 4
const SAID_CHARS = 140
const HALF = 2

/** The words that stand in for an activity line when the session reported none. */
/** A status word as the card's line: "needs you" is "Needs you". */
const sentence = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

function clipped(text: string): string {
  // One plain line: the paste tags and the attached-files block are transport, not what was said.
  const line = messagePreview(text)
  return line.length > SAID_CHARS ? `${line.slice(0, SAID_CHARS - 1)}…` : line
}

export type HoverCardText = {
  title: string
  /** What the session asks or works on, as the daemon reported it; null when it said nothing, and `word` stands in. */
  activity: string | null
  word: string
  /** A shell's folder is its working directory, drawn in mono; an agent's is its project. */
  folder: { text: string; mono: boolean; ownWorktree: boolean }
  branch: string | null
  /** Lines added and removed; null when nothing changed. */
  changes: { added: number; removed: number } | null
  pr: { number: string; state: string; tone: PullRequestTone } | null
  /** The agent and where it runs: `Claude · This computer`. */
  who: string
}

/**
 * What the card beside a hovered row says. Each line is something the daemon reported: what the agent
 * asks when it needs you, the prompt it was last given while it works. The status word is only a stand-in
 * for an activity the session did not report.
 */
export function hoverCardText(session: SessionView, title: string): HoverCardText {
  const asked = session.ask === null ? session.asking : askWords(session.ask)
  const said = session.status === 'needs' ? asked : session.status === 'working' ? session.lastPrompt : ''
  const shell = session.process === SHELL_PROCESS
  const pr = session.pr
  const number = pr === null ? '' : `#${String(pr.number)}`
  return {
    title,
    activity: shell || clipped(said) === '' ? null : clipped(said),
    word: sentence(STATUS_WORD[session.status]),
    folder: { text: shell ? session.cwdLabel : projectOf(session), mono: shell, ownWorktree: session.worktree },
    branch: shell ? null : session.branch,
    changes: session.diffAdded + session.diffRemoved > 0 ? { added: session.diffAdded, removed: session.diffRemoved } : null,
    pr: pr === null ? null : { number, state: pullRequestHeadline(pr).slice(number.length).trim() || pr.state.toLowerCase(), tone: pullRequestTone(pr) },
    who: `${agentLabel(session.process)} · ${session.machineName === null ? 'This computer' : machineLabel(session.machineName)}`,
  }
}

export type Box = { left: number; right: number; top: number; bottom: number }

/** Where a card sits: `left`, and `top` for a row in the upper half of the window or `bottom` for one in the lower half. */
export type CardPlace = { left: number } & ({ top: number } | { bottom: number })

/**
 * Where the card goes, worked out from the row alone (no measuring of the card): beside the row on the side away from
 * the window's edge. A row in the upper half hangs the card from 4px above the row's top; a row in the lower half stands
 * it on 4px below the row's bottom, so the card grows up and never runs past the window. The stylesheet caps its height
 * at the window's.
 */
export function placeHoverCard(row: Box, windowWidth: number, windowHeight: number): CardPlace {
  const fitsRight = row.right + GAP_PX + HOVER_CARD_WIDTH_PX <= windowWidth - EDGE_PX
  const left = fitsRight ? row.right + GAP_PX : Math.max(EDGE_PX, row.left - GAP_PX - HOVER_CARD_WIDTH_PX)
  if (row.top + (row.bottom - row.top) / HALF <= windowHeight / HALF) return { left, top: Math.max(EDGE_PX, row.top - ABOVE_ROW_PX) }
  return { left, bottom: Math.max(EDGE_PX, windowHeight - row.bottom - ABOVE_ROW_PX) }
}
