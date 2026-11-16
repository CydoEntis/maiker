import { useState } from 'react'
import type { SubagentView } from '@/features/workspace/model/subagents'
import { STEP_WORDS, type WorkflowView } from '@/features/workspace/model/workflows'
import { boardSummary, cardNote, reviewShort, reviewTrack, runState, workBoard, type BoardColumn, type BoardTicket, type RunState } from '../model/board'
import { RunDrawer, type RunWhere } from './RunDrawer'
import { RunMark, StepChip } from './WorkStepMark'

/** A finished run's word at its card's right; a run going has none, its mark and column say it. */
const DONE_TAG: Partial<Record<RunState, string>> = { done: 'done', failed: 'failed' }

/** A run's card in its column: the run's mark, key and end word, the title, its reviews as chips, and its note. */
function TicketCard({ ticket, open, onOpen }: { ticket: BoardTicket; open: boolean; onOpen: () => void }) {
  const { run, step } = ticket
  const state = runState(run)
  const tag = DONE_TAG[state]
  const reviews = reviewTrack(run)
  const note = cardNote(ticket)
  return (
    <li>
      <button
        type="button"
        className={`mx-board-card is-${state}${open ? ' is-open' : ''}`}
        aria-label={`${run.label}${run.title === null ? '' : `, ${run.title}`}: ${step.name}, ${STEP_WORDS[step.state]}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onOpen}
      >
        <span className="mx-board-card-head">
          <RunMark state={state} />
          <span className="mx-board-card-key">{run.label}</span>
          <span className="mx-spacer" />
          {tag !== undefined && <span className={`mx-board-card-tag is-${state}`}>{tag}</span>}
        </span>
        <span className={`mx-board-card-title${run.title === null ? ' is-none' : ''}`}>{run.title ?? 'No ticket'}</span>
        {reviews.length > 0 && (
          <span className="mx-board-track" role="list" aria-label="Reviews">
            {reviews.map((one) => <StepChip key={one.name} name={reviewShort(one.name)} full={one.name} state={one.state} note={one.note} />)}
          </span>
        )}
        {note !== null && <span className="mx-board-card-note">{note}</span>}
      </button>
    </li>
  )
}

/** One column: its title and count over its cards, or "Nothing here". */
function Column({ column, openKey, onOpen }: { column: BoardColumn; openKey: string | null; onOpen: (key: string) => void }) {
  const count = column.tickets.length
  return (
    <section className={`mx-board-column is-${column.kind}${count === 0 ? ' is-empty' : ''}`} aria-label={column.name}>
      <header className="mx-board-column-head">
        <span className="mx-board-column-name">{column.name}</span>
        <span className="mx-board-column-count">{count}</span>
      </header>
      {count === 0 ? <span className="mx-board-column-empty">Nothing here</span> : (
        <ul className="mx-board-tickets">
          {column.tickets.map((ticket) => <TicketCard key={ticket.run.key} ticket={ticket} open={ticket.run.key === openKey} onOpen={() => { onOpen(ticket.run.key) }} />)}
        </ul>
      )}
    </section>
  )
}

type Props = {
  runs: readonly WorkflowView[]
  /** The session's subagents, which a step's helper label may name. */
  helpers: readonly SubagentView[]
  onOpenHelper: (id: string) => void
  /** Where the session runs, for a run's drawer: the runs report their steps, not their place. */
  where?: RunWhere
  /** The run whose drawer starts open, as the gallery draws it. */
  startOpen?: string
}

/**
 * A session's workflow runs as a board (ADR 0010): one column per step name the workflows reported, in order, each run
 * going in the step it sits in, then "Needs human" and "Done". A run opens in a drawer.
 */
export function WorkBoard({ runs, helpers, onOpenHelper, where, startOpen }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(startOpen ?? null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const board = workBoard(runs)
  const opened = runs.find((run) => run.key === openKey)
  return (
    <div ref={setRoot} className="mx-board" role="region" aria-label="Work">
      <div className="mx-board-bar">
        <span className="mx-board-title">Runs</span>
        <span className="mx-board-summary">{boardSummary(board)}</span>
      </div>
      {runs.every((run) => run.steps.length === 0) ? (
        <p className="mx-board-empty">No steps reported yet.</p>
      ) : (
        <div className="mx-board-columns" style={{ ['--work-columns' as string]: board.columns.length }}>
          {board.columns.map((column) => <Column key={`${column.kind}:${column.name}`} column={column} openKey={openKey} onOpen={setOpenKey} />)}
        </div>
      )}
      <RunDrawer run={opened ?? null} helpers={helpers} onOpenHelper={onOpenHelper} onClose={() => { setOpenKey(null) }} container={root} {...(where === undefined ? {} : { where })} />
    </div>
  )
}
