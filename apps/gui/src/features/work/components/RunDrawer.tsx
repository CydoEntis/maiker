import { useState } from 'react'
import { Popover } from 'radix-ui'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { PopupContent } from '@/components/ui/popup'
import { ago } from '@/features/inspect/format'
import { Icon } from '@/features/workspace/components/glyphs'
import type { SubagentView } from '@/features/workspace/model/subagents'
import { namesHelper, type WorkflowView } from '@/features/workspace/model/workflows'
import { followLink } from '@/features/chat/followLink'
import { RUN_WORDS, runState, stepWord } from '../model/board'
import { StripNode, WorkStepMark } from './WorkStepMark'

const SECOND_MS = 1000

/** Only a web address is offered as the ticket's link; the host refuses anything else anyway. */
const WEB_ADDRESS = /^https?:\/\//i

/** Where the session whose runs these are lives: what the drawer's meta line names. */
export type RunWhere = {
  /** "This computer", or the machine's name. */
  machine: string
  /** The session runs on another machine, whose helpers show their task and result only. */
  remote: boolean
  project: string | null
  branch: string | null
}

type Step = WorkflowView['steps'][number]

/**
 * A step's helper label under its note, and the read-only card it opens: what the label names, the step's word, what
 * the helper was asked, what it is doing or reported, and a way to its chat. Nothing in it changes the helper.
 */
function HelperCard({ label, step, helper, remote, machine, onOpenHelper }: {
  label: string
  step: Step
  helper: SubagentView | undefined
  remote: boolean
  machine: string
  onOpenHelper: (id: string) => void
}) {
  const latest = helper?.result === null && !remote ? helper.latest : null
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="mx-board-helper" aria-label={`Helper ${label}`}>{label} ›</button>
      </Popover.Trigger>
      <PopupContent side="bottom" align="start" className="mx-board-helper-card" aria-label={`Helper ${label}`}>
        <span className="mx-board-helper-top">
          <span className="mx-board-helper-label">{label}</span>
          <span className={`mx-board-helper-word is-${step.state}`}>{stepWord(step.state)}</span>
        </span>
        {helper === undefined ? (
          <p className="mx-board-helper-quiet">No subagent of this session goes by this name.</p>
        ) : (
          <>
            {helper.task !== null && <p>{helper.task}</p>}
            {latest !== null && <span className="mx-board-helper-part"><span className="mx-board-helper-head">Latest</span><code>{latest}</code></span>}
            {helper.result !== null && <span className="mx-board-helper-part"><span className="mx-board-helper-head">Result</span><p>{helper.result}</p></span>}
            <div><Button variant="soft" size="sm" onClick={() => { onOpenHelper(helper.id) }}>Open its chat</Button></div>
          </>
        )}
        <span className="mx-board-helper-foot">
          {remote ? `Runs on ${machine}. Helpers on other machines show their task and result only. ` : 'Read-only. '}
          To change anything, ask in the main chat.
        </span>
      </PopupContent>
    </Popover.Root>
  )
}

/** The run's steps left to right: a node per step, joined by a line that fills as each step passes. */
function StepStrip({ steps }: { steps: readonly Step[] }) {
  const passed = (step: Step | undefined) => step?.state === 'passed' || step?.state === 'skipped'
  return (
    <div className="mx-board-strip" role="img" aria-label={`Steps: ${steps.map((step) => `${step.name} ${stepWord(step.state)}`).join(', ')}`}>
      {steps.map((step, at) => (
        <span key={step.name} className={`mx-board-strip-step is-${step.state}`}>
          <span className="mx-board-strip-rail">
            {at > 0 && <span className={`mx-board-strip-line is-before${passed(steps[at - 1]) ? ' is-filled' : ''}`} />}
            {at < steps.length - 1 && <span className={`mx-board-strip-line is-after${passed(step) ? ' is-filled' : ''}`} />}
            <StripNode state={step.state} />
          </span>
          <span className="mx-board-strip-name">{step.name}</span>
        </span>
      ))}
    </div>
  )
}

