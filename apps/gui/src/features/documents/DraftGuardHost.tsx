import { useEffect, useRef, useState } from 'react'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { discardAll, saveAll, useDraftAsk } from './draftGuard'

function nameOf(path: string): string {
  return path.split('/').at(-1) ?? path
}

/**
 * The question asked before a document with unsaved edits goes away: Save, Discard or Keep editing. Mounted once for
 * the window. It opens with Keep editing focused, so a stray Enter loses nothing.
 */
export function DraftGuardHost() {
  const ask = useDraftAsk()
  const [saving, setSaving] = useState(false)
  const keep = useRef<HTMLButtonElement>(null)
  const open = ask !== null
  useEffect(() => {
    if (!open) return undefined
    keep.current?.focus()
    const timer = window.setTimeout(() => { keep.current?.focus() }, 0)
    return () => { window.clearTimeout(timer) }
  }, [open])
  if (ask === null) return null
  const { drafts, answer } = ask
  const one = drafts.length === 1 ? drafts[0] : undefined
  const title = one === undefined ? `Discard changes to ${String(drafts.length)} documents?` : `Discard changes to ${nameOf(one.path)}?`
  const body = one === undefined ? `${drafts.map((draft) => draft.path).join(', ')} have changes that are not saved.` : `${one.path} has changes that are not saved.`
  return (
    <AlertDialog open onOpenChange={(next) => { if (!next && !saving) answer(false) }}>
      <AlertDialogContent
        aria-label={title}
        onOpenAutoFocus={(event) => { event.preventDefault(); keep.current?.focus() }}
        onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation() }}
      >
        <AlertDialogTitle asChild><h2>{title}</h2></AlertDialogTitle>
        <AlertDialogDescription asChild><p>{body}</p></AlertDialogDescription>
        <div className="mx-rename-actions">
          <button ref={keep} type="button" className="mx-confirm-button" disabled={saving} onClick={() => { answer(false) }}>Keep editing</button>
          <button type="button" className="mx-confirm-button is-danger" disabled={saving} onClick={() => { discardAll(drafts); answer(true) }}>Discard</button>
          <button
            type="button"
            className="mx-confirm-button is-primary"
            disabled={saving}
            onClick={() => {
              setSaving(true)
              void saveAll(drafts).then((saved) => { setSaving(false); answer(saved) }, () => { setSaving(false); answer(false) })
            }}
          >{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
