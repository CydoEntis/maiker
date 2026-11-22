import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionAsk } from '@/data/preview'
import { FAKE_CONVERSATION, FakeDaemonHistory } from '../fakeDaemonHistory'
import { forgetComposers } from '../composerStore'
import { ANSWER_KEYS } from '../permissionAsk'
import { PENDING_APPROVAL_NOTE } from '../useChatComposer'
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
const WRITE_ASK: PermissionAsk = { tool: 'Write', detail: 'src/notes.txt', answerable: true }

async function open(status: 'Blocked' | 'Idle', ask: PermissionAsk | null, agent: 'claude' | 'codex' = 'claude') {
  const daemon = new FakeDaemonHistory()
  daemon.upsert(daemon.message('t1', 'u', 'User', 'earlier'))
  daemon.status = status
  fake.current = daemon
  const typeInto = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
  render(<ChatSession link={LINK} agent={agent} online typeInto={typeInto} ask={ask} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  return { typeInto, user }
}

describe('the chat of an agent stopped on a permission prompt', () => {
  it('says what the agent wants to do, and approves with the key Claude Code takes', async () => {
    const { typeInto, user } = await open('Blocked', WRITE_ASK)

    expect(screen.getByText('Wants to use Write')).toBeInTheDocument()
    expect(screen.getByText('src/notes.txt')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Yes once/ }))

    expect(typeInto).toHaveBeenCalledExactlyOnceWith(ANSWER_KEYS.approve)
    expect(ANSWER_KEYS.approve).toBe('1')
  })

  it('approves a Codex prompt with `y`, the key checked against Codex 0.166.0, and refuses with Esc', async () => {
    const approve = await open('Blocked', WRITE_ASK, 'codex')
    await approve.user.click(screen.getByRole('button', { name: /^Yes once/ }))
    expect(approve.typeInto).toHaveBeenCalledExactlyOnceWith('y')
    cleanup()

    const refuse = await open('Blocked', WRITE_ASK, 'codex')
    await refuse.user.click(screen.getByRole('button', { name: /^No/ }))
    expect(refuse.typeInto).toHaveBeenCalledExactlyOnceWith('\x1b')
  })

  it('refuses with Esc', async () => {
    const { typeInto, user } = await open('Blocked', WRITE_ASK)

    await user.click(screen.getByRole('button', { name: /^No/ }))

    expect(typeInto).toHaveBeenCalledExactlyOnceWith('\x1b')
  })

  it('offers no allow button for a prompt whose answer key is not known, only the keys to answer it in the terminal', async () => {
    const { typeInto } = await open('Blocked', { ...WRITE_ASK, answerable: false })

    expect(screen.getByText('Wants to use Write')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Yes once/ })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: "Keys for the agent's terminal" })).toBeInTheDocument()
    expect(typeInto).not.toHaveBeenCalled()
  })

  it('offers one button per choice of a question, and picks it with its number', async () => {
    const { typeInto, user } = await open('Blocked', { tool: 'AskUserQuestion', detail: 'Which database?', answerable: false, choices: ['SQLite', 'Postgres'] })

    expect(screen.getByText('Which database?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Yes once/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Postgres/ }))

    expect(typeInto).toHaveBeenCalledExactlyOnceWith('2')
    expect(screen.getByRole('textbox', { name: 'Message Claude' })).toHaveAttribute('placeholder', PENDING_APPROVAL_NOTE)
  })

  it('shows several questions one at a time, and answers them all at once: a key each in order, then the one that submits', async () => {
    const questions = [
      { question: 'Which database?', choices: ['SQLite', 'Postgres', 'MySQL'] },
      { question: 'Which language?', choices: ['Rust', 'Go'] },
    ]
    const { typeInto, user } = await open('Blocked', { tool: 'AskUserQuestion', detail: 'Which database? 1 SQLite · 2 Postgres · 3 MySQL / Which language? 1 Rust · 2 Go', answerable: false, choices: [], questions })

    // One question shows at a time, with a tab for each; the line that ran them together is gone, and so is "Answer in the terminal".
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByRole('group', { name: 'Which database?' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Which language?' })).not.toBeInTheDocument()
    expect(screen.queryByText(/1 SQLite · 2 Postgres/)).not.toBeInTheDocument()
    expect(screen.queryByText("Only the agent's terminal can take this answer.")).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message Claude' })).toHaveAttribute('placeholder', PENDING_APPROVAL_NOTE)

    // Nothing is typed until every question has an answer, so one can be changed first.
    await user.click(screen.getByRole('radio', { name: 'SQLite' }))
    await user.click(screen.getByRole('radio', { name: 'Postgres' }))
    await user.click(screen.getByRole('button', { name: /^Next/ }))
    // The last question's button says how many are still to answer.
    const send = screen.getByRole('button', { name: /^Send answers \(1 left\)/ })
    expect(send).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('radio', { name: 'Postgres' })).toBeChecked()
    await user.click(screen.getByRole('tab', { name: /Which language\?/ }))
    await user.click(screen.getByRole('radio', { name: 'Go' }))
    expect(typeInto).not.toHaveBeenCalled()

    await user.click(send)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })

    expect(typeInto.mock.calls.map(([key]) => key)).toEqual(['2', '2', '1'])
  })

  it('answers a question that takes several answers with boxes to tick: each number, then → to move on, then submit', async () => {
    const form = [
      { question: 'Which size?', choices: ['Small', 'Large'], multi: false },
      { question: 'Which toppings?', choices: ['Nuts', 'Cream', 'Fruit'], multi: true },
    ]
    const { typeInto, user } = await open('Blocked', { tool: 'AskUserQuestion', detail: 'Which size? … / Which toppings? …', answerable: false, choices: [], questions: [], form })

    await user.click(screen.getByRole('radio', { name: 'Large' }))
    await user.click(screen.getByRole('button', { name: /^Next/ }))
    expect(screen.getByRole('group', { name: 'Which toppings? Pick any' })).toBeInTheDocument()
    const send = screen.getByRole('button', { name: /^Send answers/ })
    await user.click(screen.getByRole('checkbox', { name: 'Fruit' }))
    await user.click(screen.getByRole('checkbox', { name: 'Nuts' }))
    await user.click(screen.getByRole('checkbox', { name: 'Cream' }))
    await user.click(screen.getByRole('checkbox', { name: 'Cream' }))
    expect(screen.getByRole('checkbox', { name: 'Cream' })).not.toBeChecked()
    expect(typeInto).not.toHaveBeenCalled()

    await user.click(send)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })

    expect(typeInto.mock.calls.map(([key]) => key)).toEqual(['2', '1', '3', '\x1b[C', '1'])
  })

  it('takes an answer of your own on any question, typed where Claude\'s menu says "Type something"', async () => {
    const form = [
      { question: 'Which size?', choices: ['Small', 'Large'], multi: false },
      { question: 'Which toppings?', choices: ['Nuts', 'Cream', 'Fruit'], multi: true },
    ]
    const { typeInto, user } = await open('Blocked', { tool: 'AskUserQuestion', detail: 'Which size? … / Which toppings? …', answerable: false, choices: [], questions: [], form })

    await user.type(screen.getByRole('textbox', { name: 'Your own answer' }), 'Medium, please')
    await user.click(screen.getByRole('button', { name: /^Next/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Cream' }))
    await user.type(screen.getByRole('textbox', { name: 'Your own answer' }), 'sprinkles')
    await user.click(screen.getByRole('button', { name: /^Send answers/ }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })

    expect(typeInto.mock.calls.map(([key]) => key)).toEqual([
      '3', 'Medium, please', '\r',
      '2', '\x1b[B', '\x1b[B', '\x1b[B', 'sprinkles', '\t', '\r',
      '1',
    ])
  })

  it('sends a lone question an answer of your own', async () => {
    const { typeInto, user } = await open('Blocked', { tool: 'AskUserQuestion', detail: 'Which database?', answerable: false, choices: ['SQLite', 'Postgres'] })

    await user.type(screen.getByRole('textbox', { name: 'Your own answer' }), 'DuckDB{Enter}')
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })

    expect(typeInto.mock.calls.map(([key]) => key)).toEqual(['3', 'DuckDB', '\r'])
  })

  it('answers a lone question that takes several answers as a form, which needs at least one pick', async () => {
    const form = [{ question: 'Which toppings?', choices: ['Nuts', 'Cream'], multi: true }]
    const { typeInto, user } = await open('Blocked', { tool: 'AskUserQuestion', detail: 'Which toppings? 1 Nuts · 2 Cream', answerable: false, choices: [], questions: [], form })

    const send = screen.getByRole('button', { name: 'Send answer' })
    expect(send).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Cream' }))
    await user.click(send)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })

    expect(typeInto.mock.calls.map(([key]) => key)).toEqual(['2', '\x1b[C', '1'])
  })

  it("picks a choice of a question with its number key, as the agent's own menu does", async () => {
    const { typeInto } = await open('Blocked', { tool: 'AskUserQuestion', detail: 'Which database?', answerable: false, choices: ['SQLite', 'Postgres'] })

    fireEvent.keyDown(screen.getByRole('region', { name: 'Claude needs your permission' }), { key: '2' })
    fireEvent.keyDown(screen.getByRole('region', { name: 'Claude needs your permission' }), { key: '7' })

    expect(typeInto).toHaveBeenCalledExactlyOnceWith('2')
  })

  const planHistory = () => {
    const daemon = new FakeDaemonHistory()
    daemon.upsert(daemon.message('t1', 'u', 'User', 'plan the refunds'))
    daemon.upsert({ source: { conversation: FAKE_CONVERSATION, turn: 't1', item: 'p' }, content: { Tool: { kind: 'commandExecution', label: 'ExitPlanMode ', output: '', input: { plan: '## Refunds\n1. Add the endpoint' } } }, state: 'Completed' })
    daemon.status = 'Blocked'
    fake.current = daemon
  }
  const PLAN_ASKING = 'Would you like to proceed?\n1. Add the endpoint\n1. Yes, and use auto mode\n2. Yes, manually approve edits\n3. Tell Claude what to change'

  it("shows the plan formatted with Claude's own menu for it, each choice picked by its number, and n keeps planning", async () => {
    planHistory()
    const typeInto = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    render(<ChatSession link={LINK} agent="claude" online typeInto={typeInto} ask={{ tool: 'ExitPlanMode', detail: '', answerable: true }} asking={PLAN_ASKING} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    const card = screen.getByRole('region', { name: 'Claude needs your permission' })
    expect(within(card).getByText('Approve this plan?')).toBeInTheDocument()
    expect(within(card).getByRole('heading', { name: 'Refunds' })).toBeInTheDocument()
    const menu = within(card).getByRole('group', { name: "Claude's plan menu" })
    expect(within(menu).getAllByRole('button').map((button) => button.textContent)).toEqual(['1Yes, and use auto mode', '2Yes, manually approve edits', '3Tell Claude what to change'])
    expect(within(card).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()

    fireEvent.keyDown(card, { key: '2' })
    expect(typeInto).toHaveBeenLastCalledWith('2')
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(within(card).getByRole('button', { name: 'Keep planning' })).toHaveAttribute('aria-keyshortcuts', 'n')
    fireEvent.keyDown(card, { key: 'n' })
    expect(typeInto).toHaveBeenLastCalledWith(ANSWER_KEYS.deny)
  })

  it('sends no guessed key for a plan whose menu could not be read, and leaves it to the terminal', async () => {
    planHistory()
    const typeInto = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    render(<ChatSession link={LINK} agent="claude" online typeInto={typeInto} ask={{ tool: 'ExitPlanMode', detail: '', answerable: true }} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    const card = screen.getByRole('region', { name: 'Claude needs your permission' })
    expect(within(card).queryByRole('group', { name: "Claude's plan menu" })).not.toBeInTheDocument()
    expect(within(card).getByRole('group', { name: "Keys for the agent's terminal" })).toBeInTheDocument()
    fireEvent.keyDown(card, { key: 'y' })
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(typeInto).not.toHaveBeenCalled()
  })

  it('still says the agent is waiting when its hook reported no question', async () => {
    await open('Blocked', null)

    expect(screen.getByText('Claude is waiting in its own menu')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Yes once/ })).not.toBeInTheDocument()
    // The card above carries the terminal's keys, so the box points at it and never sends the person to the terminal.
    expect(screen.getByRole('group', { name: "Keys for the agent's terminal" })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message Claude' })).toHaveAttribute('placeholder', PENDING_APPROVAL_NOTE)
  })

  it('shows no card while the agent is not stopped on a prompt', async () => {
    await open('Idle', WRITE_ASK)

    expect(screen.queryByText('Wants to use Write')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Yes once/ })).not.toBeInTheDocument()
  })
})

