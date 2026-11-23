import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_CONVERSATION, FakeDaemonHistory } from '../fakeDaemonHistory'
import { forgetComposers, peekComposer } from '../composerStore'
import { forgetChatFeeds } from '../useChatFeed'
import { forgetReplyDrafts } from '../quickReply'
import { MAX_QUOTES } from '../quoteMessage'
import { ReducedMotionContext } from '@/features/workspace/components/motion'
import { ChatSession } from './ChatSession'

const fake = vi.hoisted(() => ({
  current: null as null | { read: (cursor: never) => Promise<unknown> },
  submitMessage: vi.fn<(conversation: { id: string; generation: number }, operation: number, text: string) => Promise<unknown>>(),
}))

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  submitMessage: fake.submitMessage,
  readConversationPage: (_id: number, cursor: unknown) => {
    if (fake.current === null) throw new Error('no fake daemon')
    return fake.current.read(cursor as never)
  },
}))

const ASKED = 'Before I start:\n\n1. Which branch should this target?\n2. Should I keep the old endpoint?\n3. Any naming preference?'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  forgetChatFeeds()
  forgetComposers()
  forgetReplyDrafts()
  fake.submitMessage.mockReset().mockResolvedValue({})
})

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  cleanup()
  vi.useRealTimers()
  fake.current = null
})

async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

async function open(setup: (daemon: FakeDaemonHistory) => void, reduced = false) {
  const daemon = new FakeDaemonHistory()
  setup(daemon)
  fake.current = daemon
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
  render(
    <ReducedMotionContext.Provider value={reduced}>
      <ChatSession link={{ conversation: FAKE_CONVERSATION, generation: 1 }} agent="claude" online />
    </ReducedMotionContext.Provider>,
  )
  await settle()
  await settle()
  return { user, box: screen.getByRole('textbox', { name: 'Message Claude' }) }
}

const asking = (daemon: FakeDaemonHistory) => { daemon.upsert(daemon.message('t1', 'a1', 'Assistant', ASKED)) }

