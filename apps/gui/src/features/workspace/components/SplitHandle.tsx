import type { PointerEvent } from 'react'
import { dragWidths } from '../model/columns'
import type { Divider } from '../model/splitTree'

type Axis = 'columns' | 'rows'

const CHILD: Record<Axis, string> = { columns: ':scope > .mx-pane-column', rows: ':scope > .mx-pane-cell' }

/** The sizes in px of the columns (left to right) or the panes of a column (top to bottom). */
function sizesOf(container: HTMLElement, axis: Axis): number[] {
  return Array.from(container.querySelectorAll<HTMLElement>(CHILD[axis])).map((child) => {
    const box = child.getBoundingClientRect()
    return axis === 'columns' ? box.width : box.height
  })
}

/**
 * Follows the pointer from a press on a handle until it is let go, telling `apply` how far it has moved along the
 * handle's axis. A pointer reports more often than the screen draws; only the last position of a frame is used.
 */
function followDrag(event: PointerEvent<HTMLDivElement>, sideways: boolean, apply: (deltaPx: number) => void): void {
  event.preventDefault()
  const handle = event.currentTarget
  handle.setPointerCapture(event.pointerId)
  const start = sideways ? event.clientX : event.clientY
  handle.classList.add('is-dragging')
  let frame: number | null = null
  let latest = start
  const flush = () => {
    frame = null
    apply(latest - start)
  }
  const move = (moveEvent: globalThis.PointerEvent) => {
    latest = sideways ? moveEvent.clientX : moveEvent.clientY
    frame ??= requestAnimationFrame(flush)
  }
  const end = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame)
      flush()
    }
    handle.classList.remove('is-dragging')
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

/**
 * The gap between two columns, or two panes of a column: invisible until hovered, drag to resize,
 * double-click to even them out.
 */
export function SplitHandle({ axis, index, onResize, onReset }: { axis: Axis; index: number; onResize: (sizes: number[]) => void; onReset: () => void }) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const container = event.currentTarget.parentElement
    if (!container) return
    const sizes = sizesOf(container, axis)
    followDrag(event, axis === 'columns', (delta) => { onResize(dragWidths(sizes, index, delta)) })
  }
  return (
    <div
      role="separator"
      aria-orientation={axis === 'columns' ? 'vertical' : 'horizontal'}
      aria-label={axis === 'columns' ? 'Resize columns' : 'Resize panes'}
      title="Drag to resize · double-click to even out"
      className={`mx-split-handle is-${axis}`}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
    />
  )
}

const FULL = 100
const percent = (share: number): string => `${String(share * FULL)}%`

/**
 * The gap between the two sides of one branch of a session's split tree (`model/splitTree.ts`): the same handle, placed
 * over the branch's dividing line. Dragging gives the first side its new share of the branch; double-click halves it.
 */
export function TreeSplitHandle({ divider, onResize, onReset }: { divider: Divider; onResize: (ratio: number) => void; onReset: () => void }) {
  const sideways = divider.dir === 'right'
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const tree = event.currentTarget.parentElement?.getBoundingClientRect()
    // The branch's own length along the drag, in px: the share is of the branch, not of the whole tree.
    const length = tree === undefined ? 0 : sideways ? tree.width * divider.w : tree.height * divider.h
    if (length <= 0) return
    const from = divider.ratio
    followDrag(event, sideways, (delta) => { onResize(from + delta / length) })
  }
  const style = sideways
    ? { left: percent(divider.x + divider.w * divider.ratio), top: percent(divider.y), height: percent(divider.h) }
    : { top: percent(divider.y + divider.h * divider.ratio), left: percent(divider.x), width: percent(divider.w) }
  return (
    <div
      role="separator"
      aria-orientation={sideways ? 'vertical' : 'horizontal'}
      aria-label="Resize panes"
      title="Drag to resize · double-click to even out"
      className={`mx-split-handle is-tree ${sideways ? 'is-columns' : 'is-rows'}`}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
    />
  )
}
