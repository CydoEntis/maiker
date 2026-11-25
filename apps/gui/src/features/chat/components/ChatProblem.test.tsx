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

  it('shows the real reason a saved chat could not be read, with Reconnect to try again', async () => {
    const reason = 'The saved conversation could not be read: The transcript is not found'
    const onReconnect = vi.fn(() => Promise.resolve())
    render(<ReadProblemLine error={reason} onReconnect={onReconnect} />)
    expect(screen.getByText('Could not read this chat')).toBeInTheDocument()
    expect(screen.getByText(reason)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(onReconnect).toHaveBeenCalledOnce()
  })

  it('shows any other failure as the service said it, with nothing to reconnect', () => {
    render(<ReadProblemLine error="The history page is too large" onReconnect={vi.fn(() => Promise.resolve())} />)
    expect(screen.getByText('Could not read this chat')).toBeInTheDocument()
    expect(screen.getByText('The history page is too large')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument()
  })

  it('says a saved chat that is too long cannot open as a chat, that nothing was lost, and offers no Reconnect', () => {
    const error = 'This saved conversation is too long to open as a chat (over 16 MB); resume it in a terminal'
    render(<ReadProblemLine error={error} onReconnect={vi.fn(() => Promise.resolve())} />)
    expect(screen.getByText('This chat is too long to open')).toBeInTheDocument()
    expect(screen.getByText(/over 16 MB\)\. Nothing was lost/)).toBeInTheDocument()
    expect(screen.getByText(/terminal to carry on, or start a new chat/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy details/i })).toBeInTheDocument()
  })
})

describe('the chat’s read line as the chat reconnects', () => {
  const RESUME = 'chat resume is disabled'
  const spinner = () => document.querySelector('.mx-problem-line [data-slot="status-icon"]')
  const line = () => document.querySelector('.mx-problem-line')

  it('keeps one line and one spinner from reconnecting to waking to a changed reason, so nothing rises or restarts again', () => {
    const reconnecting = { title: 'Reconnecting to this chat…', reason: 'What is shown may be out of date.' }
    const { rerender } = render(<ReadProblemLine error={null} notice={reconnecting} onReconnect={null} />)
    const first = line()
    const light = spinner()
    expect(light).not.toBeNull()
    rerender(<ReadProblemLine error={null} notice={{ title: 'Reconnecting to this chat…', reason: 'What is shown may be out of date. It timed out.' }} onReconnect={null} />)
    expect(spinner()).toBe(light)

    rerender(<ReadProblemLine error={RESUME} onReconnect={vi.fn(() => Promise.resolve())} />)
    expect(screen.getByText('This chat needs to reconnect')).toBeInTheDocument()
    rerender(<ReadProblemLine error={null} notice={{ title: 'Waking Claude up…', reason: 'It picks up in a moment.' }} onReconnect={null} />)
    expect(screen.getByText('Waking Claude up…')).toBeInTheDocument()
    const waking = spinner()
    rerender(<ReadProblemLine error={null} notice={{ title: 'Waking Claude up…', reason: 'Another reason.' }} onReconnect={null} />)

    expect(line()).toBe(first)
    expect(spinner()).toBe(waking)
  })

  it('forgets a failed Reconnect when the chat reports a different error', async () => {
    const { rerender } = render(<ReadProblemLine error={RESUME} onReconnect={() => Promise.reject(new Error('nope'))} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(await screen.findByText(/Reconnecting failed: nope/)).toBeInTheDocument()
    rerender(<ReadProblemLine error="history is incomplete" onReconnect={() => Promise.resolve()} />)
    expect(screen.queryByText(/Reconnecting failed/)).not.toBeInTheDocument()
  })
})
