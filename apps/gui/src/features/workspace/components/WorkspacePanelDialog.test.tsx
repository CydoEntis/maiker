import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ClosedSession } from '@/api/daemon'
import type { WorktreesRemoved } from '@/features/worktrees/api'
import type { SavedRead, StandingRead, WorkspaceRow, WorktreeRow, WorktreesRead } from '../model/workspacePanel'
import { WorkspacePanelDialog } from './WorkspacePanelDialog'

const NOW = 2_000_000_000
const HOUR = 3600
const LOGIN: WorkspaceRow = { key: 'session:t1', name: 'Fix the login', agent: 'claude', branch: 'feat/login', at: NOW - HOUR, state: 'running', sessionId: 't1', conversation: null }
function closedRow(agent: string, session: string, title: string, branch: string, at: number, skip: string | null = null): WorkspaceRow & { state: 'closed' } {
  const saved: ClosedSession = { agent, session, cwd: '/code/shop', branch, title, at, folder_present: true, worktree: null, repo: null }
  return { key: `saved:${agent}:${session}`, name: title, agent, branch, at, state: 'closed', saved, skip }
}
const PARSER = closedRow('codex', 'p1', 'Port the parser', 'main', NOW - 3 * HOUR)
const DOCS = closedRow('claude', 'd1', 'Write the docs', 'docs', NOW - 5 * HOUR)
const LISTED: SavedRead = { kind: 'listed', list: [] }
const NO_GIT: WorktreesRead = { kind: 'not-a-repo' }

const MAIN: WorktreeRow = { key: 'worktree:/code/shop', path: '/code/shop', name: 'main', main: true }
function linked(branch: string, standing: StandingRead, running = false): WorktreeRow {
  return { key: `worktree:/code/shop-${branch}`, path: `/code/shop-${branch}`, name: branch, main: false, standing, running }
}
const STANDING = { dirty: 0, branch: 'b', merged: true, last_commit: '2 days ago', inactive_days: null, missing: false }
const DIRTY = linked('dark-mode', { kind: 'read', standing: { ...STANDING, dirty: 3, merged: false } })
const QUIET = linked('old-fix', { kind: 'read', standing: { ...STANDING, inactive_days: 16 } })
const WORKTREES: WorktreesRead = { kind: 'listed', rows: [MAIN, DIRTY, QUIET] }
const UNMERGED = linked('spike', { kind: 'read', standing: { ...STANDING, merged: false } })
const BUSY = linked('busy', { kind: 'read', standing: STANDING }, true)

type Remove = (items: readonly { path: string; force: boolean }[]) => Promise<WorktreesRemoved>

function show(rows: readonly WorkspaceRow[], saved: SavedRead = LISTED, onRetry = vi.fn(), worktrees: WorktreesRead = NO_GIT, opening = false, onRemove = vi.fn<Remove>(() => Promise.resolve({ removed: [], kept: [] }))) {
  const onCancel = vi.fn()
  const onRetryWorktrees = vi.fn()
  const onOpen = vi.fn()
  const onClose = vi.fn()
  render(
    <div className="mx-app">
      <WorkspacePanelDialog name="shop" rows={rows} saved={saved} worktrees={worktrees} now={NOW} opening={opening} onOpen={onOpen} onClose={onClose} onRemove={onRemove} onRetry={onRetry} onRetryWorktrees={onRetryWorktrees} onCancel={onCancel} />
    </div>,
  )
  return { onCancel, onRetry, onRetryWorktrees, onOpen, onClose, onRemove }
}

const ticks = () => screen.getAllByRole('checkbox').map((box) => (box as HTMLInputElement).checked)

