import { useState } from 'react'
import { LOCAL_MACHINE } from '@/api/machines'
import { Button } from '@/components/ui/button'
import type { SecretAsk } from '@/features/workspace/model/session'
import { useSecretAnswer } from '@/features/workspace/useSecretAnswer'
import type { AnswerRow } from '../answerRows'
import { AnswerList } from './AnswerList'
import { WaitingCard } from './WaitingCard'

type SecretChoice = 'provide' | 'decline'

/** Providing only opens the field, so it has a letter like any yes; the value itself is typed and sent from the field. */
const SECRET_ROWS: readonly AnswerRow<SecretChoice>[] = [
  { id: 'provide', label: 'Provide…', key: 'y', hint: 'Type the value; it goes to the Maiker service only' },
  { id: 'decline', label: 'Decline', key: 'n', hint: 'The agent is told no' },
]

type Props = {
  ask: SecretAsk
  /** The machine the session is on; a secret is only taken for this computer's sessions. */
  machine: number
  online: boolean
  /** Who asks, for the head. */
  agent?: string | undefined
}

/**
 * An agent asked for a secret (`maiker_request_secret`), as a needs-you card in the chat's stack. Only the person
 * answers, in the card's password field and never in the conversation (ADR 0006); how the value leaves the window is
 * `useSecretAnswer`'s, which keeps it out of state, logs and toasts.
 */
export function SecretTray({ ask, machine, online, agent }: Props) {
  const [open, setOpen] = useState(false)
  const { field, failure, busy, give, decline } = useSecretAnswer(ask.id, machine, () => { setOpen(false) })
  const here = machine === LOCAL_MACHINE
  return (
    <WaitingCard
      label="Wants a secret"
      title={`Wants a secret: ${ask.label}`}
      aside={agent}
      answers={open ? undefined : <AnswerList label="Answers" rows={SECRET_ROWS} disabled={!online || !here || busy} onPick={(id) => { if (id === 'provide') setOpen(true); else decline() }} />}
    >
      <p className="mx-waiting-text">{ask.reason === '' ? 'It will get a single-use reference, never the value.' : ask.reason}</p>
      {!here && <p className="mx-waiting-note">Secrets are only taken for this computer’s sessions.</p>}
      {failure !== null && <p className="mx-waiting-note" role="alert">{failure}</p>}
      {open && (
        <form className="mx-waiting-secret" onSubmit={(event) => { event.preventDefault(); give() }}>
          <input ref={field} type="password" className="mx-waiting-input" autoComplete="off" spellCheck={false} aria-label={`Value for ${ask.label}`} autoFocus disabled={busy} />
          <Button type="submit" variant="needs" size="sm" disabled={busy || !online}>Give it</Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setOpen(false) }}>Cancel</Button>
        </form>
      )}
    </WaitingCard>
  )
}
