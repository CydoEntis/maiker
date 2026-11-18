import { flushSync } from 'react-dom'
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ReducedMotionContext } from '@/features/workspace/components/motion'
import { buildLayout, followAfterScroll, glidePlan, glideTop, isAtBottom, sendSpacer, sendTop, visibleRange, type FollowState } from './windowing'

type Props<T> = {
  items: readonly T[]
  /** A key that stays with the item for its whole life, never its index. */
  getKey: (item: T) => string
  /** Height used for a row until it has been measured. */
  estimate: number
  renderItem: (item: T) => ReactNode
  label: string
  /** Rows drawn beyond the view, each way. */
  overscan?: number
  /** Scrolls the row with this key to the top of the view; a new `nonce` scrolls again to the same row. */
  scrollTarget?: { key: string; nonce: number } | null
  /**
   * Each new value is a message the person just sent: the newest row `isSent` accepts is scrolled to the top of the view,
   * with room left below it, and the view stays there while the reply is shorter than the view, then follows its end.
   */
  toLatest?: number
  /** Whether a row is a message the person sent, for `toLatest` to find. */
  isSent?: (item: T) => boolean
}

/** Used until the list has been laid out, and where there is no layout (tests). */
const FALLBACK_VIEWPORT_PX = 600
const DEFAULT_OVERSCAN = 6
/**
 * A scroll is the reader's only for this long after they last touched the list (wheel, pointer, key
 * or finger). A web view also sends scroll events nobody asked for, as it settles a view the list has
 * just moved or resized; read as the reader moving, one of those would take the view from the list.
 */
const READER_SCROLL_MS = 1200

