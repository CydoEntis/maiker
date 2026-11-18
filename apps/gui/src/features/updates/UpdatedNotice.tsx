import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { APP_NAME } from '@/brand'
import { toast, useToasts } from '@/lib/toast'
import { noteLines } from './noteLines'
import type { RestartedUpdate } from './updateMemory'

const UPDATED_TOAST_ID = 'app-updated'

type Props = {
  update: RestartedUpdate
  /** Called once the toast is gone and the dialog, if it was opened, is closed. */
  onDone: () => void
}

/** After a restart into an update: a success toast with a way into What's new, and that dialog. */
export function UpdatedNotice({ update, onDone }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const lines = noteLines(update.notes)
  const shown = useToasts().items.some((item) => item.id === UPDATED_TOAST_ID)
  // Done is when the toast has been up and gone, and the dialog is not open: not before the toast first shows.
  const seen = useRef(false)

  useEffect(() => {
    toast.success(`Updated to ${update.version}`, { id: UPDATED_TOAST_ID, action: { label: 'What’s new', onClick: (event) => { event.preventDefault(); setDialogOpen(true) } } })
  }, [update.version])

  // The toast goes once the dialog is open, so the two are never both gone before you have read the notes.
  useEffect(() => { if (dialogOpen) toast.dismiss(UPDATED_TOAST_ID) }, [dialogOpen])

  useEffect(() => {
    if (shown) seen.current = true
    else if (seen.current && !dialogOpen) onDone()
  }, [shown, dialogOpen, onDone])

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>What’s new in {APP_NAME} {update.version}</DialogTitle>
          <DialogDescription>{update.previous ? `Updated from ${update.previous}.` : `${APP_NAME} is up to date.`}</DialogDescription>
        </DialogHeader>
        {lines.length > 0 && <ul className="m-0 grid list-disc gap-1.5 pl-5 text-[13px] text-[var(--fg2)]">{lines.map((line) => <li key={line}>{line}</li>)}</ul>}
        <p className="m-0 text-[12px] text-[var(--muted)]">{update.automatic ? 'Installed while nothing was running. No session was interrupted.' : 'No session was interrupted.'}</p>
      </DialogContent>
    </Dialog>
  )
}
