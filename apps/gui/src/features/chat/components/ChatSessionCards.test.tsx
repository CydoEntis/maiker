import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_CONVERSATION, FakeDaemonHistory } from '../fakeDaemonHistory'
import { forgetChatFeeds, IDLE_POLL_MS } from '../useChatFeed'
import { forgetComposers, updateComposer } from '../composerStore'
import { ChatSession } from './ChatSession'

const fake = vi.hoisted(() => ({
  current: null as null | { read: (cursor: never) => Promise<unknown> },
  approveRequest: vi.fn<(conversation: { id: string; generation: number }, requestId: number | string, decision: string) => Promise<void>>(),
}))

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  submitMessage: vi.fn().mockResolvedValue({}),
  cancelTurn: vi.fn().mockResolvedValue(undefined),
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
  fake.approveRequest.mockReset()
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

const link = () => ({ conversation: FAKE_CONVERSATION, generation: 1 })

async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

type Entry = Record<string, unknown>
const toolEntry = (turn: string, item: string, label: string, output: string, input?: unknown, extra: Record<string, unknown> = {}): Entry => ({
  source: { conversation: FAKE_CONVERSATION, turn, item },
  content: { Tool: { kind: 'commandExecution', label, output, ...(input === undefined ? {} : { input }), ...extra } },
  state: 'Completed',
})

/** Every kind of row the chat draws, in a repeating order, so measured heights differ row to row. */
function mixedConversation(count: number): FakeDaemonHistory {
  const daemon = new FakeDaemonHistory(128)
  for (let index = 0; index < count; index += 1) {
    const turn = `t${String(Math.floor(index / 7))}`
    const item = `i${String(index)}`
    switch (index % 7) {
      case 0: daemon.upsert(daemon.message(turn, item, 'User', `question ${String(index)}`)); break
      case 1: daemon.upsert(daemon.message(turn, item, 'Assistant', `Done ${String(index)}. Here is **why**.\n\n\`\`\`sh\nls\n\nls -la\n\`\`\``)); break
      case 2: daemon.upsert(toolEntry(turn, item, 'pnpm test', 'a\nb\nc\nd\ne\nf', undefined, { exit_code: 0, duration_ms: 900 })); break
      case 3: daemon.upsert(toolEntry(turn, item, 'Edit ', '', { file_path: `/repo/src/f${String(index)}.ts`, old_string: 'a\nb', new_string: 'c\nd\ne' })); break
      case 4: daemon.upsert(toolEntry(turn, item, 'TodoWrite ', '', { todos: [{ content: 'one', status: 'completed' }, { content: 'two', status: 'in_progress' }] })); break
      case 5: daemon.upsert(toolEntry(turn, item, 'Task ', 'report', { description: `Helper ${String(index)}`, prompt: 'go', subagent_type: 'Explore' })); break
      default: daemon.upsert(toolEntry(turn, item, 'Read ', 'text', { file_path: '/repo/README.md' }))
    }
  }
  fake.current = daemon
  return daemon
}

describe('a long mixed conversation', () => {
  it('draws only the rows near the view for 1,500 mixed items, ending at the newest', async () => {
    mixedConversation(1500)
    render(<ChatSession link={link()} agent="claude" online root="/repo" />)
    await settle()
    await settle()

    const list = screen.getByRole('region', { name: 'Conversation with Claude' })
    expect(list.querySelectorAll('[data-key]').length).toBeLessThan(40)
    // The last item (index 1499, 1499 % 7 = 1) is an agent message with a code block.
    expect(within(list).getByText(/Done 1499/)).toBeInTheDocument()
    expect(within(list).queryByText('question 0')).not.toBeInTheDocument()
  })
})

