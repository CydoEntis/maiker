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
  sideAnswer: vi.fn<(conversation: number, ask: unknown) => Promise<{ ok: true; text: string } | { ok: false; reason: string }>>(),
}))

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  submitMessage: fake.submitMessage,
  loadAgentCommands: fake.loadAgentCommands,
  sideAnswer: fake.sideAnswer,
  readConversationPage: (_id: number, cursor: unknown) => {
    if (fake.current === null) throw new Error('no fake daemon')
    return fake.current.read(cursor as never)
  },
}))

const COMMANDS = [
  { name: 'context', description: 'Show what fills the context', hint: '', aliases: [] },
  { name: 'goal', description: 'Set a goal', hint: '[condition]', aliases: [] },
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
  fake.sideAnswer.mockReset().mockResolvedValue({ ok: true, text: '## Context Usage\n\n**Tokens:** 48.2k' })
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
  return { openSettings: vi.fn<WindowActions['openSettings']>(), openPanel: vi.fn<WindowActions['openPanel']>(), openRecent: vi.fn<WindowActions['openRecent']>(), renameSession: vi.fn<WindowActions['renameSession']>() }
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

    expect(actions.openSettings).toHaveBeenCalledExactlyOnceWith('permissions')
    expect(actions.openRecent).toHaveBeenCalledOnce()
    expect(fake.submitMessage).not.toHaveBeenCalled()
  })

  it('opens the Extensions page for the commands that open a menu of plugins, skills, servers and hooks, and sends nothing', async () => {
    const actions = windowActions()
    const { user, box } = await open({ windowActions: actions })

    await user.type(box, '/skills{Escape}{Enter}')
    await user.type(box, '/hooks{Escape}{Enter}')

    expect(actions.openSettings).toHaveBeenCalledTimes(2)
    expect(actions.openSettings).toHaveBeenNthCalledWith(1, 'extensions')
    expect(actions.openSettings).toHaveBeenNthCalledWith(2, 'extensions')
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

  it('answers /context in a card above the box, never in the conversation, and the card goes when closed', async () => {
    const { user, box } = await open({ windowActions: windowActions() })

    await user.type(box, '/cont')
    expect(offered()).toEqual(['/contextanswered hereShow what fills the context'])
    await user.keyboard('{Enter}')
    await settle()

    expect(fake.sideAnswer).toHaveBeenCalledExactlyOnceWith(FAKE_CONVERSATION, { command: 'context' })
    const card = screen.getByRole('region', { name: 'Context' })
    expect(within(card).getByRole('heading', { name: 'Context Usage' })).toBeInTheDocument()
    expect(within(card).getByText('Not added to the conversation')).toBeInTheDocument()
    expect(fake.submitMessage).not.toHaveBeenCalled()

    await user.click(within(card).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'Context' })).not.toBeInTheDocument()
  })

  it('asks a side question while Claude works on, and can ask it in the conversation instead', async () => {
    let answer: (reply: { ok: true; text: string }) => void = () => {}
    fake.sideAnswer.mockReturnValue(new Promise((resolve) => { answer = resolve }))
    const { user, box } = await open({ windowActions: windowActions() })

    await user.type(box, '/btw which file was that?{Enter}')

    const card = screen.getByRole('region', { name: 'Side question' })
    expect(within(card).getByText('which file was that?')).toBeInTheDocument()
    expect(within(card).getByRole('status')).toHaveTextContent('Asking Claude…')
    expect(fake.sideAnswer).toHaveBeenCalledExactlyOnceWith(FAKE_CONVERSATION, { question: 'which file was that?' })
    answer({ ok: true, text: 'src/tax.js' })
    await settle()
    expect(within(card).getByText('src/tax.js')).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'Ask in the conversation' }))
    expect(fake.submitMessage).toHaveBeenCalledExactlyOnceWith({ id: String(FAKE_CONVERSATION), generation: 1 }, 1, 'which file was that?')
    expect(screen.queryByRole('region', { name: 'Side question' })).not.toBeInTheDocument()
  })

  it('waits for the question after /btw alone, and says so when Claude Code cannot answer', async () => {
    fake.sideAnswer.mockResolvedValue({ ok: false, reason: 'Claude Code took too long to answer' })
    const { user, box } = await open({ windowActions: windowActions() })

    await user.type(box, '/btw{Escape}{Enter}')
    expect(box).toHaveValue('/btw ')
    expect(fake.sideAnswer).not.toHaveBeenCalled()

    await user.type(box, 'why?{Enter}')
    await settle()
    expect(within(screen.getByRole('region', { name: 'Side question' })).getByRole('alert')).toHaveTextContent('Claude Code took too long to answer')
  })

  it('sends a reporting command typed with something after it as typed, since that changes something', async () => {
    const { user, box } = await open({ windowActions: windowActions() })

    await user.type(box, '/goal tests pass{Escape}{Enter}')

    expect(fake.sideAnswer).not.toHaveBeenCalled()
    expect(fake.submitMessage).toHaveBeenCalledExactlyOnceWith({ id: String(FAKE_CONVERSATION), generation: 1 }, 1, '/goal tests pass')
  })

  it('shows where the phone app is for /mobile, which Claude Code draws as a QR code', async () => {
    const { user, box } = await open({ windowActions: windowActions() })

    await user.type(box, '/mobile{Escape}{Enter}')

    const card = screen.getByRole('region', { name: 'Claude on your phone' })
    expect(within(card).getByRole('button', { name: 'claude.ai/mobile' })).toHaveAttribute('title', 'https://claude.ai/mobile (click to open in your browser)')
    expect(fake.sideAnswer).not.toHaveBeenCalled()
  })

  it('renames the session in Maitty too for /rename with a name, and still sends it so Claude Code agrees', async () => {
    const actions = windowActions()
    const { user, box } = await open({ windowActions: actions })

    await user.type(box, '/rename tax fix{Escape}{Enter}')

    expect(actions.renameSession).toHaveBeenCalledExactlyOnceWith('tax fix')
    expect(fake.submitMessage).toHaveBeenCalledExactlyOnceWith({ id: String(FAKE_CONVERSATION), generation: 1 }, 1, '/rename tax fix')
  })

  it('says a command only the terminal runs cannot run in a chat that has no terminal, and sends nothing', async () => {
    const { user, box } = await open({ windowActions: windowActions() })

    await user.type(box, '/keybindings{Escape}{Enter}')

    const card = screen.getByRole('region', { name: '/keybindings' })
    expect(card).toHaveTextContent("only works in Claude Code's own terminal, and this chat has none")
    expect(fake.submitMessage).not.toHaveBeenCalled()
    expect(box).toHaveValue('')
  })
})

