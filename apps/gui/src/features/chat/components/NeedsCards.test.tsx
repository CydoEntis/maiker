import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_MACHINE } from '@/api/machines'
import { approvalEvent } from '../eventFixtures'
import { ApprovalTray, HelpersTray } from './QuestionTray'
import { SecretTray } from './SecretTray'

const daemon = vi.hoisted(() => ({ answerSecret: vi.fn<(askId: number, machine: number, value: string | null) => Promise<void>>() }))
vi.mock('@/api/daemon', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/daemon')>()), answerSecret: daemon.answerSecret }))

beforeEach(() => {
  daemon.answerSecret.mockReset()
  daemon.answerSecret.mockResolvedValue(undefined)
})
afterEach(cleanup)

const actions = (busy = false) => ({ answer: vi.fn(), answerInput: vi.fn(), remember: vi.fn(), busy })
const card = () => screen.getByRole('region', { name: /^Approval/ })

describe('a request to run a command, as a needs-you card', () => {
  it.each([['y', 'Accept'], ['a', 'AcceptForSession'], ['n', 'Decline']])('answers %s with %s while the card has the keys', async (key, decision) => {
    const handlers = actions()
    render(<ApprovalTray event={approvalEvent('req-1')} actions={handlers} agent="claude" />)

    within(card()).getByRole('button', { name: 'Yes once' }).focus()
    await userEvent.keyboard(key)

    expect(handlers.answer).toHaveBeenCalledExactlyOnceWith('req-1', decision)
  })

  it('moves with the arrows and picks with Enter', async () => {
    const handlers = actions()
    render(<ApprovalTray event={approvalEvent('req-1')} actions={handlers} />)

    within(card()).getByRole('button', { name: 'Yes once' }).focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(within(card()).getByRole('button', { name: 'No' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(handlers.answer).toHaveBeenCalledExactlyOnceWith('req-1', 'Decline')
  })

  it('is one stop for Tab, on its first answer', async () => {
    render(<><button type="button">before</button><ApprovalTray event={approvalEvent('req-1')} actions={actions()} /><button type="button">after</button></>)

    screen.getByRole('button', { name: 'before' }).focus()
    await userEvent.tab()
    expect(within(card()).getByRole('button', { name: 'Yes once' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus()
  })

  it("shows only the answers the provider offers, and remembers a command for the project on a click", async () => {
    const handlers = actions()
    render(<ApprovalTray event={approvalEvent('req-2', { choices: ['Accept', 'Decline'], canRemember: true })} actions={handlers} />)

    expect(within(card()).queryByRole('button', { name: 'This session' })).not.toBeInTheDocument()
    within(card()).getByRole('button', { name: 'Yes once' }).focus()
    await userEvent.keyboard('a')
    expect(handlers.answer).not.toHaveBeenCalled()

    await userEvent.click(within(card()).getByRole('button', { name: 'Always in this project' }))
    expect(handlers.remember).toHaveBeenCalledExactlyOnceWith('req-2')
    expect(handlers.answer).not.toHaveBeenCalled()
  })

  it('takes no key with a modifier, and no answer while one is on its way', async () => {
    const handlers = actions()
    const { rerender } = render(<ApprovalTray event={approvalEvent('req-1')} actions={handlers} />)
    within(card()).getByRole('button', { name: 'Yes once' }).focus()
    await userEvent.keyboard('{Control>}y{/Control}')
    expect(handlers.answer).not.toHaveBeenCalled()

    rerender(<ApprovalTray event={approvalEvent('req-1')} actions={{ ...handlers, busy: true }} />)
    for (const button of within(card()).getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('offers no answer where only the terminal can take it', () => {
    render(<ApprovalTray event={approvalEvent('req-1')} actions={null} />)
    expect(within(card()).queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('a request to start helpers, as a needs-you card', () => {
  const helpers = () => screen.getByRole('region', { name: 'Wants to start helpers' })

  it('lists each task and answers with y, n and the standing grant', async () => {
    const answer = vi.fn()
    render(<HelpersTray ask={{ tasks: ['Search the docs', 'Run the tests'], answer }} online agent="claude" />)

    expect(within(helpers()).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['1Search the docs', '2Run the tests'])
    within(helpers()).getByRole('button', { name: 'Allow' }).focus()
    await userEvent.keyboard('n')
    await userEvent.keyboard('y')
    // "Always" is a grant for the whole project, so no letter gives it.
    await userEvent.keyboard('a')
    await userEvent.click(within(helpers()).getByRole('button', { name: 'Always for this project' }))

    expect(answer.mock.calls).toEqual([['no'], ['allow'], ['always']])
  })

  it('takes no answer while the service is unreachable', () => {
    render(<HelpersTray ask={{ tasks: ['Run the tests'], answer: vi.fn() }} online={false} />)
    for (const button of within(helpers()).getAllByRole('button')) expect(button).toBeDisabled()
  })
})

describe('a request for a secret, as a needs-you card', () => {
  const ask = { id: 7, label: 'NPM_TOKEN', reason: 'To publish the package' }
  const secret = () => screen.getByRole('region', { name: 'Wants a secret' })

  it('takes the value in a password field and sends it to the service, leaving it nowhere on the page', async () => {
    render(<SecretTray ask={ask} machine={LOCAL_MACHINE} online />)

    await userEvent.click(within(secret()).getByRole('button', { name: 'Provide…' }))
    const field = within(secret()).getByLabelText('Value for NPM_TOKEN')
    expect(field).toHaveAttribute('type', 'password')
    await userEvent.type(field, 'hunter2')
    await userEvent.click(within(secret()).getByRole('button', { name: 'Give it' }))

    await waitFor(() => { expect(daemon.answerSecret).toHaveBeenCalledExactlyOnceWith(7, LOCAL_MACHINE, 'hunter2') })
    await waitFor(() => { expect(within(secret()).queryByLabelText('Value for NPM_TOKEN')).not.toBeInTheDocument() })
    expect(document.body.innerHTML).not.toContain('hunter2')
  })

  it('tells the agent no on n', async () => {
    render(<SecretTray ask={ask} machine={LOCAL_MACHINE} online />)

    within(secret()).getByRole('button', { name: 'Provide…' }).focus()
    await userEvent.keyboard('n')

    await waitFor(() => { expect(daemon.answerSecret).toHaveBeenCalledExactlyOnceWith(7, LOCAL_MACHINE, null) })
  })

  it("takes no secret for another machine's session", () => {
    render(<SecretTray ask={ask} machine={3} online />)
    for (const button of within(secret()).getAllByRole('button')) expect(button).toBeDisabled()
  })
})
