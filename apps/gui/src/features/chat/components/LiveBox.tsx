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
 * The line at the end of a running turn: no box, the running light, how long the agent has worked and how to stop it.
 * The turn's own rows (its steps, thoughts and reply) are drawn above it as they arrive; until the first one comes,
 * `placeholder` adds a skeleton where it will be, so the chat is never blank under the message just sent. A deliberate
 * deviation from the prototype, which framed this in a card with a step line. The step is said only to screen readers;
 * the clock is hidden from them so the status is not announced every second.
 */
export function LiveBox({ phrase, since, placeholder }: { phrase: string; since: number | null; placeholder: boolean }) {
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
      {placeholder && (
        <div className="mx-live-skeleton" aria-hidden="true">
          {SKELETON_WIDTHS.map((width) => <span key={width} className="mx-sk" style={{ width: `${String(width)}%` }} />)}
        </div>
      )}
    </div>
  )
}
