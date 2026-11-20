import { cn } from "@/lib/utils"
import { Button } from "./button"

/**
 * The onboarding step bar: numbered steps in a row. The finished ones are buttons that go back; the current one is
 * marked `aria-current="step"`; the ones ahead are plain text, because a step is not skipped by clicking past it. An
 * optional trailing action (Skip setup) ends the whole flow; it keeps its own slot at the right and never shares room with
 * the steps. When the bar is too narrow for every name, only the current step keeps its name (the others stay as numbers).
 */
function StepBar({ steps, current, onSelect, skip, label = "Progress", className }: {
  steps: readonly string[]
  /** Index of the step the person is on. */
  current: number
  /** Called with the index of a finished step that was clicked. */
  onSelect: (index: number) => void
  skip?: { label: string; onSkip: () => void }
  label?: string
  className?: string
}) {
  return (
    <nav data-slot="step-bar" aria-label={label} className={cn("@container flex items-center gap-3", className)}>
      <ol className="m-0 flex min-w-0 flex-1 list-none items-center gap-2 p-0">
        {steps.map((name, index) => {
          const done = index < current
          const now = index === current
          const body = (
            <>
              <span className={cn("flex size-5 flex-none items-center justify-center rounded-(--r-badge) font-(family-name:--mono) text-[11px] font-bold shadow-[inset_0_0_0_1px_var(--line2)]", now && "bg-(--fg) text-(--bg) shadow-none", done && "text-(--done)")}>{done ? "✓" : String(index + 1)}</span>
              <span className={cn(!now && "@max-[639px]:sr-only")}>{name}</span>
            </>
          )
          const tone = cn("flex items-center gap-2 text-[12.5px] whitespace-nowrap", now ? "font-semibold text-(--fg)" : done ? "text-(--fg2)" : "text-(--dim)")
          return (
            <li key={name} className="contents">
              {index > 0 && <span aria-hidden="true" className={cn("h-px min-w-2 flex-1", index <= current ? "bg-(--fg2)" : "bg-(--line)")} />}
              {done
                ? <button type="button" className={cn(tone, "cursor-pointer hover:text-(--fg)")} onClick={() => { onSelect(index) }}>{body}</button>
                : <span aria-current={now ? "step" : undefined} className={tone}>{body}</span>}
            </li>
          )
        })}
      </ol>
      {skip !== undefined && <Button variant="ghost" size="sm" className="flex-none" onClick={skip.onSkip}>{skip.label}</Button>}
    </nav>
  )
}

export { StepBar }
