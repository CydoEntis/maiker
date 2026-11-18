import { useContext, useEffect, useId, useState } from 'react'
import '../dock.css'
import { StatusIcon, type StatusIconKind } from '@/components/ui/status-icon'
import { OpenSubagentContext } from '../openSubagent'
import { CYCLE_MS, currentHelper, helperCounts, stripOrder, type DockHelper, type HelperStatus } from '../helpersDock'
import { ChevronGlyph, HelpersGlyph } from './DockIcons'

const ICON: Record<HelperStatus, StatusIconKind> = { working: 'working', done: 'done', failed: 'error' }
const WORD: Record<HelperStatus, string> = { working: 'Working', done: 'Done', failed: 'Failed' }

/** One helper's detail: what it was asked, what it ran, and its answer (what went wrong for a failed one). */
function HelperDetail({ helper }: { helper: DockHelper }) {
  const openChat = useContext(OpenSubagentContext)(helper.label, helper.asked?.split('\n')[0] ?? null)
  const failed = helper.status === 'failed'
  return (
    <div className="mx-dock-detail">
      <div className="mx-dock-field">
        <span className="mx-dock-label">Asked to</span>
        <span className="mx-dock-text">{helper.asked ?? 'The history did not keep what it was asked.'}</span>
      </div>
      {helper.ran !== null && (
        <div className="mx-dock-field">
          <span className="mx-dock-label">Ran</span>
          <code className="mx-dock-ran"><span>$ </span>{helper.ran}</code>
        </div>
      )}
      {(helper.answer !== null || helper.stopped) && (
        <div className="mx-dock-field">
          <span className="mx-dock-label">{failed ? 'What went wrong' : 'Answer'}</span>
          <span className={`mx-dock-text${failed ? ' is-failed' : ''}`}>{helper.answer ?? 'It was stopped before it finished.'}</span>
        </div>
      )}
      {openChat !== null && <div><button type="button" className="mx-dock-action" onClick={openChat}>Open its chat</button></div>}
    </div>
  )
}

/** What a helper's row says under its name: what it is doing, else the first line of its answer, else its state. */
function lineOf(helper: DockHelper): string {
  if (helper.status === 'working') return helper.activity ?? 'Working'
  return helper.answer?.split('\n')[0] ?? (helper.status === 'failed' ? (helper.stopped ? 'Stopped' : 'Failed') : 'Done')
}

/** "3 working · 2 done · 1 failed", each in its own colour; what is none is left out. */
export function HelperCounts({ helpers }: { helpers: readonly DockHelper[] }) {
  const counts = helperCounts(helpers)
  return (
    <span className="mx-dock-counts">
      {counts.working > 0 && <span className="is-working">{counts.working} working</span>}
      {counts.done > 0 && <span className="is-done">{counts.done} done</span>}
      {counts.failed > 0 && <span className="is-failed">{counts.failed} failed</span>}
    </span>
  )
}

/** A row a helper; a click unfolds one at a time. Shared by the dock's list and the record block in the chat. */
export function HelperRows({ helpers }: { helpers: readonly DockHelper[] }) {
  const [unfolded, setUnfolded] = useState<string | null>(null)
  return (
    <ul className="mx-dock-rows">
      {helpers.map((helper) => {
        const on = unfolded === helper.id
        return (
          <li key={helper.id} className={on ? 'is-unfolded' : undefined}>
            <button type="button" className="mx-dock-row" aria-expanded={on} onClick={() => { setUnfolded(on ? null : helper.id) }}>
              <span role="img" aria-label={WORD[helper.status]} className="mx-dock-row-mark"><StatusIcon status={ICON[helper.status]} /></span>
              <span className="mx-dock-row-text">
                <span className={`mx-dock-row-name${helper.status === 'done' ? ' is-done' : ''}`}>{helper.label}</span>
                <span className={`mx-dock-row-line is-${helper.status}${on ? ' is-whole' : ''}`}>{lineOf(helper)}</span>
              </span>
              {helper.kind !== null && <span className="mx-dock-row-kind">{helper.kind}</span>}
            </button>
            {on && <HelperDetail helper={helper} />}
          </li>
        )
      })}
    </ul>
  )
}

