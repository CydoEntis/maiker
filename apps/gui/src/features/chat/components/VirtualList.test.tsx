import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VirtualList } from './VirtualList'

const ROW = 50
const rows = (count: number) => Array.from({ length: count }, (_, index) => `row-${String(index)}`)

function list(count: number) {
  return (
    <VirtualList items={rows(count)} getKey={(key) => key} estimate={ROW} label="Conversation" renderItem={(key) => <p>{key}</p>} />
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

describe('a conversation list that follows its newest row', () => {
  it('offers no jump to the latest message when the whole chat is already on screen, even after a wheel move up', () => {
    render(list(2))
    const element = scroller()

    fireEvent.wheel(element, { deltaY: -3 })

    expect(latest()).toBeNull()
  })

  it('stays on the newest row while the reader has not moved', () => {
    const { rerender } = render(list(20))
    const element = scroller()
    rerender(list(21))

    expect(element.scrollTop).toBe(21 * ROW)
    expect(latest()).toBeNull()
  })

  it('stops following when the reader moves up a little, and a growing last row leaves the view alone', () => {
    const { rerender } = render(list(20))
    const element = scroller()
    rerender(list(21))
    const reading = 21 * ROW - 10

    fireEvent.pointerDown(element)
    act(() => { element.scrollTop = reading })
    fireEvent.scroll(element)
    rerender(list(22))

    expect(element.scrollTop).toBe(reading)
    expect(latest()).not.toBeNull()
  })

  it('keeps the row being read in place while rows coming in above it are measured taller than their estimate', () => {
    const tall = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      const index = Number(this.dataset.key?.replace('row-', '') ?? Number.NaN)
      return Number.isNaN(index) ? 0 : index >= 19 && index <= 21 ? ROW + 30 : ROW
    })
    // The first draw (from the top) and the follow to the newest row both skip rows 19 to 21.
    const { rerender } = render(list(40))
    const element = scroller()
    rerender(list(40))
    const reading = 25 * ROW

    fireEvent.pointerDown(element)
    act(() => { element.scrollTop = reading })
    fireEvent.scroll(element)

    // Rows 19 to 21 came into the drawn range above the view, each 30px taller than estimated.
    expect(element.scrollTop).toBe(reading + 3 * 30)
    tall.mockRestore()
  })

  it('keeps following through a scroll the reader did not make, and comes back to the newest row', () => {
    const { rerender } = render(list(20))
    const element = scroller()
    rerender(list(21))

    // The web view moves the view by itself, with no wheel, pointer, key or finger before it.
    act(() => { element.scrollTop = 100 })
    fireEvent.scroll(element)
    expect(element.scrollTop).toBe(21 * ROW)
    rerender(list(22))

    expect(element.scrollTop).toBe(22 * ROW)
    expect(latest()).toBeNull()
  })

  it('stops at once on a wheel move up, before its scroll event', () => {
    const { rerender } = render(list(20))
    const element = scroller()
    rerender(list(21))

    fireEvent.wheel(element, { deltaY: -3 })
    rerender(list(22))

    expect(element.scrollTop).toBe(21 * ROW)
    expect(latest()).not.toBeNull()
  })

  it('glides to the newest row from the button, and stops where it is when the reader scrolls meanwhile', () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(list(20))
      const element = scroller()
      // A real view: 600px tall over 1050px of rows, so the bottom is at 450.
      Object.defineProperty(element, 'clientHeight', { configurable: true, value: 600 })
      Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 21 * ROW })
      rerender(list(21))
      fireEvent.wheel(element, { deltaY: -3 })
      act(() => { element.scrollTop = 0 })
      fireEvent.scroll(element)

      fireEvent.click(latest() as HTMLElement)
      act(() => { vi.advanceTimersByTime(100) })
      const partWay = element.scrollTop
      expect(partWay).toBeGreaterThan(0)
      expect(partWay).toBeLessThan(450)

      // The reader takes over: the glide ends there and the list does not follow.
      fireEvent.wheel(element, { deltaY: -3 })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(element.scrollTop).toBe(partWay)
      expect(latest()).not.toBeNull()

      // Left alone, it arrives and follows again.
      fireEvent.click(latest() as HTMLElement)
      act(() => { vi.advanceTimersByTime(1000) })
      expect(element.scrollTop).toBe(21 * ROW)
      expect(latest()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('follows again from the button, and when the reader scrolls back down to the bottom', () => {
    const { rerender } = render(list(20))
    const element = scroller()
    rerender(list(21))
    fireEvent.wheel(element, { deltaY: -3 })
    act(() => { element.scrollTop = 500 })
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

  it('goes back to the newest row and follows it when the person sends something, from wherever they had scrolled', () => {
    const sent = (count: number, toLatest: number) => <VirtualList items={rows(count)} getKey={(key) => key} estimate={ROW} label="Conversation" renderItem={(key) => <p>{key}</p>} toLatest={toLatest} />
    const { rerender } = render(sent(20, 0))
    const element = scroller()
    rerender(sent(21, 0))
    fireEvent.wheel(element, { deltaY: -3 })
    act(() => { element.scrollTop = 300 })
    fireEvent.scroll(element)
    expect(latest()).not.toBeNull()

    rerender(sent(22, 1))

    expect(element.scrollTop).toBe(22 * ROW)
    expect(latest()).toBeNull()
  })

  it('puts a message just sent at the top of the view, with room under it for the reply, and holds it there as the reply grows', () => {
    const sent = (items: readonly string[], pin: number) => <VirtualList items={items} getKey={(key) => key} estimate={ROW} label="Conversation" renderItem={(key) => <p>{key}</p>} pinNewest={pin} isPinTarget={(key) => key.startsWith('me-')} />
    const history = [...rows(20), 'me-0']
    const { rerender } = render(sent(history, 0))
    const element = scroller()

    rerender(sent([...history, 'me-1'], 1))

    // me-1 is the 22nd row; the room under it lets it reach the top of a 600px view.
    expect(element.scrollTop).toBe(21 * ROW)
    expect((element.firstElementChild as HTMLElement | null)?.style.height).toBe(`${String(21 * ROW + 600)}px`)

    rerender(sent([...history, 'me-1', ...rows(30).map((key) => `reply-${key}`)], 1))

    expect(element.scrollTop).toBe(21 * ROW)
    expect(latest()).not.toBeNull()
  })

  it('follows the message from its echo to the history row that replaces it', () => {
    const sent = (items: readonly string[], pin: number) => <VirtualList items={items} getKey={(key) => key} estimate={ROW} label="Conversation" renderItem={(key) => <p>{key}</p>} pinNewest={pin} isPinTarget={(key) => key.startsWith('me-')} />
    const { rerender } = render(sent(rows(20), 0))
    const element = scroller()
    rerender(sent([...rows(20), 'me-echo'], 1))
    expect(element.scrollTop).toBe(20 * ROW)

    rerender(sent([...rows(20), 'extra', 'me-real'], 1))

    expect(element.scrollTop).toBe(21 * ROW)
  })

  it('lets go of the message when the reader scrolls, and keeps the view where they left it', () => {
    const sent = (items: readonly string[], pin: number) => <VirtualList items={items} getKey={(key) => key} estimate={ROW} label="Conversation" renderItem={(key) => <p>{key}</p>} pinNewest={pin} isPinTarget={(key) => key.startsWith('me-')} />
    const { rerender } = render(sent(rows(20), 0))
    const element = scroller()
    rerender(sent([...rows(20), 'me-1'], 1))

    fireEvent.wheel(element, { deltaY: -3 })
    act(() => { element.scrollTop = 15 * ROW })
    fireEvent.scroll(element)
    rerender(sent([...rows(20), 'me-1', 'reply'], 1))

    expect(element.scrollTop).toBe(15 * ROW)
  })

  it('places a row that has just come in at its measured height in the same commit, not a frame later', () => {
    const measured = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(30)
    render(list(3))

    const offsets = Array.from(document.querySelectorAll<HTMLElement>('[data-key]'), (element) => element.style.transform)
    expect(offsets).toEqual(['translateY(0px)', 'translateY(30px)', 'translateY(60px)'])
    measured.mockRestore()
  })
})
