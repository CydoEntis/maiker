import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatActionsContext, type ChatActions } from '../chatActions'
import type { ChatRow } from '../chatRows'
import { TurnFooter } from './TurnFooter'

afterEach(cleanup)

type Divider = Extract<ChatRow, { kind: 'divider' }>
const row = (over: Partial<Divider> = {}): Divider => ({ kind: 'divider', key: 'd', event: { kind: 'turn', id: 'd', turnId: 't1', outcome: 'completed', startedAtMs: 1_000, endedAtMs: 8_000, timed: true }, steps: 5, reply: 'Fixed.', prompt: 'Fix it', ...over })
const nothing = () => undefined
const actions = (retry: ChatActions['retry']): ChatActions => ({ quote: nothing, jump: nothing, reply: nothing, retry, canReply: true })
const clock = () => '10:11 AM'

describe('the footer of a finished turn', () => {
  it('says Done with how many steps it took, and keeps how long in its tooltip', () => {
    render(<TurnFooter row={row()} clock={clock} />)

    expect(screen.getByText(/Done · 5 steps/)).toBeInTheDocument()
    expect(screen.getByRole('separator')).toHaveAttribute('title', 'Finished in 7s · 10:11 AM')
  })

  it('asks the same again when Retry is pressed', async () => {
    const retry = vi.fn()
    render(<ChatActionsContext.Provider value={actions(retry)}><TurnFooter row={row()} clock={clock} /></ChatActionsContext.Provider>)

    await userEvent.click(screen.getByRole('button', { name: 'Retry this turn' }))
    expect(retry).toHaveBeenCalledWith('Fix it')
  })

  it('offers no Retry where the chat cannot send, and no Copy where the agent wrote nothing', () => {
    render(<TurnFooter row={row({ reply: '' })} clock={clock} />)

    expect(screen.queryByRole('button', { name: 'Retry this turn' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy reply' })).toBeNull()
  })

  it('keeps its own words for a failed turn', () => {
    render(<TurnFooter row={row({ event: { ...row().event, outcome: 'failed' } })} clock={clock} />)

    expect(screen.getByText(/Failed after 7s/)).toBeInTheDocument()
  })
})
