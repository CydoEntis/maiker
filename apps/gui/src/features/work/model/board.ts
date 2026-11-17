import type { WorkflowStepState } from '@/data/preview'
import { STEP_WORDS, type WorkflowView } from '@/features/workspace/model/workflows'

type Step = WorkflowView['steps'][number]

/** A run on the board: the step it sits in, and that step's place among the run's own. */
export type BoardTicket = { run: WorkflowView; step: Step }

/**
 * What a column holds: the runs sitting in one reported step, every run that needs the person, or every run that
 * finished. The last two are the board's own, so a run waiting on the person or done never hides in a step column.
 */
export type ColumnKind = 'step' | 'needs' | 'done'

/** One column: its name as shown, and the runs in it. */
export type BoardColumn = { kind: ColumnKind; name: string; tickets: BoardTicket[] }

export type Board = {
  columns: BoardColumn[]
  /** Runs going with a step that needs the person. */
  needsCount: number
  /** Runs going that need nobody. */
  workingCount: number
  /** Runs with every step over. */
  doneCount: number
}

/** A run as a whole: what its card's mark and the drawer's word say. */
export type RunState = 'needs' | 'working' | 'waiting' | 'done' | 'failed'

/** A run's word, lower case as it reads beside the key in the drawer. */
export const RUN_WORDS: Record<RunState, string> = { needs: 'needs you', working: 'working', waiting: 'waiting', done: 'done', failed: 'failed' }

/** A step's word, lower case as the board and drawer show it. */
export function stepWord(state: WorkflowStepState): string {
  return STEP_WORDS[state].toLowerCase()
}

/** Steps in hand at once from which a card names them instead of showing one step's note. */
const SEVERAL = 2

/** States a run has moved past: the step is behind it and the ticket sits further on. */
const PASSED_BY: ReadonlySet<WorkflowStepState> = new Set(['passed', 'skipped'])

/** The column every run needing the person sits in, as the 2h design names it. */
export const NEEDS_COLUMN = 'Needs human'

/** The column every finished run sits in. */
export const DONE_COLUMN = 'Done'

/** A step name as a column's title: its first letter capital, as the workflow's lower-case names read on the board. */
function titled(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * The step names of every run, in the order the runs give them. A name one run has and another
 * lacks goes in after the step before it, so two workflows with different steps still read in order.
 */
export function columnNames(runs: readonly WorkflowView[]): string[] {
  const names: string[] = []
  for (const run of runs) {
    let previous = -1
    for (const step of run.steps) {
      let at = names.indexOf(step.name)
      if (at < 0) {
        at = previous + 1
        names.splice(at, 0, step.name)
      }
      previous = at
    }
  }
  return names
}

/** The step a run sits in: its first that has not passed, else its last (a run that finished). */
export function sittingStep(run: WorkflowView): Step | null {
  return run.steps.find((step) => !PASSED_BY.has(step.state)) ?? run.steps.at(-1) ?? null
}

/** A run as a whole, from its steps: what needs the person first, then what is in hand, then how it ended. */
export function runState(run: WorkflowView): RunState {
  if (run.active) {
    if (run.needsYou) return 'needs'
    return run.steps.some((step) => step.state === 'working' || step.state === 'sent_back') ? 'working' : 'waiting'
  }
  return run.steps.some((step) => step.state === 'failed') ? 'failed' : 'done'
}

/**
 * The Work board of a session's workflow runs (ADR 0010): one column per reported step name, each run going in the step
 * it sits in, then a column of the runs that need the person and one of the runs that finished. The step columns are
 * named by every run, finished ones too, so a run finishing never reorders the board. A run that reported no steps
 * has nowhere to sit.
 */
export function workBoard(runs: readonly WorkflowView[]): Board {
  const names = columnNames(runs)
  const steps: BoardColumn[] = names.map((name) => ({ kind: 'step', name: titled(name), tickets: [] }))
  const needs: BoardColumn = { kind: 'needs', name: NEEDS_COLUMN, tickets: [] }
  const done: BoardColumn = { kind: 'done', name: DONE_COLUMN, tickets: [] }
  for (const run of runs) {
    const step = sittingStep(run)
    if (step === null) continue
    if (!run.active) done.tickets.push({ run, step })
    else if (run.needsYou) needs.tickets.push({ run, step: run.current ?? step })
    else steps[names.indexOf(step.name)]?.tickets.push({ run, step })
  }
  // In hand means a step is at work; a run waiting between steps is on the board but is not counted as working.
  const working = runs.filter((run) => runState(run) === 'working').length
  return { columns: [...steps, needs, done], needsCount: needs.tickets.length, workingCount: working, doneCount: done.tickets.length }
}

/** The board's line under its title: what needs the person, what is in hand and what finished, or that nothing runs. */
export function boardSummary(board: Board): string {
  const parts = [
    board.needsCount > 0 ? `${String(board.needsCount)} needs you` : '',
    board.workingCount > 0 ? `${String(board.workingCount)} working` : '',
    board.doneCount > 0 ? `${String(board.doneCount)} done` : '',
  ].filter((part) => part !== '')
  return parts.length === 0 ? 'Nothing running' : parts.join(' · ')
}

/** Whether a step is one of the run's reviews, which its card shows as a track of chips. */
export function isReview(step: Step): boolean {
  return /^review\b/i.test(step.name)
}

/** A review step's name on its chip: without the "review" every one of them starts with. */
export function reviewShort(name: string): string {
  return name.replace(/^review\s+/i, '') || name
}

/**
 * The review steps a card shows as chips: only once the run is past its first step, since before the work is
 * built there is nothing to review yet.
 */
export function reviewTrack(run: WorkflowView): Step[] {
  const first = run.steps[0]
  return first !== undefined && PASSED_BY.has(first.state) ? run.steps.filter(isReview) : []
}

/**
 * A card's line under its title: the note of the step it sits in, else, when several steps are in hand at once,
 * which ones ("review code and review security are working.").
 */
export function cardNote(ticket: BoardTicket): string | null {
  if (ticket.step.note !== null) return ticket.step.note
  const working = ticket.run.steps.filter((step) => step.state === 'working').map((step) => step.name)
  if (working.length < SEVERAL) return null
  return `${working.slice(0, -1).join(', ')} and ${working.at(-1) ?? ''} are working.`
}
