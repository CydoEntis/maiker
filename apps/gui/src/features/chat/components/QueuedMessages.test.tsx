import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueuedMessages } from './QueuedMessages'

const NOTHING = () => undefined
const QUEUE = [{ id: 1, text: 'Bump the version.' }]

async function sendNowTitle(steers: boolean | undefined): Promise<string | null> {
  render(<QueuedMessages agent="codex" queue={QUEUE} open={false} onOpenChange={NOTHING} onRead={NOTHING} helpersOpen={false} onRemove={NOTHING} onEdit={NOTHING} onSendNow={NOTHING} onClear={NOTHING} steers={steers} />)
  await userEvent.setup().click(screen.getByRole('button', { name: /^Queued/ }))
  return screen.getByRole('button', { name: 'Send now' }).getAttribute('title')
}

describe('QueuedMessages', () => {
  it('says Send now goes into the running turn when the chat steers', async () => {
    expect(await sendNowTitle(true)).toBe('Send it to Codex now, into the turn it is running')
  })

  it('says Send now interrupts the step when the chat does not steer or nothing is known', async () => {
    expect(await sendNowTitle(undefined)).toBe('Send it to Codex now, interrupting the step it is on')
  })
})
