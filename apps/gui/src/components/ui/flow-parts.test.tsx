import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChoiceCards } from './choice-cards'
import { Progress } from './progress'
import { StepBar } from './step-bar'

describe('StepBar', () => {
  const NAMES = ['Welcome', 'Agents', 'Your view']

  it('lets a person go back to a finished step, and not forward to one they have not reached', async () => {
    const user = userEvent.setup()
    const select = vi.fn()
    render(<StepBar steps={NAMES} current={1} onSelect={select} />)
    expect(screen.getByText('Agents').closest('[aria-current="step"]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /Your view/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: /Welcome/ }))
    expect(select).toHaveBeenCalledWith(0)
  })

  it('shows the skip action only when given one, and runs it', async () => {
    const user = userEvent.setup()
    const skip = vi.fn()
    const { rerender } = render(<StepBar steps={NAMES} current={0} onSelect={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Skip setup' })).toBeNull()
    rerender(<StepBar steps={NAMES} current={0} onSelect={vi.fn()} skip={{ label: 'Skip setup', onSkip: skip }} />)
    await user.click(screen.getByRole('button', { name: 'Skip setup' }))
    expect(skip).toHaveBeenCalledOnce()
  })
})

describe('Progress', () => {
  it('reads a percent when it knows how far along it is', () => {
    render(<Progress value={40} label="Copying the helper" />)
    const bar = screen.getByRole('progressbar', { name: 'Copying the helper' })
    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it('carries no value while the length of the work is unknown', () => {
    render(<Progress label="Installing" />)
    const bar = screen.getByRole('progressbar', { name: 'Installing' })
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(bar).toHaveAttribute('data-indeterminate')
  })
})

function Question({ onPick }: { onPick: (value: string) => void }) {
  const [value, setValue] = useState<string | null>(null)
  return (
    <ChoiceCards
      label="Where do you spend your day?"
      value={value}
      onValueChange={(next) => { setValue(next); onPick(next) }}
      cards={[
        { value: 'chat', title: 'Chat', detail: 'Readable replies.', recommended: true },
        { value: 'terminal', title: 'Terminal', detail: 'The raw output.' },
      ]}
    />
  )
}

describe('ChoiceCards', () => {
  it('is a radio group with nothing picked until the person answers, and tags the recommended card', () => {
    render(<Question onPick={vi.fn()} />)
    const group = screen.getByRole('radiogroup', { name: 'Where do you spend your day?' })
    expect(within(group).getAllByRole('radio').map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false'])
    expect(screen.getByRole('radio', { name: /Chat/ })).toHaveTextContent('Recommended for you')
    expect(screen.getByRole('radio', { name: /Terminal/ })).not.toHaveTextContent('Recommended')
  })

  it('picks a card by click, and the arrow keys walk the cards', async () => {
    const user = userEvent.setup()
    const pick = vi.fn()
    render(<Question onPick={pick} />)
    await user.click(screen.getByRole('radio', { name: /Chat/ }))
    expect(pick).toHaveBeenLastCalledWith('chat')
    await user.keyboard('{ArrowDown}')
    // Radix moves focus a tick later; jsdom releases the key before then, so the pick is made with Space here.
    await waitFor(() => { expect(screen.getByRole('radio', { name: /Terminal/ })).toHaveFocus() })
    await user.keyboard(' ')
    expect(pick).toHaveBeenLastCalledWith('terminal')
    expect(screen.getByRole('radio', { name: /Terminal/ })).toHaveAttribute('aria-checked', 'true')
  })
})
