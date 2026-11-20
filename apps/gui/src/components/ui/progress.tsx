import * as React from "react"
import { cn } from "@/lib/utils"
import "./progress.css"

type Tone = "working" | "done" | "err" | "needs"
const PERCENT = 100
const FILL: Record<Tone, string> = { working: "bg-(--working)", done: "bg-(--done)", err: "bg-(--err)", needs: "bg-(--needs)" }

/**
 * The design's Progress: a 4px bar on the selected colour, filled in a status colour. Give it a `value` (out of `max`,
 * 100 by default so a percent works) for a determinate bar, or leave `value` out when the length of the work is not
 * known: a light then slides along the bar and the progressbar carries no value, so a screen reader says "busy" and
 * not a made-up number.
 */
function Progress({ value, max = PERCENT, tone = "working", label, className }: { value?: number; max?: number; tone?: Tone; label: string; className?: string }) {
  const known = value !== undefined
  const share = known && max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <span role="progressbar" aria-label={label} aria-valuemin={known ? 0 : undefined} aria-valuemax={known ? max : undefined} aria-valuenow={value} data-slot="progress" data-indeterminate={known ? undefined : ""} className={cn("relative block h-1 overflow-hidden bg-(--sel)", className)}>
      {known
        ? <span className={cn("block h-full transition-[width] duration-(--t-base) ease-(--ease)", FILL[tone])} style={{ width: `${String(share * PERCENT)}%` }} />
        : <span className={cn("mx-progress-run absolute inset-y-0 left-0 w-2/5", FILL[tone])} />}
    </span>
  )
}

/** A quiet count in mono: "2 of 5", "+3". */
function Counter({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="counter" className={cn("font-(family-name:--mono) text-[11px] font-medium text-(--dim) tabular-nums", className)} {...props} />
}

/** A hairline between groups. */
function Divider({ className }: { className?: string }) {
  return <span role="separator" data-slot="divider" className={cn("block h-px w-full bg-(--line)", className)} />
}

export { Progress, Counter, Divider }
