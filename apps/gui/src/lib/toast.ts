import { useEffect, useState, type ReactNode } from 'react'
import { errorMessage, explainError } from '@/lib/error-message'
import { saysNotConnected } from '@/lib/serviceLine'

/**
 * The app's one toast system (docs/DESIGN.md, Errors). A toast is for news about something you are not looking at; a
 * failure you can see stays where it happened (its row, its field, its chat). Every toast goes through `toast` below and
 * is drawn by `Toaster` (`components/ui/toaster.tsx`).
 *
 * - `success` and `info` hide after 4 seconds; `error`, `warning`, `needs` and `progress` stay until dismissed or replaced.
 * - A second failure of the same kind updates the first, with a count, instead of stacking (`merge`, and by default every
 *   error with the same title).
 * - While the window has no line to its service the toasts are held back (`holdToasts`) and come back when it returns.
 */
export type ToastKind = 'success' | 'info' | 'error' | 'warning' | 'needs' | 'progress'

export type ToastAction = {
  label: string
  /** `event.preventDefault()` keeps the toast up after the click, as a progress toast's Cancel does. */
  onClick: (event: { preventDefault: () => void }) => void
}

export type ToastOptions = {
  /** A toast with this id is replaced in place (a progress toast becoming its outcome). */
  id?: string | number | undefined
  /** Why, in one plain sentence (or a small picture such as a progress bar). It clamps at three lines. */
  description?: ReactNode | undefined
  /** The raw text (an error's own words) behind Copy details; never shown in the toast itself. */
  details?: string | undefined
  /** The one primary action, in the toast's status colour. */
  action?: ToastAction | undefined
  /** A second, outlined action after the primary one. */
  secondary?: ToastAction | undefined
  /** Milliseconds; `Infinity` stays until it is replaced or dismissed. Unset, the kind decides. */
  duration?: number | undefined
  /** False takes the ✕ away: only the action or a replacement ends it (a send only Cancel can stop). */
  closeButton?: boolean | undefined
  /** Failures that share `key` are one toast with a count; `title` names them all ("2 chats could not start"). */
  merge?: { key: string; title: (count: number) => string } | undefined
}

export type ToastItem = {
  readonly id: string
  readonly kind: ToastKind
  readonly title: string
  /** How many same-kind failures this toast stands for. */
  readonly count: number
  /** True when `title` already says the count, so the toast does not add one. */
  readonly countInTitle: boolean
  readonly description?: ReactNode
  readonly details?: string
  readonly action?: ToastAction
  readonly secondary?: ToastAction
  readonly closeButton: boolean
  readonly mergeKey: string | null
}

/** How long a success or a plain note stays. */
export const TOAST_HIDE_MS = 4000
/** The most toasts shown at once; the others wait their turn. */
export const MOST_TOASTS = 3

const STAYS = Infinity
const HIDES: Readonly<Record<ToastKind, number>> = { success: TOAST_HIDE_MS, info: TOAST_HIDE_MS, error: STAYS, warning: STAYS, needs: STAYS, progress: STAYS }

/** The id a toast that was not shown answers with, so a caller that keeps the id has one that names no toast. */
const NOT_SHOWN = 'service-not-connected'

type Timer = { handle: ReturnType<typeof setTimeout> | null; remaining: number; startedAt: number }
type Snapshot = { readonly items: readonly ToastItem[]; readonly held: boolean }

let snapshot: Snapshot = { items: [], held: false }
const timers = new Map<string, Timer>()
/** The pointer or the keys are on a toast: nothing hides while it is being read. */
let reading = false
let nextId = 0
const listeners = new Set<() => void>()

