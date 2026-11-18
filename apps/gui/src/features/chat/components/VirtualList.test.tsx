import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VirtualList } from './VirtualList'
import { SEND_TOP_GAP_PX } from './windowing'

const ROW = 50
/** The rows the list is given; the one called `sent` is the person's message. */
const rows = (count: number) => Array.from({ length: count }, (_, index) => `row-${String(index)}`)
const isSent = (key: string) => key.startsWith('sent')

type ListProps = { items?: readonly string[]; toLatest?: number }
function list({ items = rows(20), toLatest = 0 }: ListProps = {}) {
  return (
    <VirtualList items={items} getKey={(key) => key} estimate={ROW} label="Conversation" renderItem={(key) => <p>{key}</p>} toLatest={toLatest} isSent={isSent} />
  )
}

/** jsdom has no layout, so the scroller's position is a plain number the test can set and read. */
function scroller(): HTMLElement {
  const element = screen.getByRole('region', { name: 'Conversation' })
  let top = 0
  Object.defineProperty(element, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value } })
  return element
}

const latest = () => screen.queryByRole('button', { name: 'Jump to the latest message' })

afterEach(() => { vi.useRealTimers() })

describe('a conversation list', () => {
  it('offers no jump to the latest message when the whole chat is already on screen, even after a wheel move up', () => {
    render(list({ items: rows(2) }))
    const element = scroller()

    fireEvent.wheel(element, { deltaY: -3 })

    expect(latest()).toBeNull()
  })

  it('opens on the newest row and holds it while the first rows are measured', () => {
    const { rerender } = render(list())
    const element = scroller()
    rerender(list({ items: rows(21) }))

    expect(element.scrollTop).toBe(21 * ROW)
    expect(latest()).toBeNull()
  })

  it('follows the newest row as rows stream in while the view is at the end, long after the chat opened', () => {
    vi.useFakeTimers()
    const { rerender } = render(list())
    const element = scroller()
    rerender(list({ items: rows(21) }))
    act(() => { vi.advanceTimersByTime(5_000) })

    rerender(list({ items: rows(22) }))
    rerender(list({ items: rows(23) }))

    expect(element.scrollTop).toBe(23 * ROW)
    expect(latest()).toBeNull()
  })

  it('never pulls a reader who scrolled up back down when rows stream in, however little they moved, and offers the way down', () => {
    const { rerender } = render(list())
    const element = scroller()
    rerender(list({ items: rows(21) }))

    // A nudge up, still within reach of the end: the wheel lets go before the scroll it causes lands.
    fireEvent.wheel(element, { deltaY: -3 })
    rerender(list({ items: rows(22) }))
    // The view is 600px, so the end of 22 rows is at 22 * ROW - 600.
    const nudged = 22 * ROW - 600 - 10
    act(() => { element.scrollTop = nudged })
    fireEvent.scroll(element)
    rerender(list({ items: rows(24) }))

    expect(element.scrollTop).toBe(nudged)
    expect(latest()).not.toBeNull()
  })

  it('follows again once the reader scrolls back down to the end', () => {
    const { rerender } = render(list())
    const element = scroller()
    rerender(list({ items: rows(21) }))
    fireEvent.wheel(element, { deltaY: -3 })
    act(() => { element.scrollTop = 100 })
    fireEvent.scroll(element)

    fireEvent.wheel(element, { deltaY: 3 })
    act(() => { element.scrollTop = 21 * ROW - 600 })
    fireEvent.scroll(element)
    rerender(list({ items: rows(22) }))

    expect(element.scrollTop).toBe(22 * ROW)
  })

  it('leaves the view where the reader put it when rows come in', () => {
    const { rerender } = render(list())
    const element = scroller()
    rerender(list({ items: rows(21) }))
    const reading = 300

    fireEvent.pointerDown(element)
    act(() => { element.scrollTop = reading })
    fireEvent.scroll(element)
    rerender(list({ items: rows(22) }))

    expect(element.scrollTop).toBe(reading)
    expect(latest()).not.toBeNull()
  })

  it('keeps the row being read in place while rows coming in above it are measured taller than their estimate', () => {
    const tall = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      const index = Number(this.dataset.key?.replace('row-', '') ?? Number.NaN)
      return Number.isNaN(index) ? 0 : index >= 19 && index <= 21 ? ROW + 30 : ROW
    })
    // The first draw (from the top) and the hold on the newest row both skip rows 19 to 21.
    const { rerender } = render(list({ items: rows(40) }))
    const element = scroller()
    rerender(list({ items: rows(40) }))
    const reading = 25 * ROW

    fireEvent.pointerDown(element)
    act(() => { element.scrollTop = reading })
    fireEvent.scroll(element)

    // Rows 19 to 21 came into the drawn range above the view, each 30px taller than estimated.
    expect(element.scrollTop).toBe(reading + 3 * 30)
    tall.mockRestore()
  })

  it('puts the view back on the newest row after a scroll nobody asked for, while the chat opens', () => {
    const { rerender } = render(list())
    const element = scroller()
    rerender(list({ items: rows(21) }))

    // The web view moves the view by itself, with no wheel, pointer, key or finger before it.
    act(() => { element.scrollTop = 100 })
    fireEvent.scroll(element)

    expect(element.scrollTop).toBe(21 * ROW)
  })

  it('glides to the newest row from the button, and stops where it is when the reader scrolls meanwhile', () => {
    vi.useFakeTimers()
    const { rerender } = render(list())
    const element = scroller()
    // A real view: 600px tall over 1050px of rows, so the bottom is at 450.
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 21 * ROW })
    rerender(list({ items: rows(21) }))
    fireEvent.wheel(element, { deltaY: -3 })
    act(() => { element.scrollTop = 0 })
    fireEvent.scroll(element)

    fireEvent.click(latest() as HTMLElement)
    act(() => { vi.advanceTimersByTime(100) })
    const partWay = element.scrollTop
    expect(partWay).toBeGreaterThan(0)
    expect(partWay).toBeLessThan(450)

    // The reader takes over: the glide ends there.
    fireEvent.wheel(element, { deltaY: -3 })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(element.scrollTop).toBe(partWay)
    expect(latest()).not.toBeNull()

    // Left alone, it arrives.
    fireEvent.click(latest() as HTMLElement)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(element.scrollTop).toBe(21 * ROW)
    expect(latest()).toBeNull()
  })

  it('goes to the newest row from the button, and the button is gone when the reader scrolls back down to the bottom', () => {
    const { rerender } = render(list())
    const element = scroller()
    rerender(list({ items: rows(21) }))
    fireEvent.wheel(element, { deltaY: -3 })
    act(() => { element.scrollTop = 100 })
    fireEvent.scroll(element)

    fireEvent.click(latest() as HTMLElement)
    expect(latest()).toBeNull()
    expect(element.scrollTop).toBe(21 * ROW)

    fireEvent.wheel(element, { deltaY: -3 })
    act(() => { element.scrollTop = 400 })
    fireEvent.scroll(element)
    act(() => { element.scrollTop = 21 * ROW })
    fireEvent.scroll(element)
    expect(latest()).toBeNull()
  })

  it('places a row that has just come in at its measured height in the same commit, not a frame later', () => {
    const measured = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(30)
    render(list({ items: rows(3) }))

    const offsets = Array.from(document.querySelectorAll<HTMLElement>('[data-key]'), (element) => element.style.transform)
    expect(offsets).toEqual(['translateY(0px)', 'translateY(30px)', 'translateY(60px)'])
    measured.mockRestore()
  })
})

