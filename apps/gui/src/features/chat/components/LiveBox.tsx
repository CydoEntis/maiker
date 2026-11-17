import { StatusIcon } from '@/components/ui/status-icon'
import { useNow } from '@/lib/clock'
import { tookText } from '../stepInfo'

/** The live box's own running light is 12px; rows and the pane header use 14px. */
const LIGHT_PX = 12
const MS_PER_SECOND = 1000
/** The three bars of the skeleton, as shares of the line. */
const LINE_LONG = 92
const LINE_MID = 80
const LINE_SHORT = 56
const SKELETON_WIDTHS = [LINE_LONG, LINE_MID, LINE_SHORT] as const

/** "12s", "1m 20s": whole seconds, since a clock that shows a fraction would tick every frame. */
function workedFor(ms: number): string {
  return ms < MS_PER_SECOND ? '0s' : tookText(ms)
}

/** "reading src/x.ts" as a screen reader hears it: "Reading src/x.ts". */
function stepLine(phrase: string): string {
  return phrase === '' ? 'Thinking' : phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

/**
 * The one thing the chat shows while the agent works: no box, one quiet line (the running light, how long it has worked,
 * how to stop) and a skeleton where the reply will be. Nothing else of the turn is drawn until the work ends (the steps
 * arrive collapsed, the reply a sentence at a time). A deliberate deviation from the prototype, which framed this in a
 * card with a step line. The step is said only to screen readers; the clock is hidden from them so the status is not
 * announced every second.
 */
export function LiveBox({ phrase, since }: { phrase: string; since: number | null }) {
  const now = useNow()
  return (
    <div className="mx-live" role="status" aria-live="polite">
      <div className="mx-live-head">
        <StatusIcon status="working" size={LIGHT_PX} />
        <span>Working{since !== null && <span aria-hidden="true"> for <span className="mx-live-time">{workedFor(Math.max(0, now - since))}</span></span>}</span>
        <span className="sr-only">{stepLine(phrase)}</span>
        <span className="mx-spacer" />
        <span className="mx-live-esc">Esc to stop</span>
      </div>
      <div className="mx-live-skeleton" aria-hidden="true">
        {SKELETON_WIDTHS.map((width) => <span key={width} className="mx-sk" style={{ width: `${String(width)}%` }} />)}
      </div>
    </div>
  )
}
