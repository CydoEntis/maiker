import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_CONVERSATION, FakeDaemonHistory } from './fakeDaemonHistory'
import { ACTIVE_POLL_MS, forgetChatFeeds, NEWS_READ_GAP_MS, peekChatFeed, TOLD_ACTIVE_POLL_MS, useChatFeed, warmChatFeed } from './useChatFeed'

const fake = vi.hoisted(() => ({
  history: null as null | { read: (cursor: never) => Promise<unknown> },
  told: new Set<(conversation: number) => void>(),
}))

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  readConversationPage: (_id: number, cursor: unknown) => {
    if (fake.history === null) throw new Error('no fake daemon')
    return fake.history.read(cursor as never)
  },
}))

vi.mock('@/api/conversationNews', () => ({
  listenConversationChanged: (onChange: (conversation: number) => void) => {
    fake.told.add(onChange)
    return Promise.resolve(() => { fake.told.delete(onChange) })
  },
}))

const daemonSays = (conversation: number) => { for (const listener of fake.told) listener(conversation) }

async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

function working(): FakeDaemonHistory {
  const history = new FakeDaemonHistory()
  history.upsert(history.message('t1', 'u1', 'User', 'fix the parser'))
  history.status = 'Working'
  fake.history = history
  return history
}

const open = () => renderHook(() => useChatFeed({ conversation: FAKE_CONVERSATION, generation: 1, provider: 'codex' }))

beforeEach(() => {
  vi.useFakeTimers()
  forgetChatFeeds()
  fake.told.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  fake.history = null
})

describe('a chat in a window that was hidden', () => {
  it('reads as soon as the window shows again, not at its next slow poll', async () => {
    const history = working()
    open()
    await settle()
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    await settle(ACTIVE_POLL_MS)
    const before = history.reads.length
    hidden.mockReturnValue(false)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0) })
    expect(history.reads.length).toBe(before + 1)
    hidden.mockRestore()
  })
})

describe('a chat the daemon tells of changes', () => {
  it('reads when the daemon says its conversation changed, without waiting for the next poll', async () => {
    const history = working()
    open()
    await settle()
    const before = history.reads.length

    daemonSays(FAKE_CONVERSATION)
    await settle(NEWS_READ_GAP_MS)

    expect(history.reads.length).toBe(before + 1)
  })

  it('does not read for another conversation', async () => {
    const history = working()
    open()
    await settle()
    const before = history.reads.length

    daemonSays(FAKE_CONVERSATION + 1)
    await settle(NEWS_READ_GAP_MS)

    expect(history.reads.length).toBe(before)
  })

  it('reads once for a burst of changes', async () => {
    const history = working()
    open()
    await settle()
    const before = history.reads.length

    for (let change = 0; change < 20; change += 1) daemonSays(FAKE_CONVERSATION)
    await settle(NEWS_READ_GAP_MS)

    expect(history.reads.length).toBe(before + 1)
  })

  it('asks on its own less often once the daemon has told it of a change', async () => {
    const history = working()
    open()
    await settle()
    daemonSays(FAKE_CONVERSATION)
    await settle(NEWS_READ_GAP_MS)
    const before = history.reads.length

    await settle(ACTIVE_POLL_MS * 2)
    expect(history.reads.length).toBe(before)

    await settle(TOLD_ACTIVE_POLL_MS)
    expect(history.reads.length).toBe(before + 1)
  })

  it('keeps asking as before while the daemon has said nothing', async () => {
    const history = working()
    open()
    await settle()
    const before = history.reads.length

    await settle(ACTIVE_POLL_MS)

    expect(history.reads.length).toBe(before + 1)
  })

  it('stops listening when the chat closes', async () => {
    working()
    const chat = open()
    await settle()
    expect(fake.told.size).toBe(1)

    chat.unmount()
    await settle()

    expect(fake.told.size).toBe(0)
  })
})

describe('a chat opened again from the cache', () => {
  it('paints its messages on the very first render, with no loading frame and nothing awaited', async () => {
    working()
    const first = open()
    await settle()
    expect(first.result.current.feed.loaded).toBe(true)
    first.unmount()

    // Nothing is settled: no timer has run and no read has been answered when the first frame is drawn.
    const again = open()
    expect(again.result.current.feed.loaded).toBe(true)
    expect(again.result.current.events.length).toBeGreaterThan(0)
  })

  it('shows the loading state only for a conversation that was never read', () => {
    working()
    const cold = open()
    expect(cold.result.current.feed.loaded).toBe(false)
    expect(cold.result.current.events).toHaveLength(0)
  })
})

describe('reading a chat ahead of a click', () => {
  it('fills the cache once, and a chat opened after it paints from memory', async () => {
    const history = working()
    const read = (cursor: unknown) => history.read(cursor as never)
    expect(peekChatFeed(FAKE_CONVERSATION)).toBeUndefined()
    await expect(warmChatFeed(FAKE_CONVERSATION, 1, 'codex', read as never)).resolves.toBe(true)
    const reads = history.reads.length
    expect(peekChatFeed(FAKE_CONVERSATION)?.loaded).toBe(true)

    const opened = open()
    expect(opened.result.current.feed.loaded).toBe(true)
    await expect(warmChatFeed(FAKE_CONVERSATION, 1, 'codex', read as never)).resolves.toBe(false)
    expect(history.reads.length).toBeGreaterThanOrEqual(reads)
  })

  it('reads nothing for a chat that is already cached', async () => {
    const history = working()
    open()
    await settle()
    const reads = history.reads.length
    await expect(warmChatFeed(FAKE_CONVERSATION, 1, 'codex', ((cursor: unknown) => history.read(cursor as never)))).resolves.toBe(false)
    expect(history.reads.length).toBe(reads)
  })

  it('runs one read at a time: a second hover while one is reading is dropped', async () => {
    const history = working()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slow = async (cursor: unknown) => { await gate; return history.read(cursor as never) }
    const first = warmChatFeed(FAKE_CONVERSATION, 1, 'codex', slow)
    await expect(warmChatFeed(FAKE_CONVERSATION + 1, 1, 'codex', slow as never)).resolves.toBe(false)
    release()
    await expect(first).resolves.toBe(true)
  })
})
