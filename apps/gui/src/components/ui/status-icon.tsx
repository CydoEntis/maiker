import { cn } from "@/lib/utils"

/** The states a status icon draws. The caller maps its own model onto these; the primitive knows no domain. */
type StatusIconKind = "needs" | "working" | "done" | "error" | "limited" | "idle" | "unknown"

/** Share of the outline the light covers, and the gap after it (the dash pattern adds up to the 100 of `pathLength`). */
const LIGHT_LENGTH = 40
const PATH_LENGTH = 100
const LIGHT_GAP = PATH_LENGTH - LIGHT_LENGTH
/** The two sizes the design uses: rows and the pane header are 14px, the live box's own light 12px. */
const DEFAULT_SIZE = 14

/**
 * A session's status as a dot in its colour: round under Rounded corners, square under Square (needs you amber, done green,
 * failed red, limited grey, idle dim, unknown an empty outline). Working is the one moving mark: an empty tile with a light
 * running round its edge, a circle under Rounded corners and a square under Square. The colour and the place say it, not a glyph.
 */
function StatusIcon({ status, size = DEFAULT_SIZE, className }: { status: StatusIconKind; size?: number; className?: string }) {
  return (
    <span
      data-slot="status-icon"
      data-status={status}
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn("mx-status-icon", `is-${status}`, className)}
    >
      {status === "working" ? (
        <svg viewBox="0 0 10 10" preserveAspectRatio="none" className="mx-status-light" focusable="false">
          <rect className="mx-sq" x=".5" y=".5" width="9" height="9" fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" pathLength={PATH_LENGTH} strokeDasharray={`${String(LIGHT_LENGTH)} ${String(LIGHT_GAP)}`} />
          <circle className="mx-round" cx="5" cy="5" r="4.5" fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" pathLength={PATH_LENGTH} strokeDasharray={`${String(LIGHT_LENGTH)} ${String(LIGHT_GAP)}`} />
        </svg>
      ) : null}
    </span>
  )
}

export { StatusIcon, type StatusIconKind }
