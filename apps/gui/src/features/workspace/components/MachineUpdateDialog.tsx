import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ModalBody, ModalFoot, ModalHead } from '@/components/ui/modal'
import { useEffect, useRef, useState } from 'react'
import type { MachineActivity } from '@/api/machines'
import { installNote, UPDATE_WORDS, updateVerb, updateWarning, type UpdateAction } from '../model/machines'

type Props = {
  name: string
  action: UpdateAction
  /** What is open on the machine; null when it cannot say. Only asked before an update. */
  checkActivity: (name: string) => Promise<MachineActivity | null>
  onUpdate: (whenIdle: boolean) => void
  onCancel: () => void
}

type Asked = { done: false } | { done: true; activity: MachineActivity | null }

/** What is open on the machine, asked once; an install has no daemon there to ask. */
function useActivity(name: string, action: UpdateAction, checkActivity: Props['checkActivity']): Asked {
  const [asked, setAsked] = useState<Asked>(action === 'install' ? { done: true, activity: null } : { done: false })
  useEffect(() => {
    if (action === 'install') return
    let live = true
    void checkActivity(name)
      .catch(() => null)
      .then((activity) => { if (live) setAsked({ done: true, activity }) })
    return () => { live = false }
  }, [name, action, checkActivity])
  return asked
}

/** Takes the keys when it opens, so Esc cancels at once. */
function useFocusOnOpen(dialog: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    dialog.current?.focus()
    // The right-click menu that opened this is still closing, and its focus trap takes focus back as
    // it goes; claim it again once it has finished.
    const timer = window.setTimeout(() => {
      if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus()
    }, 0)
    return () => { window.clearTimeout(timer) }
  }, [dialog])
}

/**
 * The question before the sidebar installs or updates the app on a machine: what an update
 * interrupts there (the same words as Settings › Machines), and now or once it is idle.
 */
export function MachineUpdateDialog({ name, action, checkActivity, onUpdate, onCancel }: Props) {
  const words = UPDATE_WORDS[action]
  const asked = useActivity(name, action, checkActivity)
  const verb = updateVerb(action, asked.done ? asked.activity : null)
  const title = `${verb} Maiker on ${name}`
  const dialog = useRef<HTMLDivElement>(null)
  useFocusOnOpen(dialog)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled asChild aria-describedby={undefined}>
      <div
        ref={dialog}
        tabIndex={-1}
        aria-label={title}
        className="mx-rename mx-modal is-compact"
        onKeyDown={(event) => {
          // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
          if (event.key === 'Escape') event.stopPropagation()
        }}
      >
        <ModalHead title={title} onClose={onCancel} />
        <ModalBody>
          <p className="mx-modal-lead">{words.need(name)}</p>
          {asked.done
            ? <p className="mx-modal-note">{action === 'install' ? installNote(name) : updateWarning(name, asked.activity)}</p>
            : <p className="mx-modal-note" role="status">Checking what is open on {name}…</p>}
        </ModalBody>
        <ModalFoot left={<Button variant="ghost" size="lg" onClick={onCancel}>Cancel</Button>}>
          {action === 'update' && <Button variant="ghost" size="lg" disabled={!asked.done} onClick={() => { onUpdate(true) }}>{verb} when idle</Button>}
          <Button variant="primary" size="xl" disabled={!asked.done} onClick={() => { onUpdate(false) }}>{verb} now</Button>
        </ModalFoot>
      </div>
      </DialogContent>
    </Dialog>
  )
}