describe('replying to questions asked in plain text', () => {
  it('offers a Reply on each question and one line for the whole message, and none on the person\'s own words', async () => {
    await open((daemon) => { daemon.upsert(daemon.message('t0', 'u0', 'User', '1. Is this a question?')); asking(daemon) })

    expect(screen.getAllByRole('button', { name: /Reply to question \d\./ })).toHaveLength(3)
    expect(screen.getByRole('button', { name: /3 questions/ })).toHaveTextContent('Reply to each')
  })

  it('offers nothing while the message is still being written', async () => {
    await open((daemon) => { daemon.upsert(daemon.message('t1', 'a1', 'Assistant', ASKED, 'InProgress')) })

    expect(screen.queryByRole('button', { name: /Reply to/ })).not.toBeInTheDocument()
  })

  it('opens a neutral tray on every question, and answers go back as one message of question and answer pairs', async () => {
    const { user } = await open(asking)

    await user.click(screen.getByRole('button', { name: /3 questions/ }))
    const tray = screen.getByRole('group', { name: 'Reply to 3 questions' })
    expect(within(tray).getAllByRole('textbox')).toHaveLength(3)
    expect(within(tray).getByRole('button', { name: 'Send replies (0 of 3)' })).toBeDisabled()
    // The agent is not blocked, so the card does not wear the amber mark.
    expect(tray.querySelector('.mx-waiting-bang')?.textContent).not.toBe('!')

    // The first answer box has the keys; Enter goes on to the next row, a chip answers and goes on.
    expect(within(tray).getByRole('textbox', { name: /Which branch/ })).toHaveFocus()
    await user.keyboard('main{Enter}')
    expect(within(tray).getByRole('textbox', { name: /Should I keep/ })).toHaveFocus()
    await user.click(within(tray).getByRole('button', { name: 'Yes' }))
    expect(within(tray).getByRole('textbox', { name: /Should I keep/ })).toHaveValue('Yes')
    expect(within(tray).getByRole('button', { name: 'Send replies (2 of 3)' })).toBeEnabled()

    await user.keyboard('{Control>}{Enter}{/Control}')
    await settle()

    expect(fake.submitMessage).toHaveBeenCalledTimes(1)
    expect(fake.submitMessage.mock.calls[0]?.[2]).toBe(
      '> Quote from Claude:\n> 1. Which branch should this target?\n\nmain\n\n> Quote from Claude:\n> 2. Should I keep the old endpoint?\n\nYes',
    )
    expect(screen.queryByRole('group', { name: 'Reply to 3 questions' })).not.toBeInTheDocument()
    expect(screen.getByText('Reply sent, 2 answers')).toBeInTheDocument()
  })

  it('sends from the last row with Enter, and leaves unanswered questions out', async () => {
    const { user } = await open(asking)
    await user.click(screen.getByRole('button', { name: 'Reply to question 3.' }))
    const tray = screen.getByRole('group', { name: 'Reply to 3 questions' })
    // Opened from one question: it has the keys, and the others are one line each.
    expect(within(tray).getByRole('textbox', { name: /naming preference/ })).toHaveFocus()
    expect(tray.querySelectorAll('.mx-reply-row.is-compact')).toHaveLength(2)

    await user.keyboard('camelCase{Enter}')
    await settle()

    expect(fake.submitMessage.mock.calls[0]?.[2]).toBe('> Quote from Claude:\n> 3. Any naming preference?\n\ncamelCase')
  })

  it('answers a yes or no question from its row with y and n, and jumps to a row with its number', async () => {
    const { user } = await open(asking)
    await user.click(screen.getByRole('button', { name: /3 questions/ }))
    const tray = screen.getByRole('group', { name: 'Reply to 3 questions' })

    const second = within(tray).getByRole('group', { name: /Question 2\./ })
    await user.keyboard('2')
    // A number typed in an answer box is text: the box has the focus now, so nothing jumped.
    expect(within(tray).getByRole('textbox', { name: /Which branch/ })).toHaveValue('2')
    await user.clear(within(tray).getByRole('textbox', { name: /Which branch/ }))

    act(() => { second.focus() })
    await user.keyboard('n')
    expect(within(tray).getByRole('textbox', { name: /Should I keep/ })).toHaveValue('No')
    // The third row is not yes-or-no: y is a letter there, not an answer.
    const third = within(tray).getByRole('group', { name: /Question 3\./ })
    act(() => { third.focus() })
    await user.keyboard('y')
    expect(within(tray).getByRole('textbox', { name: /naming preference/ })).not.toHaveValue('Yes')

    act(() => { second.focus() })
    await user.keyboard('1')
    expect(within(tray).getByRole('group', { name: /Question 1\./ })).toHaveFocus()
  })

  it('closes with Esc and gives the written answers back when it is opened again', async () => {
    const { user } = await open(asking)
    await user.click(screen.getByRole('button', { name: /3 questions/ }))
    await user.keyboard('main')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Reply to 3 questions' })).not.toBeInTheDocument()
    expect(fake.submitMessage).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /3 questions/ }))

    expect(screen.getByRole('textbox', { name: /Which branch/ })).toHaveValue('main')
  })

  it('takes a new line with Shift+Enter without sending', async () => {
    const { user } = await open(asking)
    await user.click(screen.getByRole('button', { name: /3 questions/ }))

    await user.keyboard('line one{Shift>}{Enter}{/Shift}line two')

    expect(screen.getByRole('textbox', { name: /Which branch/ })).toHaveValue('line one\nline two')
    expect(fake.submitMessage).not.toHaveBeenCalled()
  })

  it('keeps the tray open and the answers when the send does not go', async () => {
    fake.submitMessage.mockRejectedValue(new Error('daemon said no'))
    const { user } = await open(asking)
    await user.click(screen.getByRole('button', { name: /3 questions/ }))
    await user.keyboard('main')

    await user.keyboard('{Control>}{Enter}{/Control}')
    await settle()

    expect(screen.getByRole('group', { name: 'Reply to 3 questions' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Which branch/ })).toHaveValue('main')
  })
})

