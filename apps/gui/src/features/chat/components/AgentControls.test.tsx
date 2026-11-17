import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_CONVERSATION, FakeDaemonHistory } from '../fakeDaemonHistory'
import { useFakePaneQueue } from '../fakePaneQueue'
import { forgetComposers } from '../composerStore'
import { forgetFirstMessages, holdStartChoice, startChoiceOf } from '../firstMessage'
import { forgetChoices } from '../agentChoice'
import { forgetChatFeeds, IDLE_POLL_MS } from '../useChatFeed'
import { COMMAND_SUBMIT_GAP_MS } from '../useChatComposer'
import { ChatSession } from './ChatSession'

const fake = vi.hoisted(() => ({ current: null as null | { read: (cursor: never) => Promise<unknown> } }))

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  readConversationPage: (_id: number, cursor: unknown) => {
    if (fake.current === null) throw new Error('no fake daemon')
    return fake.current.read(cursor as never)
  },
  loadTerminalScreen: () => Promise.resolve('> hi\n\n  dev · Sonnet 5.5\n  ⏵⏵ accept edits on (shift+tab to cycle)\n'),
  loadAgentModels: () => Promise.resolve([{ id: 'claude-opus-5-5', label: 'Opus 5.5', blurb: 'The most capable' }, { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', blurb: 'Fast' }]),
}))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  forgetChatFeeds()
  forgetComposers()
  forgetFirstMessages()
  forgetChoices()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  fake.current = null
})

async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

function open(agent: 'claude' | 'codex', status: 'Idle' | 'Working' = 'Idle') {
  const daemon = new FakeDaemonHistory()
  daemon.status = status
  daemon.meta = { mode: 'auto', model: 'claude-sonnet-5-5' }
  fake.current = daemon
  const typeInto = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  render(<WithPaneQueue agent={agent} typeInto={typeInto} />)
  return typeInto
}

/** The chat with a pane queue that behaves as the daemon's does; what it holds is written out, oldest first. */
function WithPaneQueue({ agent, typeInto }: { agent: 'claude' | 'codex'; typeInto: (text: string) => Promise<void> }) {
  const paneQueue = useFakePaneQueue()
  return (
    <>
      <ChatSession link={{ conversation: FAKE_CONVERSATION, generation: 1, readOnly: true }} agent={agent} online typeInto={typeInto} paneQueue={paneQueue} sessionId="s1" />
      <output aria-label="The daemon holds">{paneQueue.queued.join(' | ')}</output>
    </>
  )
}

