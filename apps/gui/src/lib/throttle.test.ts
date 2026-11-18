import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { throttleTrailing } from './throttle'

describe('a call that is throttled with a trailing run', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('runs the first call at once and collapses a burst into one more at its end', () => {
    const run = vi.fn()
    const call = throttleTrailing(run, 100)
    call()
    expect(run).toHaveBeenCalledTimes(1)
    for (let frame = 0; frame < 5; frame += 1) { vi.advanceTimersByTime(16); call() }
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(100)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('runs nothing after it is cancelled', () => {
    const run = vi.fn()
    const call = throttleTrailing(run, 100)
    call()
    vi.advanceTimersByTime(10)
    call()
    call.cancel()
    vi.advanceTimersByTime(500)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