/** The scroller's padding, top and bottom together; none where there is no style sheet (tests). */
function paddingOf(element: HTMLElement): number {
  const style = getComputedStyle(element)
  return (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
}

/**
 * A scrolling list that draws only the rows near the view, so a conversation of thousands of items
 * costs what a screenful costs. Rows are placed with `transform` (no layout work per scroll) and their
 * heights are measured as they are drawn. A chat opens on its newest row and follows it while the view is at the end,
 * so a turn that streams in stays in sight; a move up by the reader lets go, and nothing then moves the view but them.
 * A message the person sends scrolls to the top of the view with room left below it.
 */
export function VirtualList<T>({ items, getKey, estimate, renderItem, label, overscan = DEFAULT_OVERSCAN, scrollTarget = null, toLatest = 0, isSent }: Props<T>) {
  const scroller = useRef<HTMLDivElement>(null)
  // Whether the view follows the newest row, and where it was last seen (`followAfterScroll`).
  const follow = useRef<FollowState>({ following: true, top: 0, total: 0 })
  // The view holds a sent message at its top until the reader moves it.
  const pinned = useRef(false)
  // When the reader last touched the list, and whether they still hold it (a scrollbar being dragged).
  const touchedAt = useRef(Number.NEGATIVE_INFINITY)
  const held = useRef(false)
  const touched = useCallback(() => {
    touchedAt.current = performance.now()
    pinned.current = false
  }, [])
  useEffect(() => {
    const release = () => {
      if (!held.current) return
      held.current = false
      touched()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [touched])
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map())
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT_PX)
  const [padding, setPadding] = useState(0)
  const [away, setAway] = useState(false)

  // The row a sent message stands at: found when `toLatest` moves, and kept while the rows are only added to.
  const [sent, setSent] = useState<{ at: number; nonce: number } | null>(null)
  const [seenLatest, setSeenLatest] = useState(toLatest)
  if (seenLatest !== toLatest) {
    setSeenLatest(toLatest)
    const found = isSent === undefined ? -1 : items.findLastIndex(isSent)
    if (found !== -1) setSent({ at: found, nonce: toLatest })
  }
  // The view takes a sent message to its top, and holds it there until the reader moves it; once the reply under it is
  // taller than the view, the view follows the reply's end.
  useLayoutEffect(() => {
    if (sent === null) return
    pinned.current = true
    follow.current = { ...follow.current, following: true }
  }, [sent])
  // The echo of a message gives way to the history's own row of it: the stand stays on whichever row is the sent one now.
  const standAt = useMemo(() => {
    if (sent === null || isSent === undefined) return null
    const there = items[sent.at]
    if (there !== undefined && isSent(there)) return sent.at
    const last = items.findLastIndex(isSent)
    return last === -1 ? null : last
  }, [sent, items, isSent])

  const keys = useMemo(() => items.map(getKey), [items, getKey])
  const rowsLayout = useMemo(() => buildLayout(keys, heights, estimate), [keys, heights, estimate])
  // The scroller's own padding is part of what the view shows, so the room leaves the message exactly at the top.
  const spacer = standAt === null ? 0 : sendSpacer(viewport - padding, rowsLayout.offsets[standAt] ?? 0, rowsLayout.total)
  const layout = useMemo(() => ({ ...rowsLayout, total: rowsLayout.total + spacer }), [rowsLayout, spacer])
  const range = visibleRange(layout, scrollTop, viewport, overscan)
  const totalNow = useRef(layout.total)
  useLayoutEffect(() => { totalNow.current = layout.total }, [layout.total])
  // Where the view belongs while the list holds it: on the sent message while its reply is shorter than the view, else on
  // the newest row while the view follows it; null when it is the reader's. The browser stops a scroll past the end at the end.
  const wantedTop = (): number | null => {
    if (pinned.current && standAt !== null && spacer > 0) return sendTop(layout.offsets[standAt] ?? 0)
    if (pinned.current || follow.current.following) return layout.total
    return null
  }
  const wanted = useRef(wantedTop)
  useLayoutEffect(() => { wanted.current = wantedTop })

  // Measures are applied before the browser paints, so a row that has just come in is never drawn at its estimate for a
  // frame and then moved: the ref callbacks note heights while React commits and the layout effect below applies them;
  // the observer's reports (a row that grew) are applied at once, outside React's commit.
  const pending = useRef(new Map<string, number>())
  // What the rows were last laid out as, for `apply` to tell which measured rows sit above the view.
  const indexOf = useMemo(() => new Map(keys.map((key, index) => [key, index])), [keys])
  const laidOut = useRef({ indexOf, layout, heights })
  useLayoutEffect(() => { laidOut.current = { indexOf, layout, heights } })
  // How far rows above the view grew or shrank as they were measured, for the view to move by as much.
  const anchor = useRef(0)
  const apply = useCallback(() => {
    const batch = pending.current
    if (batch.size === 0) return
    pending.current = new Map()
    // Reading, rows come into the drawn range above the view and their measured height replaces the estimate:
    // without moving the view by the difference, what is being read jumps.
    const top = scroller.current?.scrollTop ?? 0
    if (wanted.current() === null) {
      const { indexOf: index, layout: was, heights: measured } = laidOut.current
      for (const [key, height] of batch) {
        const at = index.get(key)
        const offset = at === undefined ? undefined : was.offsets[at]
        const before = measured.get(key) ?? estimate
        if (offset !== undefined && offset + before <= top) anchor.current += height - before
      }
    }
    setHeights((current) => {
      let changed = false
      const next = new Map(current)
      for (const [key, height] of batch) {
        if (next.get(key) === height) continue
        next.set(key, height)
        changed = true
      }
      return changed ? next : current
    })
  }, [estimate])
  useLayoutEffect(() => { apply() })

  const record = useCallback((element: HTMLElement) => {
    const key = element.dataset.key
    const height = Math.round(element.offsetHeight)
    // A row with no height has not been laid out (or there is no layout engine): its estimate stands.
    if (key === undefined || height === 0) return
    pending.current.set(key, height)
  }, [])

  // One observer for every drawn row; a row reports its own height when it changes (an expanded card, a reply that grew).
  const observer = useRef<ResizeObserver | null>(null)
  // A row that leaves the drawn range stops being observed (the ref's cleanup), so a long read does not keep every row
  // it ever drew under the observer.
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (element === null) return
    if (observer.current === null && typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver((entries) => {
        for (const entry of entries) record(entry.target as HTMLElement)
        flushSync(apply)
      })
    }
    const watching = observer.current
    watching?.observe(element)
    record(element)
    return () => { watching?.unobserve(element) }
  }, [record, apply])
  useEffect(() => () => {
    observer.current?.disconnect()
    observer.current = null
  }, [])

  // Whether the view is at the end of the list, for the way back to it and for a view that changes size.
  const atEnd = useRef(true)
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    const update = () => {
      setViewport(element.clientHeight || FALLBACK_VIEWPORT_PX)
      setPadding(paddingOf(element))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(update)
    watch.observe(element)
    return () => { watch.disconnect() }
  }, [])

  // The list moves the view itself: remember where it is, so the reader's next scroll is measured from there.
  const place = useCallback((element: HTMLDivElement, top: number, total: number) => {
    element.scrollTop = top
    follow.current = { ...follow.current, top: element.scrollTop, total }
    setScrollTop(element.scrollTop)
    atEnd.current = isAtBottom(element.scrollTop, element.clientHeight || FALLBACK_VIEWPORT_PX, total)
    setAway(!atEnd.current)
  }, [])

  // Rows above the view were measured: the view moves with them, so the row being read stays where it was.
  useLayoutEffect(() => {
    const element = scroller.current
    const delta = anchor.current
    anchor.current = 0
    if (!element || delta === 0 || wanted.current() !== null) return
    place(element, element.scrollTop + delta, layout.total)
  }, [layout.total, place])

  // The view holds its place: on the sent message while it is pinned, on the newest row while it follows it (a view that
  // got shorter, as a message box grows, included). Otherwise it is the reader's, and rows that come in or grow leave it
  // where it is.
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    const top = wanted.current()
    if (top !== null) place(element, top, layout.total)
    else setAway(!isAtBottom(element.scrollTop, element.clientHeight || FALLBACK_VIEWPORT_PX, layout.total))
  }, [layout.total, standAt, viewport, place])

  // A reader at the end stays at the end when the view changes size: a message box that grows must not cover the last row.
  useLayoutEffect(() => {
    const element = scroller.current
    if (element && wanted.current() === null && atEnd.current) place(element, totalNow.current, totalNow.current)
  }, [viewport, place])

  // A link to a row (an approval's step) moves the view there; the view is the reader's from then on.
  const handled = useRef<number | null>(null)
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element || scrollTarget === null || handled.current === scrollTarget.nonce) return
    const at = keys.indexOf(scrollTarget.key)
    if (at === -1) return
    handled.current = scrollTarget.nonce
    follow.current = { ...follow.current, following: false }
    pinned.current = false
    place(element, layout.offsets[at] ?? 0, layout.total)
  }, [scrollTarget, keys, layout, place])

  const onScroll = () => {
    const element = scroller.current
    if (!element) return
    setScrollTop(element.scrollTop)
    const byReader = held.current || performance.now() - touchedAt.current < READER_SCROLL_MS
    const height = element.clientHeight || FALLBACK_VIEWPORT_PX
    follow.current = followAfterScroll(follow.current, { scrollTop: element.scrollTop, viewport: height, total: layout.total }, !byReader)
    atEnd.current = isAtBottom(element.scrollTop, height, layout.total)
    setAway(!atEnd.current)
    // A scroll nobody asked for (a web view settling a view the list moved) that left a held view elsewhere is put right.
    const top = wanted.current()
    if (!byReader && top !== null && element.scrollTop !== top) place(element, top, layout.total)
  }

  // A wheel turn arrives before the scroll it causes, and a streaming commit in between would undo it.
  const onWheel = (event: WheelEvent) => {
    touched()
    stopGlide()
    // The scrolling region is only as wide as the chat column; a wheel turn over the space beside it scrolls it too.
    const element = scroller.current
    if (element !== null && event.target instanceof Node && !element.contains(event.target)) element.scrollTop += event.deltaY
    // A turn up lets go of the newest row at once; nothing above to scroll to (a short chat, or the top) is not leaving it.
    if (event.deltaY < 0 && (element?.scrollTop ?? 0) > 0) follow.current = { ...follow.current, following: false }
  }

  // The jump to the newest row glides there, so the reader sees which way the chat went; the reader's own scroll, a
  // new jump or the list going away ends it, and with motion reduced it is a plain jump.
  const reducedMotion = useContext(ReducedMotionContext)
  const glide = useRef<number | null>(null)
  const stopGlide = useCallback(() => {
    if (glide.current !== null) cancelAnimationFrame(glide.current)
    glide.current = null
  }, [])
  useEffect(() => stopGlide, [stopGlide])
  const jumpToLatest = () => {
    const element = scroller.current
    if (!element) return
    stopGlide()
    const arrive = () => {
      glide.current = null
      follow.current = { ...follow.current, following: true }
      place(element, totalNow.current, totalNow.current)
    }
    const bottomNow = () => element.scrollHeight - element.clientHeight
    const plan = reducedMotion ? null : glidePlan(element.scrollTop, bottomNow(), element.clientHeight)
    if (plan === null) {
      arrive()
      return
    }
    const began = performance.now()
    const step = (now: number) => {
      const share = (now - began) / plan.ms
      if (share >= 1) {
        arrive()
        return
      }
      // The bottom is read each frame: a reply that is still arriving moves it.
      place(element, glideTop(plan.from, bottomNow(), share), totalNow.current)
      glide.current = requestAnimationFrame(step)
    }
    place(element, plan.from, totalNow.current)
    glide.current = requestAnimationFrame(step)
  }

  const drawn = items.slice(range.start, range.end)
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onWheel={onWheel}>
      <div ref={scroller} role="region" aria-label={label} tabIndex={0} className="mx-chat-scroller min-h-0 flex-1 overflow-y-auto overscroll-contain" onScroll={onScroll} onPointerDown={() => { held.current = true; touched(); stopGlide() }} onKeyDown={() => { touched(); stopGlide() }} onTouchMove={() => { touched(); stopGlide() }}>
        <div className="relative" style={{ height: layout.total }}>
          {drawn.map((item, index) => {
            const at = range.start + index
            const key = keys[at] ?? ''
            return (
              <div key={key} ref={measure} data-key={key} className="absolute inset-x-0 top-0" style={{ transform: `translateY(${String(layout.offsets[at] ?? 0)}px)` }}>
                {renderItem(item)}
              </div>
            )
          })}
        </div>
      </div>
      {away && rowsLayout.total > viewport && (
        <Button type="button" variant="soft" size="icon" className="mx-chat-jump size-8 rounded-full bg-raise" aria-label="Jump to the latest message" onClick={jumpToLatest}>
          <ArrowDown className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}
