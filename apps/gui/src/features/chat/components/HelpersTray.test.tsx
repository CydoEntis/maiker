import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HelpersTray } from './QuestionTray'

describe('the helpers request over the message box', () => {
  it('lists each task and sends the answer picked', async () => {
    const user = userEvent.setup()
    const answer = vi.fn()
    render(<HelpersTray ask={{ tasks: ['Search the docs', 'Run the tests'], answer }} online agent="claude" />)

    const card = screen.getByRole('region', { name: 'Wants to start helpers' })
    expect(card).toHaveTextContent('Wants to start 2 helpers')
    expect(card).toHaveTextContent('Search the docs')
    expect(card).toHaveTextContent('Run the tests')
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['Allow', 'No', 'Always in this project'])

    await user.click(within(card).getByRole('button', { name: 'Always in this project' }))
    await user.click(within(card).getByRole('button', { name: 'No' }))
    expect(answer.mock.calls).toEqual([['always'], ['no']])
  })

  it('takes no answer while the service is unreachable', () => {
    render(<HelpersTray ask={{ tasks: ['Run the tests'], answer: vi.fn() }} online={false} />)
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
    expect(screen.getByRole('region', { name: 'Wants to start helpers' })).toHaveTextContent('Wants to start 1 helper')
  })
})