describe('approvals in the chat', () => {
  const request = (id: string, over: Record<string, unknown> = {}) => ({
    request_id: id,
    kind: 'Command',
    turn_id: 't1',
    item_id: 'step',
    command: 'rm -rf build',
    reason: null,
    changes: [],
    choices: ['Accept', 'AcceptForSession', 'Decline'],
    ...over,
  })

  function withStep(): FakeDaemonHistory {
    const daemon = new FakeDaemonHistory()
    daemon.upsert(daemon.message('t1', 'u', 'User', 'clean it'))
    daemon.upsert(toolEntry('t1', 'step', 'rm -rf build', ''))
    fake.current = daemon
    return daemon
  }

  it('answers by request id when y is pressed in the chat while the tray asks', async () => {
    const daemon = withStep()
    daemon.approvals = [request('req-1')]
    daemon.status = 'Blocked'
    render(<ChatSession link={link()} agent="claude" online />)
    await settle()

    fireEvent.keyDown(screen.getByRole('region', { name: /Approval/ }), { key: 'y' })
    await settle()

    expect(fake.approveRequest).toHaveBeenCalledExactlyOnceWith({ id: String(FAKE_CONVERSATION), generation: 1 }, 'req-1', 'Accept')
  })

  it('leaves a letter typed in the message box to the text, even while the box is empty', async () => {
    const daemon = withStep()
    daemon.approvals = [request('req-1')]
    daemon.status = 'Blocked'
    render(<ChatSession link={link()} agent="claude" online />)
    await settle()

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message Claude' }), { key: 'y' })
    await settle()

    expect(fake.approveRequest).not.toHaveBeenCalled()
  })

  it('leaves the keys in the message box when a card comes up over a reply being typed', async () => {
    withStep()
    updateComposer(FAKE_CONVERSATION, (state) => ({ ...state, draft: 'yes please' }))
    const view = render(<ChatSession link={link()} agent="claude" online />)
    await settle()
    const box = screen.getByRole('textbox', { name: 'Message Claude' })
    box.focus()

    view.rerender(<ChatSession link={link()} agent="claude" online helperAsk={{ tasks: ['Run the tests'], answer: vi.fn() }} />)
    await settle()

    expect(screen.getByRole('region', { name: 'Wants to start helpers' })).toBeInTheDocument()
    expect(box).toHaveFocus()
  })

  it('asks one request at a time, the oldest first, and the next once that one is answered', async () => {
    const daemon = withStep()
    daemon.approvals = [request('req-old', { command: 'rm -rf build' }), request('req-new', { command: 'rm -rf dist' })]
    daemon.status = 'Blocked'
    render(<ChatSession link={link()} agent="claude" online />)
    await settle()

    expect(screen.getAllByRole('region', { name: /Approval/ })).toHaveLength(1)
    expect(screen.getByRole('region', { name: /Approval/ })).toHaveTextContent('rm -rf build')

    daemon.approvals = [request('req-new', { command: 'rm -rf dist' })]
    daemon.answeredApprovals = [{ request: request('req-old', { command: 'rm -rf build' }), decision: 'Accept' }]
    daemon.upsert(daemon.message('t1', 'u2', 'User', 'ping'))
    await settle(IDLE_POLL_MS)

    expect(screen.getByRole('region', { name: /Approval/ })).toHaveTextContent('rm -rf dist')
  })

  it('opens with the keys on the first answer, and names each answer\'s key', async () => {
    const daemon = withStep()
    daemon.approvals = [request('req-5')]
    daemon.status = 'Blocked'
    render(<ChatSession link={link()} agent="claude" online />)
    await settle()

    const card = screen.getByRole('region', { name: /Approval/ })
    expect(within(card).getByRole('button', { name: 'Yes once' })).toHaveAttribute('aria-keyshortcuts', 'y')
    expect(within(card).getByRole('button', { name: 'This session' })).toHaveAttribute('aria-keyshortcuts', 'a')
    expect(within(card).getByRole('button', { name: 'No' })).toHaveAttribute('aria-keyshortcuts', 'n')
    expect(within(card).getByRole('button', { name: 'Yes once' })).toHaveFocus()
    fireEvent.keyDown(within(card).getByRole('button', { name: 'Yes once' }), { key: 'a' })
    await settle()

    expect(fake.approveRequest).toHaveBeenCalledExactlyOnceWith({ id: String(FAKE_CONVERSATION), generation: 1 }, 'req-5', 'AcceptForSession')
  })

  it('moves a request that disappears from the pending list to answered once the daemon records it', async () => {
    const daemon = withStep()
    daemon.approvals = [request('req-3')]
    render(<ChatSession link={link()} agent="claude" online />)
    await settle()
    expect(within(screen.getByRole('region', { name: /Approval/ })).getByRole('button', { name: /^No/ })).toBeInTheDocument()

    daemon.approvals = []
    daemon.answeredApprovals = [{ request: request('req-3'), decision: 'Decline' }]
    daemon.upsert(daemon.message('t1', 'u2', 'User', 'ping'))
    await settle(IDLE_POLL_MS)

    expect(screen.getByRole('group', { name: /Approval/ })).toHaveTextContent('Denied')
    expect(screen.queryByRole('region', { name: /Approval/ })).toBeNull()
  })
})

describe('the summary for a new chat', () => {
  it('ends with the last reply as it was said, though successful tool calls are hidden', async () => {
    const daemon = new FakeDaemonHistory()
    daemon.upsert(daemon.message('t1', 'u', 'User', 'look around'))
    daemon.upsert(daemon.message('t1', 'a1', 'Assistant', `Looking. ${'x'.repeat(1000)}`))
    daemon.upsert(toolEntry('t1', 'r1', 'Read ', 'text', { file_path: '/repo/README.md' }))
    daemon.upsert(daemon.message('t1', 'a2', 'Assistant', 'Final words.'))
    fake.current = daemon
    const onNewWithSummary = vi.fn()
    render(<ChatSession link={link()} agent="claude" online root="/repo" hideSuccessfulTools problem={{ kind: 'context', agent: 'Claude', percent: 96, onCompact: vi.fn(), onNewWithSummary }} />)
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'New session with summary' }))

    expect(onNewWithSummary).toHaveBeenCalledWith(expect.stringContaining('Final words.'))
  })
})
