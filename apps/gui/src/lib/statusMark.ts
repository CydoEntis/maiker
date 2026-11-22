/** The four states there are. Idle is one of them, and the only one with nothing drawn. */
export type StatusMarkKind = 'needs' | 'working' | 'done' | 'idle'

/** What a caller may hand over: the four states, or a daemon status that is none of them. */
export type StatusIconKind = StatusMarkKind | 'error' | 'limited' | 'unknown'

/**
 * The one place a status becomes one of the four states the window draws and counts. The daemon reports more than four
 * (ADR 0003: it alone decides them) and the window only chooses how to show them: an agent that stopped, one held by its
 * plan limit and one nobody can reach are all idle. None of them is a question the person can answer, so none is needs
 * you; what happened is the session's activity text and a toast.
 */
const MARK_OF: Record<StatusIconKind, StatusMarkKind> = {
  needs: 'needs', working: 'working', done: 'done', idle: 'idle', error: 'idle', limited: 'idle', unknown: 'idle',
}

/** The state a status is drawn and counted as. */
export const markOf = (status: StatusIconKind): StatusMarkKind => MARK_OF[status]
