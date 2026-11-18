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

/** A pane holding one queued message, whose daemon answers a removal with `drop`. */
function oneQueued(drop: PaneQueue['drop']): PaneQueue {
  return { queued: ['still waiting'], add: () => Promise.resolve(), drop }
}

function open(queue: PaneQueue) {
  const daemon = new FakeDaemonHistory()
  daemon.status = 'Working'
  fake.current = daemon
  const typeInto = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  render(<ChatSession link={{ conversation: FAKE_CONVERSATION, generation: 1, readOnly: true }} agent="claude" online typeInto={typeInto} paneQueue={queue} sessionId="s1" />)
}

describe('removing a queued message', () => {
  it('takes it off the list at once', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    open(oneQueued(() => new Promise(() => undefined)))
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS) })

    await user.click(screen.getByRole('button', { name: /^Queued/ }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(screen.queryByText('still waiting')).not.toBeInTheDocument()
  })

  it.each(['that follow-up is no longer queued there', 'the daemon is offline'])('puts it back with the reason when the daemon refuses: %s', async (reason) => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    open(oneQueued(() => Promise.reject(new Error(reason))))
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS) })

    await user.click(screen.getByRole('button', { name: /^Queued/ }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS) })

    // Still listed: the daemon has not let go of it, so it may yet be sent.
    expect(screen.getByText('still waiting')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(reason))).toBeInTheDocument()
  })
})
