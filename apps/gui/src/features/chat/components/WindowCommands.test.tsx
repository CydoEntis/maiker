import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_CONVERSATION, FakeDaemonHistory } from '../fakeDaemonHistory'
import { forgetComposers } from '../composerStore'
import { forgetSlashCommands } from '../slashCommands'
import { forgetChatFeeds } from '../useChatFeed'
import { ChatSession, type WindowActions } from './ChatSession'

const fake = vi.hoisted(() => ({
  current: null as null | { read: (cursor: never) => Promise<unknown> },
  submitMessage: vi.fn<(conversation: { id: string; generation: number }, operation: number, text: string) => Promise<unknown>>(),
  loadAgentCommands: vi.fn<(agent: string, folder: string) => Promise<{ name: string; description: string; hint: string; aliases: string[] }[]>>(),
}))

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  submitMessage: fake.submitMessage,
  loadAgentCommands: fake.loadAgentCommands,
  readConversationPage: (_id: number, cursor: unknown) => {
    if (fake.current === null) throw new Error('no fake daemon')
    return fake.current.read(cursor as never)
  },
}))

const COMMANDS = [
  { name: 'clear', description: 'Start a new conversation', hint: '', aliases: [] },
  { name: 'compact', description: 'Keep a summary of the conversation', hint: '', aliases: [] },
  { name: 'model', description: 'Pick the model', hint: '[model]', aliases: [] },
  { name: 'developer:pr', description: 'Open a pull request', hint: '', aliases: ['pr'] },
]
const ROOT = '/home/me/app'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  forgetChatFeeds()
  forgetComposers()
  forgetSlashCommands()
  fake.submitMessage.mockReset().mockResolvedValue({})
  fake.loadAgentCommands.mockReset().mockResolvedValue(COMMANDS)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  fake.current = null
})

async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

async function open(props: Partial<Parameters<typeof ChatSession>[0]> = {}) {
  const daemon = new FakeDaemonHistory()
  daemon.upsert(daemon.message('t1', 'u', 'User', 'earlier'))
  fake.current = daemon
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
  render(<ChatSession link={{ conversation: FAKE_CONVERSATION, generation: 1 }} agent="claude" online root={ROOT} {...props} />)
  await settle()
  return { user, box: screen.getByRole('textbox', { name: `Message ${props.agent ?? 'claude'}` }) }
}

const offered = () => within(screen.getByRole('listbox', { name: 'claude commands' })).getAllByRole('option').map((option) => option.textContent)

function windowActions() {
  return { openSettings: vi.fn<WindowActions['openSettings']>(), openPanel: vi.fn<WindowActions['openPanel']>(), openRecent: vi.fn<WindowActions['openRecent']>() }
}

describe('the commands the window answers itself', () => {
  it('opens the session\'s changes for /diff, in a chat session too, and sends Claude nothing', async () => {
    const actions = windowActions()
    const { user, box } = await open({ windowActions: actions })

    await user.type(box, '/dif')
    expect(offered()).toEqual(['/diffChangesView uncommitted changes'])
    await user.keyboard('{Enter}')

    expect(actions.openPanel).toHaveBeenCalledExactlyOnceWith('changes')
    expect(fake.submitMessage).not.toHaveBeenCalled()
    expect(box).toHaveValue('')
  })

  it('opens the approved commands for /permissions and the closed sessions for /resume, typed out', async () => {
    const actions = windowActions()
    const { user, box } = await open({ windowActions: actions })

    await user.type(box, '/permissions{Escape}{Enter}')
    await user.type(box, '/resume{Escape}{Enter}')

    expect(actions.openSettings).toHaveBeenCalledExactlyOnceWith('agents')
    expect(actions.openRecent).toHaveBeenCalledOnce()
    expect(fake.submitMessage).not.toHaveBeenCalled()
  })

  it('lists every command for /help, right in the box', async () => {
    const { user, box } = await open({ windowActions: windowActions() })

    await user.type(box, '/help{Escape}{Enter}')

    expect(box).toHaveValue('/')
    expect(screen.getByRole('listbox', { name: 'claude commands' })).toBeInTheDocument()
    expect(fake.submitMessage).not.toHaveBeenCalled()
  })

  it('asks before /clear empties the session, with Cancel first, and sends nothing when cancelled', async () => {
    const { user, box } = await open({ windowActions: windowActions() })

    await user.type(box, '/cl')
    expect(offered()).toEqual(['/clear' + 'asks firstStart a new conversation'])
    await user.keyboard('{Enter}')

    const dialog = screen.getByRole('alertdialog', { name: 'Start a new conversation?' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(fake.submitMessage).not.toHaveBeenCalled()
  })

  it('sends /clear as typed once the person says yes', async () => {
    const { user, box } = await open({ windowActions: windowActions() })

    await user.type(box, '/clear{Escape}{Enter}')
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(fake.submitMessage).toHaveBeenCalledExactlyOnceWith({ id: String(FAKE_CONVERSATION), generation: 1 }, 1, '/clear')
  })

  it('types /exit into the terminal once confirmed, where Claude Code quits', async () => {
    const typeInto = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    const onShowTerminal = vi.fn()
    const { user, box } = await open({ link: { conversation: FAKE_CONVERSATION, generation: 1, readOnly: true }, typeInto, onShowTerminal, windowActions: windowActions() })

    await user.type(box, '/exit{Escape}{Enter}')
    expect(typeInto).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'End session' }))

    expect(onShowTerminal).toHaveBeenCalledOnce()
    await settle(1000)
    expect(typeInto.mock.calls.map(([text]) => text)).toEqual(['/exit', '\r'])
  })
})
