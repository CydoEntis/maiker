/** The geometry of a virtualised list whose rows have different heights. Pure, so it is tested without a layout engine. */

export type ListLayout = {
  /** Where each row starts, from the top of the list. */
  readonly offsets: readonly number[]
  readonly heights: readonly number[]
  readonly total: number
}

/** A row not yet measured counts as `estimate` tall. */
export function buildLayout(keys: readonly string[], measured: ReadonlyMap<string, number>, estimate: number): ListLayout {
  const offsets: number[] = []
  const heights: number[] = []
  let total = 0
  for (const key of keys) {
    const height = measured.get(key) ?? estimate
    offsets.push(total)
    heights.push(height)
    total += height
  }
  return { offsets, heights, total }
}

/** The first row that ends below `position`. */
function firstEndingBelow(layout: ListLayout, position: number): number {
  let low = 0
  let high = layout.offsets.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const end = (layout.offsets[middle] ?? 0) + (layout.heights[middle] ?? 0)
    if (end <= position) low = middle + 1
    else high = middle
  }
  return low
}

/** The rows to draw for a view: those that touch it, plus `overscan` rows each way. `end` is exclusive. */
export function visibleRange(layout: ListLayout, scrollTop: number, viewport: number, overscan: number): { start: number; end: number } {
  const count = layout.offsets.length
  if (count === 0) return { start: 0, end: 0 }
  const first = firstEndingBelow(layout, scrollTop)
  const last = firstEndingBelow(layout, scrollTop + viewport)
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + 1 + overscan) }
}

/** Within this many pixels of the bottom, a list counts as being at its end. */
export const AT_BOTTOM_PX = 48

export function isAtBottom(scrollTop: number, viewport: number, total: number): boolean {
  return total - scrollTop - viewport <= AT_BOTTOM_PX
}

/** Whether the list follows its newest row, and where the view was last seen, so the next scroll has a direction. */
export type FollowState = {
  readonly following: boolean
  readonly top: number
  readonly total: number
}

/**
 * Whether the list follows its newest row after a scroll. It goes by the direction the reader moves, not by how far from
 * the bottom they are: any move up lets go at once (a reply growing under a reader who nudged up would otherwise pull
 * them back down), and only a move down that ends within `AT_BOTTOM_PX` of the bottom takes it again. A scroll the list
 * caused itself, and the web view pulling the view in because the list got shorter, say nothing about what the reader wants.
 */
export function followAfterScroll(previous: FollowState, now: { readonly scrollTop: number; readonly viewport: number; readonly total: number }, causedByList: boolean): FollowState {
  const next: FollowState = { following: previous.following, top: now.scrollTop, total: now.total }
  if (causedByList) return next
  const pulledIn = now.total < previous.total && now.scrollTop >= now.total - now.viewport
  if (pulledIn) return next
  if (now.scrollTop < previous.top) return { ...next, following: false }
  if (now.scrollTop > previous.top && isAtBottom(now.scrollTop, now.viewport, now.total)) return { ...next, following: true }
  return next
}

/**
 * Where a message the person just sent stands in the view: this far under the top (the row's own 8px padding makes it
 * 16 to the text), so the reply is read from its start and the chat never clears.
 */
export const SEND_TOP_GAP_PX = 8

/** The scroll position that puts the row starting at `anchorOffset` at the top of the view. */
export function sendTop(anchorOffset: number): number {
  return Math.max(0, anchorOffset - SEND_TOP_GAP_PX)
}

/**
 * The empty space below the rows, so the sent message can stand at the top even while the reply is short. It shrinks as
 * the reply grows, and is gone once the rows from the message to the end fill the view.
 */
export function sendSpacer(viewport: number, anchorOffset: number, total: number): number {
  return Math.max(0, viewport - SEND_TOP_GAP_PX - (total - anchorOffset))
}

/** The jump to the newest row glides for this long at least, and longer the further it goes, up to the most. */
const GLIDE_MIN_MS = 180
const GLIDE_MAX_MS = 420
const GLIDE_MS_PER_PX = 0.25
/** A glide never covers more than this many screens: from further up the view starts this close, so a long chat is not drawn row by row on the way. */
const GLIDE_SCREENS = 2
const EASE_POWER = 3

/** Where a glide to `bottom` starts from and how long it takes; null when the view is already there. */
export function glidePlan(from: number, bottom: number, viewport: number): { from: number; ms: number } | null {
  if (bottom - from <= 0) return null
  const start = Math.max(from, bottom - viewport * GLIDE_SCREENS)
  return { from: start, ms: Math.min(GLIDE_MAX_MS, GLIDE_MIN_MS + (bottom - start) * GLIDE_MS_PER_PX) }
}

/** Where the view is `share` (0 to 1) of the way through a glide: quick at first, easing into the newest row. */
export function glideTop(from: number, bottom: number, share: number): number {
  const eased = 1 - (1 - Math.min(1, Math.max(0, share))) ** EASE_POWER
  return from + (bottom - from) * eased
}
