import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SavedRead, WorkspaceRow } from '../model/workspacePanel'
import { WorkspacePanelDialog } from './WorkspacePanelDialog'

const NOW = 2_000_000_000
const HOUR = 3600
const LOGIN: WorkspaceRow = { key: 'session:t1', name: 'Fix the login', agent: 'claude', branch: 'feat/login', at: NOW - HOUR, state: 'running', sessionId: 't1', conversation: null }
const PARSER: WorkspaceRow = {
  key: 'saved:codex:p1', name: 'Port the parser', agent: 'codex', branch: 'main', at: NOW - 3 * HOUR, state: 'closed',
  saved: { agent: 'codex', session: 'p1', cwd: '/code/shop', branch: 'main', title: 'Port the parser', at: NOW - 3 * HOUR, worktree: null, repo: null },
}
const LISTED: SavedRead = { kind: 'listed', list: [] }

function show(rows: readonly WorkspaceRow[], saved: SavedRead = LISTED, onRetry = vi.fn()) {
  const onCancel = vi.fn()
  render(<div className="mx-app"><WorkspacePanelDialog name="shop" rows={rows} saved={saved} now={NOW} onRetry={onRetry} onCancel={onCancel} /></div>)
  return { onCancel, onRetry }
}

const ticks = () => screen.getAllByRole('checkbox').map((box) => (box as HTMLInputElement).checked)

describe('a project’s workspace panel', () => {
  it('lists each session with its agent, branch, whether it runs and when, and ticks none', () => {
    show([LOGIN, PARSER])

    expect(screen.getByRole('dialog', { name: 'Workspace · shop' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Sessions' })
    const login = within(list).getByRole('checkbox', { name: /Fix the login/ })
    expect(login).toHaveAccessibleName(/Claude · feat\/login/)
    expect(login).toHaveAccessibleName(/running · 1h ago/)
    const parser = within(list).getByRole('checkbox', { name: /Port the parser/ })
    expect(parser).toHaveAccessibleName(/Codex · main/)
    expect(parser).toHaveAccessibleName(/closed · 3h ago/)
    expect(ticks()).toEqual([false, false])
    expect(screen.getByText('0 of 2 ticked')).toBeInTheDocument()
  })

  it('ticks one row, all of them with Select all, and none with Select none', async () => {
    const user = userEvent.setup()
    show([LOGIN, PARSER])
    const all = screen.getByRole('button', { name: 'Select all' })
    const none = screen.getByRole('button', { name: 'Select none' })
    expect(none).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /Port the parser/ }))
    expect(ticks()).toEqual([false, true])
    expect(screen.getByText('1 of 2 ticked')).toBeInTheDocument()
    await user.click(all)
    expect(ticks()).toEqual([true, true])
    expect(all).toBeDisabled()
    await user.click(none)
    expect(ticks()).toEqual([false, false])
    expect(none).toBeDisabled()
  })

  it('says in one sentence that a project has no sessions yet', () => {
    show([])
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('No sessions here yet. The ones you start in shop, and the ones open when it is closed, show here.')
  })

  it('asks for a restart of an older service, and still lists the sessions running', () => {
    show([], { kind: 'older' })
    expect(screen.getByRole('status')).toHaveTextContent('The Maiker service needs a restart to show the sessions open when this project was last closed.')
    expect(screen.queryByText(/No sessions here yet/)).toBeNull()
  })

  it('keeps the running rows while the saved ones load', () => {
    show([LOGIN], { kind: 'loading' })
    expect(screen.getByText('Looking for the sessions open when this project was last closed…')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Fix the login/ })).toBeInTheDocument()
  })

  it('offers Try again when the saved sessions could not be read', async () => {
    const user = userEvent.setup()
    const { onRetry } = show([], { kind: 'failed' })
    expect(screen.getByRole('status')).toHaveTextContent('Could not read the sessions open when this project was last closed.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('closes with Done', async () => {
    const user = userEvent.setup()
    const { onCancel } = show([LOGIN])
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
