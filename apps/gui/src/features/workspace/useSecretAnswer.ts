import { useRef, useState, type RefObject } from 'react'
import { answerSecret } from '@/api/daemon'
import { messageOf } from '@/features/inspect/useRepoQuery'

/**
 * The one way a secret an agent asked for (`maiker_request_secret`) leaves the window (ADR 0006): from the password
 * field `field` is on, straight to the daemon. The value is read from the field when it is sent and is never put in
 * the window's state, a toast, a log or the clipboard; the field is emptied whether the daemon took it or not, and the
 * agent gets a single-use reference, never the value.
 */
export function useSecretAnswer(askId: number, machine: number, onAnswered: () => void): {
  field: RefObject<HTMLInputElement | null>
  failure: string | null
  busy: boolean
  /** Sends what the field holds; an empty field sends nothing. */
  give: () => void
  /** Tells the agent no. */
  decline: () => void
} {
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const send = (value: string | null) => {
    setBusy(true)
    setFailure(null)
    answerSecret(askId, machine, value)
      .then(onAnswered)
      .catch((error: unknown) => { setFailure(messageOf(error)) })
      .finally(() => {
        // The value never outlives the answer: the field is emptied whether it was taken or not.
        if (field.current) field.current.value = ''
        setBusy(false)
      })
  }
  return {
    field,
    failure,
    busy,
    give: () => { const value = field.current?.value ?? ''; if (value !== '') send(value) },
    decline: () => { send(null) },
  }
}
