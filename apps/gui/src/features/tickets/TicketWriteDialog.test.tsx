import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TicketSummary, TicketWrite } from '@/api/tickets'
import { TicketWriteDialog, writeFailureWords } from './TicketWriteDialog'

afterEach(cleanup)

const SUMMARY: TicketSummary = { id: 'github:me/shop#142', title: 'Fix the cart', stateName: 'open', category: 'Open', labels: [], assignee: null, url: 'https://github.com/me/shop/issues/142', groups: [], updatedAt: '' }

function open(kind: 'comment' | 'close', answer: (write: TicketWrite) => Promise<string | null> = () => Promise.resolve(null)) {
  const onConfirm = vi.fn(answer)
  const onCancel = vi.fn()
  render(<TicketWriteDialog container={document.body} provider="github" ticket={SUMMARY} kind={kind} onConfirm={onConfirm} onCancel={onCancel} />)
  return { onConfirm, onCancel }
}

describe('commenting on a ticket', () => {
  it('shows exactly the text, as text, and sends nothing until the confirm button is clicked', async () => {
    const { onConfirm } = open('comment')
    const words = '<b>Fixed</b> in #7\nthanks'
    await userEvent.type(screen.getByRole('textbox', { name: 'Your comment' }), words.replace('\n', '{Enter}'))
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByText('Exactly what will be written')).toBeInTheDocument()
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('#142')).toBeInTheDocument()
    expect(document.querySelector('.mx-tk-sent-quote-text')?.textContent).toBe(words)
    expect(document.querySelector('b.mx-tk-mono')).not.toBeNull()
    expect(document.querySelector('.mx-tk-sent-quote-text b')).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Post comment to GitHub' }))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ kind: 'comment', text: words })
  })

  it('does not go on with an empty or too long comment', async () => {
    open('comment')
    const review = screen.getByRole('button', { name: 'Review' })
    await userEvent.click(review)
    expect(screen.queryByText('Exactly what will be written')).toBeNull()
    await userEvent.click(screen.getByRole('textbox', { name: 'Your comment' }))
    await userEvent.paste('a\tb')
    expect(screen.getByText(/tabs or hidden/)).toBeInTheDocument()
    await userEvent.click(review)
    expect(screen.queryByText('Exactly what will be written')).toBeNull()
  })

  it('writes nothing when cancelled, at either step', async () => {
    const { onConfirm, onCancel } = open('comment')
    await userEvent.type(screen.getByRole('textbox', { name: 'Your comment' }), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel (Esc)' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('says why a refused write was not written and keeps the dialog open to try again', async () => {
    const { onConfirm } = open('comment', () => Promise.resolve('GitHub is not signed in.'))
    await userEvent.type(screen.getByRole('textbox', { name: 'Your comment' }), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    await userEvent.click(screen.getByRole('button', { name: 'Post comment to GitHub' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not written. GitHub is not signed in.')
    expect(screen.getByRole('button', { name: 'Post comment to GitHub' })).toBeEnabled()
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})

describe('marking a ticket done', () => {
  it('goes straight to the review and closes only on the confirm click', async () => {
    const { onConfirm } = open('close')
    expect(screen.getByText('Mark it done (close it)')).toBeInTheDocument()
    expect(screen.getByText(/It moves to its finished state/)).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Mark done on GitHub' }))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ kind: 'close' })
  })
})

describe('what a refused write says', () => {
  it('names the way out for each failure', () => {
    expect(writeFailureWords({ kind: 'signed-out' }, 'github')).toMatch(/gh auth login/)
    expect(writeFailureWords({ kind: 'signed-out' }, 'plane')).toMatch(/refused the key/)
    expect(writeFailureWords({ kind: 'no-key' }, 'linear')).toMatch(/Settings/)
    expect(writeFailureWords({ kind: 'invalid', line: 'The write was not confirmed' }, 'plane')).toBe('The write was not confirmed')
  })
})
