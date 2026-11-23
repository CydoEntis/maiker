import { cn } from "@/lib/utils"
import { markOf, type StatusIconKind, type StatusMarkKind } from "@/lib/statusMark"
import "./status-icon.css"

/** What a screen reader hears for a mark; idle has no mark, so it has no name. */
const MARK_NAME: Record<StatusMarkKind, string | null> = { needs: "Needs you", working: "Working", done: "Done", idle: null }

/** The name of the mark a status is drawn as, or null when nothing is drawn. */
const markName = (status: StatusIconKind): string | null => MARK_NAME[markOf(status)]

/** The one box every mark sits in; a caller beside smaller text may ask for less. */
const DEFAULT_SIZE = 16

/** The speech bubble the needs-you and done marks share, and what each holds (the design's shapes, on a 24 grid). */
const BUBBLE = "M12 3.2a8.8 8.8 0 0 0-7.7 13L3 20.8l4.6-1.2A8.8 8.8 0 1 0 12 3.2z"
const QUESTION = "M9.7 9.4a2.4 2.4 0 1 1 3.3 2.2c-.7.3-1 .9-1 1.6v.2"
const QUESTION_DOT = "M12 16.9h.01"
const TICK = "M8.4 12.3l2.5 2.5 4.8-5"
/** The spinner: a full ring as the track and half of it lit, from the top left round to the bottom right. */
const RING_RADIUS = 9
const RING_LIT = "M5.64 5.64a9 9 0 0 1 12.72 12.72"

function Bubble({ holds }: { holds: "question" | "tick" }) {
  return (
    <svg viewBox="0 0 24 24" className="mx-status-bubble" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d={BUBBLE} />
      {holds === "question" ? <><path d={QUESTION} /><path d={QUESTION_DOT} /></> : <path d={TICK} />}
    </svg>
  )
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="mx-status-light" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle className="mx-status-track" cx="12" cy="12" r={RING_RADIUS} vectorEffect="non-scaling-stroke" />
      <path className="mx-status-arc" d={RING_LIT} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * A status as its mark: needs you an amber speech bubble with a question mark, working a teal spinner, done a green
 * speech bubble with a tick, and idle nothing at all (an idle row is dimmed by the row, not marked). The shape says the
 * state, so the colour is never the only signal. A mark is decoration beside words that already say the status; `named`
 * makes it an image with the state as its name, for a place that has no such words.
 */
function StatusIcon({ status, size = DEFAULT_SIZE, named = false, className }: { status: StatusIconKind; size?: number; named?: boolean; className?: string | undefined }) {
  const mark = markOf(status)
  if (mark === "idle") return null
  const name = named ? MARK_NAME[mark] : null
  return (
    <span
      data-slot="status-icon"
      data-status={mark}
      {...(name === null ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
      style={{ width: size, height: size }}
      className={cn("mx-status-icon", `is-${mark}`, className)}
    >
      {mark === "working" ? <Spinner /> : <Bubble holds={mark === "needs" ? "question" : "tick"} />}
    </span>
  )
}

export { StatusIcon, markName, markOf, type StatusIconKind, type StatusMarkKind }