describe('a project’s workspace panel', () => {
  it('marks a row Open would skip with why, in the toast’s words, and leaves it out of the ticks, Open N and Open everything', async () => {
    const gone = closedRow('claude', 'g1', 'Sketch the pricing page', 'pricing', NOW - 2 * HOUR, 'folder removed; cannot be made again')
    const { onOpen } = show([LOGIN, PARSER, gone])

    const list = screen.getByRole('list', { name: 'Sessions' })
    const box = within(list).getByRole('checkbox', { name: /Sketch the pricing page/ })
    expect(box).toHaveAccessibleName(/closed · folder removed; cannot be made again/)
    expect(box).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('0 of 2 ticked')
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(box).not.toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent('2 of 2 ticked')
    await userEvent.click(screen.getByRole('button', { name: 'Open 1' }))
    expect(onOpen).toHaveBeenLastCalledWith([PARSER.saved])
    await userEvent.click(screen.getByRole('button', { name: 'Open everything' }))
    expect(onOpen).toHaveBeenLastCalledWith([PARSER.saved])
  })

  it('offers no Open everything when every closed row would be skipped', () => {
    show([LOGIN, closedRow('opencode', 'o1', 'Ask about the cache', 'cache', NOW - HOUR, 'its agent runs only in the Chat view')])

    expect(screen.getByRole('checkbox', { name: /Ask about the cache/ })).toHaveAccessibleName(/closed · its agent runs only in the Chat view/)
    expect(screen.getByRole('button', { name: 'Open everything' })).toBeDisabled()
  })

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

  it('gives a worktree a session runs in no tick to take, and leaves it out of Select all and Remove', async () => {
    const user = userEvent.setup()
    show([], LISTED, vi.fn(), { kind: 'listed', rows: [MAIN, BUSY, QUIET] })
    const busy = screen.getByRole('checkbox', { name: /busy/ })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAccessibleName(/a session runs in it/)
    expect(screen.getByText('0 of 1 ticked')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select all' }))
    expect(busy).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Remove 1 ticked worktree' })).toBeEnabled()
  })

  it('asks before removing, naming each ticked worktree by branch, folder and standing, and sends a clean merged one as it is', async () => {
    const user = userEvent.setup()
    const { onRemove } = show([LOGIN], LISTED, vi.fn(), WORKTREES)
    expect(screen.getByRole('button', { name: 'Remove ticked worktrees' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Fix the login/ }))
    expect(screen.getByRole('button', { name: 'Remove ticked worktrees' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /old-fix/ }))
    await user.click(screen.getByRole('button', { name: 'Remove 1 ticked worktree' }))
    expect(screen.getByRole('heading', { name: 'Remove this worktree?' })).toHaveFocus()
    const [only] = within(screen.getByRole('list', { name: 'Worktrees to remove' })).getAllByRole('listitem')
    expect(only).toHaveTextContent('old-fix')
    expect(only).toHaveTextContent('/code/shop-old-fix')
    expect(only).toHaveTextContent('nothing uncommitted · merged')
    expect(only).toHaveTextContent('loses nothing')
    expect(within(only ?? document.body).queryByRole('checkbox')).toBeNull()
    expect(onRemove).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Remove 1 ticked worktree' }))
    expect(onRemove).toHaveBeenCalledWith([{ path: '/code/shop-old-fix', force: false }])
  })

  it('asks on its own about each worktree that would lose something, saying what, and sends only the confirmed ones', async () => {
    const user = userEvent.setup()
    const { onRemove } = show([], LISTED, vi.fn(), { kind: 'listed', rows: [MAIN, DIRTY, QUIET, UNMERGED, linked('new', { kind: 'checking' })] })
    await user.click(screen.getByRole('button', { name: 'Select all' }))
    await user.click(screen.getByRole('button', { name: 'Remove 4 ticked worktrees' }))
    expect(screen.getByRole('heading', { name: 'Remove these 4 worktrees?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove 1 ticked worktree' })).toBeEnabled()
    const dirty = screen.getByRole('checkbox', { name: 'Lose its 3 uncommitted changes? Remove it too' })
    const unmerged = screen.getByRole('checkbox', { name: 'Lose commits that are on no other branch (the branch is kept, the folder goes)? Remove it too' })
    expect(screen.getByRole('checkbox', { name: 'Lose whatever is in it: where it stands is not known? Remove it too' })).not.toBeChecked()
    expect(unmerged).not.toBeChecked()

    await user.click(dirty)
    await user.click(screen.getByRole('button', { name: 'Remove 2 ticked worktrees' }))
    expect(onRemove).toHaveBeenCalledWith([{ path: '/code/shop-dark-mode', force: true }, { path: '/code/shop-old-fix', force: false }])
    // Back on the list, the ones sent are unticked and the ones not confirmed stay ticked.
    expect(await screen.findByRole('checkbox', { name: /spike/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /dark-mode/ })).not.toBeChecked()
    expect(screen.getByRole('region', { name: 'Worktrees' })).toHaveFocus()
  })

  it('goes back to the list with Keep them, removing nothing and keeping the ticks', async () => {
    const user = userEvent.setup()
    const { onRemove } = show([], LISTED, vi.fn(), WORKTREES)
    await user.click(screen.getByRole('checkbox', { name: /dark-mode/ }))
    await user.click(screen.getByRole('button', { name: 'Remove 1 ticked worktree' }))
    await user.click(screen.getByRole('button', { name: 'Keep them' }))
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: /dark-mode/ })).toBeChecked()
  })

  it('shows the daemon’s reason on the row of each worktree it kept, and says how the removal went', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn<Remove>(() => Promise.resolve({ removed: ['/code/shop-spike'], kept: [{ path: '/code/shop-old-fix', why: 'something is running in it' }] }))
    show([], LISTED, vi.fn(), { kind: 'listed', rows: [MAIN, QUIET, linked('spike', { kind: 'read', standing: STANDING })] }, false, onRemove)
    await user.click(screen.getByRole('button', { name: 'Select all' }))
    await user.click(screen.getByRole('button', { name: 'Remove 2 ticked worktrees' }))
    await user.click(screen.getByRole('button', { name: 'Remove 2 ticked worktrees' }))

    expect(await screen.findByText('Removed 1 worktree. 1 worktree stayed: the reason is on its row.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /old-fix/ })).toHaveAccessibleName(/Not removed: something is running in it/)
    expect(screen.getByRole('checkbox', { name: /spike/ })).not.toHaveAccessibleName(/Not removed/)
  })

  it('says why a removal could not be asked, and what an older service leaves to the list', async () => {
    const user = userEvent.setup()
    const failing = vi.fn<Remove>(() => Promise.reject(new Error('The Maiker service did not answer.')))
    show([], LISTED, vi.fn(), WORKTREES, false, failing)
    await user.click(screen.getByRole('checkbox', { name: /old-fix/ }))
    await user.click(screen.getByRole('button', { name: 'Remove 1 ticked worktree' }))
    await user.click(screen.getByRole('button', { name: 'Remove 1 ticked worktree' }))
    expect(await screen.findByText(/^Could not remove the worktrees\. The Maiker service did not answer/)).toBeInTheDocument()
    cleanup()

    show([], LISTED, vi.fn(), WORKTREES, false, vi.fn<Remove>(() => Promise.resolve(null)))
    await user.click(screen.getByRole('checkbox', { name: /old-fix/ }))
    await user.click(screen.getByRole('button', { name: 'Remove 1 ticked worktree' }))
    await user.click(screen.getByRole('button', { name: 'Remove 1 ticked worktree' }))
    expect(await screen.findByText(/^Asked the service to remove them\./)).toBeInTheDocument()
  })

  it('closes with Done', async () => {
    const user = userEvent.setup()
    const { onCancel } = show([LOGIN])
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
