import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HelpersRequestDialog, SecretDialog } from './OutsideAskDialogs'

const daemon = vi.hoisted(() => ({ answerSecret: vi.fn<(id: number, machine: number, value: string | null) => Promise<void>>() }))
vi.mock('@/api/daemon', () => daemon)

const asker = { name: 'Fix the cart total', project: 'chameleon' }
const ask = { id: 7, label: 'NPM_TOKEN', reason: 'To publish the package.' }

beforeEach(() => { daemon.answerSecret.mockReset() })

describe('HelpersRequestDialog', () => {
  it('says who asks and lists the tasks', () => {
    render(<HelpersRequestDialog asker={asker} tasks={['Search the docs', 'Run the tests']} online onAnswer={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Fix the cart total')
    expect(within(within(dialog).getByRole('list', { name: 'Tasks' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Search the docs', 'Run the tests'])
  })

  it.each([['Allow', 'allow'], ['No, do it yourself', 'no'], ['Always for this project', 'always']] as const)('answers %s with the daemon\'s %s', async (button, choice) => {
    const onAnswer = vi.fn()
    render(<HelpersRequestDialog asker={asker} tasks={['Search the docs']} online onAnswer={onAnswer} onCancel={vi.fn()} />)
    await userEvent.setup().click(screen.getByRole('button', { name: button }))
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer).toHaveBeenCalledWith(choice)
  })

  it('answers nothing when it is closed with Escape', async () => {
    const onAnswer = vi.fn()
    const onCancel = vi.fn()
    render(<HelpersRequestDialog asker={asker} tasks={['Search the docs']} online onAnswer={onAnswer} onCancel={onCancel} />)
    await userEvent.setup().keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('cannot be answered while the service is out of reach', () => {
    render(<HelpersRequestDialog asker={asker} tasks={['Search the docs']} online={false} onAnswer={vi.fn()} onCancel={vi.fn()} />)
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })
})

describe('SecretDialog', () => {
  const field = () => screen.getByLabelText<HTMLInputElement>('Value for NPM_TOKEN')

  it('says which session asks and for what, and takes the value in a password field', () => {
    render(<SecretDialog asker={asker} ask={ask} machine={0} online onDone={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Fix the cart total')
    expect(dialog).toHaveTextContent('NPM_TOKEN')
    expect(dialog).toHaveTextContent('To publish the package.')
    expect(field()).toHaveAttribute('type', 'password')
    expect(field()).toHaveAttribute('autocomplete', 'off')
  })

  it('sends the value to the daemon once, for this request, and keeps none of it', async () => {
    const user = userEvent.setup()
    daemon.answerSecret.mockResolvedValue(undefined)
    const onDone = vi.fn()
    const { container } = render(<SecretDialog asker={asker} ask={ask} machine={0} online onDone={onDone} />)
    await user.type(field(), 'hunter2')
    await user.click(screen.getByRole('button', { name: 'Give it' }))

    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1) })
    expect(daemon.answerSecret).toHaveBeenCalledTimes(1)
    expect(daemon.answerSecret).toHaveBeenCalledWith(7, 0, 'hunter2')
    await waitFor(() => { expect(field().value).toBe('') })
    expect(document.body.textContent).not.toContain('hunter2')
    expect(container.ownerDocument.body.innerHTML).not.toContain('hunter2')
  })

  it('sends nothing for an empty field', async () => {
    render(<SecretDialog asker={asker} ask={ask} machine={0} online onDone={vi.fn()} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Give it' }))
    expect(daemon.answerSecret).not.toHaveBeenCalled()
  })

  it('tells the agent no on Decline, with no value', async () => {
    daemon.answerSecret.mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(<SecretDialog asker={asker} ask={ask} machine={0} online onDone={onDone} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Decline' }))
    await waitFor(() => { expect(onDone).toHaveBeenCalled() })
    expect(daemon.answerSecret).toHaveBeenCalledWith(7, 0, null)
  })

  it('empties the field and says why when the daemon does not take the value', async () => {
    const user = userEvent.setup()
    daemon.answerSecret.mockRejectedValue(new Error('the request is no longer waiting'))
    const onDone = vi.fn()
    render(<SecretDialog asker={asker} ask={ask} machine={0} online onDone={onDone} />)
    await user.type(field(), 'hunter2')
    await user.click(screen.getByRole('button', { name: 'Give it' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('no longer waiting')
    expect(field().value).toBe('')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('closes without answering on Cancel', async () => {
    const onDone = vi.fn()
    render(<SecretDialog asker={asker} ask={ask} machine={0} online onDone={onDone} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDone).toHaveBeenCalled()
    expect(daemon.answerSecret).not.toHaveBeenCalled()
  })

  it('takes no secret for a session on another machine', () => {
    render(<SecretDialog asker={asker} ask={ask} machine={2} online onDone={vi.fn()} />)
    expect(field()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Give it' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled()
  })
})
