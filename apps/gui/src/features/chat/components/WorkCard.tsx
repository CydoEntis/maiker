import { useState } from 'react'
import { useRevealOpen } from '../chatActions'
import { StatusIcon } from '@/components/ui/status-icon'
import { Icon } from '@/features/workspace/components/glyphs'
import { isWaitingStep } from '../stepInfo'
import { summaryCountsEverything, workStatus, workSummary, type WorkStep } from '../workSummary'
import { StepView } from './StepCards'

const SUFFIX = { running: '', completed: '', failed: ', a step failed', interrupted: ', then stopped' } as const
const RUNNING_LIGHT_PX = 12

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
 * A run of steps, folded to one row: what it did ("Read 6 files, ran 1 command"), how many steps that was, and a
 * chevron. Opening it lists the steps, each a row that opens to its own detail, and only one of them is open at a time.
 * A failed run stays folded too (its row wears a red edge and the word "failed", and the step itself shows a red ×); only a run with a step a request waits on starts open, so
 * that step is never folded away.
 */
export function WorkCard({ steps, root, openDiff, waitingStep, rowKey }: WorkCardProps) {
  const status = workStatus(steps)
  const waiting = steps.some((step) => isWaitingStep(waitingStep, step.id))
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? waiting
  useRevealOpen(rowKey, () => { setChosen(true) })
  const [openStep, setOpenStep] = useState<string | null>(null)
  const failed = status === 'failed'
  return (
    <div className={`mx-work${failed ? ' is-failed' : ''}`} data-fold="" role="group" aria-label={`${workSummary(steps)}${SUFFIX[status]}, ${String(steps.length)} steps`}>
      <button type="button" className="mx-work-head" aria-expanded={open} onClick={() => { setChosen(!open) }}>
        {status === 'running'
          ? <StatusIcon status="working" size={RUNNING_LIGHT_PX} />
          : <span className="mx-work-mark" aria-hidden="true">✱</span>}
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
