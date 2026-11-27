import { useState } from 'react'
import { useRevealOpen } from '../chatActions'
import { Icon } from '@/features/workspace/components/glyphs'
import { isWaitingStep } from '../stepInfo'
import { summaryCountsEverything, workStatus, workSummary, type WorkStep } from '../workSummary'
import { StepView } from './StepCards'
import { StepGlyph } from './cardParts'

const SUFFIX = { running: '', completed: '', failed: ', a step failed', interrupted: ', then stopped' } as const

type WorkCardProps = {
  steps: readonly WorkStep[]
  root: string | null
  openDiff: ((file: string) => void) | null
  /** The id of the step a request is waiting on, when it is one of these. */
  waitingStep: string | null
  /** The row this is, so a jump to words inside it can open it. */
  rowKey?: string | undefined
}

/**
 * A run of steps under one quiet line (design: "✓ Read 5 files, searched twice · 7 steps ›"): its mark, what it did, how many steps that was, and a
 * chevron. It starts open, listing the steps, each a row that opens to its own detail (one at a time), so what the agent is doing never folds out of
 * sight while it works; the line folds it for whoever wants it shorter.
 */
export function WorkCard({ steps, root, openDiff, waitingStep, rowKey }: WorkCardProps) {
  const status = workStatus(steps)
  const [open, setOpen] = useState(true)
  useRevealOpen(rowKey, () => { setOpen(true) })
  const [openStep, setOpenStep] = useState<string | null>(null)
  const failed = status === 'failed'
  return (
    <div className="mx-work" data-fold="" role="group" aria-label={`${workSummary(steps)}${SUFFIX[status]}, ${String(steps.length)} steps`}>
      <button type="button" className="mx-work-head" aria-expanded={open} onClick={() => { setOpen(!open) }}>
        <StepGlyph status={status} />
        <span className="mx-work-text">{workSummary(steps)}{status === 'interrupted' && ', then stopped'}</span>
        {!summaryCountsEverything(steps) && <span className="mx-work-count">{steps.length} {steps.length === 1 ? 'step' : 'steps'}</span>}
        {failed && <span className="mx-work-failed-note">failed</span>}
        <span className="mx-spacer" />
        <span className={`mx-caret-wrap${open ? ' is-open' : ''}`}><Icon name="caret" /></span>
      </button>
      {open && (
        <div className="mx-work-steps">
          {steps.map((step) => (
            <div key={step.id}>
              <StepView
                event={step}
                root={root}
                openDiff={openDiff}
                waiting={isWaitingStep(waitingStep, step.id)}
                control={{ open: openStep === step.id, toggle: () => { setOpenStep(openStep === step.id ? null : step.id) } }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
