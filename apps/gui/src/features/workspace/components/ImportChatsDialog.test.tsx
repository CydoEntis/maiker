import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ImportableChat } from '@/api/daemon'
import { ImportChatsDialog } from './ImportChatsDialog'

const NOW = 2_000_000_000
const DAY = 86_400

function chat(agent: 'claude' | 'codex', id: string, folder: string, first: string, age: number): ImportableChat {
  return { agent, folder, saved: { id, first_message: first, last_active: NOW - age } }
}

const LOGIN = chat('claude', 'a', '/code/app', 'Fix the login', DAY)
const OLD = chat('codex', 'b', '/code/app', 'Port the parser', 30 * DAY)
const LIVE = chat('claude', 'c', '/code/api', 'Add the endpoint', 10)
const LIST = [LOGIN, LIVE, OLD]

function show(onImport = vi.fn()) {
  render(<div className="mx-app"><ImportChatsDialog read={{ kind: 'listed', list: LIST }} now={NOW} locked={false} onImport={onImport} onCancel={() => undefined} /></div>)
  return onImport
}

describe('Bring in your chats', () => {
  it('lists the chats by project with the recent ones ticked, and brings in the ticked ones', async () => {
    const onImport = show()

    const app = screen.getByRole('region', { name: 'app' })
    expect(within(app).getByRole('checkbox', { name: /Fix the login/ })).toBeChecked()
    expect(within(app).getByRole('checkbox', { name: /Port the parser/ })).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Bring in 1 chat' }))
    expect(onImport).toHaveBeenCalledWith([LOGIN])
  })

  it('leaves a chat used a moment ago unticked and says to close it where it is open', async () => {
    const onImport = show()

    const api = screen.getByRole('region', { name: 'api' })
    expect(within(api).getByRole('checkbox', { name: /Add the endpoint/ })).not.toBeChecked()
    expect(within(api).getByText('May be open elsewhere: close it there first')).toBeInTheDocument()
    await userEvent.click(within(api).getByRole('checkbox', { name: /Add the endpoint/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Bring in 2 chats' }))
    expect(onImport).toHaveBeenCalledWith([LOGIN, LIVE])
  })

  it('says why there is nothing to pick while it looks, when nothing is left, and for an older service', () => {
    const { rerender } = render(<ImportChatsDialog read={{ kind: 'loading' }} now={NOW} locked={false} onImport={() => undefined} onCancel={() => undefined} />)
    expect(screen.getByRole('status')).toHaveTextContent('Looking for chats on this computer…')
    rerender(<ImportChatsDialog read={{ kind: 'listed', list: [] }} now={NOW} locked={false} onImport={() => undefined} onCancel={() => undefined} />)
    expect(screen.getByRole('status')).toHaveTextContent('Every one is already here.')
    rerender(<ImportChatsDialog read={{ kind: 'older' }} now={NOW} locked={false} onImport={() => undefined} onCancel={() => undefined} />)
    expect(screen.getByRole('status')).toHaveTextContent('Restart the Maiker service')
  })
})
