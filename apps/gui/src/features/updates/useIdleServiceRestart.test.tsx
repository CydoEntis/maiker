import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceRestartStep } from './serviceRestart'
import { SERVICE_IDLE_POLL_MS } from './serviceRestart'
import { useIdleServiceRestart } from './useIdleServiceRestart'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function mount(initial: { step: ServiceRestartStep; key: string | null }) {
  const restart = vi.fn()
  const recheck = vi.fn()
  const view = renderHook((props: { step: ServiceRestartStep; key: string | null }) => { useIdleServiceRestart({ ...props, restart, recheck }) }, { initialProps: initial })
  return { restart, recheck, ...view }
}

describe('restarting an older service by itself', () => {
  it('never restarts or looks again while the setting is off', () => {
    const { restart, recheck } = mount({ step: 'off', key: '0.71.0' })
    vi.advanceTimersByTime(SERVICE_IDLE_POLL_MS * 3)
    expect(restart).not.toHaveBeenCalled()
    expect(recheck).not.toHaveBeenCalled()
  })

  it('looks again every poll while busy, and restarts once it is quiet', () => {
    const { restart, recheck, rerender } = mount({ step: 'wait', key: '0.71.0' })
    vi.advanceTimersByTime(SERVICE_IDLE_POLL_MS * 2)
    expect(recheck).toHaveBeenCalledTimes(2)
    expect(restart).not.toHaveBeenCalled()

    rerender({ step: 'restart', key: '0.71.0' })
    expect(restart).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(SERVICE_IDLE_POLL_MS * 2)
    expect(recheck).toHaveBeenCalledTimes(2)
  })

  it('tries each version once, so a failed restart leaves the manual notice', () => {
    const { restart, rerender } = mount({ step: 'restart', key: '0.71.0' })
    rerender({ step: 'wait', key: '0.71.0' })
    rerender({ step: 'restart', key: '0.71.0' })
    expect(restart).toHaveBeenCalledTimes(1)
    rerender({ step: 'restart', key: '0.72.0' })
    expect(restart).toHaveBeenCalledTimes(2)
  })

  it('does nothing without a service that is behind', () => {
    const { restart, recheck } = mount({ step: 'restart', key: null })
    vi.advanceTimersByTime(SERVICE_IDLE_POLL_MS)
    expect(restart).not.toHaveBeenCalled()
    expect(recheck).not.toHaveBeenCalled()
  })
})
