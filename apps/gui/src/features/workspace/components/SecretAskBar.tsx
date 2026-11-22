import { useState } from 'react'
import type { SecretAsk } from '../model/session'
import { useSecretAnswer } from '../useSecretAnswer'

type Props = {
  ask: SecretAsk
  /** The machine the session is on; a secret is only taken for this computer's sessions. */
  machine: number
  online: boolean
}

/**
 * An agent asked for a secret (`maiker_request_secret`), said over the chat of a session shown as one. Only the person
 * answers, here and never in the chat (ADR 0006); how the value is sent is `useSecretAnswer`'s.
 */
export function SecretAskBar({ ask, machine, online }: Props) {
  const [open, setOpen] = useState(false)
  const { field, failure, busy, give, decline } = useSecretAnswer(ask.id, machine, () => { setOpen(false) })
  const stop = (event: { stopPropagation: () => void }) => { event.stopPropagation() }
  return (
    <div className="mx-pane-ended is-ask" role="alert" aria-label="Wants a secret">
      <span className="mx-pane-ended-text">
        <strong>{`Wants a secret: ${ask.label}`}</strong>
        <small title={ask.reason}>{ask.reason === '' ? 'It will get a single-use reference, never the value.' : ask.reason}</small>
        {failure !== null && <small role="alert">{failure}</small>}
      </span>
      {open
        ? (
          <form
            className="mx-secret-form"
            onSubmit={(event) => { event.preventDefault(); give() }}
            onMouseDown={stop}
          >
            <input ref={field} type="password" autoComplete="off" spellCheck={false} aria-label={`Value for ${ask.label}`} autoFocus disabled={busy} />
            <button type="submit" className="mx-pane-ended-button is-primary" disabled={busy || !online}>Give it</button>
            <button type="button" className="mx-pane-ended-button" disabled={busy} onClick={() => { setOpen(false) }}>Cancel</button>
          </form>
        )
        : (
          <>
            <button type="button" className="mx-pane-ended-button is-primary" disabled={!online || machine !== 0} title={machine === 0 ? 'Type the value; it goes to the Maiker service only' : 'Secrets are only taken for this computer’s sessions'} onMouseDown={stop} onClick={() => { setOpen(true) }}>Provide…</button>
            <button type="button" className="mx-pane-ended-button" disabled={!online || machine !== 0} title="The agent is told no" onMouseDown={stop} onClick={decline}>Decline</button>
          </>
        )}
    </div>
  )
}
