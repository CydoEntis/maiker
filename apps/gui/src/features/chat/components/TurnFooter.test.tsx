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

  it('asks the same again when Retry is pressed', async () => {
    const retry = vi.fn()
    render(<ChatActionsContext.Provider value={actions(retry)}><TurnFooter row={row()} clock={clock} /></ChatActionsContext.Provider>)

    await userEvent.click(screen.getByRole('button', { name: 'Retry this turn' }))
    expect(retry).toHaveBeenCalledWith('Fix it')
  })

  it('keeps its own words for a failed turn', () => {
    render(<TurnFooter row={row({ event: { ...row().event, outcome: 'failed' } })} clock={clock} />)

    expect(screen.getByText(/Failed after 7s/)).toBeInTheDocument()
  })
})
