import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ClosedSession } from '@/api/daemon'
import type { SavedRead, StandingRead, WorkspaceRow, WorktreeRow, WorktreesRead } from '../model/workspacePanel'
import { WorkspacePanelDialog } from './WorkspacePanelDialog'

const NOW = 2_000_000_000
const HOUR = 3600
const LOGIN: WorkspaceRow = { key: 'session:t1', name: 'Fix the login', agent: 'claude', branch: 'feat/login', at: NOW - HOUR, state: 'running', sessionId: 't1', conversation: null }
function closedRow(agent: string, session: string, title: string, branch: string, at: number): WorkspaceRow & { state: 'closed' } {
  const saved: ClosedSession = { agent, session, cwd: '/code/shop', branch, title, at, folder_present: true, worktree: null, repo: null }
  return { key: `saved:${agent}:${session}`, name: title, agent, branch, at, state: 'closed', saved }
}
const PARSER = closedRow('codex', 'p1', 'Port the parser', 'main', NOW - 3 * HOUR)
const DOCS = closedRow('claude', 'd1', 'Write the docs', 'docs', NOW - 5 * HOUR)
const LISTED: SavedRead = { kind: 'listed', list: [] }
const NO_GIT: WorktreesRead = { kind: 'not-a-repo' }

const MAIN: WorktreeRow = { key: 'worktree:/code/shop', path: '/code/shop', name: 'main', main: true }
function linked(branch: string, standing: StandingRead): WorktreeRow {
  return { key: `worktree:/code/shop-${branch}`, path: `/code/shop-${branch}`, name: branch, main: false, standing }
}
const STANDING = { dirty: 0, branch: 'b', merged: true, last_commit: '2 days ago', inactive_days: null, missing: false }
const DIRTY = linked('dark-mode', { kind: 'read', standing: { ...STANDING, dirty: 3, merged: false } })
const QUIET = linked('old-fix', { kind: 'read', standing: { ...STANDING, inactive_days: 16 } })
const WORKTREES: WorktreesRead = { kind: 'listed', rows: [MAIN, DIRTY, QUIET] }

