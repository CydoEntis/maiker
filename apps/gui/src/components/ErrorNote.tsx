import { type ReactNode, useState } from 'react'
import type { ExplainedError } from '@/lib/error-message'
import { copyText } from '@/lib/clipboard'

/** How long Copy details says Copied. */
const COPIED_MS = 1500

/**
 * A failure shown in place, under what failed (docs/CODE-STANDARDS.md#errors): what failed, then why in plain words, then
 * what can be done (`children`), and Copy details when the tool's own text says more than the reason.
 */
export function ErrorNote({ error, children }: { error: ExplainedError; children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void copyText(`${error.title}\n${error.details ?? error.reason}`)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => { setCopied(false) }, COPIED_MS)
      })
      .catch((failure: unknown) => { console.warn('Could not copy the error details', failure) })
  }
  return (
    <div role="alert" className="mx-error-note">
      <strong className="mx-error-note-title">{error.title}</strong>
      <span className="mx-error-note-reason">{error.reason}</span>
      {(children !== undefined || error.details !== null) && (
        <span className="mx-error-note-actions">
          {children}
          {error.details !== null && <button type="button" className="mx-text-button" onClick={copy}>{copied ? 'Copied' : 'Copy details'}</button>}
        </span>
      )}
    </div>
  )
}
