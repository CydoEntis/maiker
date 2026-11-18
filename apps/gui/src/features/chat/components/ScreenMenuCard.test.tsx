import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_CONVERSATION, FakeDaemonHistory } from '../fakeDaemonHistory'
import { forgetComposers } from '../composerStore'
import { forgetChatFeeds } from '../useChatFeed'
import { ChatSession } from './ChatSession'

const fake = vi.hoisted(() => ({
  current: null as null | { read: (cursor: never) => Promise<unknown> },
}))

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
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  fake.current = null
})

const LINK = { conversation: FAKE_CONVERSATION, generation: 1, readOnly: true }
const SWITCH = 'Switch model?\nYour next response will be slower and use more tokens.\n❯ 1. Yes, switch to Sonnet 5.5\n2. No, go back'
const DOWN = `${String.fromCharCode(27)}[B`
const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)

async function open(asking: string) {
  const daemon = new FakeDaemonHistory()
  daemon.upsert(daemon.message('t1', 'u', 'User', 'earlier'))
  daemon.status = 'Blocked'
  fake.current = daemon
  const typeInto = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
  render(<ChatSession link={LINK} agent="claude" online typeInto={typeInto} ask={null} asking={asking} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  return { typeInto, user }
}

describe('a menu Claude draws on its screen with no hook behind it', () => {
  it('shows a button per choice and no terminal until asked', async () => {
    await open(SWITCH)

    expect(screen.getByText('Your next response will be slower and use more tokens.', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Yes, switch to Sonnet 5.5/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /No, go back/ })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: "Keys for the agent's terminal" })).not.toBeInTheDocument()
  })

  it('moves the cursor to the clicked choice and presses Enter, only on a click', async () => {
    const { typeInto, user } = await open(SWITCH)

    expect(typeInto).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /No, go back/ }))
    expect(typeInto.mock.calls.map(([keys]) => keys)).toEqual([DOWN, ENTER])
  })

  it('picks by number key, but not while typing in the message box', async () => {
    const { typeInto } = await open(SWITCH)

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message claude' }), { key: '2' })
    expect(typeInto).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('region', { name: 'claude needs your permission' }), { key: '2' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(typeInto.mock.calls.map(([keys]) => keys)).toEqual([DOWN, ENTER])
  })

  it('ignores a number with no such choice', async () => {
    const { typeInto } = await open(SWITCH)

    fireEvent.keyDown(screen.getByRole('region', { name: 'claude needs your permission' }), { key: '3' })
    expect(typeInto).not.toHaveBeenCalled()
  })

  it('cancels with Esc', async () => {
    const { typeInto, user } = await open(SWITCH)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(typeInto).toHaveBeenCalledExactlyOnceWith(ESC)
  })

  it('shows the terminal on request', async () => {
    const { user } = await open(SWITCH)

    await user.click(screen.getByRole('button', { name: 'Show terminal' }))
    expect(screen.getByRole('group', { name: "Keys for the agent's terminal" })).toBeInTheDocument()
  })

  it('falls back to the terminal keys when the menu is not a clean numbered one', async () => {
    await open('Pick one\n1. Yes\n2. No')

    expect(screen.queryByRole('button', { name: /Yes/ })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: "Keys for the agent's terminal" })).toBeInTheDocument()
  })
})
