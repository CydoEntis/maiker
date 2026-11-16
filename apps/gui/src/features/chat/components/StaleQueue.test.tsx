import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_CONVERSATION, FakeDaemonHistory } from '../fakeDaemonHistory'
import { forgetComposers } from '../composerStore'
import { forgetChatFeeds, IDLE_POLL_MS } from '../useChatFeed'
import type { PaneQueue } from '../useChatComposer'
import { ChatSession } from './ChatSession'

const fake = vi.hoisted(() => ({ current: null as null | { read: (cursor: never) => Promise<unknown> } }))

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  readConversationPage: (_id: number, cursor: unknown) => {
    if (fake.current === null) throw new Error('no fake daemon')
    return fake.current.read(cursor as never)
  },
  loadTerminalScreen: () => Promise.resolve('> hi\n'),
  loadAgentModels: () => Promise.resolve([]),
}))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  forgetChatFeeds()
  forgetComposers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  fake.current = null
})

/** A pane whose list still shows a message its daemon already gave the agent, as a late snapshot does. */
function staleQueue(drop: PaneQueue['drop']): PaneQueue {
  return { queued: ['already went'], add: () => Promise.resolve(), drop }
}

function open(queue: PaneQueue) {
  const daemon = new FakeDaemonHistory()
  daemon.status = 'Working'
  fake.current = daemon
  const typeInto = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  render(<ChatSession link={{ conversation: FAKE_CONVERSATION, generation: 1, readOnly: true }} agent="claude" online typeInto={typeInto} paneQueue={queue} sessionId="s1" />)
}

describe('removing a queued message the daemon no longer holds', () => {
  it('takes it off the list at once and keeps it off, with no error, though the pane still lists it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    open(staleQueue(() => Promise.reject(new Error('that follow-up is no longer queued there'))))
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS) })

    await user.click(screen.getByRole('button', { name: 'Remove queued message' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS) })

    expect(screen.queryByText('already went')).not.toBeInTheDocument()
    expect(screen.queryByText(/no longer queued/)).not.toBeInTheDocument()
  })

  it('puts it back with the reason when the daemon refuses for another reason', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    open(staleQueue(() => Promise.reject(new Error('the daemon is offline'))))
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS) })

    await user.click(screen.getByRole('button', { name: 'Remove queued message' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS) })

    expect(screen.getByText('already went')).toBeInTheDocument()
    expect(screen.getByText(/the daemon is offline/)).toBeInTheDocument()
  })
})
