import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FAKE_CONVERSATION, FakeDaemonHistory } from '../fakeDaemonHistory'
import { forgetChatFeeds } from '../useChatFeed'
import { forgetComposers } from '../composerStore'
import { ChatSession } from './ChatSession'
import { type SessionPlace } from './SessionBar'

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  readConversationPage: () => Promise.resolve(new FakeDaemonHistory().read({ before: null } as never)),
}))

afterEach(() => { cleanup(); forgetChatFeeds(); forgetComposers() })

const PLACE: SessionPlace = { machine: null, project: 'maiker', branch: 'ui-changes', worktree: false, folder: '/dev/maiker' }

describe('the chat under its box', () => {
  const LINK = { conversation: FAKE_CONVERSATION, generation: 1 }

  it('swaps the box for a read-only line with Resume and New session here once the session has ended', async () => {
    const user = userEvent.setup()
    const onResume = vi.fn()
    const onNewSession = vi.fn()
    render(<ChatSession link={LINK} agent="claude" online place={PLACE} ended={{ onResume, onNewSession }} />)
    expect(await screen.findByText('This session has ended. The chat is read-only.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resume' }))
    await user.click(screen.getByRole('button', { name: 'New session here' }))
    expect(onResume).toHaveBeenCalledOnce()
    expect(onNewSession).toHaveBeenCalledOnce()
    // The location stays; the controls of a session that is gone do not.
    expect(screen.getByRole('group', { name: 'Session location' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Usage' })).toBeNull()
  })
})
