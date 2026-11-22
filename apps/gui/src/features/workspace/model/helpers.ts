import { markOf, type StatusMarkKind } from '@/lib/statusMark'
import type { SessionView } from './session'
import { mostUrgent, rowTitle } from './sidebar'

/** The helpers a session's agent started and that are still listed. */
export type HelperCount = {
  total: number
  /** How many of them wait on the person. */
  needs: number
  /** Their names as the sidebar calls them, in list order. */
  names: readonly string[]
}

export type HelperLinks = {
  /** The name of the session that started a helper, by the helper's id. */
  starterOf: ReadonlyMap<string, string>
  /** What a starting session's row says of its helpers, by its id. */
  helpersOf: ReadonlyMap<string, HelperCount>
}

/**
 * Who started whom among `sessions`. A session is a helper only while the session that started it is still listed:
 * once that one is gone nothing waits on the helper, and its row is the person's like any other.
 */
export function helperLinks(sessions: readonly SessionView[]): HelperLinks {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const starterOf = new Map<string, string>()
  const helpersOf = new Map<string, HelperCount>()
  for (const session of sessions) {
    const starter = session.startedBy === null ? undefined : byId.get(session.startedBy)
    if (starter === undefined) continue
    starterOf.set(session.id, rowTitle(starter))
    const before = helpersOf.get(starter.id) ?? { total: 0, needs: 0, names: [] }
    helpersOf.set(starter.id, {
      total: before.total + 1,
      needs: before.needs + (session.status === 'needs' ? 1 : 0),
      names: [...before.names, rowTitle(session)],
    })
  }
  return { starterOf, helpersOf }
}

/** `2 helpers`, as a row and its hover card write the count. */
export function helpersWord(total: number): string {
  return `${String(total)} helper${total === 1 ? '' : 's'}`
}

/** What a screen reader hears of a session's helpers: the count, and how many wait on the person when any do. */
export function helpersSpoken(helpers: HelperCount): string {
  return helpers.needs === 0 ? helpersWord(helpers.total) : `${helpersWord(helpers.total)}, ${String(helpers.needs)} ${helpers.needs === 1 ? 'needs' : 'need'} you`
}

/** What the line under a lead says of its helpers. */
export type HelperSummary = {
  readonly count: number
  /** The most urgent state among them: needs you, then working, then done; idle when none is any of those. */
  readonly state: StatusMarkKind
  /** How many of them wait on the person. */
  readonly needs: number
}

export function helperSummary(helpers: readonly Pick<SessionView, 'status'>[]): HelperSummary {
  const marks = helpers.map((helper) => markOf(helper.status))
  return { count: marks.length, state: mostUrgent(marks), needs: marks.filter((mark) => mark === 'needs').length }
}

const STATE_SPOKEN: Record<StatusMarkKind, string | null> = { needs: null, working: 'working', done: 'done', idle: null }

/** The summary as a screen reader hears it: the count, then how many need you, or the state the line's mark shows. */
export function summarySpoken(summary: HelperSummary): string {
  const count = helpersWord(summary.count)
  if (summary.needs > 0) return `${count}, ${String(summary.needs)} ${summary.needs === 1 ? 'needs' : 'need'} you`
  const state = STATE_SPOKEN[summary.state]
  return state === null ? count : `${count}, ${state}`
}

/** The lines a helper's work added and removed. */
export type HelperDiff = { readonly added: number; readonly removed: number }

/**
 * What a finished helper's row says it changed, or null: a helper that is not done yet is still changing, and one
 * that changed nothing has no counts to show.
 */
export function helperDiff(helper: Pick<SessionView, 'status' | 'diffAdded' | 'diffRemoved'>): HelperDiff | null {
  if (markOf(helper.status) !== 'done' || helper.diffAdded + helper.diffRemoved === 0) return null
  return { added: helper.diffAdded, removed: helper.diffRemoved }
}

/** `+86 −12`, as a row writes the counts. */
export function diffText(diff: HelperDiff): string {
  return `+${String(diff.added)} −${String(diff.removed)}`
}

/** The counts in words, for a screen reader. */
export function diffSpoken(diff: HelperDiff): string {
  return `${String(diff.added)} added, ${String(diff.removed)} removed`
}
