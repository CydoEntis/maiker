import { cn } from "@/lib/utils"

/** The three pieces of the M, as the title bar draws it: the left leg, the right leg and the fold between them. Each traces on its own beat (`.mx-mtrace`, dialogs.css). */
const LEFT_LEG = "M2.9 29.6 24.3 45.6V61.5Q24.3 64 22 65.6L8 74.8Q2.9 77 2.9 71Z"
const RIGHT_LEG = "M49.3 26.9 74.5 6Q82.9 0 91 6L94 9Q96.4 12 96.4 16V61Q96.4 64.5 93 66.6L79 75.4Q72 79 72 71V34.1L63.1 41.9Z"
const FOLD = "M2.9 27.4V17.5Q2.9 14 5.5 11.5L9 8.4Q15 3 22 8.2L63.1 41.9 49 54Q45 57.5 40.5 54.5Z"

/** The loader's size in pixels: the width the design draws it at; the height follows the M's proportions. */
const WIDTH = 44
const HEIGHT = 34

/**
 * The loader for a wait that fills a view (a launch, reading another machine). The M traces its left leg, the fold and
 * the right leg, fills, fades and starts over, one loop in 2.4s; under reduced motion it stands drawn. A row-size wait
 * uses the running light (`StatusIcon`) instead. `label` is the words beside it, which are also what a screen reader hears.
 */
function MLoader({ label, className }: { label: string; className?: string }) {
  return (
    <div data-slot="m-loader" role="status" className={cn("mx-mloader", className)}>
      <svg aria-hidden="true" className="mx-mtrace" width={WIDTH} height={HEIGHT} viewBox="-3 -1 106 82" fill="none" strokeLinejoin="round" focusable="false">
        <path className="mx-mk-a" d={LEFT_LEG} />
        <path className="mx-mk-b" d={RIGHT_LEG} />
        <path className="mx-mk-c" d={FOLD} />
      </svg>
      <span>{label}</span>
    </div>
  )
}

export { MLoader }
