import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TicketDetail, TicketSummary } from '@/api/tickets'
import { KitchenDialog, NEW_KITCHEN, StartTicketDialog } from './TicketDialogs'

afterEach(cleanup)

const SUMMARY: TicketSummary = { id: 'github:me/shop#142', title: 'Fix the cart', stateName: 'open', category: 'Open', labels: [], assignee: null, url: 'https://github.com/me/shop/issues/142', groups: [], updatedAt: '' }
const DETAIL: TicketDetail = { ...SUMMARY, body: '**bold** <b>tags</b> [links](https://x.example)', comments: [], commentsMore: false, links: [], blockedBy: [] }

function start(change: Partial<Parameters<typeof StartTicketDialog>[0]> = {}) {
  const onGo = vi.fn()
  render(<StartTicketDialog container={document.body} provider="github" ticket={DETAIL} blockers={[]} blockerState="open" here={false} defaultAgent="claude" folder="/home/me/shop" project="shop" onCancel={vi.fn()} onGo={onGo} {...change} />)
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

  it('sends to this chat without the agent and folder choices', async () => {
    const onGo = start({ here: true })
    expect(screen.queryByRole('radiogroup', { name: 'Agent' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Send to chat/ }))
    expect(onGo).toHaveBeenCalledOnce()
  })
})

describe('sending tickets to Kitchen', () => {
  const second: TicketSummary = { ...SUMMARY, id: 'github:me/shop#143', title: 'Fix the till', url: 'https://github.com/me/shop/issues/143' }

  function kitchen(blocked: readonly string[]) {
    const onGo = vi.fn()
    render(<KitchenDialog container={document.body} provider="github" tickets={[SUMMARY, second]} blockersOf={(id) => (blocked.includes(id) ? ['#1'] : [])} targets={[]} onCancel={vi.fn()} onGo={onGo} />)
    return onGo
  }

  it('skips a blocked ticket unless it is sent anyway', async () => {
    const onGo = kitchen([second.id])
    expect(screen.getByText(/1 blocked ticket will be skipped/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /send anyway/ }))
    await userEvent.click(screen.getByRole('button', { name: /Send 2 to Kitchen/ }))
    expect(onGo).toHaveBeenCalledWith(NEW_KITCHEN, [SUMMARY, second])
  })

  it('does nothing when every ticket is blocked', async () => {
    const onGo = kitchen([SUMMARY.id, second.id])
    await userEvent.click(screen.getByRole('button', { name: /Nothing to send/ }))
    expect(onGo).not.toHaveBeenCalled()
  })
})
