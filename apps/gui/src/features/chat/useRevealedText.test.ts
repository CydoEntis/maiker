import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REVEAL_MS, revealEnds, useRevealedText } from './useRevealedText'

const units = (text: string) => revealEnds(text).map((end, index, all) => text.slice(all[index - 1] ?? 0, end).trim())

describe('the units a reply is revealed in', () => {
  it('splits prose into sentences', () => {
    expect(units('Auth now uses sessions. Old logins keep working! Is that fine? Yes')).toEqual(['Auth now uses sessions.', 'Old logins keep working!', 'Is that fine?', 'Yes'])
  })

  it('makes each list item and each table row a unit, and a wrapped item part of its item', () => {
    expect(units('- one\n- two\n  still two\n\n| a | b |\n|---|---|\n| 1 | 2 |')).toEqual(['- one', '- two\n  still two', '| a | b |', '|---|---|', '| 1 | 2 |'])
  })

  it('keeps a fenced block of code whole', () => {
    expect(units('Here.\n\n```ts\nconst a = 1. b\nconst c = 2\n```\n\nDone.')).toEqual(['Here.', '```ts\nconst a = 1. b\nconst c = 2\n```', 'Done.'])
  })

  it('does not end a sentence inside a number or a name', () => {
    expect(units('Version 1.2 is out, see src/a.ts now.')).toEqual(['Version 1.2 is out, see src/a.ts now.'])
  })
})

describe('a reply revealed a sentence at a time', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const reply = 'One. Two. Three.'

  it('starts with the first sentence of a reply that arrived live, then adds one every tick', () => {
    const { result } = renderHook(() => useRevealedText(reply, true, true))
    expect(result.current).toBe('One.')

    act(() => { vi.advanceTimersByTime(REVEAL_MS) })
    expect(result.current).toBe('One. Two.')

    act(() => { vi.advanceTimersByTime(REVEAL_MS) })
    expect(result.current).toBe(reply)
  })

  it('shows a reply that was already there whole', () => {
    const { result } = renderHook(() => useRevealedText(reply, true, false))
    expect(result.current).toBe(reply)
  })

  it('shows everything at once when motion is reduced', () => {
    const { result } = renderHook(() => useRevealedText(reply, false, true))
    expect(result.current).toBe(reply)
  })

  it('reveals only what was added when the text grows', () => {
    const { result, rerender } = renderHook(({ text }) => useRevealedText(text, true, false), { initialProps: { text: 'One.' } })
    rerender({ text: 'One. Two. Three.' })
    expect(result.current).toBe('One.')

    act(() => { vi.advanceTimersByTime(REVEAL_MS * 2) })
    expect(result.current).toBe('One. Two. Three.')
  })
})
