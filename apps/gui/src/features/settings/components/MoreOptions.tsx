import { useState, type ReactNode } from 'react'

/**
 * The quiet end of an outcome's actions: one "More" that opens the lesser ways out (Edit address, a retry) and ssh's own
 * words behind Details, so an outcome shows one primary action and nothing competing with it.
 */
export function MoreOptions({ raw, children }: { raw: string | null; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  return (
    <>
      <button type="button" className="mx-rm-text" aria-expanded={open} onClick={() => { setOpen(!open) }}>More</button>
      {open && (
        <>
          {children}
          {raw !== null && <button type="button" className="mx-rm-text" aria-expanded={showRaw} onClick={() => { setShowRaw(!showRaw) }}>{showRaw ? 'Hide details' : 'Details'}</button>}
          {showRaw && raw !== null && <pre className="mono mx-rm-raw">{raw}</pre>}
        </>
      )}
    </>
  )
}
