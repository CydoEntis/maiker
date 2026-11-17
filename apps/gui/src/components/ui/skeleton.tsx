import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

/** The widths the bars take in turn, so a block of them reads as lines of text. */
const LINE_WIDTHS = ["88%", "64%", "76%", "52%", "70%", "44%"]

/**
 * Placeholder bars where something is on its way. Nothing says "Loading" on screen: the label is for screen readers
 * only. The bars are drawn in the hairline colour, so they show on every theme's surfaces.
 */
function SkeletonLines({ label, lines = 3, className }: { label: string; lines?: number; className?: string }) {
  const widths = Array.from({ length: lines }, (_, index) => `${String(index)}:${LINE_WIDTHS[index % LINE_WIDTHS.length] ?? "60%"}`)
  return (
    <div role="status" aria-label={label} data-slot="skeleton-lines" className={cn("flex flex-col gap-2.5 py-1.5", className)}>
      {widths.map((key) => (
        <div key={key} className="h-2 animate-pulse rounded-(--r-badge) bg-(--line2) motion-reduce:animate-none" style={{ width: key.slice(key.indexOf(":") + 1) }} />
      ))}
    </div>
  )
}

export { Skeleton, SkeletonLines }
