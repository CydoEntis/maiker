/**
 * The terminal dock's size (layout 2h). It opens at the design's size, which follows the window; once dragged it keeps
 * the size it was given. At the bottom that is a height, on the right a width.
 */
export type DockAxis = 'height' | 'width'

/** The least and most a dragged dock may be, in px. */
export const DOCK_MIN_PX: Readonly<Record<DockAxis, number>> = { height: 120, width: 300 }
export const DOCK_MAX_PX: Readonly<Record<DockAxis, number>> = { height: 640, width: 1100 }
/** The dock never takes more than this share of the room it shares with the chat, so the chat keeps the larger part. */
export const DOCK_MAX_SHARE = 0.6

const SIZE_KEY: Readonly<Record<DockAxis, string>> = { height: 'maiker.gui.terminal-dock.height', width: 'maiker.gui.terminal-dock.width' }

/** A size the dock can have where it and the chat share `room` px. */
export function clampDockSize(axis: DockAxis, size: number, room: number): number {
  const most = Math.max(DOCK_MIN_PX[axis], Math.min(DOCK_MAX_PX[axis], Math.floor(room * DOCK_MAX_SHARE)))
  return Math.round(Math.min(Math.max(size, DOCK_MIN_PX[axis]), most))
}

/** The size dragged last time, or null for the design's own. */
export function readDockSize(axis: DockAxis): number | null {
  try {
    const stored = window.localStorage.getItem(SIZE_KEY[axis])
    if (stored === null) return null
    const size = Number(stored)
    return Number.isFinite(size) && size >= DOCK_MIN_PX[axis] && size <= DOCK_MAX_PX[axis] ? size : null
  } catch {
    return null
  }
}

export function writeDockSize(axis: DockAxis, size: number | null): void {
  try {
    if (size === null) window.localStorage.removeItem(SIZE_KEY[axis])
    else window.localStorage.setItem(SIZE_KEY[axis], String(size))
  } catch {
    // The size is only remembered, never needed.
  }
}
