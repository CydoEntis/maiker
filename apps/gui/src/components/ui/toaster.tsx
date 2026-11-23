import * as React from "react"
import { X } from "lucide-react"
import { copyText } from "@/lib/clipboard"
import { COLLAPSE_AT, readingToasts, toast, useToasts, type ToastAction, type ToastItem, type ToastKind } from "@/lib/toast"
import { Button } from "./button"
import { IconButton } from "./icon-button"
import { CopyDetails } from "./feedback"
import { StatusIcon, type StatusIconKind } from "./status-icon"

/** The session state a toast's kind stands for; an error, a warning and a plain note are not session states. */
const STATE_MARK: Partial<Record<ToastKind, StatusIconKind>> = { success: "done", needs: "needs", progress: "working" }

/** The `!` in a circle (the design's shape, on a 24 grid). */
const EXCLAIM_RADIUS = 8.8
const EXCLAIM = "M12 7.6v5.2M12 16.3v.1"

/** How long a dismissed toast takes to fade and drop away: the `mx-toast-out` animation in feedback.css. */
const TOAST_EXIT_MS = 140

type Leaving = { item: ToastItem; at: number }

/**
 * The toasts just dismissed, kept for TOAST_EXIT_MS at the place they held so they fade out instead of vanishing. Only a
 * toast that left the list counts; one folded into the collapsed stack is still there.
 */
function useLeavingToasts(items: readonly ToastItem[]): readonly Leaving[] {
  const [seen, setSeen] = React.useState(items)
  const [leaving, setLeaving] = React.useState<readonly Leaving[]>([])
  if (seen !== items) {
    const kept = new Set(items.map((item) => item.id))
    const gone = seen.flatMap((item, at) => (kept.has(item.id) ? [] : [{ item, at }]))
    setSeen(items)
    if (gone.length > 0) setLeaving([...leaving.filter((entry) => !kept.has(entry.item.id)), ...gone])
  }
  React.useEffect(() => {
    if (leaving.length === 0) return undefined
    const timer = window.setTimeout(() => { setLeaving([]) }, TOAST_EXIT_MS)
    return () => { window.clearTimeout(timer) }
  }, [leaving])
  return leaving
}

/**
 * A toast's mark: needs you and done are the session marks, a failure a red `!` in a circle and a warning the same in
 * amber, and a plain note has none. The failure and the warning have a shape of their own because neither is a state a
 * session can be in. Decoration: the toast's words and its role already say what it is.
 */
function ToastMark({ kind }: { kind: ToastKind }) {
  const state = STATE_MARK[kind]
  if (state !== undefined) return <span className="mx-toast-mark" aria-hidden="true"><StatusIcon status={state} /></span>
  if (kind !== "error" && kind !== "warning") return null
  return (
    <span className={`mx-toast-mark is-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="12" cy="12" r={EXCLAIM_RADIUS} />
        <path d={EXCLAIM} />
      </svg>
    </span>
  )
}

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
    // A failure's or a warning's action is its fix, the one thing to do next, so it is the primary button; elsewhere it is a quiet choice.
    <Button variant={item.kind === "needs" ? "needs" : item.kind === "error" || item.kind === "warning" ? "primary" : "ghost"} size="sm" onClick={() => { if (item.action !== undefined) run(item, item.action) }}>{item.action.label}</Button>
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
      <ToastMark kind={item.kind} />
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
  const leaving = useLeavingToasts(items)
  const rows = shown.map((item) => ({ item, leaving: false }))
  // A collapsed stack shows one toast; a dismissed one fading in beside it would read as a second.
  if (!collapsed && !held) for (const entry of leaving) rows.splice(Math.min(entry.at, rows.length), 0, { item: entry.item, leaving: true })
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
      {rows.map(({ item, leaving: gone }, index) => (
        <div key={item.id} className={gone ? "mx-toast-slot is-leaving" : "mx-toast-slot"} data-ghosts={index === 0 ? ghosts : 0} aria-hidden={gone || undefined} inert={gone}>
          {index === 0 && Array.from({ length: ghosts }, (_, layer) => <span key={layer} className="mx-toast-ghost" data-depth={ghosts - layer} aria-hidden="true" />)}
          <ToastView item={item} />
        </div>
      ))}
    </section>
  )
}

export { Toaster }
