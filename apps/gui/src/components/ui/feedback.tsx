import * as React from "react"
import { FocusScope } from "radix-ui/internal"
import { StatusIcon } from "@/components/ui/status-icon"
import { cn } from "@/lib/utils"
import "./feedback.css"

/*
 * The error system's parts (docs/DESIGN.md, Errors). Each says what failed (a short past-tense title), why (one plain
 * sentence) and what to do (one primary action in the status colour, then Copy details, last and quiet). They know no
 * domain: the caller gives the words and the actions.
 */

/** The status colour of a part: its icon and its left edge, never its words. */
export type FeedbackTone = "error" | "ok" | "caution" | "needs" | "working" | "info"

const GLYPH: Record<FeedbackTone, string> = { error: "×", ok: "✓", caution: "▲", needs: "!", working: "", info: "i" }

/** While a part fixes itself its edge and light turn teal (working); a success that is still finishing stays green. */
const edgeOf = (tone: FeedbackTone, running: boolean): FeedbackTone => (running && tone !== "ok" ? "working" : tone)

/** How long Copy details says Copied. */
export const COPIED_MS = 2000

/** The mark at the head of a part: its status glyph, or the running light while it fixes itself. */
function FeedbackMark({ tone, running = false }: { tone: FeedbackTone; running?: boolean }) {
  return <span className="mx-fb-mark" aria-hidden="true">{running ? <StatusIcon status="working" size={14} /> : GLYPH[tone]}</span>
}

type FeedbackButtonProps = React.ComponentProps<"button"> & {
  /** primary: tinted in the status colour; needs: the solid needs-you answer; outline: neutral; text: quiet. */
  kind?: "primary" | "needs" | "outline" | "text"
  large?: boolean
}

function FeedbackButton({ kind = "outline", large = false, className, type = "button", ...props }: FeedbackButtonProps) {
  return <button type={type} className={cn("mx-fb-btn", kind !== "outline" && `is-${kind}`, large && "is-lg", className)} {...props} />
}

/**
 * Copies the raw text behind a failure. It says Copied for two seconds; both words hold the one slot, so the button keeps
 * its width. A copy that fails says so in the button's place rather than nowhere.
 */
function CopyDetails({ text, copy, large = false, className }: { text: string; copy: (text: string) => Promise<void>; large?: boolean; className?: string }) {
  const [said, setSaid] = React.useState<"idle" | "copied" | "failed">("idle")
  React.useEffect(() => {
    if (said === "idle") return undefined
    const timer = window.setTimeout(() => { setSaid("idle") }, COPIED_MS)
    return () => { window.clearTimeout(timer) }
  }, [said])
  const words = { idle: "Copy details", copied: "Copied", failed: "Could not copy" } as const
  return (
    <FeedbackButton kind="text" large={large} className={className} onClick={() => { copy(text).then(() => { setSaid("copied") }, () => { setSaid("failed") }) }}>
      <span className="mx-fb-swap">
        {(Object.keys(words) as Array<keyof typeof words>).map((key) => <span key={key} className="mx-fb-word" data-shown={String(key === said)} aria-hidden={key !== said}>{words[key]}</span>)}
      </span>
    </FeedbackButton>
  )
}

/** Where a blocking alert sits: over one chat's pane (the rest of the app keeps working), or over the whole window under its title bar. */
export type AlertScope = "chat" | "window"

type ScopedAlertProps = {
  scope: AlertScope
  tone: FeedbackTone
  /** While it fixes itself (restarting, reconnecting) the mark is the running light and there are no actions. */
  running?: boolean
  title: React.ReactNode
  reason: React.ReactNode
  /** The actions row: the primary first, so it takes the focus; Copy details last. */
  actions?: React.ReactNode
  /** Anything between the reason and the actions (a list of what a restart keeps). */
  children?: React.ReactNode
  /** Esc: the dialog's "Not now". */
  onEscape?: () => void
  /** A whole-window alert holds the keys inside it; a chat's leaves the rest of the app usable. */
  className?: string
}

