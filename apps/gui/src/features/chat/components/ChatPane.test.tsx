import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPane } from './ChatPane'

vi.mock('./ChatSession', () => ({
  ChatSession: ({ hasTerminal }: { hasTerminal?: boolean }) => <p>chat session, terminal: {String(hasTerminal)}</p>,
}))

afterEach(cleanup)

const shell = { kind: 'shell' } as const
const noop = () => undefined

describe('the card of a session that has no chat', () => {
  it('says why, names what runs, and offers the terminal log without starting anything', async () => {
    const onShowLog = vi.fn()
    render(<ChatPane availability={shell} process="shell" online onShowLog={onShowLog} />)

    expect(screen.getByRole('heading', { name: 'Chat view is for agent sessions' })).toBeInTheDocument()
    expect(screen.getByText('Running here: shell')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show terminal log' }))
    expect(onShowLog).toHaveBeenCalledTimes(1)
  })
})

describe('the chat of a ready session', () => {
  const ready = { kind: 'ready', agent: 'claude', link: { conversation: 44, generation: 1 } } as const

  it('tells the chat when the session has no terminal', () => {
    render(<ChatPane availability={ready} process="claude" online hasTerminal={false} onShowLog={noop} />)
    expect(screen.getByText('chat session, terminal: false')).toBeInTheDocument()
  })

  it('assumes a terminal unless told otherwise', () => {
    render(<ChatPane availability={ready} process="claude" online onShowLog={noop} />)
    expect(screen.getByText('chat session, terminal: true')).toBeInTheDocument()
  })
})

describe('the chat of a session whose agent has not reported in yet', () => {
  const starting = { kind: 'no-events', agent: 'claude' } as const

  it('is the chat with its message box at once, not a card that says there is nothing', () => {
    render(<ChatPane availability={starting} process="claude" online sessionId="s1" onShowLog={noop} />)
    expect(screen.getByText('What are we building today?')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message Claude' })).toBeEnabled()
    expect(screen.queryByText('Chat view is for agent sessions')).not.toBeInTheDocument()
  })

  it('keeps the old card for a pane that gave the chat no session to hold a message for', () => {
    render(<ChatPane availability={starting} process="claude" online onShowLog={noop} />)
    expect(screen.getByText('Chat view is for agent sessions')).toBeInTheDocument()
  })
})
