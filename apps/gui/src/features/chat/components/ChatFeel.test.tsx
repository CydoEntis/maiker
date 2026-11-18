import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_CONVERSATION, FakeDaemonHistory } from '../fakeDaemonHistory'
import { forgetComposers } from '../composerStore'
import { forgetFirstMessages } from '../firstMessage'
import { ACTIVE_POLL_MS, forgetChatFeeds, IDLE_POLL_MS } from '../useChatFeed'
import { PASTE_SUBMIT_GAP_MS, RESUBMIT_AFTER_MS } from '../useChatComposer'
import type { SessionStatus } from '@/features/workspace/model/session'
import { ChatSession } from './ChatSession'

const fake = vi.hoisted(() => ({ current: null as null | { read: (cursor: never) => Promise<unknown> } }))

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  readConversationPage: (_id: number, cursor: unknown) => {
    if (fake.current === null) throw new Error('no fake daemon')
    return fake.current.read(cursor as never)
  },
}))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  forgetChatFeeds()
  forgetComposers()
  forgetFirstMessages()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  fake.current = null
})

/** Long enough for any reply in these tests to be typed in: the reply catches up within a few seconds. */
const TYPED_IN_MS = 3_000

const LINK = { conversation: FAKE_CONVERSATION, generation: 1, readOnly: true }

async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

function open(status: 'Idle' | 'Working' = 'Idle') {
  const daemon = new FakeDaemonHistory()
  daemon.status = status
  daemon.upsert(daemon.message('t1', 'u1', 'User', 'earlier'))
  fake.current = daemon
  const typeInto = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
  const element = (paneStatus?: SessionStatus, helpersOnly = 0) => <ChatSession link={LINK} agent="claude" online typeInto={typeInto} helpersOnly={helpersOnly} {...(paneStatus === undefined ? {} : { paneStatus })} />
  const view = render(element())
  return { daemon, typeInto, user, setPaneStatus: (paneStatus: SessionStatus, helpersOnly = 0) => { view.rerender(element(paneStatus, helpersOnly)) } }
}

