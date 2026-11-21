import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPane } from './ChatPane'

vi.mock('./ChatSession', () => ({
  ChatSession: () => <p>chat session</p>,
}))

afterEach(cleanup)

const shell = { kind: 'shell' } as const

describe('the card of a session that has no chat', () => {
  it('says why and names what runs, with no control that starts anything or shows a terminal', () => {
    render(<ChatPane availability={shell} process="shell" online />)

    expect(screen.getByRole('heading', { name: 'Chat view is for agent sessions' })).toBeInTheDocument()
    expect(screen.getByText('Running here: shell')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

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

  it('keeps the old card for a pane that gave the chat no session to hold a message for', () => {
    render(<ChatPane availability={starting} process="claude" online />)
    expect(screen.getByText('Chat view is for agent sessions')).toBeInTheDocument()
  })
})
