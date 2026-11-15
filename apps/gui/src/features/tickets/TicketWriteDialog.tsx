import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { commentProblem, TICKET_COMMENT_MAX_CHARS, trimmedComment, type TicketFailure, type TicketSummary, type TicketWrite } from '@/api/tickets'
import { PROVIDER_LOOK, ticketKey, type Provider } from './model/tickets'

/** What a write that did not happen says, in the words the dialog shows. Nothing was written. */
export function writeFailureWords(failure: TicketFailure, provider: Provider): string {
  const name = PROVIDER_LOOK[provider].name
  switch (failure.kind) {
    case 'no-key': return `Add your ${name} key in Settings first.`
    case 'signed-out': return provider === 'github' ? 'GitHub is not signed in. Run gh auth login in a terminal.' : `${name} refused the key, so nothing was written.`
    case 'not-found': return `${name} has no such ticket, or this key cannot see it.`
    case 'rate-limited': return `${name} says too many requests. Try again in a minute.`
    case 'unreachable': return failure.line
    case 'invalid': return failure.line
  }
}

type Props = {
  container: HTMLElement | null
  provider: Provider
  ticket: TicketSummary
  /** A comment starts by asking for the words; closing goes straight to the review. */
  kind: 'comment' | 'close'
  /** Sends the confirmed write. Resolves with why it was not written, or null when it was. */
  onConfirm: (write: TicketWrite) => Promise<string | null>
  onCancel: () => void
}

/**
 * The one way the window changes a ticket. A comment is typed, then reviewed; closing is only reviewed. The review shows
 * the provider, the ticket and **exactly what will be written**, and nothing is sent until its button is clicked
 * (Enter does not confirm). A refusal shows why and leaves the ticket as it was; Maitty never edits or deletes one.
 */
export function TicketWriteDialog({ container, provider, ticket, kind, onConfirm, onCancel }: Props) {
  const [draft, setDraft] = useState('')
  const [reviewing, setReviewing] = useState(kind === 'close')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const look = PROVIDER_LOOK[provider]
  const key = ticketKey(ticket)
  const problem = commentProblem(draft)
  const text = trimmedComment(draft)
  const write: TicketWrite = kind === 'close' ? { kind: 'close' } : { kind: 'comment', text }
  const title = kind === 'close' ? `Mark ${key} done` : `Comment on ${key}`
  const cancel = () => { if (!busy) onCancel() }
  const confirm = () => {
    if (busy) return
    setBusy(true)
    setRefused(null)
    void onConfirm(write).then((why) => {
      if (why === null) return
      setRefused(why)
      setBusy(false)
    })
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) cancel() }}>
      <DialogContent unstyled container={container} overlayClassName="mx-tk-scrim" className="mx-tk-dialog" aria-describedby={undefined}>
        <div className="mx-tk-dialog-head"><DialogTitle className="mx-tk-dialog-title">{title}</DialogTitle><span className="mx-spacer" /><button type="button" className="mx-tk-x" aria-label="Cancel (Esc)" onClick={cancel}>✕</button></div>
        <div className="mx-tk-dialog-body">
          {!reviewing ? (
            <div className="mx-tk-sent">
              <label className="mx-tk-section-head" htmlFor="mx-tk-comment">Your comment</label>
              <textarea id="mx-tk-comment" className="mx-tk-compose" rows={7} value={draft} autoFocus onChange={(event) => { setDraft(event.target.value) }} />
              <span className={`mx-tk-note${draft !== '' && problem !== null ? ' mx-tk-danger' : ''}`}>
                {draft !== '' && problem !== null ? problem : `${String([...text].length)} of ${String(TICKET_COMMENT_MAX_CHARS)} characters. You review it before anything is posted.`}
              </span>
            </div>
          ) : (
            <>
              <div className="mx-tk-form">
                <span className="mx-tk-dim">Where</span>
                <span>{look.name}</span>
                <span className="mx-tk-dim">Ticket</span>
                <span><b className="mx-tk-mono">{key}</b> {ticket.title}</span>
                <span className="mx-tk-dim">Change</span>
                <span>{kind === 'close' ? 'Mark it done (close it)' : 'Add a comment'}</span>
              </div>
              <div className="mx-tk-sent">
                <span className="mx-tk-section-head">Exactly what will be written</span>
                <div className="mx-tk-sent-box">
                  <div className="mx-tk-sent-quote">
                    <div className="mx-tk-sent-quote-text">{kind === 'close' ? `Close ${key} on ${look.name}. It moves to its finished state; its words and comments stay as they are.` : text}</div>
                  </div>
                </div>
                <span className="mx-tk-note">Nothing is written until you confirm. Maitty only adds a comment or marks a ticket done, and never edits or deletes one.</span>
              </div>
            </>
          )}
          {refused !== null && <div role="alert" className="mx-tk-alert"><span className="mx-tk-glyph mx-tk-danger">✕</span><span><b>Not written.</b> {refused}</span></div>}
        </div>
        <div className="mx-tk-dialog-foot">
          {reviewing && kind === 'comment' && <button type="button" className="mx-tk-button" disabled={busy} onClick={() => { setReviewing(false); setRefused(null) }}>Back</button>}
          <button type="button" className="mx-tk-button" disabled={busy} onClick={cancel}>Cancel <kbd>Esc</kbd></button>
          {/* Separate keys, so the button that was just clicked to review is not the one a held Enter then confirms. */}
          {!reviewing ? (
            <button key="review" type="button" className="mx-tk-button is-primary" aria-disabled={problem !== null} onClick={() => { if (problem === null) setReviewing(true) }}>Review</button>
          ) : (
            <button key="confirm" type="button" className="mx-tk-button is-primary" disabled={busy} onClick={confirm}>{busy ? 'Writing…' : kind === 'close' ? `Mark done on ${look.name}` : `Post comment to ${look.name}`}</button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
