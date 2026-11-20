import { cn } from "@/lib/utils"
import "./status-icon.css"

/** The four marks there are: one set, each drawn in the same box. */
type StatusMarkKind = "needs" | "working" | "done" | "idle"

/**
 * What a caller may hand over: the four marks, or a daemon state that has none of its own. There is no failed mark: a
 * stopped agent and one held by its plan limit both read as needs you (as `sectionOf` files them), and a state nobody
 * knows reads as idle. The reason is words beside the mark, never a different mark.
 */
type StatusIconKind = StatusMarkKind | "error" | "limited" | "unknown"

const MARK_OF: Record<StatusIconKind, StatusMarkKind> = {
  needs: "needs", working: "working", done: "done", idle: "idle", error: "needs", limited: "needs", unknown: "idle",
}

/** The mark a status is drawn as. */
const markOf = (status: StatusIconKind): StatusMarkKind => MARK_OF[status]

/** Share of the ring the lit arc covers, and the gap after it (the dash pattern adds up to the 100 of `pathLength`). */
const LIGHT_LENGTH = 40
const PATH_LENGTH = 100
const LIGHT_GAP = PATH_LENGTH - LIGHT_LENGTH
/** The one box every mark sits in; a caller beside smaller text may ask for less. */
const DEFAULT_SIZE = 16

/**
 * A session's status, one set in one box: idle a dim dot, done a green dot, needs you an amber dot, working a 2px ring
 * with a lit arc running round it (11px, round under Rounded corners, square under Square). The colour and the place say it,
 * not a glyph.
 */
function StatusIcon({ status, size = DEFAULT_SIZE, className }: { status: StatusIconKind; size?: number; className?: string | undefined }) {
  const mark = markOf(status)
  const dash = `${String(LIGHT_LENGTH)} ${String(LIGHT_GAP)}`
  return (
    <span
      data-slot="status-icon"
      data-status={mark}
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn("mx-status-icon", `is-${mark}`, className)}
    >
      {mark === "working" ? (
        <svg viewBox="0 0 11 11" className="mx-status-light" focusable="false">
          <rect className="mx-sq mx-track" x="1" y="1" width="9" height="9" fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <circle className="mx-round mx-track" cx="5.5" cy="5.5" r="4.5" fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <rect className="mx-sq mx-arc" x="1" y="1" width="9" height="9" fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" pathLength={PATH_LENGTH} strokeDasharray={dash} />
          <circle className="mx-round mx-arc" cx="5.5" cy="5.5" r="4.5" fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" pathLength={PATH_LENGTH} strokeDasharray={dash} />
        </svg>
      ) : null}
    </span>
  )
}

export { StatusIcon, markOf, type StatusIconKind, type StatusMarkKind }
