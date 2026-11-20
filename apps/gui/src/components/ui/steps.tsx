import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Card, CardBody } from "./card"
import { StatusIcon, type StatusMarkKind } from "./status-icon"

/** Where a step is. `needs` is a step stopped on something only the person can fix; `failed` is one that ended badly. */
type StepState = "pending" | "running" | "done" | "needs" | "failed"

type StepItem = {
  id: string
  /** What the step does, in plain words ("Reach 100.78.214.15"). */
  label: string
  state: StepState
  /** What came of it, once it has ("Reached 100.78.214.15 · 38 ms"). It is announced when it changes. */
  result?: string
  /** The step's own room: the fix for a `needs` step, a progress bar for a running one. */
  body?: ReactNode
}

/** A step is drawn with the shared status mark; a step waiting its turn is the mark's waiting dot. */
const MARK: Record<StepState, StatusMarkKind> = { pending: "idle", running: "working", done: "done", needs: "needs", failed: "needs" }
/** The mark is hidden from screen readers, so the state is also said in words (colour is never the only signal). */
const WORD: Record<StepState, string> = { pending: "waiting", running: "in progress", done: "done", needs: "needs you", failed: "needs you" }
const LABEL_TONE: Record<StepState, string> = { pending: "text-(--dim)", running: "text-(--fg)", done: "text-(--fg2)", needs: "text-(--needs)", failed: "text-(--err)" }
/** The step the person's eye (and a screen reader) should be on. */
const isCurrent = (state: StepState) => state === "running" || state === "needs" || state === "failed"

function StepRow({ step, last }: { step: StepItem; last: boolean }) {
  return (
    <li data-slot="step" data-state={step.state} aria-current={isCurrent(step.state) ? "step" : undefined} className="flex gap-3">
      <span className="flex flex-none flex-col items-center pt-0.5">
        <StatusIcon status={MARK[step.state]} /><span className="sr-only">{WORD[step.state]}</span>
        {!last && <span aria-hidden="true" className={cn("mt-1 w-px flex-1", step.state === "done" ? "bg-(--line2)" : "bg-(--line)")} />}
      </span>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-1", !last && "pb-3.5")}>
        <span className={cn("text-[13px] leading-[18px] font-semibold", LABEL_TONE[step.state])}>{step.label}</span>
        {/* Always rendered, so the live region exists before its text changes and the change is read out. */}
        <span aria-live="polite" className="text-xs text-(--muted) empty:hidden">{step.result}</span>
        {step.body !== undefined && (step.state === "needs"
          ? <Card className="mt-1.5"><CardBody>{step.body}</CardBody></Card>
          : <div className="mt-1.5">{step.body}</div>)}
      </div>
    </li>
  )
}

/**
 * A vertical checklist that ticks itself off: each step is pending, running, done (with its result line), or stopped
 * on something (`needs`, in amber, with a body for the one main fix; `failed`, in red). The list is an ordered list
 * named by `label`, the current step carries `aria-current="step"`, and a result is announced as it appears.
 */
function Steps({ steps, label, className }: { steps: readonly StepItem[]; label: string; className?: string }) {
  return (
    <ol data-slot="steps" aria-label={label} className={cn("m-0 flex list-none flex-col p-0", className)}>
      {steps.map((step, index) => <StepRow key={step.id} step={step} last={index === steps.length - 1} />)}
    </ol>
  )
}

export { Steps, type StepItem, type StepState }
