import * as React from "react"
import { copyText } from "@/lib/clipboard"
import { COLLAPSE_AT, readingToasts, toast, useToasts, type ToastAction, type ToastItem, type ToastKind } from "@/lib/toast"
import { CopyDetails, FeedbackButton, FeedbackMark, type FeedbackTone } from "./feedback"

const TONE: Record<ToastKind, FeedbackTone> = { success: "ok", info: "info", error: "error", warning: "caution", needs: "needs", progress: "working" }

/** Alt+T moves the keys to the newest toast, as the toaster this replaced did; Esc on a toast dismisses it. */
const JUMP_KEY = "t"

function run(item: ToastItem, action: ToastAction): void {
  const click = { kept: false }
  action.onClick({ preventDefault: () => { click.kept = true } })
  if (!click.kept) toast.dismiss(item.id)
}

function ToastView({ item }: { item: ToastItem }) {
  const tone = TONE[item.kind]
  const titleId = React.useId()
  return (
    <div
      role={item.kind === "error" ? "alert" : "status"}
      aria-labelledby={titleId}
      data-float
      data-toast={item.kind}
      className={`mx-toast is-edge-${tone}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !item.closeButton) return
        event.stopPropagation()
        toast.dismiss(item.id)
      }}
    >
      <FeedbackMark tone={tone} running={item.kind === "progress"} />
      <div className="mx-toast-body">
        <span id={titleId} className="mx-toast-title">
          {item.title}
          {item.count > 1 && !item.countInTitle && <span className="mx-toast-count">×{item.count}</span>}
        </span>
        {item.context !== undefined && <span className="mx-toast-context">{item.context}</span>}
        {item.description !== undefined && <span className="mx-toast-reason">{item.description}</span>}
        {(item.action !== undefined || item.secondary !== undefined || item.details !== undefined) && (
          <span className="mx-toast-actions">
            {item.action !== undefined && (
              <FeedbackButton kind={item.kind === "needs" ? "needs" : "primary"} onClick={() => { if (item.action !== undefined) run(item, item.action) }}>{item.action.label}</FeedbackButton>
            )}
            {item.secondary !== undefined && <FeedbackButton onClick={() => { if (item.secondary !== undefined) run(item, item.secondary) }}>{item.secondary.label}</FeedbackButton>}
            {item.details !== undefined && <CopyDetails text={item.details} copy={copyText} />}
          </span>
        )}
      </div>
      {item.closeButton && <button type="button" className="mx-toast-x" aria-label="Dismiss" onClick={() => { toast.dismiss(item.id) }}>✕</button>}
    </div>
  )
}

/**
 * Where every toast is drawn: the corner Settings chose, 360px, newest above the others. From `COLLAPSE_AT` toasts on, only
 * the newest shows with "N more, hover to see all"; the pointer or the keys on the stack open it. Toasts that wait while
 * the window has no line to its service are not drawn. Nothing hides while the pointer or the keys are on a toast.
 */
function Toaster() {
  const { items, held } = useToasts()
  const region = React.useRef<HTMLElement>(null)
  const [open, setOpen] = React.useState(false)
  const visible = held ? [] : items
  const collapsed = visible.length >= COLLAPSE_AT && !open
  const shown = collapsed ? visible.slice(0, 1) : visible
  const any = visible.length > 0
  React.useEffect(() => {
    if (!any) return undefined
    const jump = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== JUMP_KEY) return
      const first = region.current?.querySelector<HTMLElement>("button")
      if (first === null || first === undefined) return
      event.preventDefault()
      first.focus()
    }
    window.addEventListener("keydown", jump)
    return () => { window.removeEventListener("keydown", jump) }
  }, [any])
  // A toast that goes away under the pointer would never send pointerleave, so reading ends with the last one.
  React.useEffect(() => { if (!any) readingToasts(false) }, [any])
  // Likewise the stack closes with its last toast (state set during render, as React allows).
  if (!any && open) setOpen(false)
  return (
    <section
      ref={region}
      className="mx-toaster"
      aria-label="Notifications"
      aria-live="polite"
      onPointerEnter={() => { readingToasts(true); setOpen(true) }}
      onPointerLeave={() => { readingToasts(false); setOpen(false) }}
      onFocus={() => { readingToasts(true); setOpen(true) }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { readingToasts(false); setOpen(false) } }}
    >
      {collapsed && <span className="mx-toast-more">{visible.length - 1} more, hover to see all</span>}
      {shown.map((item) => <ToastView key={item.id} item={item} />)}
    </section>
  )
}

export { Toaster }
