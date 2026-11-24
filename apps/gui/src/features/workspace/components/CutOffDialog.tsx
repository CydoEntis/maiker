import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ModalBody, ModalFoot, ModalHead } from '@/components/ui/modal'
import { displayName, type SessionView } from '../model/session'
import { AppIcon } from './glyphs'
import { windowRoot } from './windowRoot'

const TITLE = 'Pick up where you left off'

type Props = {
  /** The sessions a service restart cut mid-reply, on every machine. Never empty while the dialog is shown. */
  sessions: readonly SessionView[]
  /** Continues the ticked sessions; every listed one is then off the list for this window. */
  onContinue: (ticked: readonly SessionView[]) => void
  /** Leaves them all as they are: each still offers itself in its own pane. */
  onNotNow: () => void
}

/**
 * The one question after a restart, and only when a reply was cut: the sessions it stopped mid-reply, all ticked, with
 * Continue and Not now. Sessions that were idle came back by themselves and are not here. A session that joins while the
 * dialog is up (another machine coming back) joins ticked.
 */
export function CutOffDialog({ sessions, onContinue, onNotNow }: Props) {
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set())
  const dialog = useRef<HTMLDivElement>(null)
  const ticked = sessions.filter((session) => !unticked.has(session.id))
  const toggle = (id: string) => {
    setUnticked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }
  const count = sessions.length
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onNotNow() }}>
      <DialogContent unstyled asChild container={windowRoot()} aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); dialog.current?.focus() }}>
        <div
          ref={dialog}
          tabIndex={-1}
          aria-label={TITLE}
          className="mx-rename mx-modal is-compact mx-cutoff"
          onKeyDown={(event) => {
            // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
            if (event.key === 'Escape') event.stopPropagation()
          }}
        >
          <ModalHead title={TITLE} onClose={onNotNow} />
          <ModalBody>
            <p>
              Maiker restarted while {count === 1 ? 'this session was' : `these ${String(count)} sessions were`} replying.
              Continue picks {count === 1 ? 'it' : 'the ticked ones'} up from {count === 1 ? 'its' : 'their'} own record.
            </p>
            <ul className="mx-cutoff-list" aria-label="Sessions cut off mid-reply">
              {sessions.map((session) => (
                <li key={session.id}>
                  <label className="mx-cutoff-row">
                    <input type="checkbox" data-bare checked={!unticked.has(session.id)} onChange={() => { toggle(session.id) }} />
                    <AppIcon process={session.process} size={14} />
                    <span className="mx-cutoff-name">{displayName(session)}</span>
                    <span className="mx-cutoff-where">{session.machineName === null ? session.repoName ?? session.cwdLabel : `${session.repoName ?? session.cwdLabel} · ${session.machineName}`}</span>
                  </label>
                </li>
              ))}
            </ul>
          </ModalBody>
          <ModalFoot left={<Button type="button" variant="ghost" size="lg" onClick={onNotNow}>Not now</Button>}>
            <Button type="button" variant="primary" size="lg" disabled={ticked.length === 0} onClick={() => { onContinue(ticked) }}>
              {ticked.length === count ? (count === 1 ? 'Continue' : 'Continue all') : `Continue ${String(ticked.length)}`}
            </Button>
          </ModalFoot>
        </div>
      </DialogContent>
    </Dialog>
  )
}
