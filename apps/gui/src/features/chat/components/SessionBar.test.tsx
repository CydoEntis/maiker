import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FAKE_CONVERSATION, FakeDaemonHistory } from '../fakeDaemonHistory'
import { forgetChatFeeds } from '../useChatFeed'
import { forgetComposers } from '../composerStore'
import { ChatSession } from './ChatSession'
import { SessionBar, type SessionPlace } from './SessionBar'

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  readConversationPage: () => Promise.resolve(new FakeDaemonHistory().read({ before: null } as never)),
}))

afterEach(() => { cleanup(); forgetChatFeeds(); forgetComposers() })

const PLACE: SessionPlace = { machine: null, project: 'maiker', branch: 'ui-changes', worktree: false, folder: '/dev/maiker' }

describe('SessionBar', () => {
  it('names the project and branch as chips, with the full folder on hover and no machine name on this computer', () => {
    render(<SessionBar place={PLACE} />)
    const place = screen.getByRole('group', { name: 'Session location' })
    expect(within(place).getByRole('button', { name: '/dev/maiker: maiker' })).toHaveAttribute('title', '/dev/maiker')
    expect(within(place).getByRole('button', { name: 'Branch ui-changes: ui-changes' })).toBeInTheDocument()
    expect(place).not.toHaveTextContent('build-box')
  })

  it('names another machine and the worktree after the project', () => {
    render(<SessionBar place={{ ...PLACE, machine: 'build-box', worktree: true, worktreeName: 'amber-fox' }} />)
    expect(screen.getByRole('group', { name: 'Session location' })).toHaveTextContent('build-boxmaiker / amber-foxui-changes')
  })

  it('leaves out the branch outside git and draws the controls it is given', () => {
    render(<SessionBar place={{ ...PLACE, branch: null }}><button type="button">Model</button></SessionBar>)
    expect(screen.getByRole('group', { name: 'Session location' })).toHaveTextContent('maiker')
    expect(screen.queryByRole('button', { name: /^Branch/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Model' })).toBeInTheDocument()
  })
})

describe('the chat under its box', () => {
  const LINK = { conversation: FAKE_CONVERSATION, generation: 1 }

  it('keeps the place and usage in the row under the box; the model, permissions, attach and send are in the box', async () => {
    render(<ChatSession link={LINK} agent="claude" online place={PLACE} usage={{ context: 70, limits: [] }} />)
    const bar = await screen.findByRole('group', { name: 'Session location' })
    const row = bar.parentElement as HTMLElement
    expect(within(row).getByRole('group', { name: 'Usage' })).toBeInTheDocument()
    const send = screen.getByRole('button', { name: 'Send message' })
    const inBox = send.closest('.mx-box') as HTMLElement
    expect(within(inBox).getByRole('img', { name: /Permission mode/ })).toBeInTheDocument()
    expect(within(inBox).getByRole('button', { name: /^Attach files/ })).toBeInTheDocument()
    expect(row.contains(send)).toBe(false)
    expect(within(row).queryByRole('img', { name: /Permission mode/ })).toBeNull()
  })

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

  it('says why Resume is unavailable and does nothing when it is clicked', async () => {
    const user = userEvent.setup()
    render(<ChatSession link={LINK} agent="claude" online ended={{ resumeWhy: 'No conversation was saved to resume', onNewSession: vi.fn() }} />)
    const resume = await screen.findByRole('button', { name: 'Resume' })
    expect(resume).toHaveAttribute('aria-disabled', 'true')
    expect(resume).toHaveAttribute('title', 'No conversation was saved to resume')
    await user.click(resume)
  })
})