/**
 * A dialog that blocks only what it is about (`role="alertdialog"`): a veil over that scope, the card centred on it.
 * A chat's alert takes the focus only when the focus was in that chat or nowhere, and never holds it, so the sidebar and
 * other panes keep working. The window's alert keeps Tab inside it (the title bar stays clear and clickable). Esc is
 * Not now in both.
 */
function ScopedAlert({ scope, tone, running = false, title, reason, actions, children, onEscape, className }: ScopedAlertProps) {
  const titleId = React.useId()
  const reasonId = React.useId()
  const card = React.useRef<HTMLDivElement>(null)
  // The chat's alert moves the focus to its primary button once, as it appears, unless the person is typing elsewhere.
  React.useEffect(() => {
    if (scope !== "chat") return
    const element = card.current
    const active = document.activeElement
    const scopeRoot = element?.parentElement?.parentElement ?? null
    const ours = active === null || active === document.body || (scopeRoot?.contains(active) ?? false)
    if (ours) (element?.querySelector<HTMLElement>("button:not(:disabled)") ?? element)?.focus({ preventScroll: true })
  }, [scope])
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || onEscape === undefined) return
    event.preventDefault()
    event.stopPropagation()
    onEscape()
  }
  const body = (
    <div
      ref={card}
      role="alertdialog"
      aria-modal={scope === "window"}
      aria-labelledby={titleId}
      aria-describedby={reasonId}
      tabIndex={-1}
      data-float
      data-scope={scope}
      className={cn("mx-alert", `is-edge-${edgeOf(tone, running)}`, className)}
      onKeyDown={onKeyDown}
    >
      <h2 id={titleId} className="mx-alert-title"><FeedbackMark tone={tone} running={running} />{title}</h2>
      <p id={reasonId} className="mx-alert-reason">{reason}</p>
      {children}
      {!running && actions !== undefined && <div className="mx-alert-actions">{actions}</div>}
    </div>
  )
  return (
    <div className={cn("mx-veil", `is-${scope}`)} data-veil={scope}>
      {scope === "window" ? <FocusScope.FocusScope asChild trapped loop>{body}</FocusScope.FocusScope> : body}
    </div>
  )
}

/** One line in the chat's dock for a problem you put off, or a warning that blocks nothing: above everything else in the dock. */
function ProblemLine({ tone, running = false, title, reason, actions }: { tone: FeedbackTone; running?: boolean; title: string; reason: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div data-fold role="status" className={cn("mx-problem-line", `is-edge-${edgeOf(tone, running)}`)}>
      <FeedbackMark tone={tone} running={running} />
      <span className="mx-problem-words"><strong>{title}</strong><span>{reason}</span></span>
      {!running && actions}
    </div>
  )
}

/** A failure on the page you came to read (a chat that could not start): part of the page, its reason in full, text actions only. */
function InlineNote({ title, reason, actions }: { title: React.ReactNode; reason: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div data-fold role="alert" className="mx-note is-edge-error">
      <FeedbackMark tone="error" />
      <div className="mx-note-body">
        <span className="mx-note-title">{title}</span>
        <span className="mx-note-reason">{reason}</span>
        {actions !== undefined && <span className="mx-note-actions">{actions}</span>}
      </div>
    </div>
  )
}

/**
 * The one sentence under a field whose value is not allowed. The field points at it with `aria-describedby` and says
 * `aria-invalid`; `fieldErrorProps` gives both. It shows after the field is left or its form is sent, never while typing.
 */
function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return <p id={id} role="alert" className="mx-field-error"><span>{children}</span></p>
}

/** The attributes a field with an error carries: marked invalid and described by its message. */
function fieldErrorProps(id: string, error: string | null | undefined): { "aria-invalid"?: true; "aria-describedby"?: string } {
  return error === null || error === undefined || error === "" ? {} : { "aria-invalid": true, "aria-describedby": id }
}

export { CopyDetails, FeedbackButton, FeedbackMark, FieldError, fieldErrorProps, InlineNote, ProblemLine, ScopedAlert }
