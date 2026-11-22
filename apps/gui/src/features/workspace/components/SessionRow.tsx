import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { SESSION_ROW_ATTRIBUTE } from '../keyTargets'
import { StatusIcon } from '@/components/ui/status-icon'
import { diffSpoken, diffText, helpersSpoken, WAITING_FOR_SLOT, type HelperCount, type HelperDiff } from '../model/helpers'
import { limitedWord, MAX_SESSION_NAME_LENGTH, STATUS_WORD, type SessionView } from '../model/session'
import { isFreshSession, rowTitle, sectionOf } from '../model/sidebar'
import { beginPointerDrag } from './dragSession'
import { InlineName } from './InlineName'
import { isMenuKey } from './menuPoint'

/** The status mark at a row's right edge. */
const MARK_PX = 14

type Props = {
  session: SessionView
  selected: boolean
  /** The name of the session whose agent started this one, while that session is listed. */
  starter?: string | null
  /** The helpers this session's agent started, when it has any listed. */
  helpers?: HelperCount | null
  /** What a finished helper changed, written before its mark. */
  diff?: HelperDiff | null
  /** The name is being typed in the row. */
  renaming: boolean
  onShow: () => void
  onRename: () => void
  /** The name typed, already known to be a new one. */
  onRenameSave: (name: string) => void
  onRenameEnd: () => void
  onContextMenu: (event: MouseEvent) => void
  /** The context-menu key, or Shift+F10, on the row. */
  onMenuKey: (event: KeyboardEvent<HTMLElement>) => void
}

/**
 * What a screen reader hears after the name: what runs in it (the row shows no agent mark, so this is the only place a
 * row says it), whose helper it is, its own helpers, what a finished helper changed, and its status in a word.
 */
function spokenState(session: SessionView, starter: string | null, helpers: HelperCount | null, diff: HelperDiff | null): string {
  const status = session.status === 'limited' ? limitedWord(session.resumeAt, Date.now()) : STATUS_WORD[session.status]
  return [session.process, starter === null ? null : `helper of ${starter}`, helpers === null ? null : helpersSpoken(helpers), diff === null ? null : diffSpoken(diff), status, session.waitingForSlot ? WAITING_FOR_SLOT.toLowerCase() : null].filter((part) => part !== null).join(', ')
}

/**
 * One session in the sidebar: its name at the left and its status mark at the right, and nothing else but a finished
 * helper's line counts before its mark (a long name is cut short first). An idle session has no mark and is dimmed; where it runs, what it is doing and for how long are the hover card's. While it is renamed
 * the name is a field in the same place: Enter or leaving it saves, Escape cancels, and an empty or unchanged name
 * changes nothing.
 */
export function SessionRow({ session, selected, starter = null, helpers = null, diff = null, renaming, onShow, onRename, onRenameSave, onRenameEnd, onContextMenu, onMenuKey }: Props) {
  const title = rowTitle(session)
  const mark = sectionOf(session)
  const fresh = isFreshSession(session)
  const className = `mx-sb-row is-${mark}${selected ? ' is-selected' : ''}${fresh ? ' is-fresh' : ''}`
  const row = useRef<HTMLButtonElement>(null)
  const wasRenaming = useRef(false)
  // The field took the keyboard from the row; when Enter or Escape ends it, the row has it back. A click elsewhere
  // already put focus where it was meant to go.
  useEffect(() => {
    if (wasRenaming.current && !renaming && document.activeElement === document.body) row.current?.focus()
    wasRenaming.current = renaming
  }, [renaming])
  if (renaming) {
    // A session nothing was sent to has no name yet: its field starts empty over "New session".
    const shown = fresh ? '' : title
    return (
      <div className={`${className} is-renaming`} {...{ [SESSION_ROW_ATTRIBUTE]: session.id }}>
        <InlineName
          value={shown}
          placeholder={title}
          label="Session name"
          maxLength={MAX_SESSION_NAME_LENGTH}
          onCommit={(name) => {
            if (name !== '' && name !== shown) onRenameSave(name)
            onRenameEnd()
          }}
          onCancel={onRenameEnd}
        />
        <StatusIcon status={session.status} size={MARK_PX} className="mx-sb-row-mark" />
      </div>
    )
  }
  return (
    <button
      ref={row}
      type="button"
      className={className}
      {...{ [SESSION_ROW_ATTRIBUTE]: session.id }}
      onPointerDown={(event) => { beginPointerDrag(event, { kind: 'session', id: session.id, label: title }) }}
      aria-label={`${title}, ${spokenState(session, starter, helpers, diff)}`}
      aria-current={selected ? 'page' : undefined}
      onClick={onShow}
      onKeyDown={(event) => {
        if (event.key === 'F2') {
          event.preventDefault()
          onRename()
        } else if (isMenuKey(event)) onMenuKey(event)
      }}
      onContextMenu={onContextMenu}
    >
      <span className="mx-sb-row-name">{title}</span>
      {diff !== null && <span className="mx-sb-row-diff">{diffText(diff)}</span>}
      <StatusIcon status={session.status} size={MARK_PX} className="mx-sb-row-mark" />
    </button>
  )
}