function show(rows: readonly WorkspaceRow[], saved: SavedRead = LISTED, onRetry = vi.fn(), worktrees: WorktreesRead = NO_GIT, opening = false) {
  const onCancel = vi.fn()
  const onRetryWorktrees = vi.fn()
  const onOpen = vi.fn()
  const onClose = vi.fn()
  render(
    <div className="mx-app">
      <WorkspacePanelDialog name="shop" rows={rows} saved={saved} worktrees={worktrees} now={NOW} opening={opening} onOpen={onOpen} onClose={onClose} onRetry={onRetry} onRetryWorktrees={onRetryWorktrees} onCancel={onCancel} />
    </div>,
  )
  return { onCancel, onRetry, onRetryWorktrees, onOpen, onClose }
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

  it('opens only the ticked closed sessions, and is off while none is ticked', async () => {
    const user = userEvent.setup()
    const { onOpen } = show([LOGIN, PARSER, DOCS])
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Fix the login/ }))
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /Port the parser/ }))
    await user.click(screen.getByRole('button', { name: 'Open 1' }))
    expect(onOpen).toHaveBeenCalledWith([PARSER.saved])
    expect(ticks()).toEqual([true, false, false])
  })

  it('opens every closed session with Open everything, nothing ticked', async () => {
    const user = userEvent.setup()
    const { onOpen } = show([LOGIN, PARSER, DOCS])
    await user.click(screen.getByRole('button', { name: 'Open everything' }))
    expect(onOpen).toHaveBeenCalledWith([PARSER.saved, DOCS.saved])
  })

  it('keeps both Opens off while a session is starting', async () => {
    const user = userEvent.setup()
    show([LOGIN, PARSER], LISTED, vi.fn(), NO_GIT, true)
    await user.click(screen.getByRole('checkbox', { name: /Port the parser/ }))
    expect(screen.getByRole('button', { name: 'Opening…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open everything' })).toBeDisabled()
  })

  it('has nothing for Open everything when every session runs', () => {
    show([LOGIN])
    expect(screen.getByRole('button', { name: 'Open everything' })).toBeDisabled()
  })

  it('closes only the ticked sessions in the window, and is off while none is ticked', async () => {
    const user = userEvent.setup()
    const ended: WorkspaceRow = { key: 'session:t2', name: 'Old build', agent: 'codex', branch: null, at: null, state: 'ended', sessionId: 't2', conversation: null }
    const { onClose } = show([LOGIN, ended, PARSER])
    expect(screen.getByRole('button', { name: 'Close ticked sessions' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Port the parser/ }))
    expect(screen.getByRole('button', { name: 'Close ticked sessions' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Select all' }))
    await user.click(screen.getByRole('button', { name: 'Close 2 ticked sessions' }))
    expect(onClose).toHaveBeenCalledWith(['t1', 't2'])
  })

  it('leaves ticked worktrees to Remove worktree: Open and Close stay off, and an Open keeps their ticks', async () => {
    const user = userEvent.setup()
    const { onOpen, onClose } = show([LOGIN, PARSER], LISTED, vi.fn(), WORKTREES)
    await user.click(screen.getByRole('checkbox', { name: /dark-mode/ }))
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close ticked sessions' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Select all' }))
    await user.click(screen.getByRole('button', { name: 'Close 1 ticked session' }))
    expect(onClose).toHaveBeenCalledWith(['t1'])
    await user.click(screen.getByRole('button', { name: 'Open 1' }))
    expect(onOpen).toHaveBeenCalledWith([PARSER.saved])
    expect(screen.getByRole('checkbox', { name: /dark-mode/ })).toBeChecked()
  })

  it('lists each worktree with its branch, uncommitted changes, whether it is merged and how long it has been quiet', () => {
    show([LOGIN], LISTED, vi.fn(), WORKTREES)

    const list = screen.getByRole('list', { name: 'Worktrees' })
    const dirty = within(list).getByRole('checkbox', { name: /dark-mode/ })
    expect(dirty).toHaveAccessibleName(/3 uncommitted changes · not merged/)
    expect(dirty).toHaveAccessibleName(/2 days ago/)
    const quiet = within(list).getByRole('checkbox', { name: /old-fix/ })
    expect(quiet).toHaveAccessibleName(/nothing uncommitted · merged/)
    expect(quiet).toHaveAccessibleName(/inactive 16 days/)
    expect(ticks()).toEqual([false, false, false])
  })

  it('lists the main checkout without a tick, and Select all ticks every other row', async () => {
    const user = userEvent.setup()
    show([LOGIN], LISTED, vi.fn(), WORKTREES)
    const list = screen.getByRole('list', { name: 'Worktrees' })
    const [main] = within(list).getAllByRole('listitem')
    expect(main).toHaveTextContent('main')
    expect(main).toHaveTextContent('main checkout · stays')
    expect(within(main ?? list).queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('0 of 3 ticked')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select all' }))
    expect(ticks()).toEqual([true, true, true])
    expect(screen.getByText('3 of 3 ticked')).toBeInTheDocument()
    await user.click(within(list).getByRole('checkbox', { name: /old-fix/ }))
    expect(screen.getByText('2 of 3 ticked')).toBeInTheDocument()
  })

  it('says checking on each worktree until its standing arrives, and can still be ticked meanwhile', async () => {
    const user = userEvent.setup()
    show([], LISTED, vi.fn(), { kind: 'listed', rows: [MAIN, linked('dark-mode', { kind: 'checking' })] })
    const row = screen.getByRole('checkbox', { name: /dark-mode/ })
    expect(row).toHaveAccessibleName(/checking…/)
    await user.click(row)
    expect(screen.getByText('1 of 1 ticked')).toBeInTheDocument()
  })

  it('says a worktree whose folder is gone, and one whose standing could not be read', () => {
    show([], LISTED, vi.fn(), {
      kind: 'listed',
      rows: [linked('gone', { kind: 'read', standing: { ...STANDING, missing: true } }), linked('odd', { kind: 'failed', why: 'The service did not answer.' })],
    })
    expect(screen.getByRole('checkbox', { name: /gone/ })).toHaveAccessibleName(/its folder is gone/)
    expect(screen.getByRole('checkbox', { name: /odd/ })).toHaveAccessibleName(/could not check where it stands/)
    expect(screen.getByText('could not check where it stands')).toHaveAttribute('title', 'The service did not answer.')
  })

  it('says it is looking for the worktrees, offers Try again when it could not, and shows nothing outside git', async () => {
    const user = userEvent.setup()
    show([LOGIN], LISTED, vi.fn(), { kind: 'loading' })
    expect(screen.getByText('Looking for the worktrees of shop…')).toBeInTheDocument()
    cleanup()

    const { onRetryWorktrees } = show([LOGIN], LISTED, vi.fn(), { kind: 'failed' })
    expect(screen.getByText(/Could not read the worktrees of shop\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetryWorktrees).toHaveBeenCalledTimes(1)
    cleanup()

    show([LOGIN], LISTED, vi.fn(), NO_GIT)
    expect(screen.queryByRole('region', { name: 'Worktrees' })).toBeNull()
  })

  it('closes with Done', async () => {
    const user = userEvent.setup()
    const { onCancel } = show([LOGIN])
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
