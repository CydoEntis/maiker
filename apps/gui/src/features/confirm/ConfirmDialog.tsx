import { useEffect, useRef, useState } from 'react'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { canSkip, type ConfirmCopy } from './confirm'
import type { PendingConfirm } from './useConfirm'
import './confirm.css'

type Props = ConfirmCopy & {
  /** `dontAskAgain` is false for a question that does not offer it. */
  onConfirm: (dontAskAgain: boolean) => void
  onCancel: () => void
  /** Draws the "Don't ask again" box. Only a kind with a remembered choice has one. */
  offersDontAskAgain?: boolean
  /** Cancel for a question that opens on its own while the person may be typing, so a stray Enter does nothing. */
  firstFocus?: 'confirm' | 'cancel'
}

/**
 * The app's one confirm dialog. Focus starts on the primary button; Enter presses the focused button, and confirms from
 * the checkbox; Escape or a click outside cancels. Focus goes back to where it was when the dialog closes.
 */
export function ConfirmDialog({ title, body, note, confirmLabel, danger, onConfirm, onCancel, offersDontAskAgain = false, firstFocus = 'confirm' }: Props) {
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const first = firstFocus === 'confirm' ? confirmButton : cancelButton
  useEffect(() => {
    first.current?.focus()
    // The menu or key that opened this may still be handing focus back as it goes; claim it again.
    const timer = window.setTimeout(() => {
      if (document.activeElement !== first.current) first.current?.focus()
    }, 0)
    return () => { window.clearTimeout(timer) }
  }, [first])
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <AlertDialogContent
        className="mx-confirm"
        aria-label={title}
        onDismiss={onCancel}
        onOpenAutoFocus={(event) => { event.preventDefault(); first.current?.focus() }}
        onKeyDown={(event) => {
          // Radix closes on Escape; this keeps the key from reaching whatever is open under the question.
          if (event.key === 'Escape') event.stopPropagation()
          // A button takes its own Enter. From the checkbox, Enter is the answer, not a tick.
          if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
            event.preventDefault()
            onConfirm(dontAskAgain)
          }
        }}
      >
        <AlertDialogTitle asChild><h2>{title}</h2></AlertDialogTitle>
        <AlertDialogDescription asChild><p>{body}</p></AlertDialogDescription>
        {note !== undefined && <p className="mx-confirm-note">{note}</p>}
        <div className="mx-confirm-foot">
          {offersDontAskAgain && (
            <label className="mx-confirm-skip">
              <input type="checkbox" data-bare checked={dontAskAgain} onChange={(event) => { setDontAskAgain(event.target.checked) }} />
              <span>Don’t ask again</span>
            </label>
          )}
          <span className="mx-confirm-fill" />
          <button ref={cancelButton} type="button" className="mx-confirm-cancel" onClick={onCancel}>Cancel</button>
          <button ref={confirmButton} type="button" className={`mx-confirm-ok${danger ? ' is-danger' : ''}`} onClick={() => { onConfirm(dontAskAgain) }}>{confirmLabel}</button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The question a `useConfirm` is asking, if any. Mounted once by whoever owns that confirm. */
export function ConfirmHost({ pending }: { pending: PendingConfirm | null }) {
  if (pending === null) return null
  const { kind, ...copy } = pending.ask
  // Keyed by kind and title so a second question starts with its box unticked.
  return <ConfirmDialog key={`${kind}:${copy.title}`} {...copy} offersDontAskAgain={canSkip(kind)} onConfirm={(dontAskAgain) => { pending.answer(true, dontAskAgain) }} onCancel={() => { pending.answer(false, false) }} />
}