type Props = {
  /** The run shown, or null while the drawer is closed. */
  run: WorkflowView | null
  helpers: readonly SubagentView[]
  onOpenHelper: (id: string) => void
  onClose: () => void
  /** Where the session lives, for the meta line. */
  where?: RunWhere
  /** The board it covers: the drawer and its dim mount there, so they cover the pane and not the window. */
  container: HTMLElement | null
}

/**
 * One run, in a drawer at the board's right over the dimmed board (ADR 0010): its key and word, title and where it
 * runs, its steps as a strip, then every step with its mark, name, word, note and helper, as the workflow reported
 * them. Escape, the Work crumb, the close button or a click outside closes it.
 */
export function RunDrawer({ run, helpers, onOpenHelper, onClose, where, container }: Props) {
  // Read once a drawer opens: the meta line is a still picture of when the run last reported, not a clock.
  const [now] = useState(() => Math.floor(Date.now() / SECOND_MS))
  const link = run?.link !== null && run?.link !== undefined && WEB_ADDRESS.test(run.link) ? run.link : null
  const state = run === null ? null : runState(run)
  const meta = run === null ? '' : [
    `Updated ${ago(run.reportedAt, now)}`,
    where?.machine,
    where?.project ?? undefined,
    where?.branch === null || where?.branch === undefined ? undefined : `⑂ ${where.branch}`,
  ].filter((part) => part !== undefined).join(' · ')
  return (
    <Dialog open={run !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent unstyled container={container} overlayClassName="mx-board-dim" className="mx-board-drawer" aria-label={run === null ? undefined : `Run ${run.label}`} aria-describedby={undefined}>
        {run !== null && state !== null && (
          <>
            <header className="mx-board-drawer-head">
              <nav className="mx-board-crumbs" aria-label="Breadcrumb">
                <button type="button" className="mx-board-crumb" onClick={onClose}>Work</button>
                <span className="mx-board-crumb-gap" aria-hidden="true">›</span>
                <strong>{run.label}</strong>
              </nav>
              <span className="mx-spacer" />
              {link !== null && <button type="button" className="mx-board-ticket-link" onClick={() => { followLink(link) }}>Open ticket ↗</button>}
              <IconButton label="Close details" onClick={onClose}><Icon name="close" /></IconButton>
            </header>
            <div className="mx-board-drawer-body">
              <div className="mx-board-summary-block">
                <span className="mx-board-summary-top">
                  <span className="mx-board-summary-key">{run.label}</span>
                  <span className={`mx-board-run-word is-${state}`}>{RUN_WORDS[state]}</span>
                </span>
                {run.title !== null && <h3 className="mx-board-drawer-title">{run.title}</h3>}
                <span className="mx-board-meta">{meta}</span>
              </div>
              {run.steps.length > 0 && <StepStrip steps={run.steps} />}
              <ol className="mx-board-steps" aria-label="Steps">
                {run.steps.map((step) => {
                  const label = step.helper
                  const helper = label === null ? undefined : helpers.find((child) => namesHelper(label, child))
                  return (
                    <li key={step.name} className={`mx-board-step is-${step.state}`} aria-current={step === run.current ? 'step' : undefined}>
                      <WorkStepMark state={step.state} />
                      <span className="mx-board-step-text">
                        <span className="mx-board-step-line">
                          <span className="mx-board-step-name">{step.name}</span>
                          <span className="mx-board-step-word">{stepWord(step.state)}</span>
                        </span>
                        {step.note !== null && <span className="mx-board-step-note">{step.note}</span>}
                        {label !== null && <HelperCard label={label} step={step} helper={helper} remote={where?.remote === true} machine={where?.machine ?? ''} onOpenHelper={onOpenHelper} />}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
