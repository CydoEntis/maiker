import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TicketDetail, TicketSummary } from '@/api/tickets'
import { StartTicketDialog } from './TicketDialogs'

afterEach(cleanup)

const SUMMARY: TicketSummary = { id: 'github:me/shop#142', title: 'Fix the cart', stateName: 'open', category: 'Open', labels: [], assignee: null, url: 'https://github.com/me/shop/issues/142', groups: [], updatedAt: '' }
const DETAIL: TicketDetail = { ...SUMMARY, body: '**bold** <b>tags</b> [links](https://x.example)', comments: [], commentsMore: false, links: [], blockedBy: [] }

function start(change: Partial<Parameters<typeof StartTicketDialog>[0]> = {}) {
  const onGo = vi.fn()
  render(<StartTicketDialog container={document.body} provider="github" ticket={DETAIL} blockers={[]} blockerState="open" defaultAgent="claude" folder="/home/me/shop" project="shop" onCancel={vi.fn()} onGo={onGo} {...change} />)
  return onGo
}

describe('starting an agent on a ticket', () => {
  it("shows exactly what will be sent, the ticket's words as typed", () => {
    start()
    expect(screen.getByText('Exactly what will be sent')).toBeInTheDocument()
    expect(screen.getByText(DETAIL.body)).toBeInTheDocument()
    expect(document.querySelector('b')).toBeNull()
  })

  it('warns about a blocker in red and still starts', async () => {
    const onGo = start({ blockers: ['#140'] })
    expect(screen.getByRole('alert')).toHaveTextContent('Blocked by #140')
    await userEvent.click(screen.getByRole('button', { name: /Start Claude/ }))
    expect(onGo).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', worktree: true, branch: 'agent/gh-142-fix-the-cart' }))
  })

  it("on another machine's project, makes the worktree on that machine, or edits its folder", async () => {
    const onGo = start({ machineName: 'kingdom' })
    expect(screen.getByText(/made on kingdom/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'This folder' }))
    expect(screen.getByText(/Edits kingdom's checkout directly/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Start Claude/ }))
    expect(onGo).toHaveBeenCalledWith(expect.objectContaining({ worktree: false }))
  })
})
