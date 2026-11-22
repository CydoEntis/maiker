import * as React from "react"
import { X } from "lucide-react"
import { copyText } from "@/lib/clipboard"
import { COLLAPSE_AT, readingToasts, toast, useToasts, type ToastAction, type ToastItem, type ToastKind } from "@/lib/toast"
import { Button } from "./button"
import { IconButton } from "./icon-button"
import { CopyDetails } from "./feedback"
import { StatusIcon, type StatusIconKind } from "./status-icon"

/** The app's one status mark per kind: a note is idle, a success done, a progress working, and anything that needs a look needs you. */
const MARK: Record<ToastKind, StatusIconKind> = { success: "done", info: "idle", error: "error", warning: "needs", needs: "needs", progress: "working" }

/** How many layers show behind the newest toast while the stack is folded. */
const MAX_GHOSTS = 2

/** Alt+T moves the keys to the newest toast, as the toaster this replaced did; Esc on a toast dismisses it. */
const JUMP_KEY = "t"

function run(item: ToastItem, action: ToastAction): void {
  const click = { kept: false }
  action.onClick({ preventDefault: () => { click.kept = true } })
  if (!click.kept) toast.dismiss(item.id)
}

/** A success or a note with nothing to read under its title is one line, its action at the right. */
const isNote = (item: ToastItem): boolean => (item.kind === "success" || item.kind === "info") && item.description === undefined && item.details === undefined && item.secondary === undefined

function ToastView({ item }: { item: ToastItem }) {
  const titleId = React.useId()
  const note = isNote(item)
  const action = item.action === undefined ? null : (
    <Button variant={item.kind === "needs" ? "needs" : note ? "ghost" : "soft"} size="sm" onClick={() => { if (item.action !== undefined) run(item, item.action) }}>{item.action.label}</Button>
  )
  return (
    <div
      role={item.kind === "error" ? "alert" : "status"}
      aria-labelledby={titleId}
      data-float
      data-toast={item.kind}
      className={`mx-toast${note ? " is-note" : ""}${item.kind === "needs" ? " is-needs" : ""}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !item.closeButton) return
        event.stopPropagation()
        toast.dismiss(item.id)
      }}
    >
      <StatusIcon status={MARK[item.kind]} />
      <div className="mx-toast-body">
        <span className="mx-toast-head">
          <span id={titleId} className="mx-toast-title">
            {item.title}
            {item.count > 1 && !item.countInTitle && <span className="mx-toast-count">×{item.count}</span>}
          </span>
          {item.context !== undefined && <span className="mx-toast-context" title={item.context}>{item.context}</span>}
        </span>
        {item.description !== undefined && <span className="mx-toast-reason">{item.description}</span>}
        {!note && (item.action !== undefined || item.secondary !== undefined || item.details !== undefined) && (
          <span className="mx-toast-actions">
            {action}
            {item.secondary !== undefined && <Button variant="ghost" size="sm" onClick={() => { if (item.secondary !== undefined) run(item, item.secondary) }}>{item.secondary.label}</Button>}
            {item.details !== undefined && <CopyDetails text={item.details} copy={copyText} />}
          </span>
        )}
      </div>
      {note && action}
      {item.closeButton && <IconButton label="Dismiss" className="mx-toast-x" onClick={() => { toast.dismiss(item.id) }}><X /></IconButton>}
      {item.hideAfter !== null && <span key={item.count} className="mx-toast-bar" aria-hidden="true" style={{ animationDuration: `${String(item.hideAfter)}ms` }} />}
    </div>
  )
}

/**
 * Where every toast is drawn: the corner Settings chose, 380px, newest above the others. From `COLLAPSE_AT` toasts on, only
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
  const ghosts = collapsed ? Math.min(visible.length - 1, MAX_GHOSTS) : 0
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
      {shown.map((item, index) => (
        <div key={item.id} className="mx-toast-slot" data-ghosts={index === 0 ? ghosts : 0}>
          {index === 0 && Array.from({ length: ghosts }, (_, layer) => <span key={layer} className="mx-toast-ghost" data-depth={ghosts - layer} aria-hidden="true" />)}
          <ToastView item={item} />
        </div>
      ))}
    </section>
  )
}

export { Toaster }