function publish(next: Snapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

const timersRun = (): boolean => !reading && !snapshot.held

function clearTimer(id: string): void {
  const timer = timers.get(id)
  if (timer?.handle != null) clearTimeout(timer.handle)
  timers.delete(id)
}

function startTimer(id: string, timer: Timer): void {
  timer.startedAt = Date.now()
  timer.handle = setTimeout(() => { dismiss(id) }, timer.remaining)
}

function setTimer(id: string, duration: number): void {
  clearTimer(id)
  if (!Number.isFinite(duration)) return
  const timer: Timer = { handle: null, remaining: duration, startedAt: 0 }
  timers.set(id, timer)
  if (timersRun()) startTimer(id, timer)
}

function pauseTimers(): void {
  const now = Date.now()
  for (const timer of timers.values()) {
    if (timer.handle === null) continue
    clearTimeout(timer.handle)
    timer.handle = null
    timer.remaining = Math.max(0, timer.remaining - (now - timer.startedAt))
  }
}

function resumeTimers(): void {
  for (const [id, timer] of timers) if (timer.handle === null) startTimer(id, timer)
}

function show(kind: ToastKind, title: string, options: ToastOptions = {}): string {
  const duration = options.duration ?? HIDES[kind]
  const mergeKey = options.merge?.key ?? (kind === 'error' ? `error:${title}` : null)
  const content = {
    kind,
    ...(options.description === undefined || options.description === null ? {} : { description: options.description }),
    ...(options.details === undefined || options.details === '' ? {} : { details: options.details }),
    ...(options.action === undefined ? {} : { action: options.action }),
    ...(options.secondary === undefined ? {} : { secondary: options.secondary }),
    closeButton: options.closeButton !== false,
    mergeKey,
  }
  const items = snapshot.items
  const replaced = options.id === undefined ? undefined : items.find((item) => item.id === String(options.id))
  const merged = replaced ?? (mergeKey === null ? undefined : items.find((item) => item.mergeKey === mergeKey && item.kind === kind))
  if (merged !== undefined) {
    const count = replaced === undefined ? merged.count + 1 : 1
    const named = options.merge?.title(count)
    const item: ToastItem = { id: merged.id, title: named ?? title, count, countInTitle: named !== undefined, ...content }
    publish({ ...snapshot, items: items.map((candidate) => (candidate.id === merged.id ? item : candidate)) })
    setTimer(item.id, duration)
    return item.id
  }
  nextId += 1
  const id = options.id === undefined ? `toast-${String(nextId)}` : String(options.id)
  const named = options.merge?.title(1)
  const item: ToastItem = { id, title: named ?? title, count: 1, countInTitle: named !== undefined, ...content }
  // Newest first: it stands above the others, which stay where they are.
  publish({ ...snapshot, items: [item, ...items] })
  setTimer(id, duration)
  return id
}

/** Takes a toast away; with no id, every toast. */
function dismiss(id?: string | number): void {
  if (id === undefined) {
    for (const key of [...timers.keys()]) clearTimer(key)
    if (snapshot.items.length > 0) publish({ ...snapshot, items: [] })
    return
  }
  const key = String(id)
  clearTimer(key)
  if (snapshot.items.some((item) => item.id === key)) publish({ ...snapshot, items: snapshot.items.filter((item) => item.id !== key) })
}

/** No line to the service is the window's news, not one action's: the title-bar chip and the offline dialog say it once. */
function showError(title: string, options?: ToastOptions): string {
  return saysNotConnected(title) ? NOT_SHOWN : show('error', title, options)
}

/**
 * A failure with its error (docs/CODE-STANDARDS.md#errors): the title says what failed, the reason says why in plain
 * words (`explainError`: a raw tool or OS failure of a known kind in plain words, any other made one sentence), and the
 * error's own text is behind Copy details when it says more than the reason. An error that only says the window has
 * no line to the service is not shown (`showError`).
 */
function showFailure(what: string, error: unknown, options: ToastOptions = {}): string {
  const said = errorMessage(error, '')
  if (saysNotConnected(said)) return NOT_SHOWN
  // An error that only repeats the title adds nothing under it.
  if (said !== '' && said === what) return show('error', what, options)
  const { reason, details } = explainError(said, what)
  return show('error', what, { description: reason, ...(details === null ? {} : { details }), ...options })
}

export const toast = {
  /** Something you asked for is done and nothing on screen shows it. Hides after 4s. */
  success: (title: string, options?: ToastOptions) => show('success', title, options),
  /** A plain note (an Undo, a hint). Hides after 4s. */
  info: (title: string, options?: ToastOptions) => show('info', title, options),
  /** Something failed where you are not looking. Stays until dismissed. */
  error: showError,
  /** `error` with why in plain words as the reason, and the error's own text behind Copy details. */
  failed: showFailure,
  /** Worth knowing and not a failure (a machine on an older version). Stays until dismissed. */
  warning: (title: string, options?: ToastOptions) => show('warning', title, options),
  /** A session you are not looking at needs you. Stays until answered or dismissed. */
  needs: (title: string, options?: ToastOptions) => show('needs', title, options),
  /** Work under way; replace it by its id with the outcome. */
  progress: (title: string, options?: ToastOptions) => show('progress', title, options),
  dismiss,
}

/** While the window has no line to its service, toasts wait: none shows and none times out until it is back. */
export function holdToasts(held: boolean): void {
  if (held === snapshot.held) return
  if (held) pauseTimers()
  publish({ ...snapshot, held })
  if (!held && timersRun()) resumeTimers()
}

/** The pointer or the keys are on a toast, so none hides under them. */
export function readingToasts(on: boolean): void {
  if (on === reading) return
  reading = on
  if (on) pauseTimers()
  else if (timersRun()) resumeTimers()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * What the toaster draws: the toasts, newest first, and whether they are held back. It is ordinary state, not
 * `useSyncExternalStore`: a toast raised while the window renders its sessions (a startup failure) would force that
 * render to start over synchronously and put the session list a frame late.
 */
export function useToasts(): Snapshot {
  const [shown, setShown] = useState(snapshot)
  useEffect(() => {
    const sync = () => { setShown(snapshot) }
    // A toast raised between the first render and this subscription is picked up here.
    sync()
    return subscribe(sync)
  }, [])
  return shown
}

/** For tests: the toasts now, and a clean store. */
export function currentToasts(): Snapshot {
  return snapshot
}

export function resetToasts(): void {
  dismiss()
  reading = false
  snapshot = { items: [], held: false }
  nextId = 0
}
