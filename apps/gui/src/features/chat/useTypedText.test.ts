import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CATCH_UP_SECONDS, charsDue, MIN_CHARS_PER_SECOND, useTypedText, wordEdge } from './useTypedText'

describe('how fast a reply is typed', () => {
  it('never goes below the minimum pace, so a short reply still reads as typed', () => {
    expect(charsDue(10, 1)).toBe(MIN_CHARS_PER_SECOND)
  })

  it('rises so that a long reply catches up within the limit', () => {
    expect(charsDue(5000, 1) * CATCH_UP_SECONDS).toBeCloseTo(5000)
  })
})

describe('where a cut falls', () => {
  it('ends on the last whole word', () => {
    expect(wordEdge('one two three', 6)).toBe(3)
  })

  it('shows everything once the cut reaches the end', () => {
    expect(wordEdge('one two', 99)).toBe(7)
  })

  it('cuts inside a word with no gap near it, such as a long address', () => {
    const address = 'x'.repeat(200)
    expect(wordEdge(address, 100)).toBe(100)
  })
})

describe('a reply being typed', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const words = 'The quick brown fox jumps over the lazy dog. '.repeat(8)

  it('shows a reply that was already there whole', () => {
    const { result } = renderHook(() => useTypedText(words, true, false))
    expect(result.current).toBe(words)
  })

  it('starts a reply that arrived while watched at its first words and reaches the end', () => {
    const { result } = renderHook(() => useTypedText(words, true, true))
    expect(result.current).toBe('')
    act(() => { vi.advanceTimersByTime(400) })
    expect(result.current.length).toBeGreaterThan(0)
    expect(result.current.length).toBeLessThan(words.length)
    expect(words.startsWith(result.current)).toBe(true)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current).toBe(words)
  })

  it('shows everything at once when it is turned off', () => {
    const { result } = renderHook(() => useTypedText(words, false, true))
    expect(result.current).toBe(words)
  })

  it('types on from where it was when the reply grows', () => {
    const { result, rerender } = renderHook(({ text }) => useTypedText(text, true, false), { initialProps: { text: 'Hello there. ' } })
    expect(result.current).toBe('Hello there. ')
    rerender({ text: `Hello there. ${words}` })
    expect(result.current.startsWith('Hello there.')).toBe(true)
    expect(result.current.length).toBeLessThan(words.length)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current).toBe(`Hello there. ${words}`)
  })
})
