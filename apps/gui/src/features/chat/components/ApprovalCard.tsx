import type { ApprovalDecision, ApprovalEvent, ItemStatus } from '../chatEvents'
import type { StepRef } from '../chatRows'
import { StepGlyph } from './cardParts'

/** What answering an approval needs from the chat; `null` while the answer cannot be sent from here. */
export type ApprovalActions = {
  answer: (requestId: number | string, decision: ApprovalDecision) => void
  /** Answers a user-input request's questions, one list of answers per question id. */
  answerInput: (requestId: number | string, answers: Record<string, string[]>) => void
  /** Approves a command request and has the daemon remember it for the project; absent where it cannot. */
  remember?: (requestId: number | string) => void
  /** An answer is on its way. */
  busy: boolean
}

/** How a request reads as one line of the conversation, and the mark it carries. */
const ANSWERED: Record<ApprovalDecision | 'unknown' | 'pending', { word: string; status: ItemStatus }> = {
  Accept: { word: 'Allowed', status: 'completed' },
  AcceptForSession: { word: 'Allowed for this session', status: 'completed' },
  Decline: { word: 'Denied', status: 'failed' },
  Cancel: { word: 'Cancelled', status: 'interrupted' },
  unknown: { word: 'Answered', status: 'interrupted' },
  pending: { word: 'Waiting for an answer', status: 'running' },
}

const TITLE: Record<ApprovalEvent['approvalKind'], string> = {
  Command: 'Wants to run a command',
  FileChange: 'Wants to change files',
  Permission: 'Is requesting additional permissions',
  UserInput: 'Needs your input',
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

type Props = {
  event: ApprovalEvent
  /** The tool step this request is about, when the provider named it. */
  step: StepRef | null
  onGoToStep: ((key: string) => void) | null
}

/**
 * A request as a line of the conversation: what was chosen, once it is answered here or anywhere else (the daemon
 * keeps the choice). It never asks: a pending request is the needs-you card over the message box (`ApprovalTray`), so
 * where one shows as a row (a helper's own chat) the line only says it waits.
 */
export function ApprovalCard({ event, step, onGoToStep }: Props) {
  const detail = event.command ?? event.changes.map((change) => change.path).join('\n')
  // A question's answer is not a permission, so it is never said to be allowed or denied.
  const said = event.resolution.status === 'pending' ? ANSWERED.pending : event.approvalKind === 'UserInput' ? ANSWERED.unknown : ANSWERED[event.resolution.answer]
  return (
    <div role="group" aria-label={`Approval: ${TITLE[event.approvalKind]}`} className="mx-answered">
      <StepGlyph status={said.status} />
      <strong>{said.word}</strong>
      {detail !== '' && <span className="mx-answered-detail">{detail.split(/\r?\n/)[0]}</span>}
      <span className="mx-spacer" />
      {step !== null && onGoToStep !== null && <button type="button" className="mx-answered-step" aria-label={`Go to the step this is about: ${step.label}`} onClick={() => { onGoToStep(step.key) }}>Go to step ↑</button>}
      {event.resolution.status === 'answered' && event.resolution.answeredAtMs != null && <span className="mx-step-meta is-dim">{clock(event.resolution.answeredAtMs)}</span>}
    </div>
  )
}
