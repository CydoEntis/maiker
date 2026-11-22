import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentToasts, resetToasts } from '@/lib/toast'
import { FOUND_FOR_MS, OFFLINE_AFTER_MS } from './model/serviceState'
import { useServiceStage } from './useServiceStage'

function mount(online = true) {
  const onBack = vi.fn()
  const hook = renderHook(({ online, mismatch }: { online: boolean; mismatch: boolean }) => useServiceStage({ online, mismatch, onBack }), { initialProps: { online, mismatch: false } })
  return { ...hook, onBack }
}

describe('the service stage over time', () => {
  beforeEach(() => { vi.useFakeTimers(); resetToasts() })
  afterEach(() => { vi.useRealTimers(); resetToasts() })

  it('is a blip for three seconds, then offline; a blip that ends in time says nothing', () => {
    const { result, rerender, onBack } = mount()
    rerender({ online: false, mismatch: false })
    expect(result.current.stage).toBe('blip')
    act(() => { vi.advanceTimersByTime(OFFLINE_AFTER_MS - 1) })
    expect(result.current.stage).toBe('blip')
    rerender({ online: true, mismatch: false })
    expect(result.current.stage).toBe('ok')
    act(() => { vi.advanceTimersByTime(OFFLINE_AFTER_MS + FOUND_FOR_MS) })
    expect(result.current.stage).toBe('ok')
    expect(onBack).not.toHaveBeenCalled()
  })

  it('after an outage says it found the service for a moment, then calls back once', () => {
    const { result, rerender, onBack } = mount()
    rerender({ online: false, mismatch: false })
    act(() => { vi.advanceTimersByTime(OFFLINE_AFTER_MS) })
    expect(result.current.stage).toBe('offline')
    rerender({ online: true, mismatch: false })
    expect(result.current.stage).toBe('found')
    act(() => { vi.advanceTimersByTime(FOUND_FOR_MS) })
    expect(result.current.stage).toBe('ok')
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('holds toasts while offline and lets them out when it is back', () => {
    const { rerender } = mount()
    rerender({ online: false, mismatch: false })
    expect(currentToasts().held).toBe(false)
    act(() => { vi.advanceTimersByTime(OFFLINE_AFTER_MS) })
    expect(currentToasts().held).toBe(true)
    rerender({ online: true, mismatch: false })
    expect(currentToasts().held).toBe(false)
  })

  it('never calls a service on another protocol offline', () => {
    const { result, rerender } = mount()
    rerender({ online: false, mismatch: true })
    act(() => { vi.advanceTimersByTime(OFFLINE_AFTER_MS * 2) })
    expect(result.current.stage).toBe('ok')
  })
})
