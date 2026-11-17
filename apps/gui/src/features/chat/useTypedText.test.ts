import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextPosition, shownAt, TICK_MS, useTypedText } from './useTypedText'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('typed text', () => {
  it('shows what was there at once, then types toward what arrives, ending on all of it', () => {
    const { result, rerender } = renderHook(({ text }) => useTypedText(text, true), { initialProps: { text: 'Hello' } })
    expect(result.current).toBe('Hello')

    rerender({ text: 'Hello, and welcome to the new chat' })
    expect(result.current).toBe('Hello')
    act(() => { vi.advanceTimersByTime(TICK_MS) })
    expect(result.current.length).toBeGreaterThan('Hello'.length)
    expect(result.current.length).toBeLessThan('Hello, and welcome to the new chat'.length)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current).toBe('Hello, and welcome to the new chat')
  })

  it('types a reply that arrives whole from its first letter when it is new', () => {
    const { result } = renderHook(() => useTypedText('Going well, thanks.', true, true))
    expect(result.current).toBe('')
    act(() => { vi.advanceTimersByTime(TICK_MS) })
    expect(result.current.length).toBeGreaterThan(0)
    expect(result.current.length).toBeLessThan('Going well, thanks.'.length)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current).toBe('Going well, thanks.')
  })

  it('comes out word by word at a steady pace, not most of it in the first moment', () => {
    const reply = 'The quick brown fox jumps over the lazy dog and keeps on running. '.repeat(40)
    const stops: number[] = []
    for (let position = 0; position < reply.length; position = nextPosition(reply, position)) stops.push(shownAt(reply, position))

    // Every stop is at the end of a word, and each frame adds at most a few words, never a burst.
    expect(stops.slice(1).every((at) => at === 0 || /\s/.test(reply.charAt(at)))).toBe(true)
    const steps = stops.slice(1).map((at, index) => at - (stops[index] ?? 0))
    expect(Math.max(...steps)).toBeLessThan(60)
    // A quarter of a second in, most of a long reply is still to come; it is all there within a few seconds.
    const quarterSecond = Math.round(250 / TICK_MS)
    expect(stops[quarterSecond]).toBeLessThan(reply.length / 4)
    expect(stops.length * TICK_MS).toBeLessThan(5000)
    expect(stops.length * TICK_MS).toBeGreaterThan(2000)
  })

  it('takes a short reply a moment, and never passes the end', () => {
    expect(shownAt('ok', nextPosition('ok', 2))).toBe(2)
    expect(shownAt('ok', 9)).toBe(2)
    const line = 'Done: all four checks pass and the branch is pushed.'
    let ticks = 0
    for (let position = 0; position < line.length; position = nextPosition(line, position)) ticks += 1
    expect(ticks * TICK_MS).toBeLessThan(400)
    expect(ticks * TICK_MS).toBeGreaterThan(100)
  })

  it('runs no timer once it has caught up, and starts one again when more arrives', () => {
    const { result, rerender } = renderHook(({ text }) => useTypedText(text, true), { initialProps: { text: 'Hello' } })
    expect(vi.getTimerCount()).toBe(0)
    rerender({ text: 'Hello there' })
    expect(vi.getTimerCount()).toBe(1)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current).toBe('Hello there')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows everything at once when it is off', () => {
    const { result, rerender } = renderHook(({ text }) => useTypedText(text, false), { initialProps: { text: 'a' } })
    rerender({ text: 'a much longer reply' })
    expect(result.current).toBe('a much longer reply')
  })

  it('never shows more than has arrived when the text shrinks', () => {
    const { result, rerender } = renderHook(({ text }) => useTypedText(text, true), { initialProps: { text: 'abc **bo' } })
    rerender({ text: 'abc' })
    expect(result.current).toBe('abc')
  })
})
