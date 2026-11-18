import { act, cleanup, render, screen, within } from '@testing-library/react'
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

const working = (id: string, task: string, latest: string) => ({ id, name: 'Explore', state: 'Working' as const, task, startedAt: 0, updatedAt: 0, latest, result: null })

describe('the helpers line', () => {
  it('shows while helpers work, with one helper’s activity, the failed count and a block each, and the chat holds a quiet line', async () => {
    const { daemon } = await open((setup) => {
      task(setup, 'a', 'Find callers', 'Running')
      task(setup, 'b', 'Check limits', 'Completed', 'Fine.')
      task(setup, 'c', 'Update the spec', 'Failed', 'Syntax error on line 214.')
    }, [working('s1', 'Find callers', 'Grep refundable')])

    const line = screen.getByRole('region', { name: 'Helpers running' })
    expect(line).toHaveTextContent('Find callers')
    expect(line).toHaveTextContent('Grep refundable')
    expect(line).toHaveTextContent('1 failed')
    expect(line).toHaveTextContent('2 of 3')
    expect(line.querySelectorAll('.mx-dock-block')).toHaveLength(3)
    // Where the helpers started, the chat says so and the record waits.
    expect(screen.getByRole('button', { name: /Started 3 helpers/ })).toHaveTextContent('running below')
    expect(daemon.status).toBe('Working')
  })

  it('clears the red failed count once the list has been opened, and shows each helper with what it was asked', async () => {
    const { user } = await open((setup) => {
      task(setup, 'a', 'Find callers', 'Running')
      task(setup, 'c', 'Update the spec', 'Failed', 'Syntax error on line 214.')
    })
    const line = screen.getByRole('region', { name: 'Helpers running' })

    await user.click(within(line).getByRole('button', { name: /Find callers/ }))
    expect(within(line).getByText('2 helpers')).toBeInTheDocument()
    expect(line).toHaveTextContent('1 working')
    expect(line).toHaveTextContent('1 failed')
    await user.click(within(line).getByRole('button', { name: /Update the spec/ }))
    expect(within(line).getByText('What went wrong')).toBeInTheDocument()
    expect(within(line).getByText('Asked to')).toBeInTheDocument()

    await user.click(within(line).getAllByRole('button', { name: /Find callers/ })[0] as HTMLElement)
    // The label that sat on the line is gone for good; the count stays in the list's head.
    expect(line.querySelector('.mx-dock-failed')).toBeNull()
  })

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

describe('only one part of the dock is open', () => {
  it('folds the queue’s list when the helpers list opens, and the helpers list when the queue opens', async () => {
    const { daemon, user } = await open((setup) => { task(setup, 'a', 'Find callers', 'Running') })
    daemon.queued.push({ operation: 1, text: 'first' }, { operation: 2, text: 'second' })
    await settle(IDLE_POLL_MS)
    const queue = screen.getByRole('region', { name: 'Queued messages' })
    const helpers = screen.getByRole('region', { name: 'Helpers running' })

    await user.click(within(queue).getByRole('button', { name: /2 queued/ }))
    expect(within(queue).getByRole('list', { name: 'Queue, in the order they are sent' })).toBeInTheDocument()

    await user.click(within(helpers).getByRole('button', { name: /Find callers/ }))
    expect(within(queue).queryByRole('list', { name: 'Queue, in the order they are sent' })).not.toBeInTheDocument()
    expect(within(helpers).getByText('1 helper')).toBeInTheDocument()

    await user.click(within(queue).getByRole('button', { name: /2 queued/ }))
    expect(within(queue).getByRole('list', { name: 'Queue, in the order they are sent' })).toBeInTheDocument()
    expect(within(helpers).queryByText('1 helper')).not.toBeInTheDocument()
  })
})
