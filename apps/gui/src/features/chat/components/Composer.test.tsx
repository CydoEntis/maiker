import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_CONVERSATION, FakeDaemonHistory } from '../fakeDaemonHistory'
import { forgetChoices, writeChoice } from '../agentChoice'
import { forgetComposers } from '../composerStore'
import { forgetChatFeeds, IDLE_POLL_MS } from '../useChatFeed'
import { ChatSession } from './ChatSession'

const fake = vi.hoisted(() => ({
  current: null as null | { read: (cursor: never) => Promise<unknown> },
  submitMessage: vi.fn<(conversation: { id: string; generation: number }, operation: number, text: string, choice?: { model?: string; effort?: string }) => Promise<unknown>>(),
  cancelTurn: vi.fn<(conversation: { id: string; generation: number }) => Promise<void>>(),
  dequeueMessage: vi.fn<(conversation: { id: string; generation: number }, operation: number) => Promise<void>>(),
  sendQueuedMessageNow: vi.fn<(conversation: { id: string; generation: number }, operation: number) => Promise<void>>(),
  approveRequest: vi.fn<(conversation: { id: string; generation: number }, requestId: number | string, decision: string) => Promise<void>>(),
}))

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  submitMessage: fake.submitMessage,
  cancelTurn: fake.cancelTurn,
  dequeueMessage: fake.dequeueMessage,
  sendQueuedMessageNow: fake.sendQueuedMessageNow,
  approveRequest: fake.approveRequest,
  readConversationPage: (_id: number, cursor: unknown) => {
    if (fake.current === null) throw new Error('no fake daemon')
    return fake.current.read(cursor as never)
  },
}))

const LINK = { conversation: FAKE_CONVERSATION, generation: 1 }
const TARGET = { id: String(FAKE_CONVERSATION), generation: 1 }

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  forgetChatFeeds()
  forgetComposers()
  fake.submitMessage.mockReset()
  fake.cancelTurn.mockReset()
  fake.dequeueMessage.mockReset()
  fake.sendQueuedMessageNow.mockReset()
  fake.sendQueuedMessageNow.mockResolvedValue(undefined)
  fake.approveRequest.mockReset()
  fake.submitMessage.mockResolvedValue({})
  fake.cancelTurn.mockResolvedValue(undefined)
  fake.approveRequest.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  fake.current = null
})

async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

async function open(setup: (daemon: FakeDaemonHistory) => void = () => undefined, online = true) {
  const daemon = new FakeDaemonHistory()
  daemon.upsert(daemon.message('t1', 'u', 'User', 'earlier'))
  setup(daemon)
  fake.current = daemon
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
  render(<ChatSession link={LINK} agent="claude" online={online} />)
  await settle()
  return { daemon, user, box: screen.getByRole('textbox', { name: 'Message Claude' }) }
}

describe('the usage strip', () => {

  it('shows the context from the start and a plan limit only once it is half used', async () => {
    fake.current = new FakeDaemonHistory()
    render(<ChatSession link={LINK} agent="claude" online usage={{ context: 12, limits: [{ name: 'week', used: 70, resetsAt: 0 }] }} />)
    await settle()

    const meters = within(screen.getByRole('group', { name: 'Usage' }))
    expect(meters.getAllByRole('meter').map((meter) => meter.getAttribute('aria-label'))).toEqual(['Context', 'Weekly limit'])
    expect(screen.getByRole('group', { name: 'Usage' })).toHaveTextContent('Week70%')
  })
})

