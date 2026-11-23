import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ChatProblem } from '../problem'
import { useChatProblem } from './ChatProblem'
import { ReadProblemLine } from './ReadProblemLine'

function Harness({ problem }: { problem: ChatProblem }) {
  const { alert, line } = useChatProblem(problem, () => '')
  return <>{alert}{line}</>
}

describe('a chat’s problem', () => {
  it('never asks about a stopped agent over the chat, and keeps Restart within reach', async () => {
    const onRestart = vi.fn()
    render(<Harness problem={{ kind: 'stopped', agent: 'Claude', code: 1, onRestart }} />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy details/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Restart' }))
    expect(onRestart).toHaveBeenCalledOnce()
  })

  it('asks about a machine that stopped answering over the chat', () => {
    render(<Harness problem={{ kind: 'machine', machine: 'devbox', since: null, onRetry: vi.fn() }} />)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})

describe('a chat whose read failed', () => {
  const REFUSED = 'Claude history could not be reconciled with the provider transcript; chat resume is disabled'

  it('says plainly that a chat the service stopped continuing needs to reconnect, and Reconnect starts it again', async () => {
    const onReconnect = vi.fn(() => Promise.resolve())
    render(<ReadProblemLine error={REFUSED} onReconnect={onReconnect} />)
    expect(screen.getByText('This chat needs to reconnect')).toBeInTheDocument()
    expect(screen.queryByText(/reconciled/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(onReconnect).toHaveBeenCalledOnce()
  })

  it('gives the reason when reconnecting fails, and leaves Reconnect to try again', async () => {
    render(<ReadProblemLine error={REFUSED} onReconnect={() => Promise.reject(new Error('The saved conversation could not be read: not found'))} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(await screen.findByText(/Reconnecting failed: The saved conversation could not be read/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
  })

  it('shows any other failure as the service said it, with nothing to reconnect', () => {
    render(<ReadProblemLine error="The history page is too large" onReconnect={vi.fn(() => Promise.resolve())} />)
    expect(screen.getByText('Could not read this chat')).toBeInTheDocument()
    expect(screen.getByText('The history page is too large')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument()
  })
})
