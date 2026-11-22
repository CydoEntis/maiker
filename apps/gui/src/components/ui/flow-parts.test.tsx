import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChoiceCards } from './choice-cards'
import { Progress } from './progress'

describe('Progress', () => {

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
