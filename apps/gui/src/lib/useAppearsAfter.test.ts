import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOADING_SHOWS_AFTER_MS, useAppearsAfter } from './useAppearsAfter'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('a loading state', () => {
  it('stays hidden for a quick answer and shows once the wait is long enough to notice', () => {
    const { result } = renderHook(() => useAppearsAfter())
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(LOADING_SHOWS_AFTER_MS - 1) })
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe(true)
  })
})
