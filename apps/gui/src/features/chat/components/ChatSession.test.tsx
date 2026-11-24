import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_CONVERSATION, FakeDaemonHistory } from '../fakeDaemonHistory'
import { ACTIVE_POLL_MS, forgetChatFeeds, IDLE_POLL_MS, RETRY_READ_MS } from '../useChatFeed'
import { forgetComposers } from '../composerStore'
import { ChatSession } from './ChatSession'
import { DAEMON_NAME } from '@/brand'

const fake = vi.hoisted(() => ({
  current: null as null | { read: (cursor: never) => Promise<unknown> },
  submitMessage: vi.fn<(conversation: { id: string; generation: number }, operation: number, text: string) => Promise<unknown>>(),
  cancelTurn: vi.fn<(conversation: { id: string; generation: number }) => Promise<void>>(),
  approveRequest: vi.fn<(conversation: { id: string; generation: number }, requestId: number | string, decision: string) => Promise<void>>(),
}))

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  submitMessage: fake.submitMessage,
  cancelTurn: fake.cancelTurn,
  approveRequest: fake.approveRequest,
  readConversationPage: (_id: number, cursor: unknown) => {
    if (fake.current === null) throw new Error('no fake daemon')
    return fake.current.read(cursor as never)
  },
}))

// jsdom lays nothing out: give the list a height and a scroll position that holds what is set.
const scrolled = new WeakMap<Element, number>()
const VIEWPORT_PX = 600

beforeEach(() => {
  vi.useFakeTimers()
  forgetChatFeeds()
  forgetComposers()
  fake.submitMessage.mockReset()
  fake.cancelTurn.mockReset()
  fake.approveRequest.mockReset()
  fake.submitMessage.mockResolvedValue({})
  fake.cancelTurn.mockResolvedValue(undefined)
  fake.approveRequest.mockResolvedValue(undefined)
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT_PX })
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) { return scrolled.get(this) ?? 0 },
    set(this: Element, value: number) { scrolled.set(this, value) },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  fake.current = null
})

const link = (generation = 1) => ({ conversation: FAKE_CONVERSATION, generation })

async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

function conversation(count: number): FakeDaemonHistory {
  const daemon = new FakeDaemonHistory(128)
  for (let index = 0; index < count; index += 1) {
    daemon.upsert(daemon.message('t1', `m${String(index)}`, index % 2 === 0 ? 'User' : 'Assistant', `message ${String(index)}`))
  }
  fake.current = daemon
  return daemon
}

