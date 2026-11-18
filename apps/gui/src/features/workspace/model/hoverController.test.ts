import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOVER_CARD_DELAY_MS, type Box } from './hoverCard'
import { HOVER_CARD_WARM_MS, HoverController } from './hoverController'

const ROW: Box = { left: 20, right: 280, top: 100, bottom: 140 }
const other: Box = { left: 20, right: 280, top: 160, bottom: 200 }

function controller() {
  return new HoverController(() => ({ width: 1400, height: 900 }))
}

describe('the hover card controller', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows the first card only after a resting pointer has waited the delay, fading in', () => {
    const hover = controller()
    hover.enter('a', () => ROW)
    vi.advanceTimersByTime(HOVER_CARD_DELAY_MS - 1)
    expect(hover.getSnapshot().target).toBeNull()
    vi.advanceTimersByTime(1)
    expect(hover.getSnapshot()).toMatchObject({ open: true, cold: true, target: { id: 'a', place: { left: 288, top: 96 } } })
  })

  it('never shows a card for a pointer that left before the delay', () => {
    const hover = controller()
    hover.enter('a', () => ROW)
    vi.advanceTimersByTime(100)
    hover.leave()
    vi.advanceTimersByTime(HOVER_CARD_DELAY_MS)
    expect(hover.getSnapshot().target).toBeNull()
  })

  it('moves a warm card to the next row at once, with no delay and no fade', () => {
    const hover = controller()
    hover.enter('a', () => ROW)
    vi.advanceTimersByTime(HOVER_CARD_DELAY_MS)
    hover.leave()
    expect(hover.getSnapshot()).toMatchObject({ open: false, target: { id: 'a' } })
    vi.advanceTimersByTime(HOVER_CARD_WARM_MS - 1)
    hover.enter('b', () => other)
    expect(hover.getSnapshot()).toMatchObject({ open: true, target: { id: 'b', place: { top: 156 } } })
    vi.advanceTimersByTime(HOVER_CARD_WARM_MS * 2)
    expect(hover.getSnapshot().target?.id).toBe('b')
  })

  it('unmounts a card that stayed away longer than the warm time, and the next one waits again', () => {
    const hover = controller()
    hover.enter('a', () => ROW)
    vi.advanceTimersByTime(HOVER_CARD_DELAY_MS)
    hover.leave()
    vi.advanceTimersByTime(HOVER_CARD_WARM_MS)
    expect(hover.getSnapshot().target).toBeNull()
    hover.enter('b', () => other)
    expect(hover.getSnapshot().target).toBeNull()
  })

  it('tells its listeners, and not after it is disposed', () => {
    const hover = controller()
    const listener = vi.fn()
    hover.subscribe(listener)
    hover.enter('a', () => ROW)
    vi.advanceTimersByTime(HOVER_CARD_DELAY_MS)
    expect(listener).toHaveBeenCalledTimes(1)
    hover.dispose()
    hover.leave()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
