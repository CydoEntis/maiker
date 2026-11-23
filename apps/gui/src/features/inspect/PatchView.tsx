import { Fragment, useState } from 'react'
import { HighlightedLine } from '@/components/HighlightedLine'
import { errorMessage } from '@/lib/error-message'
import { commentMessage, patchLines, type PatchLine } from './patchLines'

/** Lets a line of the diff be commented on: the comment goes to the agent as a message. */
export type PatchComments = {
  /** The file the diff is of, as the agent knows it. */
  path: string
  /** The agent's name, for the button. */
  agent: string
  onSend: (message: string) => Promise<void>
  /** The comments already sent on this file, kept by whoever shows the diff so they outlast a look at another file. */
  sent: readonly SentComment[]
  onSent: (comment: SentComment) => void
}

/** A comment that went to the agent: the diff line it is pinned under, and what it said. */
export type SentComment = { index: number; text: string }

function canComment(line: PatchLine): boolean {
  return line.line !== null
}

/**
 * A diff line: its number in the file as it is now (a removed line has none), then its text. The number, and the `+` or
 * `−` before the text, are drawn by the stylesheet so that copying the diff copies only the code.
 */
function Line({ line, path }: { line: PatchLine; path: string }) {
  const code = line.kind === 'add' || line.kind === 'remove' || (line.kind === 'context' && line.line !== null)
  return (
    <>
      <i className="mx-src-no" data-no={line.newLine ?? ''} aria-hidden="true" />
      <span className="mx-src-text">{code ? <HighlightedLine line={line.text.slice(1)} path={path} /> : line.text}</span>
      {'\n'}
    </>
  )
}

/**
 * One file's unified diff, each line tinted by what it did, numbered, and coloured as the file's own
 * language. Git's own header lines are left out: the pane already names the file. With `comments`, a
 * click on a line opens a box to tell the agent about it.
 */
export function PatchView({ patch, path, comments }: { patch: string; /** The file the diff is of, which decides its syntax colours. */ path: string; comments?: PatchComments | undefined }) {
  const [open, setOpen] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const sent = comments?.sent ?? []
  const lines = patchLines(patch)
  const firstHunk = lines.findIndex((line) => line.kind === 'hunk')

  const openAt = (index: number) => {
    if (sending) return
    setOpen(index)
    setDraft('')
    setFailure(null)
  }
  const send = (index: number, line: PatchLine) => {
    if (!comments || draft.trim() === '') return
    const text = draft.trim()
    setSending(true)
    setFailure(null)
    comments.onSend(commentMessage(comments.path, line, text))
      .then(() => {
        comments.onSent({ index, text })
        setOpen(null)
      })
      .catch((error: unknown) => { setFailure(errorMessage(error, `Could not send the comment to ${comments.agent}`)) })
      .finally(() => { setSending(false) })
  }

  return (
    <pre className="mx-src is-diff" tabIndex={0} aria-label="Diff">
      {lines.map((line, index) => {
        // The first hunk's header only says where the file starts; a later one marks a gap in it.
        if (index <= firstHunk) return null
        if (line.kind === 'hunk') return <span key={index} className="mx-src-gap" aria-hidden="true" />
        const commentable = comments !== undefined && canComment(line)
        return (
          <Fragment key={index}>
            {commentable ? (
              <span
                className={`mx-src-line is-${line.kind} is-commentable`}
                data-line={line.line ?? ''}
                role="button"
                tabIndex={0}
                title="Click to comment"
                onClick={() => { openAt(index) }}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openAt(index) } }}
              ><Line line={line} path={path} /></span>
            ) : (
              <span className={`mx-src-line is-${line.kind}`} data-line={line.line ?? ''}><Line line={line} path={path} /></span>
            )}
            {sent.filter((comment) => comment.index === index).map((comment, at) => (
              <span key={at} className="mx-patch-sent"><b>You → {comments?.agent}</b>{comment.text} <i>· sent to {comments?.agent}</i></span>
            ))}
            {comments !== undefined && open === index && (
              <span className="mx-patch-comment">
                <textarea
                  className="mx-patch-comment-text"
                  aria-label={`Comment on line ${String(line.line ?? '')}`}
                  placeholder={`Tell ${comments.agent} about this line`}
                  rows={2}
                  autoFocus
                  value={draft}
                  disabled={sending}
                  onChange={(event) => { setDraft(event.target.value) }}
                  onKeyDown={(event) => {
                    // Esc closes the box, not the whole panel.
                    if (event.key === 'Escape') { event.stopPropagation(); setOpen(null) }
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send(index, line) }
                  }}
                />
                {failure !== null && <span className="mx-patch-comment-error" role="alert">{failure}</span>}
                <span className="mx-patch-comment-actions">
                  <button type="button" className="mx-text-button" disabled={sending} onClick={() => { setOpen(null) }}>Cancel</button>
                  <button type="button" className="mx-text-button is-primary" disabled={sending || draft.trim() === ''} onClick={() => { send(index, line) }}>{sending ? 'Sending…' : `Send to ${comments.agent}`}</button>
                </span>
              </span>
            )}
          </Fragment>
        )
      })}
    </pre>
  )
}
