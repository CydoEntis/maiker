import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ChatProblem } from '../problem'
import { useChatProblem } from './ChatProblem'

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
