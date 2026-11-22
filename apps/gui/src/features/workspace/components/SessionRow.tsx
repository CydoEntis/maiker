import type { MouseEvent } from 'react'
import { StatusIcon } from '@/components/ui/status-icon'
import { helpersSpoken, type HelperCount } from '../model/helpers'
import { limitedWord, STATUS_WORD, type SessionView } from '../model/session'
import { isFreshSession, rowTitle, sectionOf } from '../model/sidebar'
import { beginPointerDrag } from './dragSession'

/** The status mark at a row's right edge. */
const MARK_PX = 14

type Props = {
  session: SessionView
  selected: boolean
  /** The name of the session whose agent started this one, while that session is listed. */
  starter?: string | null
  /** The helpers this session's agent started, when it has any listed. */
  helpers?: HelperCount | null
  onShow: () => void
  onRename: () => void
  onContextMenu: (event: MouseEvent) => void
}

/**
 * What a screen reader hears after the name: what runs in it (the row shows no agent mark, so this is the only place a
 * row says it), whose helper it is, its own helpers, and its status in a word.
 */
function spokenState(session: SessionView, starter: string | null, helpers: HelperCount | null): string {
  const status = session.status === 'limited' ? limitedWord(session.resumeAt, Date.now()) : STATUS_WORD[session.status]
  return [session.process, starter === null ? null : `helper of ${starter}`, helpers === null ? null : helpersSpoken(helpers), status].filter((part) => part !== null).join(', ')
}

/**
 * One session in the sidebar: its name at the left and its status mark at the right, and nothing else. An idle session
 * has no mark and is dimmed; where it runs, what it is doing and for how long are the hover card's.
 */
export function SessionRow({ session, selected, starter = null, helpers = null, onShow, onRename, onContextMenu }: Props) {
  const title = rowTitle(session)
  const mark = sectionOf(session)
  return (
    <button
      type="button"
      className={`mx-sb-row is-${mark}${selected ? ' is-selected' : ''}${isFreshSession(session) ? ' is-fresh' : ''}`}
      onPointerDown={(event) => { beginPointerDrag(event, { kind: 'session', id: session.id, label: title }) }}
      aria-label={`${title}, ${spokenState(session, starter, helpers)}`}
      aria-current={selected ? 'page' : undefined}
      onClick={onShow}
      onKeyDown={(event) => { if (event.key === 'F2') { event.preventDefault(); onRename() } }}
      onContextMenu={onContextMenu}
    >
      <span className="mx-sb-row-name">{title}</span>
      <StatusIcon status={session.status} size={MARK_PX} className="mx-sb-row-mark" />
    </button>
  )
}
