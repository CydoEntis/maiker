import { rowTitle, type SidebarSort } from '../model/sidebar'
import type { SessionView } from '../model/session'

/**
 * What can move a row: which sessions there are, their order and sections (status, put away, snoozed), how the list is grouped, sorted and folded. When it is the same string, nothing moved and `useFlip`
 * measures nothing.
 */
export function flipKey(props: { sessions: readonly SessionView[]; grouping: string }, sessions: readonly SessionView[], sort: SidebarSort, project: string | null, putAwayOpen: boolean, views: { signature: string }, drafting: boolean, placement: string): string {
  const rows = props.sessions.map((session) => `${session.id}:${session.status}:${session.archived ? 'a' : ''}${session.snoozedUntil === null ? '' : 's'}:${rowTitle(session)}`).join('|')
  return `${rows}#${props.grouping}#${sort}#${project ?? ''}#${String(putAwayOpen)}#${views.signature}#${String(drafting)}#${String(sessions.length)}#${placement}`
}