describe('how the chat feels while it waits', () => {
  it('shows the shape of a conversation while the history is first read, then the history', async () => {
    open()
    expect(screen.getByRole('status', { name: 'Reading the conversation' })).toBeInTheDocument()

    await settle()

    expect(screen.queryByRole('status', { name: 'Reading the conversation' })).not.toBeInTheDocument()
    expect(screen.getByText('earlier')).toBeInTheDocument()
  })

  it('draws a message at once when it is sent and shows the live box saying the agent is thinking, until the history has it', async () => {
    const { daemon, typeInto, user } = open()
    await settle()

    await user.type(screen.getByRole('textbox', { name: 'Message claude' }), 'hello there{Enter}')
    await settle()

    await settle(PASTE_SUBMIT_GAP_MS + 1)
    expect(typeInto).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('Sending')).toHaveTextContent('hello there')
    expect(screen.getByText('Thinking')).toBeInTheDocument()

    // The agent writes its file: the real message replaces the drawn one, and there is only one.
    daemon.upsert(daemon.message('t1', 'u2', 'User', 'hello there'))
    await settle(IDLE_POLL_MS)

    expect(screen.queryByLabelText('Sending')).not.toBeInTheDocument()
    expect(screen.getAllByText('hello there')).toHaveLength(1)
  })

  it('types the Enter once more when the message did not start a turn, and only once', async () => {
    const { typeInto, user } = open()
    await settle()
    await user.type(screen.getByRole('textbox', { name: 'Message claude' }), 'hello there{Enter}')
    await settle(PASTE_SUBMIT_GAP_MS + 1)
    expect(typeInto).toHaveBeenCalledTimes(2)

    // Still at rest and nothing in the history: the words are sitting in the agent's box.
    await settle(RESUBMIT_AFTER_MS)
    expect(typeInto).toHaveBeenCalledTimes(3)
    expect(typeInto).toHaveBeenLastCalledWith('\r')
    await settle(RESUBMIT_AFTER_MS * 2)
    expect(typeInto).toHaveBeenCalledTimes(3)
  })

  it('types no second Enter once the agent took the message', async () => {
    const { daemon, typeInto, user, setPaneStatus } = open()
    await settle()
    await user.type(screen.getByRole('textbox', { name: 'Message claude' }), 'hello there{Enter}')
    await settle(PASTE_SUBMIT_GAP_MS + 1)
    setPaneStatus('working')
    daemon.status = 'Working'
    await settle(RESUBMIT_AFTER_MS)

    expect(typeInto).toHaveBeenCalledTimes(2)
  })

  it('takes a message the agent joined to the one before it as sent', async () => {
    const { daemon, user } = open()
    await settle()
    await user.type(screen.getByRole('textbox', { name: 'Message claude' }), 'then the integrations{Enter}')
    await settle(PASTE_SUBMIT_GAP_MS + 1)

    daemon.upsert(daemon.message('t1', 'u2', 'User', 'set it up\nthen the integrations'))
    await settle(IDLE_POLL_MS)

    expect(screen.queryByLabelText('Sending')).not.toBeInTheDocument()
  })

  it('stops saying the agent is thinking after a few seconds, when its own status does not, while the message stays', async () => {
    const { user } = open()
    await settle()
    await user.type(screen.getByRole('textbox', { name: 'Message claude' }), 'hello there{Enter}')
    await settle(PASTE_SUBMIT_GAP_MS + 1)
    expect(screen.getByText('Thinking')).toBeInTheDocument()

    await settle(4_100)

    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Sending')).toHaveTextContent('hello there')
  })

  it('reads again as a turn ends, so the last words are not left to the slow idle poll', async () => {
    const { daemon } = open('Working')
    await settle()
    expect(screen.getByText('Thinking')).toBeInTheDocument()

    // The turn ends; the agent's last message is written a moment after the status changes.
    daemon.status = 'Idle'
    await settle(ACTIVE_POLL_MS + 1)
    daemon.upsert(daemon.message('t1', 'a1', 'Assistant', 'the answer'))
    await settle(700 + TYPED_IN_MS)

    expect(screen.getByText('the answer')).toBeInTheDocument()
  })

  it('draws the running turn as it streams in: its steps at once and its reply typed in, over one working line', async () => {
    const { daemon } = open('Working')
    daemon.upsert(daemon.message('t2', 'u2', 'User', 'fix the build'))
    await settle()
    // Nothing of the turn yet: a skeleton holds the place of its first row.
    expect(screen.getByText('Thinking')).toBeInTheDocument()
    expect(document.querySelectorAll('.mx-sk')).toHaveLength(3)

    daemon.upsert(daemon.tool('t2', 'c1', 'pnpm build', 'error: lockfile', 'Running'))
    daemon.upsert(daemon.message('t2', 'a1', 'Assistant', 'The build fails because', 'Running'))
    await settle(ACTIVE_POLL_MS + 1 + TYPED_IN_MS)

    expect(screen.getByText('The build fails because')).toBeInTheDocument()
    expect(document.querySelector('[data-key="t2:c1"]')).not.toBeNull()
    expect(document.querySelector('.mx-sk')).toBeNull()
    expect(screen.getByText('Esc to stop')).toBeInTheDocument()

    // More of the same message: typed on from where it was.
    daemon.upsert(daemon.message('t2', 'a1', 'Assistant', 'The build fails because the lockfile is stale.', 'Running'))
    await settle(ACTIVE_POLL_MS + 1 + TYPED_IN_MS)
    expect(screen.getByText('The build fails because the lockfile is stale.')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-key="t2:a1"]')).toHaveLength(1)
  })

  it('shows a reply that arrived while the chat was closed whole when it is opened again, and does not type it in', async () => {
    const { daemon } = open()
    await settle()
    cleanup()

    // The agent answered while another view was showing.
    daemon.upsert(daemon.message('t1', 'a1', 'Assistant', 'the answer that came while you were away'))
    render(<ChatSession link={LINK} agent="claude" online />)
    await settle()

    expect(screen.getByText('the answer that came while you were away')).toBeInTheDocument()
  })

  it('shows a reply that arrived while the window was hidden whole, and does not type it in', async () => {
    const { daemon } = open()
    await settle()
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    await settle(IDLE_POLL_MS)

    daemon.upsert(daemon.message('t1', 'a1', 'Assistant', 'the answer that came while you were away'))
    hidden.mockReturnValue(false)
    await settle(IDLE_POLL_MS)
    hidden.mockRestore()

    expect(screen.getByText('the answer that came while you were away')).toBeInTheDocument()
  })

  it('shows the agent working as soon as the pane says so, before the conversation has been read again', async () => {
    const { daemon, setPaneStatus } = open('Idle')
    await settle()
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()

    // A turn started in the terminal: the pane's status is live, the chat's own read is still "idle".
    setPaneStatus('working')
    await settle()

    expect(screen.getByText('Thinking')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message claude' })).toHaveAttribute('placeholder', 'Queue a message for when claude finishes')

    // And the chat read the conversation at that moment, not at its next idle poll.
    daemon.upsert(daemon.message('t1', 'u3', 'User', 'asked in the terminal'))
    setPaneStatus('idle')
    await settle(700)
    expect(screen.getByText('asked in the terminal')).toBeInTheDocument()
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
  })

  it('says the agent is free while only its helpers work, and takes a message at once', async () => {
    const { typeInto, user, setPaneStatus } = open('Idle')
    await settle()

    setPaneStatus('working', 3)
    await settle()

    expect(screen.getByText('Free · 3 helpers working')).toBeInTheDocument()
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
    const box = screen.getByRole('textbox', { name: 'Message claude' })
    expect(box).not.toHaveAttribute('placeholder', 'Queue a message for when claude finishes')
    await user.type(box, 'and Slack too{Enter}')
    await settle(PASTE_SUBMIT_GAP_MS + 1)
    expect(typeInto).toHaveBeenCalledWith('\x1b[200~and Slack too\x1b[201~')
  })

  it('keeps the live box up for a moment after the turn ends, so the pane is not blank before the reply is read', async () => {
    const { daemon, setPaneStatus } = open('Idle')
    await settle()
    setPaneStatus('working')
    await settle()
    daemon.upsert(daemon.message('t1', 'u3', 'User', 'a question'))
    await settle(400)

    // The turn ended on the pane, but the history has no answer yet.
    setPaneStatus('idle')
    await settle(50)
    expect(screen.getByText('Thinking')).toBeInTheDocument()

    // And it does not stay for good: with no answer it gives way after a moment.
    await settle(1000)
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
  })

  it('gives the focus back to the message box when you click the conversation, so one click is enough to type again', async () => {
    open('Idle')
    await settle(IDLE_POLL_MS)
    const box = screen.getByRole('textbox', { name: 'Message claude' })
    box.blur()
    expect(box).not.toHaveFocus()

    fireEvent.click(screen.getByText('earlier'))

    expect(box).toHaveFocus()
  })

  it('says in the message box how the agent is set up, from its own file', async () => {
    const { daemon } = open()
    daemon.meta = { mode: 'auto', model: 'claude-sonnet-5-5' }
    await settle(IDLE_POLL_MS)

    // The mode is a shield; its name is in the button's name and tooltip.
    expect(screen.getByRole('button', { name: /^Permission mode: Auto/ })).toHaveAttribute('title', expect.stringContaining('Auto'))
    expect(screen.getByText('Claude Sonnet 5.5')).toBeInTheDocument()
  })

  it('marks a mode that asks about nothing, and shows nothing when the file said nothing', async () => {
    const { daemon } = open()
    await settle()
    // This chat can type into its terminal, so the mode is a button (it cycles the mode); it says when the agent has not reported one.
    expect(screen.getByRole('button', { name: /not reported yet/ })).toHaveAttribute('title', expect.stringContaining('Permissions'))

    daemon.meta = { mode: 'bypassPermissions', model: null }
    await settle(IDLE_POLL_MS)

    const shield = screen.getByRole('button', { name: /^Permission mode: Bypass permissions/ })
    expect(shield.className).toContain('danger')
  })

  it('drops a message the history never showed, rather than leaving it standing as sent', async () => {
    const { user } = open()
    await settle()
    await user.type(screen.getByRole('textbox', { name: 'Message claude' }), 'lost words{Enter}')
    await settle(PASTE_SUBMIT_GAP_MS + 1)
    expect(screen.getByLabelText('Sending')).toBeInTheDocument()

    await settle(21_000)

    expect(screen.queryByLabelText('Sending')).not.toBeInTheDocument()
  })
})