describe('changing the mode, the model and the reasoning of a chat that follows the terminal', () => {
  it('moves the agent to the mode picked from the dropdown, with its own Shift+Tab', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const typeInto = open('claude')
    await settle(IDLE_POLL_MS)

    await user.click(screen.getByRole('button', { name: /^Permission mode: .* Pick another/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: /Accept edits/ }))
    await settle(1000)
    // The fake screen already shows "accept edits", so no key is needed; the chip shows it.
    expect(typeInto).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Permission mode: Accept edits/ })).toBeInTheDocument()
  })

  it('sends /model and /effort when a model and a reasoning level are picked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const typeInto = open('claude')
    await settle(IDLE_POLL_MS)

    await user.click(screen.getByRole('button', { name: /^Agent, model and reasoning/ }))
    await user.click(await screen.findByRole('radio', { name: /Opus 5.5/ }))
    await settle(COMMAND_SUBMIT_GAP_MS)
    // The command first and its Enter after a pause: sent together, Claude Code takes the Enter for its completion.
    expect(typeInto.mock.calls.map(([text]) => text)).toEqual(['/model claude-opus-5-5', '\r'])
    // The chip shows the picked model at once.
    expect(screen.getByRole('button', { name: /^Agent, model and reasoning/ })).toHaveTextContent('Opus')
    await user.click(screen.getByRole('radio', { name: 'High' }))
    await settle(COMMAND_SUBMIT_GAP_MS)
    expect(typeInto.mock.calls.map(([text]) => text).slice(2)).toEqual(['/effort high', '\r'])
  })

  it('moves a running Codex to the picked mode with its own /permissions command', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const typeInto = open('codex')
    await settle(IDLE_POLL_MS)

    await user.click(screen.getByRole('button', { name: /^Permission mode: .* Pick another/ }))
    expect(await screen.findAllByRole('menuitemradio')).toHaveLength(3)
    await user.click(screen.getByRole('menuitemradio', { name: /^Read only/ }))
    await settle(IDLE_POLL_MS)
    // The command first and its Enter a moment later: Codex takes an Enter that comes with the text for a line break.
    expect(typeInto.mock.calls.map(([text]) => text)).toEqual(['/permissions :read-only --approval-policy=on-request', '\r'])
    expect(screen.getByRole('button', { name: /^Permission mode: Read only/ })).toBeInTheDocument()
  })

  it('sends a working Codex nothing and says why', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const typeInto = open('codex', 'Working')
    await settle(IDLE_POLL_MS)

    await user.click(screen.getByRole('button', { name: /^Permission mode: .* Pick another/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: /^Full access/ }))
    expect(typeInto).not.toHaveBeenCalled()
  })

  it('keeps the mode chip in place while the agent works, greyed out with the reason, and sends nothing from it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const typeInto = open('claude', 'Working')
    await settle(IDLE_POLL_MS)

    const mode = screen.getByRole('button', { name: /^Permission mode: Auto/ })
    expect(mode).toHaveAttribute('aria-disabled', 'true')
    expect(mode).toHaveAttribute('title', expect.stringMatching(/working/))

    await user.click(mode)
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
    expect(typeInto).not.toHaveBeenCalled()
  })

  it('sends a model and an effort picked while the agent works at once, as typing them in the terminal does', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const typeInto = open('claude', 'Working')
    await settle(IDLE_POLL_MS)

    const model = screen.getByRole('button', { name: /^Agent, model and reasoning/ })
    expect(model).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(model)
    await user.click(await screen.findByRole('radio', { name: /^Opus 5\.5/ }))
    await user.click(screen.getByRole('radio', { name: 'High' }))

    // Nothing waits for the turn to end, nothing is left in the queue, and the two commands do not interleave.
    await settle(COMMAND_SUBMIT_GAP_MS * 2)
    expect(typeInto.mock.calls.map(([text]) => text)).toEqual(['/model claude-opus-5-5', '\r', '/effort high', '\r'])
    expect(screen.queryByRole('region', { name: 'Queued messages' })).not.toBeInTheDocument()
  })

  it('names what the agent says it runs, whether it was picked here or typed in the terminal', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const daemon = new FakeDaemonHistory()
    daemon.meta = { mode: 'auto', model: 'claude-sonnet-5-5' }
    fake.current = daemon
    const typeInto = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    const chat = (effort: string) => <ChatSession link={{ conversation: FAKE_CONVERSATION, generation: 1, readOnly: true }} agent="claude" online typeInto={typeInto} sessionId="s1" effort={effort} />
    const { rerender } = render(chat('medium'))
    await settle(IDLE_POLL_MS)
    const button = () => screen.getByRole('button', { name: /^Agent, model and reasoning/ })
    expect(button()).toHaveAccessibleName(/Sonnet 5.5 · Medium/)

    // Picked here: shown at once, and the agent's files then say the same.
    await user.click(button())
    await user.click(screen.getByRole('radio', { name: 'High' }))
    await settle(COMMAND_SUBMIT_GAP_MS)
    expect(button()).toHaveAccessibleName(/· High/)
    rerender(chat('high'))
    expect(button()).toHaveAccessibleName(/· High/)

    // Typed in the terminal: the chat follows.
    rerender(chat('low'))
    daemon.meta = { mode: 'auto', model: 'claude-opus-5-5' }
    await settle(IDLE_POLL_MS)
    expect(button()).toHaveAccessibleName(/Opus 5.5 · Low/)
    // No pick of its own is kept, so nothing can later disagree with the terminal.
    expect(window.localStorage.getItem('maitty.gui.agentChoice.v1')).toBeNull()
  })

  it('ignores a pick this window kept for an earlier chat of the same number', async () => {
    // Numbers start again when the daemon restarts; the earlier chat's agent had said what this one says.
    window.localStorage.setItem('maitty.gui.agentChoice.v1', JSON.stringify({ [String(FAKE_CONVERSATION)]: { model: 'claude-opus-5-5', reasoning: 'max', saidModel: 'claude-sonnet-5-5', saidEffort: 'medium' } }))
    const daemon = new FakeDaemonHistory()
    daemon.meta = { mode: 'auto', model: 'claude-sonnet-5-5' }
    fake.current = daemon
    render(<ChatSession link={{ conversation: FAKE_CONVERSATION, generation: 1, readOnly: true }} agent="claude" online typeInto={vi.fn()} sessionId="s1" effort="medium" />)
    await settle(IDLE_POLL_MS)
    expect(screen.getByRole('button', { name: /^Agent, model and reasoning/ })).toHaveAccessibleName(/Sonnet 5.5 · Medium/)
  })

  it('starts from what was picked on the new-chat page, before the agent has said anything', async () => {
    holdStartChoice('s1', { model: 'claude-opus-5-5', reasoning: 'high', mode: 'plan' })
    const daemon = new FakeDaemonHistory()
    daemon.meta = null
    fake.current = daemon
    render(<ChatSession link={{ conversation: FAKE_CONVERSATION, generation: 1, readOnly: true }} agent="claude" online typeInto={vi.fn()} sessionId="s1" />)
    await settle(IDLE_POLL_MS)

    // The effort is drawn as bars on the button, so it is in the button's name, not its text.
    expect(screen.getByRole('button', { name: /^Agent, model and reasoning: Claude · Opus 5.5 · High/ })).toHaveTextContent('Opus 5.5')
    expect(screen.getByRole('button', { name: /^Permission mode: Plan/ })).toBeInTheDocument()
    expect(startChoiceOf('s1')).toBeNull()
  })

  it('opens Codex\'s own /model menu in the chat from the model label, and closes it with Esc', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const typeInto = open('codex')
    await settle(IDLE_POLL_MS)

    await user.click(screen.getByRole('button', { name: /^Model: .* Open its menu/ }))
    await settle(COMMAND_SUBMIT_GAP_MS)
    // The command first and its Enter after a pause, as every typed command goes; nothing is typed that the person did not ask for.
    expect(typeInto.mock.calls.map(([text]) => text)).toEqual(['/model', '\r'])
    const card = screen.getByRole('region', { name: 'Codex model menu' })
    expect(within(card).getByRole('group', { name: "Keys for the agent's terminal" })).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'Down' }))
    expect(typeInto).toHaveBeenLastCalledWith('\x1b[B')
    await user.click(within(card).getByRole('button', { name: 'Close' }))
    expect(typeInto).toHaveBeenLastCalledWith('\x1b')
    expect(screen.queryByRole('region', { name: 'Codex model menu' })).not.toBeInTheDocument()
  })

  it('does not open Codex\'s model menu while it works, and says why', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const typeInto = open('codex', 'Working')
    await settle(IDLE_POLL_MS)

    const label = screen.getByRole('button', { name: /^Model: .* Open its menu/ })
    expect(label).toHaveAttribute('aria-disabled', 'true')
    expect(label).toHaveAttribute('title', expect.stringMatching(/working/))
    await user.click(label)
    expect(typeInto).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Codex model menu' })).not.toBeInTheDocument()
  })
})
