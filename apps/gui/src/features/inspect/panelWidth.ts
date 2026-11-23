/** The side panel opens this wide (a list of files or changes); its edge drags between the two bounds. */
export const DEFAULT_WIDTH_PX = 340
export const MIN_WIDTH_PX = 300
export const MAX_WIDTH_PX = 640

export function clampWidth(width: number): number {
  return Math.round(Math.min(Math.max(width, MIN_WIDTH_PX), MAX_WIDTH_PX))
}

function widthIn(stored: string | null): number | null {
  if (stored === null || stored.trim() === '') return null
  const width = Number(stored)
  return Number.isFinite(width) ? width : null
}

/**
 * The width to open at, from what is stored: `kept` under the current key, `earlier` under the key of the panel that
 * showed a file and its diff inside itself. A width chosen for that panel is taken only when it still fits a list; one
 * as wide as a viewer needed (the old default included) goes back to the default, since the file now has its own pane.
 * Null is the default.
 */
export function storedWidth(kept: string | null, earlier: string | null): number | null {
  const now = widthIn(kept)
  if (now !== null) return now >= MIN_WIDTH_PX ? clampWidth(now) : null
  const before = widthIn(earlier)
  return before !== null && before >= MIN_WIDTH_PX && before <= MAX_WIDTH_PX ? Math.round(before) : null
}
