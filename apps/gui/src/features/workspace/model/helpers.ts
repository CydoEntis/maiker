import type { SessionView } from './session'
import { rowTitle } from './sidebar'

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
