import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast }))

import { KEY_WAIT_DIAL_MS } from './model/keyWait'
import type { MachineHead } from './model/machines'
import { useKeyWait } from './useKeyWait'

const head = (word: string): MachineHead => ({ key: 'machine-1', machine: 1, name: 'box', label: 'box', chip: { glyph: '●', word, tone: 'ok' }, why: null, said: null, loginCommand: null, target: null, down: false, downSince: null, grants: { clipboard: false, notices: false }, updateCommand: null, updateAction: null })

describe('waiting for a key that is set up in a terminal', () => {
  beforeEach(() => { vi.useFakeTimers(); toast.success.mockClear() })
  afterEach(() => { vi.useRealTimers() })

  it('dials the machine again until it connects, then says so once', () => {
    const retry = vi.fn()
    const { result, rerender } = renderHook(({ heads }) => useKeyWait(heads, retry), { initialProps: { heads: [head('needs login')] } })
    act(() => { result.current('box') })
    act(() => { vi.advanceTimersByTime(KEY_WAIT_DIAL_MS) })
    expect(retry).toHaveBeenCalledWith('box')
    expect(toast.success).not.toHaveBeenCalled()
    rerender({ heads: [head('connected')] })
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Connected to box')
    retry.mockClear()
    act(() => { vi.advanceTimersByTime(KEY_WAIT_DIAL_MS * 3) })
    expect(retry).not.toHaveBeenCalled()
  })

  it('keeps quiet when asked to, and stops when told', () => {
    const retry = vi.fn()
    const { result, rerender } = renderHook(({ heads }) => useKeyWait(heads, retry), { initialProps: { heads: [head('needs login')] } })
    let stop = () => {}
    act(() => { stop = result.current('box', true) })
    rerender({ heads: [head('connected')] })
    expect(toast.success).not.toHaveBeenCalled()
    rerender({ heads: [head('needs login')] })
    act(() => { stop = result.current('box', true) })
    act(() => { stop() })
    retry.mockClear()
    act(() => { vi.advanceTimersByTime(KEY_WAIT_DIAL_MS * 2) })
    expect(retry).not.toHaveBeenCalled()
  })
})
