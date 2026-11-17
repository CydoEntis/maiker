import { useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

type Props = {
  title: string
  confirmLabel: string
  /** The confirm button is drawn as a danger button: removing something. */
  danger?: boolean
  /** Runs the confirmed change. Resolves with why it was not done, or null when it was. */
  onConfirm: () => Promise<string | null>
  onCancel: () => void
  children: ReactNode
}

/**
 * Where the page asks before it changes anything. Cancel is where focus starts, Enter does not confirm (only a click on the
 * confirm button does), and a refusal shows why and leaves the dialog open. There is no "always": each change asks.
 */
export function ConfirmDialog({ title, confirmLabel, danger = false, onConfirm, onCancel, children }: Props) {
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const cancel = () => { if (!busy) onCancel() }
  const confirm = () => {
    if (busy) return
    setBusy(true)
    setRefused(null)
    onConfirm().then(
      (why) => {
        // The page closes the dialog when the change is done; only a refusal keeps it.
        if (why !== null) { setRefused(why); setBusy(false) }
      },
      (error: unknown) => { setRefused(error instanceof Error ? error.message : 'The change did not finish'); setBusy(false) },
    )
  }
  return (
    // A change that has started cannot be taken back, so the dialog stays until it has ended.
    <Dialog open onOpenChange={(isOpen) => { if (!isOpen) cancel() }}>
      <DialogContent unstyled asChild aria-describedby={undefined}>
        <div
          aria-label={title}
          className="mx-rename mx-getfile"
          onKeyDown={(event) => {
            // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
            if (event.key === 'Escape') event.stopPropagation()
          }}
        >
          <DialogTitle asChild><h2>{title}</h2></DialogTitle>
          {children}
          {refused !== null && <p role="alert">Not done. {refused}</p>}
          <div className="mx-rename-actions">
            <button type="button" className="mx-text-button" autoFocus disabled={busy} onClick={cancel}>Cancel</button>
            <button type="button" className={`mx-text-button is-primary${danger ? ' is-danger' : ''}`} disabled={busy} onClick={confirm}>{busy ? 'Working…' : confirmLabel}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
