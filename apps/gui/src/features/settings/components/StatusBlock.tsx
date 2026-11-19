import { useEffect, useState, type ReactNode } from 'react'
import type { Glyph, Tone } from '../model/machineRows'

/** `work` is a spinner: the machine is being reached, installed on or linked. */
export type BlockTone = Tone | 'work'

const COPIED_MS = 1600

/** The mark that starts a status line. The shape says the state too, so colour is never the only signal. */
export function StateMark({ glyph, tone }: { glyph: Glyph | '✓'; tone: Tone | 'done' }) {
  return <span className={`mx-rm-mark is-${tone}`} aria-hidden="true">{glyph}</span>
}

/** A command or fingerprint in mono, with Copy that turns to Copied. */
export function CopyLine({ text, label, onCopy }: { text: string; label: string; onCopy: (text: string) => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => { setCopied(false) }, COPIED_MS)
    return () => { window.clearTimeout(timer) }
  }, [copied])
  return (
    <span className="mx-rm-copy">
      <code className="mono">{text}</code>
      <button type="button" className="mx-rm-text" aria-label={`Copy ${label}`} onClick={() => { onCopy(text); setCopied(true) }}>{copied ? 'Copied' : 'Copy'}</button>
    </span>
  )
}

type Props = {
  tone: BlockTone
  /** The one sentence, in the text colour. */
  lead: ReactNode
  /** The sentence after it, in the second colour. */
  more?: ReactNode
  /** A command or fingerprint to copy. */
  copy?: { text: string; label: string; onCopy: (text: string) => void } | undefined
  /** Raw output, behind Details. */
  raw?: string | null
  /** On a machine's page: no background, only the mark and the words. */
  plain?: boolean
  /** Buttons: the neutral primary first, then text buttons. */
  children?: ReactNode
}

/**
 * The one block that reports progress and problems, for Add a machine and a machine's page: a mark or
 * spinner, one sentence, an optional command, and the actions. Each change is announced.
 */
export function StatusBlock({ tone, lead, more, copy, raw = null, plain = false, children }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`mx-rm-block is-${tone}${plain ? ' is-plain' : ''}`} role="status" aria-live="polite">
      <div className="mx-rm-bline">
        {tone === 'work' ? <span className="mx-mach-spin" aria-hidden="true" /> : <StateMark glyph={MARKS[tone]} tone={tone} />}
        <span className="mx-rm-words"><span className="mx-rm-lead">{lead}</span>{more !== undefined && more !== null && <> <span className="mx-rm-more">{more}</span></>}</span>
      </div>
      {copy && <CopyLine {...copy} />}
      {(children !== undefined || raw !== null) && (
        <div className="mx-rm-actions">
          {children}
          {raw !== null && <button type="button" className="mx-rm-text" aria-expanded={open} onClick={() => { setOpen(!open) }}>{open ? 'Hide details' : 'Details'}</button>}
        </div>
      )}
      {open && raw !== null && <pre className="mono mx-rm-raw">{raw}</pre>}
    </div>
  )
}

const MARKS: Record<Tone, Glyph> = { ok: '●', quiet: '○', needs: '!', bad: '×' }