describe('sending', () => {
  it('sends on Enter through the conversation with the next operation number, and clears the box', async () => {
    const { user, box } = await open()

    await user.type(box, 'run the tests{Enter}')

    expect(fake.submitMessage).toHaveBeenCalledTimes(1)
    expect(fake.submitMessage).toHaveBeenCalledWith(TARGET, 1, 'run the tests')
    expect(box).toHaveValue('')
  })

  it('sends the model and reasoning picked for this chat with the message, and only what was picked', async () => {
    window.localStorage.clear()
    forgetChoices()
    writeChoice(FAKE_CONVERSATION, { model: 'opus', reasoning: 'high' })
    try {
      const { user, box } = await open()
      await user.type(box, 'think hard{Enter}')
      expect(fake.submitMessage).toHaveBeenCalledWith(TARGET, 1, 'think hard', { model: 'opus', effort: 'high' })
    } finally {
      window.localStorage.clear()
      forgetChoices()
    }
  })

  it('adds a new line on Shift+Enter and sends nothing', async () => {
    const { user, box } = await open()

    await user.type(box, 'one{Shift>}{Enter}{/Shift}two')

    expect(box).toHaveValue('one\ntwo')
    expect(fake.submitMessage).not.toHaveBeenCalled()
  })

  it('keeps the message when the send fails and retries it with the same operation number', async () => {
    const { user, box } = await open()
    fake.submitMessage.mockRejectedValueOnce(new Error('the Maiker service went away'))

    await user.type(box, 'please retry{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('the Maiker service went away')
    expect(box).toHaveValue('please retry')

    await user.type(box, '{Enter}')
    expect(fake.submitMessage).toHaveBeenNthCalledWith(1, TARGET, 1, 'please retry')
    expect(fake.submitMessage).toHaveBeenNthCalledWith(2, TARGET, 1, 'please retry')
    expect(box).toHaveValue('')
  })

  it('gives a failed message back ahead of what was typed while it was going', async () => {
    const { user, box } = await open()
    let fail: (reason: Error) => void = () => undefined
    fake.submitMessage.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))

    await user.type(box, 'first{Enter}')
    await user.type(box, 'second')
    act(() => { fail(new Error('the Maiker service went away')) })

    expect(await screen.findByRole('alert')).toHaveTextContent('the Maiker service went away')
    expect(box).toHaveValue('first\n\nsecond')
  })

  it('takes typing but sends nothing, with the reason, while the daemon is offline', async () => {
    const { user, box } = await open(() => undefined, false)

    expect(box).toBeEnabled()
    expect(box).toHaveAttribute('placeholder', 'The Maiker service is offline')
    await user.type(box, 'for later{Enter}')
    expect(box).toHaveValue('for later')
    expect(fake.submitMessage).not.toHaveBeenCalled()
  })
})

describe('while a request waits for an answer', () => {
  const pending = [{ request_id: 9, kind: 'Command', turn_id: 't1', command: 'rm -rf build', choices: ['Accept', 'AcceptForSession', 'Decline'] }]

  it('gives the request the focus, so y answers it at once', async () => {
    const { user } = await open((setup) => { setup.status = 'Blocked'; setup.approvals = pending })

    const tray = screen.getByRole('region', { name: /Approval/ })
    expect(tray).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard('y')

    await settle()
    expect(fake.approveRequest).toHaveBeenCalledWith(TARGET, 9, 'Accept')
  })

  it('answers through the daemon by request id, then shows the choice and turns the composer back on', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Blocked'; setup.approvals = pending })

    await user.click(within(screen.getByRole('region', { name: /Approval/ })).getByRole('button', { name: /This session/ }))

    await settle()
    expect(fake.approveRequest).toHaveBeenCalledWith(TARGET, 9, 'AcceptForSession')
    const card = screen.getByRole('group', { name: /Approval/ })
    expect(card).toHaveTextContent('Allowed for this session')
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
    daemon.status = 'Working'
    daemon.approvals = []
    await settle(IDLE_POLL_MS)
    expect(box).not.toBeDisabled()
  })
})

