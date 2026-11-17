/**
 * Queued messages a chat box let go of (removed, taken back, sent now), counted one by one. The pane's queue names
 * its messages only by their words, so two the same must be told apart by how many are left: each one let go is
 * done once the pane's queue holds no more than `until` of its words.
 */
export type LetGo = { readonly text: string; readonly until: number }

export const NO_LET_GO: readonly LetGo[] = []

function count(queued: readonly string[], text: string): number {
  return queued.filter((item) => item === text).length
}

/** One more of `text` let go of, while `queued` is what the pane still holds. */
export function letGoOf(current: readonly LetGo[], queued: readonly string[], text: string): readonly LetGo[] {
  const already = current.filter((item) => item.text === text).length
  return [...current, { text, until: count(queued, text) - already - 1 }]
}

/** The latest one of `text` taken back: the daemon refused to let go of it. */
export function heldAgain(current: readonly LetGo[], text: string): readonly LetGo[] {
  const last = current.map((item) => item.text).lastIndexOf(text)
  return last < 0 ? current : [...current.slice(0, last), ...current.slice(last + 1)]
}

/** Those the pane's queue has caught up with are forgotten, so the same words queued again later show. */
export function stillLetGo(current: readonly LetGo[], queued: readonly string[]): readonly LetGo[] {
  const left = current.filter((item) => count(queued, item.text) > item.until)
  return left.length === current.length ? current : left
}

/** The pane's queue as the box shows it: as many of each words hidden as are let go of and not yet gone. */
export function shownQueued(queued: readonly string[], letGo: readonly LetGo[]): { index: number; text: string }[] {
  const hide = new Map<string, number>()
  for (const item of letGo) hide.set(item.text, (hide.get(item.text) ?? 0) + 1)
  const shown: { index: number; text: string }[] = []
  queued.forEach((text, index) => {
    const hidden = hide.get(text) ?? 0
    if (hidden > 0) {
      hide.set(text, hidden - 1)
      return
    }
    shown.push({ index, text })
  })
  return shown
}

/**
 * The words taken out of the pane's queue between two lists, when exactly one message left it; null otherwise. Only
 * the first leaving means the daemon typed it in; one from further back was taken out by a person.
 */
export function oneLeft(before: readonly string[], after: readonly string[]): { text: string; first: boolean } | null {
  if (before.length !== after.length + 1) return null
  const at = after.findIndex((text, index) => text !== before[index])
  const index = at < 0 ? after.length : at
  const rest = [...before.slice(0, index), ...before.slice(index + 1)]
  if (rest.some((text, i) => text !== after[i])) return null
  const text = before[index]
  return text === undefined ? null : { text, first: index === 0 }
}
