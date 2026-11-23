import { useRef, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ModalBody, ModalFoot, ModalHead } from '@/components/ui/modal'
import { LOCAL_MACHINE } from '@/api/machines'
import { helpersRequestWords } from '../model/outsideAsks'
import type { SecretAsk } from '../model/session'
import { useSecretAnswer } from '../useSecretAnswer'

/** Who asks: the session by the name its row has, and its project. */
type Asker = { name: string; project: string }

export type HelpersChoice = 'allow' | 'always' | 'no'

// Radix closes on Escape; this keeps the key from reaching the app's own handlers.
const keepEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') event.stopPropagation() }

/**
 * A terminal session's request to start helpers, answered outside its pane (ADR 0016: only a person answers). The three
 * answers are the daemon's: this session, every session of the project, or none. Closing it answers nothing, and the
 * session keeps waiting.
 */
export function HelpersRequestDialog({ asker, tasks, online, onAnswer, onCancel }: {
  asker: Asker
  tasks: readonly string[]
  online: boolean
  onAnswer: (choice: HelpersChoice) => void
  onCancel: () => void
}) {
  const allow = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled asChild aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); allow.current?.focus() }}>
        <div className="mx-rename mx-modal is-compact mx-outside-ask" onKeyDown={keepEscape}>
          <ModalHead title={helpersRequestWords(tasks.length)} onClose={onCancel} />
          <ModalBody>
          <p>{`${asker.name} in ${asker.project} asks to start other agents for these tasks.`}</p>
          <ul className="mx-outside-ask-tasks" aria-label="Tasks">
            {tasks.map((task, index) => <li key={`${String(index)}:${task}`}>{task}</li>)}
          </ul>
          </ModalBody>
          <ModalFoot>
            <Button type="button" variant="ghost" size="lg" disabled={!online} title="Every session of this project may, from now on" onClick={() => { onAnswer('always') }}>Always for this project</Button>
            <Button type="button" variant="ghost" size="lg" disabled={!online} title="It does the work alone" onClick={() => { onAnswer('no') }}>No, do it yourself</Button>
            <Button ref={allow} type="button" variant="primary" size="lg" disabled={!online} title="This session may start helpers from now on" onClick={() => { onAnswer('allow') }}>Allow</Button>
          </ModalFoot>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The secret a terminal session's agent asked for (`maiker_request_secret`), typed outside its pane and never into the
 * terminal or a chat (ADR 0006). It says who asks and for what; how the value is sent is `useSecretAnswer`'s. Closing it
 * answers nothing, and the request keeps waiting.
 */
export function SecretDialog({ asker, ask, machine, online, onDone }: {
  asker: Asker
  ask: SecretAsk
  /** The machine the session is on; a secret is only taken for this computer's sessions. */
  machine: number
  online: boolean
  /** The daemon took the answer, or the person closed the dialog without one. */
  onDone: () => void
}) {
  const { field, failure, busy, give, decline } = useSecretAnswer(ask.id, machine, onDone)
  const here = machine === LOCAL_MACHINE
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone() }}>
      <DialogContent unstyled asChild aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); field.current?.focus() }}>
        <form className="mx-rename mx-modal is-compact mx-outside-ask" onKeyDown={keepEscape} onSubmit={(event) => { event.preventDefault(); give() }}>
          <ModalHead title={`Wants a secret: ${ask.label}`} onClose={onDone} />
          <ModalBody>
          <p>{`${asker.name} in ${asker.project} asks for it.`}{ask.reason === '' ? '' : ` ${ask.reason}`}</p>
          <p>{here ? 'The value goes to the Maiker service only. The agent gets a single-use reference, never the value.' : 'Secrets are only taken for this computer’s sessions.'}</p>
          <input ref={field} type="password" autoComplete="off" spellCheck={false} aria-label={`Value for ${ask.label}`} disabled={busy || !here} />
          {failure !== null && <p className="mx-rm-error" role="alert">{failure}</p>}
          </ModalBody>
          <ModalFoot>
            <Button type="button" variant="ghost" size="lg" disabled={busy} onClick={onDone}>Cancel</Button>
            <Button type="button" variant="ghost" size="lg" disabled={busy || !online || !here} title="The agent is told no" onClick={decline}>Decline</Button>
            <Button type="submit" variant="primary" size="lg" disabled={busy || !online || !here}>Give it</Button>
          </ModalFoot>
        </form>
      </DialogContent>
    </Dialog>
  )
}
