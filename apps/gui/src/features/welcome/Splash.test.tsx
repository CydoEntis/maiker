import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPLASH_LEAST_MS, SPLASH_MOST_MS, SPLASH_OUT_MS, Splash } from './Splash'

const splash = () => document.querySelector('.mx-splash')

describe('Splash', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('stays until the mark has drawn, even when the sessions are already there', () => {
    render(<Splash ready reducedMotion={false} />)
    act(() => { vi.advanceTimersByTime(SPLASH_LEAST_MS - 1) })
    expect(splash()?.getAttribute('data-leaving')).toBe('false')
    act(() => { vi.advanceTimersByTime(1) })
    expect(splash()?.getAttribute('data-leaving')).toBe('true')
    act(() => { vi.advanceTimersByTime(SPLASH_OUT_MS) })
    expect(splash()).toBeNull()
  })

  it('waits for the sessions, but not past its limit', () => {
    render(<Splash ready={false} reducedMotion={false} />)
    act(() => { vi.advanceTimersByTime(SPLASH_MOST_MS - 1) })
    expect(splash()?.getAttribute('data-leaving')).toBe('false')
    act(() => { vi.advanceTimersByTime(1) })
    expect(splash()?.getAttribute('data-leaving')).toBe('true')
    act(() => { vi.advanceTimersByTime(SPLASH_OUT_MS) })
    expect(splash()).toBeNull()
  })

  it('leaves as soon as the sessions arrive', () => {
    const { rerender } = render(<Splash ready={false} reducedMotion={false} />)
    act(() => { vi.advanceTimersByTime(SPLASH_LEAST_MS) })
    expect(splash()).not.toBeNull()
    rerender(<Splash ready reducedMotion={false} />)
    act(() => { vi.advanceTimersByTime(SPLASH_OUT_MS) })
    expect(splash()).toBeNull()
  })
})