describe("Claude's own \"don't ask again\" choice", () => {
  const MENU = "Bash command\ncargo test\nDo you want to proceed?\n❯ 1. Yes\n2. Yes, and don't ask again\n3. No, and tell Claude what to do"
  const BASH_ASK: PermissionAsk = { tool: 'Bash', detail: 'cargo test', answerable: true }

  async function openWith(ask: PermissionAsk, asking: string, agent: 'claude' | 'codex' = 'claude') {
    const daemon = new FakeDaemonHistory()
    daemon.upsert(daemon.message('t1', 'u', 'User', 'earlier'))
    daemon.status = 'Blocked'
    fake.current = daemon
    const typeInto = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    render(<ChatSession link={LINK} agent={agent} online typeInto={typeInto} ask={ask} asking={asking} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    return { typeInto, user }
  }

  it("offers the choice in Claude's words and sends its number, only on a click", async () => {
    const { typeInto, user } = await openWith(BASH_ASK, MENU)

    expect(typeInto).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: "Yes, and don't ask again" }))
    expect(typeInto).toHaveBeenCalledExactlyOnceWith('2')
  })

  it('is not picked by its number, and Enter still means only the first choice, Yes once', async () => {
    const { typeInto } = await openWith(BASH_ASK, MENU)
    const card = screen.getByRole('region', { name: 'Claude needs your permission' })

    fireEvent.keyDown(card, { key: '2' })
    expect(typeInto).not.toHaveBeenCalled()
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(typeInto).toHaveBeenCalledExactlyOnceWith(ANSWER_KEYS.approve)
  })

  it('offers it for no menu it cannot read, for another agent or for a question', async () => {
    await openWith(BASH_ASK, '')
    expect(screen.queryByRole('button', { name: /don't ask again/ })).not.toBeInTheDocument()
    cleanup()

    await openWith(BASH_ASK, MENU, 'codex')
    expect(screen.queryByRole('button', { name: /don't ask again/ })).not.toBeInTheDocument()
    cleanup()

    await openWith(BASH_ASK, MENU.replace('Yes, and don\'t ask again', 'Yes, allow all edits during this session'))
    expect(screen.queryByRole('button', { name: /during this session/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Yes once/ })).toBeInTheDocument()
  })
})
