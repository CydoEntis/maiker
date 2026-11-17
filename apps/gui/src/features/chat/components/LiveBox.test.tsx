import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LiveBox } from './LiveBox'

describe('the live box', () => {
  it('says how long the agent has worked, how to stop it, and the step it is on for a screen reader', () => {
    render(<LiveBox phrase="reading src/x.ts" since={Date.now() - 12_000} />)

    expect(screen.getByRole('status')).toHaveTextContent('Working for 12s')
    expect(screen.getByText('Esc to stop')).toBeInTheDocument()
    expect(screen.getByText('Reading src/x.ts')).toHaveClass('sr-only')
  })

  it('says Thinking before any step has started, draws three skeleton bars and no box', () => {
    const { container } = render(<LiveBox phrase="thinking" since={null} />)

    expect(screen.getByText('Thinking')).toBeInTheDocument()
    expect(container.querySelectorAll('.mx-sk')).toHaveLength(3)
    expect(container.querySelector('.mx-live')?.getAttribute('data-fold')).toBeNull()
  })
})