describe('the chat history', () => {

  it('keys rows by the event id, so a re-read leaves the same rows', async () => {
    conversation(3)
    render(<ChatSession link={link()} agent="claude" online />)
    await settle()
    const keys = () => Array.from(document.querySelectorAll('[data-key]')).map((row) => row.getAttribute('data-key'))
    const before = keys()

    await settle(IDLE_POLL_MS)

    expect(before).toEqual(['t1:m0', 't1:m1', 't1:m2'])
    expect(keys()).toEqual(before)
  })

  it('follows new messages on its next read, with no duplicates', async () => {
    const daemon = conversation(2)
    render(<ChatSession link={link()} agent="claude" online />)
    await settle()
    expect(screen.getByText('message 1')).toBeInTheDocument()

    daemon.upsert(daemon.message('t1', 'm2', 'Assistant', 'a new reply'))
    await settle(IDLE_POLL_MS)
    // A reply that arrives is typed in, not shown whole; give the typing time to catch up.
    await settle(1500)

    expect(screen.getAllByText('a new reply')).toHaveLength(1)
    expect(screen.getAllByText('message 1')).toHaveLength(1)
  })

  it('polls faster while the agent works', async () => {
    const daemon = conversation(2)
    daemon.status = 'Working'
    render(<ChatSession link={link()} agent="claude" online />)
    await settle()
    daemon.reads.length = 0

    await settle(ACTIVE_POLL_MS * 3)

    expect(daemon.reads.length).toBeGreaterThanOrEqual(3)
  })

  it('tries a failed read again at once, and says nothing when that one works', async () => {
    const daemon = conversation(2)
    render(<ChatSession link={link()} agent="claude" online />)
    await settle()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    daemon.failure = new Error('the kept line went stale')
    await settle(IDLE_POLL_MS)
    expect(screen.queryByText(/Reconnecting to the daemon/)).not.toBeInTheDocument()
    daemon.failure = null
    await settle(RETRY_READ_MS)

    expect(screen.queryByText(/Reconnecting to the daemon/)).not.toBeInTheDocument()
    expect(screen.getByText('message 1')).toBeInTheDocument()
    warn.mockRestore()
  })

  it('says in the dock that it is waking its agent while a restart left the chat asleep, and nothing once it is up', async () => {
    conversation(1)
    const { rerender } = render(<ChatSession link={{ ...link(), waking: true }} agent="claude" online />)
    await settle()
    expect(screen.getByText('Waking Claude up…')).toBeInTheDocument()
    expect(screen.getByText('message 0')).toBeInTheDocument()

    rerender(<ChatSession link={link(2)} agent="claude" online />)
    await settle()
    expect(screen.queryByText('Waking Claude up…')).not.toBeInTheDocument()
  })

  it('says in the dock that it is reconnecting when reads keep failing, keeps what it showed, and resumes without duplicates', async () => {
    const daemon = conversation(2)
    render(<ChatSession link={link()} agent="claude" online />)
    await settle()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    daemon.failure = new Error(`${DAEMON_NAME} is not running`)
    await settle(IDLE_POLL_MS)
    await settle(RETRY_READ_MS)
    expect(screen.getByText(/Reconnecting to this chat…/)).toBeInTheDocument()
    // The reason is on screen, so a window that cannot read its chat says why instead of only waiting.
    expect(screen.getByText(new RegExp(`${DAEMON_NAME} is not running`))).toBeInTheDocument()
    expect(screen.getByText('message 1')).toBeInTheDocument()

    daemon.failure = null
    daemon.upsert(daemon.message('t1', 'm2', 'User', 'sent while it was down'))
    await settle(IDLE_POLL_MS)

    expect(screen.queryByText(/Reconnecting to this chat…/)).not.toBeInTheDocument()
    expect(screen.queryByText(new RegExp(`${DAEMON_NAME} is not running`))).not.toBeInTheDocument()
    expect(screen.getAllByText('message 0')).toHaveLength(1)
    expect(screen.getAllByText('sent while it was down')).toHaveLength(1)
    // The warning names the failure, never the conversation's text.
    expect(warn).toHaveBeenCalledWith('Could not read the conversation', `${DAEMON_NAME} is not running`)
    warn.mockRestore()
  })

  it('shows a fresh conversation when the generation changes', async () => {
    const daemon = conversation(2)
    const view = render(<ChatSession link={link(1)} agent="claude" online />)
    await settle()
    expect(screen.getByText('message 1')).toBeInTheDocument()

    daemon.restart()
    daemon.upsert(daemon.message('t9', 'n0', 'User', 'a different conversation'))
    view.rerender(<ChatSession link={link(2)} agent="claude" online />)
    await settle()

    expect(screen.getByText('a different conversation')).toBeInTheDocument()
    expect(screen.queryByText('message 1')).not.toBeInTheDocument()
  })

  it('announces a change of state once, without reading the conversation out', async () => {
    const daemon = conversation(2)
    daemon.status = 'Working'
    render(<ChatSession link={link()} agent="codex" online />)
    await settle()

    const announcer = screen.getAllByRole('status').find((node) => node.getAttribute('aria-live') === 'polite')
    expect(announcer).toHaveTextContent('Codex is working')
    expect(screen.getByRole('region', { name: 'Conversation with Codex' })).not.toHaveAttribute('aria-live')
  })

  it('shows an item the history cannot describe as unavailable, not as an invented diff', async () => {
    const daemon = conversation(0)
    daemon.upsert(daemon.message('t1', 'u', 'User', 'edit it'))
    daemon.upsert({ source: { conversation: FAKE_CONVERSATION, turn: 't1', item: 'e' }, content: { Tool: { kind: 'commandExecution', label: 'Edit ', output: '' } }, state: 'Completed' })
    render(<ChatSession link={link()} agent="claude" online />)
    await settle()
    // An edit on its own starts open.
    expect(screen.getByText(/didn.t keep this diff/)).toBeInTheDocument()
  })
})

describe('a subagent’s own chat', () => {
  const subagent = { id: 'b', name: 'Write drafts tests', kind: 'Explore', status: 'done' as const, task: 'Write drafts tests for the routes.', latest: null, result: 'Wrote 12 tests.\n\nThey all pass.', startedAt: 100, updatedAt: 170 }

  it('shows what it was asked and its report under a bar that names it, instead of the session’s chat', async () => {
    conversation(2)
    render(<ChatSession link={link()} agent="claude" online subagent={subagent} />)
    await settle()

    const bar = screen.getAllByRole('status').find((node) => node.textContent.includes('Subagent'))
    expect(bar).toBeDefined()
    expect(screen.getByText('Write drafts tests', { selector: 'strong' })).toBeInTheDocument()
    expect(bar).toHaveTextContent('done in 1m 10s')
    expect(bar).toHaveTextContent('read-only')
    const log = screen.getByRole('log', { name: 'Subagent Write drafts tests' })
    expect(within(log).getByText('Write drafts tests for the routes.')).toBeInTheDocument()
    expect(within(log).getByText('Wrote 12 tests.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Conversation with Claude' })).not.toBeInTheDocument()
  })
})

describe('a chat kept out of sight', () => {
  it('shows what it had, reads nothing while paused, and reads at once when shown again', async () => {
    const daemon = conversation(2)
    const reads = vi.spyOn(daemon, 'read')
    const { rerender } = render(<ChatSession link={link()} agent="claude" online />)
    await settle()
    rerender(<ChatSession link={link()} agent="claude" online paused />)
    reads.mockClear()

    daemon.upsert(daemon.message('t1', 'm2', 'Assistant', 'said while away'))
    await settle(IDLE_POLL_MS * 3)

    expect(reads).not.toHaveBeenCalled()
    expect(screen.getByText('message 1')).toBeInTheDocument()
    expect(screen.queryByText('said while away')).not.toBeInTheDocument()

    rerender(<ChatSession link={link()} agent="claude" online />)
    await settle()
    await settle(1500)

    expect(reads).toHaveBeenCalled()
    expect(screen.getByText('said while away')).toBeInTheDocument()
    expect(screen.getAllByText('message 1')).toHaveLength(1)
  })
})
