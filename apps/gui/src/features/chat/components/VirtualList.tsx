import { flushSync } from 'react-dom'
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ReducedMotionContext } from '@/features/workspace/components/motion'
import { buildLayout, followAfterScroll, glidePlan, glideTop, isAtBottom, keptRoom, roomToPin, visibleRange, type FollowState } from './windowing'

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
  /** Each new value takes the view back to the newest row and follows it again (the person just queued something). */
  toLatest?: number
  /**
   * Each new value puts the last row `isPinTarget` picks at the top of the view and holds it there while the rows under
   * it come in (the person just sent something), until the reader scrolls. With no such row it is `toLatest`.
   */
  pinNewest?: number
  isPinTarget?: (item: T) => boolean
}

function lastIndexWhere<T>(items: readonly T[], test: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item !== undefined && test(item)) return index
  }
  return -1
}

/** The scroller's padding, top and bottom together; none where there is no style sheet (tests). */
function paddingOf(element: HTMLElement): number {
  const style = getComputedStyle(element)
  return (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
}

/** A placed view within this many pixels of its row counts as there (a scaled screen gives fractions). */
const PLACED_SLACK_PX = 1

/** Used until the list has been laid out, and where there is no layout (tests). */
const FALLBACK_VIEWPORT_PX = 600
const DEFAULT_OVERSCAN = 6
/**
 * A scroll is the reader's only for this long after they last touched the list (wheel, pointer, key
 * or finger). A web view also sends scroll events nobody asked for, as it settles a view the list has
 * just moved or resized; read as the reader moving up, one of those stopped the list following.
 */
const READER_SCROLL_MS = 1200

/**
 * A scrolling list that draws only the rows near the view, so a conversation of thousands of items
 * costs what a screenful costs. Rows are placed with `transform` (no layout work per scroll), their
 * heights are measured as they are drawn, and the list follows its newest row until the reader
 * moves up; then it offers a way back to it. A message just sent is pinned to the top of the view
 * instead, with the reply drawn under it, the way a chat page reads.
 */
export function VirtualList<T>({ items, getKey, estimate, renderItem, label, overscan = DEFAULT_OVERSCAN, scrollTarget = null, toLatest = 0, pinNewest = 0, isPinTarget }: Props<T>) {
  const scroller = useRef<HTMLDivElement>(null)
  // Whether the list follows its newest row, and where it was last seen (`followAfterScroll`).
  const follow = useRef<FollowState>({ following: true, top: 0, total: 0 })
  // Where the list itself last put the view, so the scroll event that write causes is not read as the reader's.
  const wrote = useRef<number | null>(null)
  // When the reader last touched the list, and whether they still hold it (a scrollbar being dragged).
  const touchedAt = useRef(Number.NEGATIVE_INFINITY)
  const held = useRef(false)
  const touched = useCallback(() => { touchedAt.current = performance.now() }, [])
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
  const [following, setFollowing] = useState(true)
  // Whether the message just sent is held at the top of the view (`pinNewest`); the ref is for event handlers.
  const [pinned, setPinned] = useState(false)
  const pinnedNow = useRef(false)
  const unpin = useCallback(() => {
    pinnedNow.current = false
    setPinned(false)
  }, [])
  // The room left under the last row when the pin went, for `keptRoom` to shrink.
  const [kept, setKept] = useState(0)

  const keys = useMemo(() => items.map(getKey), [items, getKey])
  const layout = useMemo(() => buildLayout(keys, heights, estimate), [keys, heights, estimate])
  const range = visibleRange(layout, scrollTop, viewport, overscan)
  // The pinned row is found again each time: a message sent shows as an echo first and as the history's own row once
  // the history has it, under another key.
  const pinAt = pinned && isPinTarget !== undefined ? lastIndexWhere(items, isPinTarget) : -1
  const pinOffset = pinAt === -1 ? null : (layout.offsets[pinAt] ?? null)
  // Empty room under the last row: what a pinned message needs to sit at the top while its reply is short, and once
  // nothing is pinned, only what is still on screen.
  const room = pinOffset !== null ? roomToPin(pinOffset, viewport, padding, layout.total) : keptRoom(kept, scrollTop, viewport, padding, layout.total)
  if (room !== kept) setKept(room)
  // What the view scrolls over: the rows and the room under them.
  const total = layout.total + room

  // A message just sent is pinned when its row is there; without one, the effect below goes to the newest row instead.
  const [seenPin, setSeenPin] = useState(pinNewest)
  if (seenPin !== pinNewest) {
    setSeenPin(pinNewest)
    const target = isPinTarget !== undefined && lastIndexWhere(items, isPinTarget) !== -1
    setPinned(target)
    if (target) setFollowing(false)
  }
  // A link to a row lets go of the pinned message (the effect that follows the link moves the view).
  const [seenTarget, setSeenTarget] = useState(scrollTarget?.nonce ?? null)
  if ((scrollTarget?.nonce ?? null) !== seenTarget) {
    setSeenTarget(scrollTarget?.nonce ?? null)
    setPinned(false)
  }
  useLayoutEffect(() => {
    pinnedNow.current = pinned
    if (pinned) follow.current = { ...follow.current, following: false }
  }, [pinned])

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
    // Reading up, rows come into the drawn range above the view and their measured height replaces the estimate:
    // without moving the view by the difference, what is being read jumps.
    const top = scroller.current?.scrollTop ?? 0
    if (!follow.current.following && !pinnedNow.current) {
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

  // One observer for every drawn row; a row reports its own height when it changes (an expanded card, a streamed message).
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

  // The list moves the view itself: remember what it wrote and where the view is.
  const place = useCallback((element: HTMLDivElement, top: number, total: number) => {
    element.scrollTop = top
    wrote.current = element.scrollTop
    follow.current = { ...follow.current, top: element.scrollTop, total }
    setScrollTop(element.scrollTop)
  }, [])

  // Rows above the view were measured: the view moves with them, so the row being read stays where it was.
  useLayoutEffect(() => {
    const element = scroller.current
    const delta = anchor.current
    anchor.current = 0
    if (!element || delta === 0 || follow.current.following || pinnedNow.current) return
    place(element, element.scrollTop + delta, total)
  }, [total, place])

  // Keep the newest row in view while the list follows it.
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    // With room left under the last row the newest row is still on screen (`keptRoom`): new rows fill the room first.
    if (!follow.current.following || pinnedNow.current || room > 0) {
      follow.current = { ...follow.current, total }
      return
    }
    place(element, total, total)
    // The view's own height is a dependency too: a message box that grows must not leave the newest row under it.
  }, [total, room, viewport, place])

  // A pinned row stays at the top of the view: rows above it measured, or its echo replaced by the history's row, move it.
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element || pinOffset === null || Math.abs(element.scrollTop - pinOffset) <= PLACED_SLACK_PX) return
    place(element, pinOffset, total)
  }, [pinOffset, total, place])

  // A link to a row (an approval's step) moves the view there and stops following the newest row.
  const handled = useRef<number | null>(null)
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element || scrollTarget === null || handled.current === scrollTarget.nonce) return
    const at = keys.indexOf(scrollTarget.key)
    if (at === -1) return
    handled.current = scrollTarget.nonce
    follow.current = { ...follow.current, following: false }
    place(element, layout.offsets[at] ?? 0, total)
    setFollowing(false)
  }, [scrollTarget, keys, layout, total, place])

  const onScroll = () => {
    const element = scroller.current
    if (!element) return
    setScrollTop(element.scrollTop)
    const ownWrite = wrote.current === element.scrollTop
    const byReader = held.current || performance.now() - touchedAt.current < READER_SCROLL_MS
    wrote.current = null
    if (pinnedNow.current) {
      // The reader scrolling lets go of the pinned message; a scroll nobody asked for is put back.
      if (!byReader || ownWrite) {
        if (!ownWrite && pinOffset !== null) place(element, pinOffset, total)
        return
      }
      unpin()
    }
    const height = element.clientHeight || FALLBACK_VIEWPORT_PX
    follow.current = followAfterScroll(follow.current, { scrollTop: element.scrollTop, viewport: height, total }, ownWrite || !byReader)
    setFollowing(follow.current.following)
    // A scroll nobody asked for that left a following list short of its newest row is put right.
    if (!ownWrite && !byReader && room === 0 && follow.current.following && !isAtBottom(element.scrollTop, height, total)) place(element, total, total)
  }

  // A wheel move up arrives before the scroll it causes, and a streaming commit in between would undo it.
  const onWheel = (event: WheelEvent) => {
    touched()
    stopGlide()
    if (pinnedNow.current) unpin()
    // The scrolling region is only as wide as the chat column; a wheel turn over the space beside it scrolls it too.
    const element = scroller.current
    if (element !== null && event.target instanceof Node && !element.contains(event.target)) element.scrollTop += event.deltaY
    // Nothing above to scroll to (a short chat, or the top already) is not leaving the newest row.
    if (event.deltaY >= 0 || !follow.current.following || (scroller.current?.scrollTop ?? 0) <= 0) return
    follow.current = { ...follow.current, following: false }
    setFollowing(false)
  }

  // The jump to the newest row glides there, so the reader sees which way the chat went; the reader's own scroll, a
  // new jump or the list going away ends it, and with motion reduced it is a plain jump.
  const reducedMotion = useContext(ReducedMotionContext)
  const glide = useRef<number | null>(null)
  const totalNow = useRef(layout.total)
  useLayoutEffect(() => { totalNow.current = layout.total }, [layout.total])
  const stopGlide = useCallback(() => {
    if (glide.current !== null) cancelAnimationFrame(glide.current)
    glide.current = null
  }, [])
  useEffect(() => stopGlide, [stopGlide])
  const jumpToLatest = () => {
    const element = scroller.current
    if (!element) return
    stopGlide()
    unpin()
    const arrive = () => {
      glide.current = null
      follow.current = { ...follow.current, following: true }
      place(element, totalNow.current, totalNow.current)
      setFollowing(true)
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

  // Sending is asking to see the answer: a reader scrolled up is taken back down.
  const handledLatest = useRef(toLatest)
  useEffect(() => {
    if (handledLatest.current === toLatest) return
    handledLatest.current = toLatest
    jumpToLatest()
  })

  // Sending is asking to see the answer, read from the top: the message just sent goes to the top of the view (pinned
  // above), or with no row to pin, the view goes to the newest row.
  const handledPin = useRef(pinNewest)
  useLayoutEffect(() => {
    if (handledPin.current === pinNewest) return
    handledPin.current = pinNewest
    if (pinned) stopGlide()
    else jumpToLatest()
  })

  const drawn = items.slice(range.start, range.end)
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onWheel={onWheel}>
      <div ref={scroller} role="region" aria-label={label} tabIndex={0} className="mx-chat-scroller min-h-0 flex-1 overflow-y-auto overscroll-contain" onScroll={onScroll} onPointerDown={() => { held.current = true; touched(); stopGlide() }} onKeyDown={() => { touched(); stopGlide() }} onTouchMove={() => { touched(); stopGlide() }}>
        <div className="relative" style={{ height: total }}>
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
      {!following && (pinned ? scrollTop + viewport < layout.total + padding : layout.total > viewport) && (
        <Button type="button" variant="soft" size="icon" className="mx-chat-jump size-8 rounded-full bg-raise" aria-label="Jump to the latest message" onClick={jumpToLatest}>
          <ArrowDown className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}