describe('quotes', () => {
  async function quoteSelection(user: ReturnType<typeof userEvent.setup>, node: HTMLElement) {
    const range = document.createRange()
    range.selectNodeContents(node)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    fireEvent.mouseUp(node)
    await user.click(screen.getByRole('button', { name: 'Quote' }))
  }

  it('collects quotes in the strip, ignoring a repeat and holding five, with a remove button and Clear', async () => {
    const { user } = await open((daemon) => {
      for (let index = 0; index < 7; index += 1) daemon.upsert(daemon.message('t1', `a${String(index)}`, 'Assistant', `Note number ${String(index)}.`))
    })

    const note = (index: number) => within(screen.getByRole('region', { name: 'Conversation with Claude' })).getByText(`Note number ${String(index)}.`)
    await quoteSelection(user, note(0))
    await quoteSelection(user, note(0))
    expect(within(screen.getByRole('group', { name: 'Quotes for your next message' })).getAllByRole('listitem')).toHaveLength(1)

    for (let index = 1; index < 7; index += 1) await quoteSelection(user, note(index))
    const strip = screen.getByRole('group', { name: 'Quotes for your next message' })
    expect(within(strip).getAllByRole('listitem')).toHaveLength(MAX_QUOTES)

    await user.click(within(strip).getAllByRole('button', { name: /^Remove the quote from Claude/ })[0] as HTMLElement)
    expect(within(strip).getAllByRole('listitem')).toHaveLength(MAX_QUOTES - 1)
    await user.click(within(strip).getByRole('button', { name: 'Clear' }))
    expect(screen.queryByRole('group', { name: 'Quotes for your next message' })).not.toBeInTheDocument()
  })

  it('quotes a whole message from its hover action, naming who said it', async () => {
    const { user } = await open((daemon) => {
      daemon.upsert(daemon.message('t0', 'u0', 'User', 'Please fix the build.'))
      daemon.upsert(daemon.message('t1', 'a1', 'Assistant', 'The lockfile was out of date.'))
    })

    const buttons = screen.getAllByRole('button', { name: 'Quote this message' })
    expect(buttons).toHaveLength(2)
    await user.click(buttons[0] as HTMLElement)

    const strip = screen.getByRole('group', { name: 'Quotes for your next message' })
    expect(strip).toHaveTextContent('You')
    expect(strip).toHaveTextContent('Please fix the build.')
  })

  it('sends the quotes ahead of the words, and the chat draws them as stubs above the words', async () => {
    const { user, box } = await open((daemon) => { daemon.upsert(daemon.message('t1', 'a1', 'Assistant', 'The lockfile was out of date.')) })
    await quoteSelection(user, screen.getByText('The lockfile was out of date.'))

    await user.type(box, 'Regenerate it please')
    await user.keyboard('{Enter}')
    await settle()

    expect(fake.submitMessage.mock.calls[0]?.[2]).toBe('> Quote from Claude:\n> The lockfile was out of date.\n\nRegenerate it please')
    expect(peekComposer(FAKE_CONVERSATION).quotes).toHaveLength(0)
    const stub = screen.getByRole('button', { name: /Quoted from Claude: The lockfile was out of date\./ })
    expect(stub).toBeInTheDocument()
    expect(screen.getByText('Regenerate it please')).toBeInTheDocument()
    // The sent bubble holds the stub and the words, never the `>` lines.
    expect(screen.queryByText(/Quote from Claude:/)).not.toBeInTheDocument()
  })

  it('does not send quotes alone, and treats a slash line with quotes as a message', async () => {
    const { user, box } = await open((daemon) => { daemon.upsert(daemon.message('t1', 'a1', 'Assistant', 'The lockfile was out of date.')) })
    await quoteSelection(user, screen.getByText('The lockfile was out of date.'))

    await user.click(box)
    await user.keyboard('{Enter}')
    await settle()
    expect(fake.submitMessage).not.toHaveBeenCalled()

    await user.type(box, '/status')
    await user.keyboard('{Enter}')
    await settle()
    expect(fake.submitMessage.mock.calls[0]?.[2]).toBe('> Quote from Claude:\n> The lockfile was out of date.\n\n/status')
  })

  const asked = (daemon: FakeDaemonHistory) => {
    daemon.upsert(daemon.message('t1', 'a1', 'Assistant', 'The lockfile was out of date.'))
    daemon.upsert(daemon.message('t2', 'u1', 'User', '> Quote from Claude:\n> The lockfile was out of date.\n\nFix it'))
  }

  it('goes to the quoted message when its stub is pressed, and marks it for 1.2 seconds', async () => {
    const { user } = await open(asked)

    await user.click(screen.getByRole('button', { name: /Quoted from Claude/ }))
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    const source = Array.from(document.querySelectorAll<HTMLElement>('[data-key]')).find((row) => row.textContent.includes('The lockfile was out of date.') && row.querySelector('.mx-msg-agent') !== null)
    expect(source).toBeDefined()
    expect(source).toHaveClass('is-flash')

    await act(async () => { await vi.advanceTimersByTimeAsync(1250) })
    expect(source).not.toHaveClass('is-flash')
  })
})