describe('while the agent works', () => {
  // The daemon holds a message sent mid-turn: the stand-in does the same, as the real one answers.
  function daemonQueues(daemon: FakeDaemonHistory) {
    fake.submitMessage.mockImplementation((_conversation, operation, text) => {
      if (daemon.status === 'Working') {
        daemon.queued.push({ operation, text })
        return Promise.resolve({ conversation: FAKE_CONVERSATION, generation: 1, operation })
      }
      return Promise.resolve({})
    })
    fake.dequeueMessage.mockImplementation((_conversation, operation) => {
      daemon.queued = daemon.queued.filter((message) => message.operation !== operation)
      return Promise.resolve()
    })
  }

  it('hands a message to the daemon, which queues it, and shows it as queued until it is sent', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)

    expect(box).toHaveAttribute('placeholder', 'Queue a message for when Claude finishes')
    await user.type(box, 'and then lint it{Enter}')
    await settle()

    expect(fake.submitMessage).toHaveBeenCalledWith(TARGET, 1, 'and then lint it')
    const queued = screen.getByRole('region', { name: 'Queued messages' })
    expect(queued).toHaveTextContent('and then lint it')
    // When it is sent is the header's tooltip now, not a line on the card.
    expect(within(queued).getByTitle(/even if you close the window/)).toHaveTextContent('Queued')
    expect(box).toHaveValue('')
  })

  it('numbers each message after the ones the daemon already holds, in order', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)

    await user.type(box, 'first{Enter}')
    await settle()
    await user.type(box, 'second{Enter}')
    await settle()

    expect(fake.submitMessage).toHaveBeenNthCalledWith(1, TARGET, 1, 'first')
    expect(fake.submitMessage).toHaveBeenNthCalledWith(2, TARGET, 2, 'second')
    // Two or more fold into a stack: the first message in front, how many wait behind it.
    const queued = screen.getByRole('region', { name: 'Queued messages' })
    expect(queued).toHaveTextContent('2 queued')
    expect(queued).toHaveTextContent('first')
    expect(queued).toHaveTextContent('+1')
  })

  it('shows what the daemon holds when the chat is opened again, so closing the window loses nothing', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)
    await user.type(box, 'still here{Enter}')
    await settle()

    cleanup()
    forgetChatFeeds()
    forgetComposers()
    render(<ChatSession link={LINK} agent="claude" online />)
    await settle()

    expect(screen.getByRole('region', { name: 'Queued messages' })).toHaveTextContent('still here')
  })

  it('removes a queued message through the daemon', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)
    await user.type(box, 'never mind{Enter}')
    await settle()

    await user.click(screen.getByRole('button', { name: /^Queued/ }))
    await user.click(screen.getByRole('button', { name: /Remove/ }))
    await settle()

    expect(fake.dequeueMessage).toHaveBeenCalledWith(TARGET, 1)
    expect(screen.queryByRole('region', { name: 'Queued messages' })).not.toBeInTheDocument()
  })

  it('takes a queued message back into the box to edit, ahead of what was typed there', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)
    await user.type(box, 'lint it{Enter}')
    await settle()
    await user.type(box, 'and more')

    await user.click(screen.getByRole('button', { name: /^Queued/ }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await settle()

    expect(fake.dequeueMessage).toHaveBeenCalledWith(TARGET, 1)
    expect(box).toHaveValue('lint it\n\nand more')
    expect(box).toHaveFocus()
    expect(screen.queryByRole('region', { name: 'Queued messages' })).not.toBeInTheDocument()
  })

  it('shows a queued message with its files as chips, never the lines that name them, and gives both back on Edit', async () => {
    const withFile = 'look at this\n\nAttached files (kept by Maiker; read them with your file tools):\n- C:\\kept\\attach-1794395248212-6aebc0c8-notes.txt'
    const { daemon, user, box } = await open((setup) => {
      setup.status = 'Working'
      setup.queued.push({ operation: 7, text: withFile })
    })
    daemonQueues(daemon)

    const queued = screen.getByRole('region', { name: 'Queued messages' })
    expect(queued).toHaveTextContent('look at this')
    expect(queued).not.toHaveTextContent('Attached files (kept by Maiker')

    await user.click(screen.getByRole('button', { name: /^Queued/ }))
    expect(within(queued).getByRole('list', { name: 'Attached files' })).toHaveTextContent('notes.txt')
    await user.click(within(queued).getByRole('button', { name: 'Edit' }))
    await settle()

    expect(fake.dequeueMessage).toHaveBeenCalledWith(TARGET, 7)
    expect(box).toHaveValue('look at this')
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
  })

  it('leaves the box alone when the message to edit was already sent', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)
    await user.type(box, 'lint it{Enter}')
    await settle()
    fake.dequeueMessage.mockRejectedValue(new Error('not queued'))

    await user.click(screen.getByRole('button', { name: /^Queued/ }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await settle()

    expect(box).toHaveValue('')
  })

  it('sends a queued message now through the daemon, by its operation number', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)
    fake.sendQueuedMessageNow.mockImplementation((_conversation, operation) => {
      daemon.queued = daemon.queued.filter((message) => message.operation !== operation)
      return Promise.resolve()
    })
    await user.type(box, 'steer left{Enter}')
    await settle()

    await user.click(screen.getByRole('button', { name: /^Queued/ }))
    await user.click(screen.getByRole('button', { name: 'Send now' }))
    await settle(2000)

    expect(fake.sendQueuedMessageNow).toHaveBeenCalledWith(TARGET, 1)
    expect(screen.queryByRole('region', { name: 'Queued messages' })).not.toBeInTheDocument()
    expect(fake.submitMessage).toHaveBeenCalledTimes(1)
  })

  it('keeps the message queued and says why when the daemon refuses to send it now', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)
    fake.sendQueuedMessageNow.mockRejectedValue(new Error('the turn ended a moment ago'))
    await user.type(box, 'steer left{Enter}')
    await settle()

    await user.click(screen.getByRole('button', { name: /^Queued/ }))
    await user.click(screen.getByRole('button', { name: 'Send now' }))
    await settle(2000)

    expect(screen.getByRole('alert')).toHaveTextContent('the turn ended a moment ago')
    expect(screen.getByRole('region', { name: 'Queued messages' })).toHaveTextContent('steer left')
  })

  it('sends a message now once, however often the button is pressed before the daemon answers', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)
    let answer: () => void = () => undefined
    fake.sendQueuedMessageNow.mockImplementation(() => new Promise<void>((resolve) => { answer = resolve }))
    await user.type(box, 'steer left{Enter}')
    await settle()

    await user.click(screen.getByRole('button', { name: /^Queued/ }))
    const button = screen.getByRole('button', { name: 'Send now' })
    await user.click(button)
    await user.click(button)
    await settle()

    expect(fake.sendQueuedMessageNow).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    answer()
    await settle()
    expect(button).toBeEnabled()
  })

  it('offers no Send now while a request waits for an answer', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)
    await user.type(box, 'steer left{Enter}')
    await settle()
    await user.click(screen.getByRole('button', { name: /^Queued/ }))
    expect(screen.getByRole('button', { name: 'Send now' })).toBeInTheDocument()

    daemon.status = 'Blocked'
    daemon.approvals = [{ request_id: 9, kind: 'Command', turn_id: 't1', command: 'rm -rf build', choices: ['Accept', 'Decline'] }]
    await settle(5000)

    expect(screen.getByRole('region', { name: 'Queued messages' })).toHaveTextContent('steer left')
    expect(screen.queryByRole('button', { name: 'Send now' })).not.toBeInTheDocument()
  })

  it('moves a queued message up by queueing it ahead of the one above it, in the daemon', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)
    for (const text of ['first', 'second', 'third']) {
      await user.type(box, `${text}{Enter}`)
      await settle()
    }

    await user.click(screen.getByRole('button', { name: /3 queued/ }))
    await user.click(screen.getByRole('button', { name: /third/ }))
    await user.click(screen.getByRole('button', { name: 'Move up' }))
    await settle()

    // The two last are taken out and queued again, third ahead of second; the first never moves.
    expect(fake.dequeueMessage).toHaveBeenCalledTimes(2)
    expect(daemon.queued.map((message) => message.text)).toEqual(['first', 'third', 'second'])
  })

  it('clears every queued message with Clear all', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)
    for (const text of ['first', 'second']) {
      await user.type(box, `${text}{Enter}`)
      await settle()
    }

    await user.click(screen.getByRole('button', { name: /2 queued/ }))
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    await settle()

    expect(daemon.queued).toEqual([])
    expect(screen.queryByRole('region', { name: 'Queued messages' })).not.toBeInTheDocument()
  })

  it('says so when a message was sent a moment before it could be removed, and shows the daemon\'s state', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)
    await user.type(box, 'too late{Enter}')
    await settle()
    fake.dequeueMessage.mockRejectedValueOnce(new Error('That message is no longer waiting; it may already have been sent'))
    daemon.queued = []

    await user.click(screen.getByRole('button', { name: /^Queued/ }))
    await user.click(screen.getByRole('button', { name: /Remove/ }))
    await settle()

    expect(await screen.findByRole('alert')).toHaveTextContent('no longer waiting')
    expect(screen.queryByRole('region', { name: 'Queued messages' })).not.toBeInTheDocument()
  })

  it('picks a new number when the daemon says another window got there first', async () => {
    const { daemon, user, box } = await open((setup) => { setup.status = 'Working' })
    daemonQueues(daemon)
    fake.submitMessage.mockRejectedValueOnce(new Error('Operation ID is stale or reused with changed content'))
    // The other window's message arrived meanwhile.
    daemon.queued.push({ operation: 1, text: 'from the other window' })

    await user.type(box, 'mine{Enter}')
    await settle()
    await user.type(box, '{Enter}')
    await settle()

    expect(fake.submitMessage).toHaveBeenNthCalledWith(1, TARGET, 1, 'mine')
    expect(fake.submitMessage).toHaveBeenNthCalledWith(2, TARGET, 2, 'mine')
  })

  it('interrupts with Stop and with Esc', async () => {
    const { user, box } = await open((daemon) => { daemon.status = 'Working' })

    await user.click(screen.getByRole('button', { name: 'Stop Claude' }))
    expect(fake.cancelTurn).toHaveBeenCalledWith(TARGET)

    await user.click(box)
    await user.keyboard('{Escape}')
    expect(fake.cancelTurn).toHaveBeenCalledTimes(2)
  })

  it('does not treat Esc as an interrupt when nothing is running', async () => {
    const { user, box } = await open()

    await user.click(box)
    await user.keyboard('{Escape}')

    expect(fake.cancelTurn).not.toHaveBeenCalled()
  })
})
