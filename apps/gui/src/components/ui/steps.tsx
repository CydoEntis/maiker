import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
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
const LABEL_TONE: Record<StepState, string> = { pending: "text-(--dim)", running: "text-(--fg)", done: "text-(--fg)", needs: "font-semibold text-(--needs)", failed: "font-semibold text-(--err)" }
/** The step the person's eye (and a screen reader) should be on. */
const isCurrent = (state: StepState) => state === "running" || state === "needs" || state === "failed"

/** A step that is done says what came of it in place of its name ("Reached 100.78.214.15 · 38 ms"); the others say what they do. */
function StepRow({ step, last }: { step: StepItem; last: boolean }) {
  const title = step.state === "done" && step.result !== undefined ? step.result : step.label
  return (
    <li data-slot="step" data-state={step.state} aria-current={isCurrent(step.state) ? "step" : undefined} className="flex gap-3.5">
      <span className="flex w-[21px] flex-none flex-col items-center">
        <span className={cn("flex size-[21px] flex-none items-center justify-center", step.state === "pending" && "opacity-35")}><StatusIcon status={MARK[step.state]} /></span>
        <span className="sr-only">{WORD[step.state]}</span>
        {!last && <span aria-hidden="true" className={cn("mt-px -mb-1 w-px flex-1", step.state === "done" ? "bg-[color-mix(in_oklab,var(--done)_40%,transparent)]" : "bg-(--line2)")} />}
      </span>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-1 pt-px", !last && "pb-[18px]")}>
        {/* Always rendered, so the live region exists before its text changes and the change is read out. */}
        <span aria-live="polite" className={cn("text-[13.5px] leading-[19px]", LABEL_TONE[step.state])}>{title}</span>
        {/* The active step's body sits straight under its label: one calm list, no card inside the dialog's card. */}
        {step.body !== undefined && <div className="flex flex-col gap-2.5">{step.body}</div>}
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
