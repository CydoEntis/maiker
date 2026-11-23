import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toSubagentView } from '@/features/workspace/model/subagents'
import { FAKE_CONVERSATION, FakeDaemonHistory } from '../fakeDaemonHistory'
import { forgetComposers } from '../composerStore'
import { forgetChatFeeds, IDLE_POLL_MS } from '../useChatFeed'
import { ChatSession } from './ChatSession'

const fake = vi.hoisted(() => ({
  current: null as null | { read: (cursor: never) => Promise<unknown> },
}))

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  submitMessage: vi.fn().mockResolvedValue({}),
  cancelTurn: vi.fn().mockResolvedValue(undefined),
  dequeueMessage: vi.fn().mockResolvedValue(undefined),
  readConversationPage: (_id: number, cursor: unknown) => {
    if (fake.current === null) throw new Error('no fake daemon')
    return fake.current.read(cursor as never)
  },
}))

const LINK = { conversation: FAKE_CONVERSATION, generation: 1 }

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

async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

/** A Claude `Task` call: one helper, running or finished. */
const task = (daemon: FakeDaemonHistory, item: string, description: string, state: 'Running' | 'Completed' | 'Failed', report = ''): void => { daemon.upsert({
  source: { conversation: FAKE_CONVERSATION, turn: 't1', item },
  content: { Tool: { kind: 'commandExecution', label: 'Task ', output: report, input: { description, prompt: `Please ${description.toLowerCase()}`, subagent_type: 'Explore' } } },
  state,
}) }

async function open(setup: (daemon: FakeDaemonHistory) => void, subagents: Parameters<typeof toSubagentView>[0][] = []) {
  const daemon = new FakeDaemonHistory()
  daemon.upsert(daemon.message('t1', 'u', 'User', 'split it up'))
  daemon.status = 'Working'
  setup(daemon)
  fake.current = daemon
  const user = userEvent.setup({ advanceTimers: (ms) => { vi.advanceTimersByTime(ms) } })
  render(<ChatSession link={LINK} agent="claude" online subagents={subagents.map(toSubagentView)} />)
  await settle()
  return { daemon, user }
}

describe('the helpers line', () => {

  it('goes when every helper has finished, and the marker becomes the record', async () => {
    const { daemon, user } = await open((setup) => {
      task(setup, 'a', 'Find callers', 'Running')
      task(setup, 'b', 'Check limits', 'Completed', 'Fine.')
    })
    expect(screen.getByRole('region', { name: 'Helpers running' })).toBeInTheDocument()

    task(daemon, 'a', 'Find callers', 'Completed', 'Six callers.')
    await settle(IDLE_POLL_MS)

    expect(screen.queryByRole('region', { name: 'Helpers running' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Started 2 helpers/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /2 helpers/ }))
    expect(screen.getByText('Six callers.')).toBeInTheDocument()
  })

  it('is not drawn for a session at rest, whatever an old history says of its helpers', async () => {
    const daemon = new FakeDaemonHistory()
    daemon.upsert(daemon.message('t1', 'u', 'User', 'split it up'))
    task(daemon, 'a', 'Find callers', 'Running')
    fake.current = daemon
    render(<ChatSession link={LINK} agent="claude" online paneStatus="idle" />)
    await settle()

    expect(screen.queryByRole('region', { name: 'Helpers running' })).not.toBeInTheDocument()
  })
})
