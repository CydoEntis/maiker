import { useRef, useState, type KeyboardEvent } from 'react'
import { movedHighlight, rowForKey, type AnswerRow } from '../answerRows'

type Props<Id extends string> = {
  /** The group's accessible name. */
  label: string
  rows: readonly AnswerRow<Id>[]
  /** No answer can be sent now: the service is unreachable, or one is on its way. */
  disabled?: boolean
  onPick: (id: Id) => void
}

/**
 * A needs-you card's answers: one row an answer, its key at the left, the first row highlighted. The column is one
 * stop for Tab; while it has the keys the arrows move the highlight, Enter picks it, and a row's letter picks that
 * row. A letter is an answer only here and never in a field, so a reply being typed is never taken for one.
 */
export function AnswerList<Id extends string>({ label, rows, disabled = false, onPick }: Props<Id>) {
  const group = useRef<HTMLDivElement>(null)
  const [highlight, setHighlight] = useState(0)
  const at = Math.max(0, Math.min(highlight, rows.length - 1))
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.ctrlKey || event.metaKey || event.altKey) return
    const moved = movedHighlight(rows.length, at, event.key)
    const picked = moved === null ? rowForKey(rows, event.key) : null
    if (moved === null && picked === null) return
    event.preventDefault()
    // The chat answers a letter typed elsewhere in it for the card (`answerKeyTarget`): this one is already answered.
    event.stopPropagation()
    if (picked !== null) onPick(picked.id)
    // The focus is the highlight: moving one moves the other, so Enter presses the row the arrows are on.
    else if (moved !== null) group.current?.querySelectorAll<HTMLButtonElement>('button')[moved]?.focus()
  }
  return (
    <div ref={group} role="group" aria-label={label} className="mx-answers" onKeyDown={onKeyDown}>
      {rows.map((row, index) => (
        <button
          key={row.id}
          type="button"
          className={`mx-answer${row.quiet === true ? ' is-quiet' : ''}`}
          // One stop for Tab: the highlighted row. The arrows reach the others.
          tabIndex={index === at ? 0 : -1}
          data-highlight={index === at}
          data-answer-key={row.key ?? undefined}
          aria-keyshortcuts={row.key ?? undefined}
          title={row.hint}
          disabled={disabled}
          onFocus={() => { setHighlight(index) }}
          onClick={() => { onPick(row.id) }}
        >
          {row.key !== null && <kbd className="mx-answer-key" aria-hidden="true">{row.key}</kbd>}
          <span className="mx-answer-text">{row.label}</span>
        </button>
      ))}
    </div>
  )
}
