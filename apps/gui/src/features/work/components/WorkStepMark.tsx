import type { WorkflowStepState } from '@/data/preview'
import { StatusMark, type MarkState } from '@/components/ui/status-mark'
import { Spinner } from '@/features/workspace/components/glyphs'
import { STEP_WORDS } from '@/features/workspace/model/workflows'
import { stepWord, type RunState } from '../model/board'

/** The step states the shared StatusMark draws. */
const MARK: Partial<Record<WorkflowStepState, MarkState>> = { waiting: 'waiting', working: 'running', passed: 'done', failed: 'failed', needs_you: 'needs' }

/** The states it lacks keep a shape of their own, so none reads by colour alone. */
const GLYPH: Partial<Record<WorkflowStepState, string>> = { sent_back: '↺', skipped: '–', unknown: '?' }

/** A workflow step's 14px mark, named by the state's word. */
export function WorkStepMark({ state }: { state: WorkflowStepState }) {
  const mark = MARK[state]
  if (mark !== undefined) return <StatusMark state={mark} spinner={<Spinner />} />
  return <span role="img" aria-label={STEP_WORDS[state]} className={`mx-board-glyph is-${state}`}>{GLYPH[state]}</span>
}

/** A run as a whole drawn with the step mark of the same meaning. */
const RUN_MARK: Record<RunState, WorkflowStepState> = { needs: 'needs_you', working: 'working', waiting: 'waiting', done: 'passed', failed: 'failed' }

/** A run's 14px mark on its card. */
export function RunMark({ state }: { state: RunState }) {
  return <WorkStepMark state={RUN_MARK[state]} />
}

/** The glyph a chip or a strip node carries for the states its colour alone would not tell. */
const CHIP_GLYPH: Partial<Record<WorkflowStepState, string>> = { passed: '✓', failed: '✕', sent_back: '↺', needs_you: '!', skipped: '–', unknown: '?' }

/**
 * One review step as a chip on a card: its short name in its state's colour, with a spinner while it works and a
 * glyph when it failed, was sent back or needs the person.
 */
export function StepChip({ name, full, state, note }: { name: string; full: string; state: WorkflowStepState; note: string | null }) {
  const glyph = state === 'failed' || state === 'sent_back' || state === 'needs_you' ? CHIP_GLYPH[state] : undefined
  return (
    <span role="listitem" className={`mx-board-chip is-${state}`} title={`${full}: ${stepWord(state)}${note === null ? '' : ` · ${note}`}`}>
      {state === 'working' && <span className="mx-board-chip-spin" aria-hidden="true" />}
      {glyph !== undefined && <span aria-hidden="true">{glyph}</span>}
      {name}
    </span>
  )
}

/** One node of the drawer's step strip: a 20px square in the step's colour, its glyph or spinner inside. */
export function StripNode({ state }: { state: WorkflowStepState }) {
  return (
    <span className={`mx-board-node is-${state}`} aria-hidden="true">
      {state === 'working' ? <span className="mx-board-node-spin" /> : CHIP_GLYPH[state]}
    </span>
  )
}
