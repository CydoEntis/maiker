import { useSyncExternalStore } from 'react'

/**
 * The text of a New session draft that was left without being started, kept in memory for this app run only: switching to
 * another session and coming back finds it. Esc, the close button and a start empty it. An empty draft is never kept.
 */
let parked = ''
const listeners = new Set<() => void>()

const notify = () => { for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Keeps `text` as the draft; whitespace alone is nothing, so it clears it. */
export function parkDraft(text: string): void {
  const next = text.trim() === '' ? '' : text
  if (next === parked) return
  parked = next
  notify()
}

export function parkedDraft(): string {
  return parked
}

export function discardDraft(): void {
  parkDraft('')
}

/** Whether a draft with text is waiting to be picked up again. */
export function useHasParkedDraft(): boolean {
  return useSyncExternalStore(subscribe, () => parked !== '', () => false)
}
