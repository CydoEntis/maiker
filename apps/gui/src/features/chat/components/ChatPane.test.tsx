import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPane } from './ChatPane'

vi.mock('./ChatSession', () => ({
  ChatSession: () => <p>chat session</p>,
}))

afterEach(cleanup)

describe('the chat of a ready session', () => {
  const ready = { kind: 'ready', agent: 'claude', link: { conversation: 44, generation: 1 } } as const

  it('shows the chat of a session that has one', () => {
    render(<ChatPane availability={ready} process="claude" online />)
    expect(screen.getByText('chat session')).toBeInTheDocument()
  })
})

describe('the chat of a session whose agent has not reported in yet', () => {
  const starting = { kind: 'no-events', agent: 'claude' } as const

  it('is the chat with its message box at once, not a card that says there is nothing', () => {
    render(<ChatPane availability={starting} process="claude" online sessionId="s1" />)
    expect(screen.getByText('What are we building today?')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message Claude' })).toBeEnabled()
    expect(screen.queryByText('Chat view is for agent sessions')).not.toBeInTheDocument()
  })
})
