import type { MouseEvent } from 'react'
import type { TicketSummary } from '@/api/tickets'
import { CATEGORIES, CATEGORY_LOOK, initials, isMine, labelColor, shortAge, ticketKey, type FactoryRun } from './model/tickets'

/** What a row needs beyond the ticket: whether it is ticked, focused or open, what blocks it and its factory run. */
export type RowState = {
  checked: boolean
  focused: boolean
  open: boolean
  /** The keys of the blockers not done yet, when the ticket was read whole; empty when nothing blocks it or it is not known. */
  blockedBy: readonly string[]
  run: FactoryRun | null
}

type RowProps = {
  ticket: TicketSummary
  state: RowState
  me: string | null
  now: number
  onToggle: (id: string) => void
  onOpen: (id: string) => void
  onOpenWork: (sessionId: string) => void
}

/** A ticket's checkbox: a 15px square that fills with the accent and a tick. */
function Tick({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`mx-tk-tick${checked ? ' is-on' : ''}`}
      onClick={(event: MouseEvent) => { event.stopPropagation(); onToggle() }}
    >
      {checked ? '✓' : ''}
    </button>
  )
}

/**
 * One ticket in the list or on a board card: tick, key, title (two lines at most), then state, labels, the assignee's
 * initials and its age; under them what blocks it, or its factory run with the step it is on. Ticket text is text.
 */
export function TicketRow({ ticket, state, me, now, onToggle, onOpen, onOpenWork }: RowProps) {
  const key = ticketKey(ticket)
  const look = CATEGORY_LOOK[ticket.category]
  const mine = isMine(ticket, me)
  return (
    <div
      role="listitem"
      aria-current={state.focused || undefined}
      data-ticket={ticket.id}
      className={`mx-tk-row${state.checked ? ' is-checked' : ''}${state.open ? ' is-open' : ''}${state.focused ? ' is-focused' : ''}${ticket.category === 'Closed' ? ' is-closed' : ''}`}
      onClick={() => { onOpen(ticket.id) }}
    >
      <Tick checked={state.checked} label={`Select ${key}`} onToggle={() => { onToggle(ticket.id) }} />
      <div className="mx-tk-row-body">
        <span className="mx-tk-row-head"><span className="mx-tk-key">{key}</span><span className="mx-tk-title">{ticket.title}</span></span>
        <span className="mx-tk-row-meta">
          <span className="mx-tk-state" style={{ color: look.color }}><span className="mx-tk-glyph">{look.glyph}</span>{ticket.stateName === '' ? look.word : ticket.stateName}</span>
          {ticket.labels.map((label) => <span key={label} className="mx-tk-label"><span style={{ background: labelColor(label) }} />{label}</span>)}
          <span className="mx-spacer" />
          <span className={`mx-tk-who${mine ? ' is-me' : ''}`} title={ticket.assignee ?? 'Unassigned'}>{initials(ticket.assignee, me)}</span>
          <span className="mx-tk-when">{shortAge(ticket.updatedAt, now)}</span>
        </span>
        {state.blockedBy.length > 0 && <span className="mx-tk-blocked"><span className="mx-tk-glyph">✕</span> Blocked by {state.blockedBy.join(', ')}</span>}
        {state.run !== null && (
          <button type="button" className="mx-tk-factory" title="Open its run in the Work tab" onClick={(event) => { event.stopPropagation(); if (state.run) onOpenWork(state.run.sessionId) }}>
            <span className="mx-tk-spin" aria-hidden="true" />In Factory · {state.run.step} ›
          </button>
        )}
      </div>
    </div>
  )
}

type ListProps = Omit<RowProps, 'ticket' | 'state'> & { tickets: readonly TicketSummary[]; stateOf: (ticket: TicketSummary) => RowState }

/** The board: Open, Started and Closed side by side, each with its count, scrolling on its own. */
export function TicketBoard({ tickets, stateOf, ...row }: ListProps) {
  return (
    <div className="mx-tk-board" role="group" aria-label="Tickets by state">
      {CATEGORIES.map((category) => {
        const cards = tickets.filter((ticket) => ticket.category === category)
        const look = CATEGORY_LOOK[category]
        return (
          <section key={category} className="mx-tk-col" aria-label={look.word}>
            <span className="mx-tk-col-head"><span className="mx-tk-glyph" style={{ color: look.color }}>{look.glyph}</span>{look.word}<span className="mx-tk-n">{cards.length}</span></span>
            <div className="mx-tk-col-body" role="list">
              {cards.length === 0 && <span className="mx-tk-col-empty">Nothing here</span>}
              {cards.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} state={stateOf(ticket)} {...row} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/**
 * While the first page is read: a line that says what is being read, then pulsing placeholder rows, under the header
 * and toolbar already in place, so a slow provider never looks like a frozen page.
 */
export function TicketSkeleton({ source }: { source: string }) {
  const WIDTHS = ['70%', '52%', '64%', '44%', '58%', '66%']
  return (
    <div className="mx-tk-skeleton">
      <div role="status" className="mx-tk-more-row"><span className="mx-tk-spin" aria-hidden="true" />Reading tickets from {source}…</div>
      <div aria-hidden="true">
        {WIDTHS.map((width) => (
          <div key={width} className="mx-tk-skel"><span style={{ width }} /><span style={{ width: '40%' }} /></div>
        ))}
      </div>
    </div>
  )
}

/** Pulsing placeholder lines where a ticket's description and comments go while the whole ticket is read. */
export function TicketTextSkeleton() {
  const WIDTHS = ['92%', '78%', '85%', '40%']
  return (
    <div className="mx-tk-text-skel" aria-hidden="true">
      {WIDTHS.map((width) => <span key={width} style={{ width }} />)}
    </div>
  )
}
