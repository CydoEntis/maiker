import { cn } from "@/lib/utils"

/** The states a status icon draws. The caller maps its own model onto these; the primitive knows no domain. */
type StatusIconKind = "needs" | "working" | "done" | "error" | "limited" | "idle" | "unknown"

/** The glyph each status carries, so colour is never the only signal. Working draws the running light instead. */
const GLYPH: Record<Exclude<StatusIconKind, "working" | "unknown">, string> = {
  needs: "!",
  done: "✓",
  error: "×",
  limited: "‖",
  idle: "–",
}

/** The running light's path round the folded tile: the same outline `corner-shape: bevel` cuts (top-left and bottom-right). */
const FOLDED_OUTLINE = "M3 .5H9.5V7L7 9.5H.5V3Z"
/** Share of the outline the light covers, and the gap after it (the dash pattern adds up to the 100 of `pathLength`). */
const LIGHT_LENGTH = 24
const PATH_LENGTH = 100
const LIGHT_GAP = PATH_LENGTH - LIGHT_LENGTH
/** The two sizes the design uses: rows and the pane header are 14px, the live box's own light 12px. */
const DEFAULT_SIZE = 14

/**
 * A session's status as the design draws it: a small square with the status's own glyph (`!` needs you in the needs
 * colour, `✓` done, `×` failed, `–` idle and dim). Working is an empty tile with a light running round its edge, and
 * under Folded corners the light follows the cut outline. Idle and unknown are dimmed, not coloured.
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
          <path className="mx-fold" d={FOLDED_OUTLINE} fill="none" strokeWidth=".95" strokeLinecap="square" pathLength={PATH_LENGTH} strokeDasharray={`${String(LIGHT_LENGTH)} ${String(LIGHT_GAP)}`} />
        </svg>
      ) : status === "unknown" ? null : (
        GLYPH[status]
      )}
    </span>
  )
}

export { StatusIcon, type StatusIconKind }
