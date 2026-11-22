import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOCK_TICK_MS, useNow } from './clock'

describe('shared clock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('moves forward a second at a time while something shows it', () => {
    const { result } = renderHook(() => useNow())
    const first = result.current

    act(() => { vi.advanceTimersByTime(CLOCK_TICK_MS) })

    expect(result.current).toBeGreaterThanOrEqual(first + CLOCK_TICK_MS)
  })

  it('keeps running while the window is visible with focus elsewhere, so it can be read from another window', () => {
    const { result } = renderHook(() => useNow())
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    act(() => { window.dispatchEvent(new Event('blur')) })
    const before = result.current

    act(() => { vi.advanceTimersByTime(CLOCK_TICK_MS * 5) })

    expect(result.current).toBeGreaterThan(before)
  })

  it('stands still while the window is hidden', () => {
    const { result } = renderHook(() => useNow())
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    const held = result.current

    act(() => { vi.advanceTimersByTime(CLOCK_TICK_MS * 5) })

    expect(result.current).toBe(held)
  })

  it('stops the clock once nothing shows it', () => {
    const { unmount } = renderHook(() => useNow())
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

})
