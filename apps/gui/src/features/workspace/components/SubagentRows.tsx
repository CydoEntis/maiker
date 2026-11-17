import type { SubagentStatus, SubagentView } from '../model/subagents'
import { Icon, Spinner } from './glyphs'

const STATUS_WORDS: Record<SubagentStatus, string> = { working: 'working', needs: 'needs you', done: 'done', stopped: 'stopped' }

/** At most this many helpers are named under a session; the rest are counted, so a busy agent does not push the list away. */
export const SUBAGENT_ROWS_MAX = 4

/** A helper's mark, a shape for each state and never colour alone: a spinner, an amber square, a check, a cross. */
function SubagentMark({ status }: { status: SubagentStatus }) {
  return (
    <span className={`mx-sub-mark is-${status}`} aria-hidden="true">
      {status === 'working' && <Spinner />}
      {status === 'done' && <Icon name="check" size={7} strokeWidth={3.5} />}
      {status === 'stopped' && <Icon name="close" size={7} strokeWidth={3.5} />}
    </span>
  )
}

type Props = {
  subagents: readonly SubagentView[]
  /** The helper whose chat its pane shows, if one is. */
  openId: string | null
  /** Opens a helper's own chat, read-only, in its session's pane. */
  onOpen: (id: string) => void
  /** Shows the session itself, for the helpers past `SUBAGENT_ROWS_MAX`. */
  onShowSession: () => void
}

/**
 * Under every session with helpers running, selected or not: one short row each on a guide line, so what runs is in view
 * from anywhere. A click opens the helper's own chat; a helper cannot be written to, only its session can.
 */
export function SubagentRows({ subagents, openId, onOpen, onShowSession }: Props) {
  const named = subagents.slice(0, SUBAGENT_ROWS_MAX)
  const more = subagents.length - named.length
  return (
    <div className="mx-sub-list" role="group" aria-label="Subagents">
      <span className="mx-sub-guide" aria-hidden="true" />
      {named.map((subagent) => (
        <button
          key={subagent.id}
          type="button"
          className={`mx-sub-row${subagent.id === openId ? ' is-open' : ''}`}
          aria-label={`${subagent.name}, ${STATUS_WORDS[subagent.status]}`}
          aria-current={subagent.id === openId ? 'page' : undefined}
          title={subagent.latest ?? subagent.task ?? subagent.name}
          onClick={() => { onOpen(subagent.id) }}
        >
          <span className="mx-sub-bend" aria-hidden="true" />
          <SubagentMark status={subagent.status} />
          <span className="mx-sub-name">{subagent.name}</span>
        </button>
      ))}
      {more > 0 && (
        <button type="button" className="mx-sub-row is-more" onClick={onShowSession}>
          <span className="mx-sub-bend" aria-hidden="true" />
          <span className="mx-sub-name">+{more} more</span>
        </button>
      )}
    </div>
  )
}
