import { useState } from 'react'
import { StatusIcon } from '@/components/ui/status-icon'
import { Icon } from '@/features/workspace/components/glyphs'
import { ElapsedSince } from '@/features/workspace/components/times'
import { isWaitingStep, tookText } from '../stepInfo'
import { workDurationMs, workStatus, workSummary, type WorkStep } from '../workSummary'
import { StepGlyph } from './cardParts'
import { StepView } from './StepCards'

const SUFFIX = { running: '', completed: '', failed: ' · a step failed', interrupted: ', then stopped' } as const
const TIME_TONE = { running: 'is-working', completed: 'is-dim', failed: 'is-danger', interrupted: 'is-dim' } as const
const RUNNING_LIGHT_PX = 12

type WorkCardProps = {
  steps: readonly WorkStep[]
  root: string | null
  openDiff: ((file: string) => void) | null
  /** The id of the step a request is waiting on, when it is one of these. */
  waitingStep: string | null
}

/**
 * A run of steps, folded to one row: what it did ("Read 6 files, ran 1 command"), how many steps that was, and a
 * chevron. Opening it lists the steps, each a row that opens to its own detail, and only one of them is open at a time.
 * A failed run stays folded too (its line says a step failed); only a run with a step a request waits on starts open, so
 * that step is never folded away.
 */
export function WorkCard({ steps, root, openDiff, waitingStep }: WorkCardProps) {
  const status = workStatus(steps)
  const waiting = steps.some((step) => isWaitingStep(waitingStep, step.id))
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? waiting
  const [openStep, setOpenStep] = useState<string | null>(null)
  const took = workDurationMs(steps)
  const first = steps[0]
  return (
    <div className="mx-work" data-fold="" role="group" aria-label={`${workSummary(steps)}, ${String(steps.length)} steps`}>
      <button type="button" className="mx-work-head" aria-expanded={open} onClick={() => { setChosen(!open) }}>
        {status === 'completed'
          ? <span className="mx-work-mark" aria-hidden="true">✱</span>
          : status === 'running' ? <StatusIcon status="working" size={RUNNING_LIGHT_PX} /> : <StepGlyph status={status} />}
        <span className="mx-work-text" title={`${workSummary(steps)}${SUFFIX[status]}`}>{workSummary(steps)}{SUFFIX[status]}</span>
        <span className="mx-work-count">{steps.length} {steps.length === 1 ? 'step' : 'steps'}</span>
        {status === 'running' && first !== undefined
          ? <span className={`mx-step-meta ${TIME_TONE.running}`}><ElapsedSince since={first.timing.startedAtMs ?? first.observed.firstSeenAtMs} /></span>
          : took !== null && <span className={`mx-step-meta ${TIME_TONE[status]}`}>{tookText(took)}</span>}
        <span className="mx-spacer" />
        <span className={`mx-caret-wrap${open ? ' is-open' : ''}`}><Icon name="caret" /></span>
      </button>
      {open && (
        <div className="mx-work-steps">
          {steps.map((step) => (
            <div key={step.id} className={step.status === 'failed' ? 'mx-work-failed' : undefined}>
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
