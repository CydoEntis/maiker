import { rowTitle } from '../model/sidebar'
import type { SessionView } from '../model/session'

/**
 * What can move a row: which sessions there are (status, put away, snoozed, name), where each sits in the tree
 * (`treePlacement`), and what is folded. When it is the same string, nothing moved and `useFlip` measures nothing.
 */
export function flipKey(sessions: readonly SessionView[], putAwayOpen: boolean, folds: string, drafting: boolean, placement: string): string {
  const rows = sessions.map((session) => `${session.id}:${session.status}:${session.archived ? 'a' : ''}${session.snoozedUntil === null ? '' : 's'}:${rowTitle(session)}`).join('|')
  return `${rows}#${String(putAwayOpen)}#${folds}#${String(drafting)}#${placement}`
}