/** The progress strip: a block a helper, finished first. */
export function HelperStrip({ helpers }: { helpers: readonly DockHelper[] }) {
  return (
    <span className="mx-dock-strip" aria-hidden="true">
      {stripOrder(helpers).map((helper) => <span key={helper.id} className={`mx-dock-block is-${helper.status}`} />)}
    </span>
  )
}

/** The full list, over the chat: a head with the counts, then a row a helper. */
function HelpersList({ helpers, id }: { helpers: readonly DockHelper[]; id: string }) {
  return (
    <div id={id} className="mx-dock-list" data-float="1">
      <div className="mx-dock-list-head">
        <span className="mx-dock-list-title">{helpers.length} {helpers.length === 1 ? 'helper' : 'helpers'}</span>
        <HelperCounts helpers={helpers} />
      </div>
      <HelperRows helpers={helpers} />
    </div>
  )
}

type Props = {
  helpers: readonly DockHelper[]
  open: boolean
  /** Opens or folds the list; the chat folds the queue when this opens (one open at a time). */
  onOpenChange: (open: boolean) => void
}

/**
 * The helpers line above the message box, while any helper works: the running light, the name and activity of one
 * working helper (each in turn, every `CYCLE_MS`), a red "N failed" until the list has been opened once, a block a
 * helper in a progress strip, and how many are done of the total. A click opens the full list upward over the chat.
 * The finished and failed helpers stay listed until all have finished.
 */
export function HelpersDock({ helpers, open, onOpenChange }: Props) {
  const list = useId()
  const [tick, setTick] = useState(0)
  const [seen, setSeen] = useState(false)
  const counts = helperCounts(helpers)
  const working = counts.working
  useEffect(() => {
    if (working <= 1) return
    const timer = window.setInterval(() => { setTick((current) => current + 1) }, CYCLE_MS)
    return () => { window.clearInterval(timer) }
  }, [working])
  // Opening the list is what clears the red label, for as long as this dock is up.
  if (open && !seen) setSeen(true)
  const current = currentHelper(helpers, tick)
  const finished = counts.done + counts.failed
  return (
    <div className="mx-dock-helpers" role="region" aria-label="Helpers running">
      {open && <HelpersList helpers={helpers} id={list} />}
      <button type="button" className="mx-dock-line" data-fold="1" aria-expanded={open} aria-controls={open ? list : undefined} onClick={() => { onOpenChange(!open) }}>
        <StatusIcon status="working" />
        <span className="mx-dock-now">
          {current !== null && <span className="mx-dock-now-name">{current.label}</span>}
          {current !== null && <span key={current.id} className="mx-dock-now-act">{current.activity ?? 'Working'}</span>}
        </span>
        {counts.failed > 0 && !seen && <span className="mx-dock-failed">{counts.failed} failed</span>}
        <HelperStrip helpers={helpers} />
        <span className="mx-dock-of">{finished} of {helpers.length}</span>
        <span className={`mx-dock-chevron${open ? ' is-open' : ''}`}><ChevronGlyph /></span>
      </button>
    </div>
  )
}

type MarkerProps = { count: number; onOpen: () => void }

/** Where helpers started, in the chat, while they run below: one quiet line; its row shows the full record when they finish. */
export function HelpersMarker({ count, onOpen }: MarkerProps) {
  return (
    <button type="button" className="mx-dock-marker" onClick={onOpen}>
      <span className="mx-dock-marker-glyph"><HelpersGlyph /></span>
      Started {count} {count === 1 ? 'helper' : 'helpers'}
      <span className="mx-dock-marker-tail">· running below</span>
    </button>
  )
}