describe('sending a message', () => {
  const chat = [...rows(20), 'sent-1']
  const sentOffset = 20 * ROW

  it('scrolls it to the top of the view, with room under it for a reply that has not come', () => {
    const { rerender } = render(list({ items: rows(20) }))
    const element = scroller()
    rerender(list({ items: chat, toLatest: 1 }))

    expect(element.scrollTop).toBe(sentOffset - SEND_TOP_GAP_PX)
    // The room: the view is 600px, so the sent row is followed by 600 - gap - its own height of empty space.
    const total = Number(element.firstElementChild?.getAttribute('style')?.match(/height: (\d+)px/)?.[1])
    expect(total).toBe(sentOffset + ROW + (600 - SEND_TOP_GAP_PX - ROW))
  })

  it('holds it at the top while the reply is shorter than the view, the room under it shrinking, then follows the reply\'s end', () => {
    const { rerender } = render(list({ items: rows(20) }))
    const element = scroller()
    rerender(list({ items: chat, toLatest: 1 }))
    const reply = (grown: number) => [...chat, ...rows(grown).map((key) => `reply-${key}`)]
    const total = () => Number(element.firstElementChild?.getAttribute('style')?.match(/height: (\d+)px/)?.[1])

    for (let grown = 1; grown <= 5; grown += 1) rerender(list({ items: reply(grown), toLatest: 1 }))
    expect(element.scrollTop).toBe(sentOffset - SEND_TOP_GAP_PX)
    expect(total()).toBe(sentOffset + 600 - SEND_TOP_GAP_PX)

    for (let grown = 6; grown <= 30; grown += 1) rerender(list({ items: reply(grown), toLatest: 1 }))
    // A reply taller than the view leaves no room: the rows themselves are the height, and the view is on their end.
    expect(total()).toBe((chat.length + 30) * ROW)
    expect(element.scrollTop).toBe(total())
    expect(latest()).toBeNull()
  })

  it('stands on the history\'s own row when the echo of the message gives way to it', () => {
    const { rerender } = render(list({ items: rows(20) }))
    const element = scroller()
    rerender(list({ items: [...rows(20), 'sent-echo'], toLatest: 1 }))
    rerender(list({ items: [...rows(20), 'sent-real', 'reply'], toLatest: 1 }))

    expect(element.scrollTop).toBe(sentOffset - SEND_TOP_GAP_PX)
  })

  it('hands the view to the reader as soon as they move it up, and the reply growing past the view leaves them there', () => {
    const { rerender } = render(list({ items: rows(20) }))
    const element = scroller()
    rerender(list({ items: chat, toLatest: 1 }))

    fireEvent.wheel(element, { deltaY: -3 })
    act(() => { element.scrollTop = sentOffset - 200 })
    fireEvent.scroll(element)
    rerender(list({ items: [...chat, ...rows(30).map((key) => `reply-${key}`)], toLatest: 1 }))

    expect(element.scrollTop).toBe(sentOffset - 200)
    expect(latest()).not.toBeNull()
  })

  it('scrolls to the new message again when another is sent', () => {
    const { rerender } = render(list({ items: rows(20) }))
    const element = scroller()
    const first = [...chat, 'reply-1']
    rerender(list({ items: first, toLatest: 1 }))
    fireEvent.wheel(element, { deltaY: 3 })

    rerender(list({ items: [...first, 'sent-2'], toLatest: 2 }))

    expect(element.scrollTop).toBe((first.length) * ROW - SEND_TOP_GAP_PX)
  })
})
