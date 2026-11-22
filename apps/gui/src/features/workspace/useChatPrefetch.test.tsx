import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionView } from './model/session'

const warm = vi.hoisted(() => vi.fn<(conversation: number, generation: number, provider: string) => Promise<boolean>>(() => Promise.resolve(true)))
vi.mock('@/features/chat/useChatFeed', () => ({ warmChatFeed: warm }))

import { PREFETCH_DELAY_MS, useChatPrefetch } from './useChatPrefetch'

const chatty = { conversation: { agent: 'claude', chat: { conversation: 7, generation: 2 } } } as unknown as SessionView
const shell = { conversation: { agent: null, chat: undefined } } as unknown as SessionView
const noEvents = { conversation: { agent: 'claude', chat: undefined } } as unknown as SessionView
const sessions = new Map<string, SessionView>([['chat', chatty], ['shell', shell], ['quiet', noEvents]])
const lookup = (id: string) => sessions.get(id)

beforeEach(() => { vi.useFakeTimers(); warm.mockClear() })
afterEach(() => { vi.useRealTimers() })

describe('reading a chat ahead when its row is hovered', () => {
  it('warms the chat once, after the pointer has rested for the delay', () => {
    const { result } = renderHook(() => useChatPrefetch(lookup))
    act(() => { result.current('chat') })
    act(() => { vi.advanceTimersByTime(PREFETCH_DELAY_MS - 1) })
    expect(warm).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(warm).toHaveBeenCalledExactlyOnceWith(7, 2, 'claude')
  })

  it('reads nothing for a pointer that only passes over, or leaves before the delay', () => {
    const { result } = renderHook(() => useChatPrefetch(lookup))
    act(() => { result.current('chat') })
    act(() => { vi.advanceTimersByTime(50) })
    act(() => { result.current(null) })
    act(() => { vi.advanceTimersByTime(PREFETCH_DELAY_MS * 2) })
    expect(warm).not.toHaveBeenCalled()
  })

  it('does not read a terminal or a session with no chat yet', () => {
    const { result } = renderHook(() => useChatPrefetch(lookup))
    act(() => { result.current('shell') })
    act(() => { vi.advanceTimersByTime(PREFETCH_DELAY_MS) })
    act(() => { result.current('quiet') })
    act(() => { vi.advanceTimersByTime(PREFETCH_DELAY_MS) })
    expect(warm).not.toHaveBeenCalled()
  })
})
