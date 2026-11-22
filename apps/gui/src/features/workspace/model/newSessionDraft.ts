/**
 * The text of a New session draft that was left without being started, kept in memory for this app run only: switching to
 * another session and coming back finds it. Esc, the close button and a start empty it. An empty draft is never kept.
 */
let parked = ''

/** Keeps `text` as the draft; whitespace alone is nothing, so it clears it. */
export function parkDraft(text: string): void {
  parked = text.trim() === '' ? '' : text
}

export function parkedDraft(): string {
  return parked
}

export function discardDraft(): void {
  parkDraft('')
}
