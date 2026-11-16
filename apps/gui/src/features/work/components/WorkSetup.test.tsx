import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WorkSetup } from './WorkSetup'

describe('Work with no factory in the chat', () => {
  it('says what a factory is without naming one, and opens Tickets', async () => {
    const onOpenTickets = vi.fn()
    render(<WorkSetup others={[]} onOpenOther={vi.fn()} onOpenTickets={onOpenTickets} onBack={vi.fn()} />)

    expect(screen.getByText('No factory runs in this chat')).toBeInTheDocument()
    expect(screen.getByText('No factory has run here yet')).toBeInTheDocument()
    expect(screen.queryByText(/maiker/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Copy/ })).toBeNull()
    expect(screen.queryByText('A factory already runs in this project')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Open Tickets' }))
    expect(onOpenTickets).toHaveBeenCalledOnce()
  })

  it('offers the chats of this project that already run one', async () => {
    const onOpenOther = vi.fn()
    render(<WorkSetup others={[{ id: 't4', label: 'Factory', sub: 'shop · 2 running' }]} onOpenOther={onOpenOther} onOpenTickets={vi.fn()} onBack={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /shop · 2 running/ }))
    expect(onOpenOther).toHaveBeenCalledWith('t4')
  })
})
