import type { TicketSummary } from '@/api/tickets'
import { CATEGORY_LOOK, labelColor, shortAge, ticketKey } from './model/tickets'

type RowProps = {
  ticket: TicketSummary
  /** Picked with the arrow keys: Enter starts it. */
  focused: boolean
  /** Its whole text is being read for the start dialog. */
  starting: boolean
  now: number
  onStart: (id: string) => void
}

/**
 * One ticket in the picker: key, title (two lines at most), then state, labels and its age. A click starts an agent on
 * it, after it is read whole. Ticket text is text.
 */
export function TicketRow({ ticket, focused, starting, now, onStart }: RowProps) {
  const key = ticketKey(ticket)
  const look = CATEGORY_LOOK[ticket.category]
  return (
    <div role="listitem" className="mx-tk-item">
      <button
        type="button"
        aria-current={focused || undefined}
        aria-busy={starting || undefined}
        aria-label={`Start an agent on ${key}: ${ticket.title}`}
        data-ticket={ticket.id}
        className={`mx-tk-row${focused ? ' is-focused' : ''}${starting ? ' is-open' : ''}`}
        onClick={() => { onStart(ticket.id) }}
      >
        <span className="mx-tk-row-body">
          <span className="mx-tk-row-head"><span className="mx-tk-key">{key}</span><span className="mx-tk-title">{ticket.title}</span></span>
          <span className="mx-tk-row-meta">
            <span className="mx-tk-state" style={{ color: look.color }}><span className="mx-tk-glyph">{look.glyph}</span>{ticket.stateName === '' ? look.word : ticket.stateName}</span>
            {ticket.labels.map((label) => <span key={label} className="mx-tk-label"><span style={{ background: labelColor(label) }} />{label}</span>)}
            <span className="mx-spacer" />
            <span className="mx-tk-when">{shortAge(ticket.updatedAt, now)}</span>
          </span>
        </span>
      </button>
    </div>
  )
}

/**
 * While the first page is read: pulsing placeholder rows under the header and toolbar already in place, so a slow
 * provider never looks like a frozen page. What is read is said to screen readers only.
 */
export function TicketSkeleton({ source, rows = 6 }: { source: string; rows?: number }) {
  const WIDTHS = ['70%', '52%', '64%', '44%', '58%', '66%']
  return (
    <div className="mx-tk-skeleton" role="status" aria-label={`Reading tickets from ${source}`}>
      <div aria-hidden="true">
        {WIDTHS.slice(0, rows).map((width) => (
          <div key={width} className="mx-tk-skel"><span style={{ width }} /><span style={{ width: '40%' }} /></div>
        ))}
      </div>
    </div>
  )
}

