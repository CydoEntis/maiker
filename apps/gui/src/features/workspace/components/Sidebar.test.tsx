import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/data/preview'
import { resetToasts } from '@/lib/toast'
import { LOCAL_HEAD, type MachineHead } from '../model/machines'
import { groupByProject, type OpenedProject } from '../model/openedProjects'
import { toSessionView, type SessionView } from '../model/session'
import type { ProjectActions } from './projectMenu'
import { Sidebar, type SidebarProps } from './Sidebar'

vi.mock('@/api/daemon', () => ({ terminalOf: (id: string) => Number(id.slice(id.indexOf('t') + 1)) }))

const DEVBOX: MachineHead = { ...LOCAL_HEAD, key: 'machine-4', machine: 4, name: 'devbox', label: 'devbox', chip: { glyph: '●', word: 'connected', tone: 'ok' } }
const SENTENCE = 'devbox did not answer. Check that it is on and on the network.'
const DEVBOX_DOWN: MachineHead = { ...DEVBOX, down: true, why: SENTENCE, chip: { glyph: '✕', word: 'unreachable', tone: 'bad' } }

const SHOP: OpenedProject = { machineName: null, folder: '/home/me/shop' }
const NOTES: OpenedProject = { machineName: null, folder: '/home/me/notes' }
const API: OpenedProject = { machineName: 'devbox', folder: '/srv/api' }

/** A named agent session as the daemon reports it, in the shop project unless `extra` says where. */
function session(pane: number, title: string, extra: Partial<Conversation> = {}): SessionView {
  const cwd = extra.cwd ?? SHOP.folder
  return toSessionView(
    { id: `t${String(pane)}`, generation: 0, kind: 'terminal', title, named: true, project: '', folder: cwd, cwd, repo: null, branch: 'working tree', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: 'claude', ...extra },
    '/home/me',
  )
}
const onDevbox = (pane: number, title: string, extra: Partial<Conversation> = {}) => session(pane, title, { machine: 4, machineName: 'devbox', cwd: API.folder, ...extra })
const startedBy = (id: string): Partial<Conversation> => ({ details: { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, startedBy: id } })

function show(sessions: SessionView[], more: Partial<SidebarProps> = {}, opened: readonly OpenedProject[] = []) {
  const none = vi.fn()
  const grouping = groupByProject(sessions, opened)
  const projectActions = {
    onNewSession: vi.fn(), onNewWorktree: vi.fn(), onNewTerminal: vi.fn(), onOpenWorktree: vi.fn(), onCopyPath: vi.fn(), onShowFiles: vi.fn(),
    onClose: vi.fn(),
  } satisfies ProjectActions
  const props: SidebarProps = {
    sessions, listed: true, machines: [LOCAL_HEAD], projects: grouping.machines, opened: grouping.opened, sort: 'recent', onSort: none, selectedProject: null, installedAgents: ['claude', 'codex', 'gemini'], focusedId: null, mode: 'docked', online: true, canStart: true, portalContainer: null,
    onToggleRail: none, side: 'left', width: 264, onResize: none, onResizeEnd: none, onSearch: none, projectActions,
    onOpenProject: none, onAddMachine: none, onMachineSettings: none, onRetryMachine: none, onSignInMachine: none, onCopyCommand: none, onRenameMachine: none, onUpdateMachine: none, onShowSession: none, onRenameSession: none,
    onCopyPath: none, onEndSession: none, onOpenSettings: none,
    ...more,
  }
  const view = render(<Sidebar {...props} />)
  // Draws the same sidebar again with some props changed, as the window does when the selection moves.
  return { projectActions, again: (next: Partial<SidebarProps>) => { view.rerender(<Sidebar {...props} {...next} />) } }
}

// Folded headings are kept in this window's storage; each test starts with none.
beforeEach(() => { localStorage.clear() })
afterEach(() => { resetToasts() })

const rowsIn = (scope: HTMLElement) => within(scope).queryAllByRole('button', { name: /, (idle|working|needs you|done|stopped|offline)$/ }).map((row) => row.getAttribute('aria-label')?.split(',')[0])
const heading = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, \\d+ sessions?(, (needs you|working|done))?$`) })
/** What each row of the open menu says, without its mark and its key, which are hidden from a screen reader. */
const menuItems = () => screen.getAllByRole('menuitem').map((item) => {
  const spoken = item.cloneNode(true) as HTMLElement
  spoken.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => { hidden.remove() })
  return spoken.textContent
})

describe('the foot\'s pull-request button', () => {
  it('counts only the pull requests that need you, and opens the surface', async () => {
    const onOpen = vi.fn()
    show([session(1, 'Fix the cart total')], { pullRequests: { needYou: 2, onOpen } })

    const button = screen.getByRole('button', { name: /^Pull requests, 2 pull requests need you$/ })
    await userEvent.click(button)

    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('has no count when none needs you', () => {
    show([session(1, 'Fix the cart total')], { pullRequests: { needYou: 0, onOpen: vi.fn() } })

    expect(screen.getByRole('button', { name: 'Pull requests' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /need you|needs you$/ })).not.toBeInTheDocument()
  })

  it('is left off the rail, as the design draws it', () => {
    show([session(1, 'Fix the cart total')], { mode: 'rail', pullRequests: { needYou: 1, onOpen: vi.fn() } })

    expect(screen.queryByRole('button', { name: /^Pull requests/ })).not.toBeInTheDocument()
  })
})

describe('the list', () => {
  it('lists the project opened last first, its sessions the most urgent first, each with its status in its name', () => {
    show([session(1, 'Tidy up', { status: 'working', cwd: '/home/me/docs' }), session(2, 'Which key?', { status: 'needs-you' }), session(3, 'Shipped', { status: 'done' })])
    const lists = screen.getAllByRole('list').map((list) => list.getAttribute('aria-label'))
    expect(lists).toEqual(['shop', 'docs'])
    expect(rowsIn(screen.getByRole('list', { name: 'shop' }))).toEqual(['Which key?', 'Shipped'])
    expect(screen.getByRole('button', { name: 'Which key?, claude, needs you' })).toBeTruthy()
    expect(heading('shop')).toHaveAccessibleName('shop, 2 sessions, needs you')
  })

  it('keeps a helper under the session that started it', () => {
    show([session(1, 'Lead', { status: 'working' }), session(2, 'Helper', { status: 'working', ...startedBy('t1') }), session(3, 'Other', { status: 'needs-you' })])
    expect(rowsIn(screen.getByRole('list', { name: 'shop' }))).toEqual(['Other', 'Lead', 'Helper'])
    expect(screen.getByRole('button', { name: 'Helper, claude, helper of Lead, working' })).toBeTruthy()
    expect(rowsIn(screen.getByRole('list', { name: 'Helpers of Lead' }))).toEqual(['Helper'])
  })

  it('folds a lead\'s helpers from their summary line, which says how many there are and what is most urgent', async () => {
    const user = userEvent.setup()
    const sessions = [session(1, 'Lead', { status: 'working' }), session(2, 'Cache', { status: 'needs-you', ...startedBy('t1') }), session(3, 'Resize', { status: 'working', ...startedBy('t1') })]
    const { again } = show(sessions)
    const summary = screen.getByRole('button', { name: /^2 helpers, 1 needs you/ })
    expect(summary.getAttribute('aria-expanded')).toBe('true')
    summary.focus()
    await user.keyboard('{Enter}')
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('list', { name: 'Helpers of Lead' })).toBeNull()
    expect(rowsIn(screen.getByRole('list', { name: 'shop' }))).toEqual(['Lead'])
    // The fold is the lead's, so it holds while its helpers change state.
    const next = sessions.map((each) => (each.id === 't2' ? session(2, 'Cache', { status: 'working', ...startedBy('t1') }) : each))
    again({ sessions: next, projects: groupByProject(next, []).machines })
    expect(screen.getByRole('button', { name: /^2 helpers, working/ }).getAttribute('aria-expanded')).toBe('false')
    await user.click(screen.getByRole('button', { name: /^2 helpers, working/ }))
    expect(rowsIn(screen.getByRole('list', { name: 'Helpers of Lead' }))).toEqual(['Cache', 'Resize'])
  })

  it('keeps a finished helper listed, saying what it changed', () => {
    show([session(1, 'Lead', { status: 'working' }), session(2, 'Batch', { status: 'done', diffAdded: 86, diffRemoved: 12, ...startedBy('t1') })])
    expect(screen.getByRole('button', { name: 'Batch, claude, helper of Lead, 86 added, 12 removed, done' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^1 helper, done/ })).toBeTruthy()
  })

  it('shows the session picked and marks it as the current one', async () => {
    const user = userEvent.setup()
    const onShowSession = vi.fn()
    show([session(1, 'One', { status: 'working' }), session(2, 'Two', { status: 'working' })], { onShowSession, focusedId: 't2' })
    await user.click(screen.getByRole('button', { name: /^One,/ }))
    expect(onShowSession).toHaveBeenCalledWith('t1')
    expect(screen.getByRole('button', { name: /^Two,/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /^One,/ })).not.toHaveAttribute('aria-current')
  })

  it('reaches a row from the keyboard, and Enter shows it', async () => {
    const user = userEvent.setup()
    const onShowSession = vi.fn()
    show([session(1, 'One', { status: 'working' })], { onShowSession })
    act(() => { screen.getByRole('button', { name: /^One,/ }).focus() })
    await user.keyboard('{Enter}')
    expect(onShowSession).toHaveBeenCalledWith('t1')
  })

  it('says it is looking until the service has listed its sessions, then that there are none', () => {
    const { again } = show([], { listed: false })
    expect(screen.getByText(/Looking for your sessions/)).toBeTruthy()
    again({ listed: true })
    expect(screen.queryByText(/Looking for your sessions/)).toBeNull()
    expect(screen.getByText('No sessions yet')).toBeTruthy()
  })

  it('tells the window which row the pointer or the keyboard is on, and when it leaves', async () => {
    const user = userEvent.setup()
    const onHoverSession = vi.fn()
    show([session(1, 'Growth', { status: 'working' })], { onHoverSession })
    const row = screen.getByRole('button', { name: /^Growth,/ })
    await user.hover(row)
    expect(onHoverSession).toHaveBeenLastCalledWith('t1')
    await user.unhover(row)
    expect(onHoverSession).toHaveBeenLastCalledWith(null)
    act(() => { row.focus() })
    expect(onHoverSession).toHaveBeenLastCalledWith('t1')
  })
})

describe('a project', () => {
  it('holds all its sessions, idle ones too, under one heading, and lists a project with no session', () => {
    show([session(1, 'Busy', { status: 'working' }), session(2, 'Quiet'), session(3, 'Old notes', { cwd: '/home/me/docs' })], {}, [NOTES])
    expect(rowsIn(screen.getByRole('list', { name: 'shop' }))).toEqual(['Busy', 'Quiet'])
    expect(rowsIn(screen.getByRole('list', { name: 'docs' }))).toEqual(['Old notes'])
    expect(screen.getByRole('button', { name: 'notes, no sessions' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Idle' })).toBeNull()
  })

  it('says its own state on its heading, the most urgent of its sessions, and none while all of them are idle', () => {
    show([session(1, 'Busy', { status: 'working' }), session(2, 'Asking', { status: 'needs-you' }), session(3, 'Old notes', { cwd: '/home/me/docs' })])
    expect(screen.getByRole('button', { name: 'shop, 2 sessions, needs you' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'docs, 1 session' })).toBeTruthy()
  })

  it('draws a project with nothing going on as idle, and a busy one as it is', () => {
    show([session(1, 'Busy', { status: 'working' }), session(2, 'Quiet', { cwd: '/home/me/docs' }), session(3, 'Helper', { cwd: '/home/me/docs', ...startedBy('t2') })])
    expect(heading('docs').closest('.mx-sb-head')).toHaveClass('is-idle')
    expect(screen.getByRole('button', { name: /^Helper,/ }).closest('.mx-sb-group')).toHaveClass('is-idle')
    expect(heading('shop').closest('.mx-sb-group')).not.toHaveClass('is-idle')
  })

  it('stays in its place when its sessions change state', () => {
    const before = [session(1, 'First', { cwd: '/home/me/docs' }), session(2, 'Second')]
    const { again } = show(before)
    const order = () => screen.getAllByRole('list').map((list) => list.getAttribute('aria-label'))
    expect(order()).toEqual(['shop', 'docs'])
    const after = [session(1, 'First', { cwd: '/home/me/docs', status: 'needs-you' }), session(2, 'Second')]
    again({ sessions: after, projects: groupByProject(after, []).machines, opened: groupByProject(after, []).opened })
    expect(order()).toEqual(['shop', 'docs'])
  })

  it('lists a session that stopped or whose machine is out of reach, so none goes missing', () => {
    show([session(1, 'Crashed', { status: 'recovery' }), session(2, 'Far away', { status: 'unknown' })])
    expect(screen.getByRole('button', { name: 'Crashed, claude, stopped' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Far away, claude, offline' })).toBeTruthy()
  })
})

describe('a project heading', () => {
  it('folds its sessions, still says one of them needs you, and keeps the fold after a restart', async () => {
    const user = userEvent.setup()
    const sessions = [session(1, 'Which key?', { status: 'needs-you' })]
    const first = render(<Sidebar {...propsOf(sessions)} />)
    await user.click(heading('shop'))
    expect(heading('shop')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /^Which key\?,/ })).toBeNull()
    expect(heading('shop')).toHaveAccessibleName('shop, 1 session, needs you')
    first.unmount()
    render(<Sidebar {...propsOf(sessions)} />)
    expect(heading('shop')).toHaveAttribute('aria-expanded', 'false')
  })

  it('unfolds the project just opened or picked', async () => {
    const user = userEvent.setup()
    const sessions = [session(1, 'One', { status: 'working' })]
    const { again } = show(sessions)
    await user.click(heading('shop'))
    again({ selectedProject: { ...SHOP } })
    expect(heading('shop')).toHaveAttribute('aria-expanded', 'true')
  })

  it('starts a session with the agent picked from its + menu, by click or by its number', async () => {
    const user = userEvent.setup()
    const { projectActions } = show([session(1, 'One', { status: 'working', repo: 'shop', branch: 'main' })])
    await user.click(screen.getByRole('button', { name: 'New session or worktree in shop' }))
    const menu = await screen.findByRole('menu', { name: 'New in shop' })
    expect(menu).toHaveTextContent('In shop · This computer')
    expect(menuItems()).toEqual(['Claude', 'Codex', 'Gemini', 'Terminal', 'New worktree…', 'Open worktree…'])
    await user.click(within(menu).getByRole('menuitem', { name: /Codex/ }))
    expect(projectActions.onNewSession).toHaveBeenLastCalledWith(0, SHOP, 'codex')
    await user.click(screen.getByRole('button', { name: 'New session or worktree in shop' }))
    await screen.findByRole('menu', { name: 'New in shop' })
    await user.keyboard('3')
    expect(projectActions.onNewSession).toHaveBeenLastCalledWith(0, SHOP, 'gemini')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers an agent that is not installed as such, and numbers only the ones that are', async () => {
    const user = userEvent.setup()
    const { projectActions } = show([session(1, 'One', { status: 'working' })], { installedAgents: ['claude', 'gemini'] })
    await user.click(screen.getByRole('button', { name: 'New session or worktree in shop' }))
    const menu = await screen.findByRole('menu', { name: 'New in shop' })
    expect(within(menu).getByRole('menuitem', { name: /Codex/ })).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('2')
    expect(projectActions.onNewSession).toHaveBeenLastCalledWith(0, SHOP, 'gemini')
  })

  it('starts a terminal and the worktree dialogs from its + menu', async () => {
    const user = userEvent.setup()
    const { projectActions } = show([], {}, [NOTES])
    await user.click(screen.getByRole('button', { name: 'notes, no sessions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Terminal/ }))
    expect(projectActions.onNewTerminal).toHaveBeenCalledWith(0, NOTES)
    await user.click(screen.getByRole('button', { name: 'notes, no sessions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Open worktree/ }))
    expect(projectActions.onOpenWorktree).toHaveBeenCalledWith(0, NOTES, 'notes')
  })

  it('offers its own actions on a right-click, and acts on its machine', async () => {
    const user = userEvent.setup()
    const { projectActions } = show([onDevbox(1, 'There', { status: 'working', repo: 'api', branch: 'main' })], { machines: [LOCAL_HEAD, DEVBOX] })
    fireEvent.contextMenu(heading('api'))
    await screen.findByRole('menu', { name: 'api' })
    expect(menuItems()).toEqual(['New session', 'New worktree…', 'Copy path', 'Show files', 'Close project…'])
    await user.click(screen.getByRole('menuitem', { name: /New session/ }))
    expect(projectActions.onNewSession).toHaveBeenLastCalledWith(4, API)
    fireEvent.contextMenu(heading('api'))
    await user.click(await screen.findByRole('menuitem', { name: 'Copy path' }))
    expect(projectActions.onCopyPath).toHaveBeenCalledWith(API)
    fireEvent.contextMenu(heading('api'))
    await user.click(await screen.findByRole('menuitem', { name: 'Show files' }))
    expect(projectActions.onShowFiles).toHaveBeenCalledWith('t1')
  })

  it('opens its menu from the menu key on the focused heading', async () => {
    const user = userEvent.setup()
    show([session(1, 'One', { status: 'working' })])
    act(() => { heading('shop').focus() })
    await user.keyboard('{ContextMenu}')
    expect(await screen.findByRole('menu', { name: 'shop' })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(heading('shop')).toHaveFocus()
  })

  it('offers no worktree in a project whose sessions run outside git', async () => {
    const user = userEvent.setup()
    show([session(1, 'One', { status: 'working' })])
    await user.click(screen.getByRole('button', { name: 'New session or worktree in shop' }))
    await screen.findByRole('menu', { name: 'New in shop' })
    expect(menuItems()).toEqual(['Claude', 'Codex', 'Gemini', 'Terminal'])
  })

  it('closes a project from its menu, whether or not a session runs in it', async () => {
    const user = userEvent.setup()
    const { projectActions } = show([session(1, 'One', { status: 'working' })], {}, [NOTES])
    fireEvent.contextMenu(screen.getByRole('button', { name: 'notes, no sessions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Close project…' }))
    expect(projectActions.onClose).toHaveBeenCalledWith(NOTES, 'notes')
    fireEvent.contextMenu(heading('shop'))
    await user.click(await screen.findByRole('menuitem', { name: 'Close project…' }))
    expect(projectActions.onClose).toHaveBeenLastCalledWith(SHOP, 'shop')
  })
})

describe('a project on another machine', () => {
  it('carries the machine as a tag, whose menu renames it and opens its settings', async () => {
    const user = userEvent.setup()
    const onRenameMachine = vi.fn()
    const onOpenProject = vi.fn()
    show([onDevbox(1, 'There', { status: 'working' })], { machines: [LOCAL_HEAD, DEVBOX], onRenameMachine, onOpenProject })
    await user.click(screen.getByRole('button', { name: 'devbox, connected' }))
    expect(menuItems()).toEqual(['Open a project on this machine…', 'Rename…', 'Machine settings…'])
    await user.click(screen.getByRole('menuitem', { name: 'Open a project on this machine…' }))
    expect(onOpenProject).toHaveBeenCalledWith(4)
    await user.click(screen.getByRole('button', { name: 'devbox, connected' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename…' }))
    expect(onRenameMachine).toHaveBeenCalledWith('devbox')
  })

  it('says the machine is not connected, with the host\'s sentence and Retry within reach, and starts nothing there', async () => {
    const user = userEvent.setup()
    const onRetryMachine = vi.fn()
    show([onDevbox(1, 'There', { status: 'working' })], { machines: [LOCAL_HEAD, DEVBOX_DOWN], onRetryMachine })
    const tag = screen.getByRole('button', { name: 'devbox, not connected' })
    expect(tag).toHaveAttribute('title', SENTENCE)
    await user.click(tag)
    expect(await screen.findByRole('menu', { name: 'devbox' })).toHaveTextContent(SENTENCE)
    await user.click(screen.getByRole('menuitem', { name: 'Retry' }))
    expect(onRetryMachine).toHaveBeenCalledWith('devbox')
    await user.click(screen.getByRole('button', { name: 'New session or worktree in api' }))
    expect(await screen.findByRole('menuitem', { name: /Claude/ })).toHaveAttribute('aria-disabled', 'true')
  })

  it('offers the one Install or Update when that is what the machine needs, and the command and sign-in when those are', async () => {
    const user = userEvent.setup()
    const onUpdateMachine = vi.fn()
    const onCopyCommand = vi.fn()
    const { again } = show([onDevbox(1, 'There')], { machines: [LOCAL_HEAD, { ...DEVBOX_DOWN, updateAction: 'update' }], onUpdateMachine, onCopyCommand })
    await user.click(screen.getByRole('button', { name: 'devbox, not connected' }))
    expect(screen.queryByRole('menuitem', { name: 'Retry' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Update Maiker' }))
    expect(onUpdateMachine).toHaveBeenCalledWith('devbox', 'update')
    again({ machines: [LOCAL_HEAD, { ...DEVBOX_DOWN, fixCommand: 'ssh-keygen -R devbox', failure: 'needs-person' }] })
    await user.click(screen.getByRole('button', { name: 'devbox, not connected' }))
    expect(screen.getByRole('menuitem', { name: 'Sign in in a terminal' })).toBeTruthy()
    await user.click(screen.getByRole('menuitem', { name: 'Copy the command' }))
    expect(onCopyCommand).toHaveBeenCalledWith('ssh-keygen -R devbox')
  })

  it('shows how far an update has got on the tag', () => {
    show([onDevbox(1, 'There')], { machines: [LOCAL_HEAD, DEVBOX_DOWN], updateProgress: { devbox: 40 } })
    expect(screen.getByRole('button', { name: 'devbox, updating, 40%' })).toBeTruthy()
  })
})

describe('a session row\'s menu', () => {
  it('holds Rename, New worktree, Open worktree, Copy path and Close session, and nothing else', () => {
    show([session(1, 'Shipped', { status: 'done' }), onDevbox(2, 'There', { status: 'working' })], { machines: [LOCAL_HEAD, DEVBOX], onNewWorktree: vi.fn(), onOpenWorktree: vi.fn() })
    for (const row of [/^Shipped,/, /^There,/]) {
      fireEvent.contextMenu(screen.getByRole('button', { name: row }))
      expect(menuItems()).toEqual(['Rename', 'New worktree', 'Open worktree…', 'Copy path', 'Close session…'])
    }
  })

  it('does each item\'s own action once, for the row it was opened on', async () => {
    const user = userEvent.setup()
    const calls = { onNewWorktree: vi.fn(), onOpenWorktree: vi.fn(), onCopyPath: vi.fn(), onEndSession: vi.fn() }
    show([session(1, 'One', { status: 'working', repo: 'shop' }), session(2, 'Two', { status: 'working', repo: 'shop' })], { ...calls, onSaveSessionName: vi.fn() })
    const pick = async (item: RegExp) => {
      fireEvent.contextMenu(screen.getByRole('button', { name: /^Two,/ }))
      await user.click(await screen.findByRole('menuitem', { name: item }))
    }
    await pick(/^New worktree/)
    await pick(/^Open worktree/)
    await pick(/^Copy path/)
    await pick(/^Close session/)
    for (const action of Object.values(calls)) {
      expect(action).toHaveBeenCalledTimes(1)
      expect(action).toHaveBeenCalledWith('t2')
    }
    await pick(/^Rename/)
    expect(await screen.findByRole('textbox', { name: 'Session name' })).toHaveValue('Two')
  })

  it('opens from the menu key or Shift+F10 on a focused row, moves with the arrows and closes on Escape back to the row', async () => {
    const user = userEvent.setup()
    show([session(1, 'One', { status: 'working', repo: 'shop' })], { onNewWorktree: vi.fn(), onOpenWorktree: vi.fn() })
    const row = screen.getByRole('button', { name: /^One,/ })
    act(() => { row.focus() })
    await user.keyboard('{ContextMenu}')
    await waitFor(() => { expect(screen.getByRole('menuitem', { name: /^Rename/ })).toHaveFocus() })
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: /^Close session/ })).toHaveFocus()
    await user.keyboard('{Home}{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: /^New worktree/ })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(row).toHaveFocus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(await screen.findByRole('menu', { name: 'One' })).toBeTruthy()
  })
})

describe('renaming a session in its row', () => {
  const renameOne = async (user: ReturnType<typeof userEvent.setup>) => {
    act(() => { screen.getByRole('button', { name: /^One,/ }).focus() })
    await user.keyboard('{F2}')
    const field = await screen.findByRole('textbox', { name: 'Session name' })
    await waitFor(() => { expect(field).toHaveFocus() })
    return field
  }

  it('saves the name typed on Enter and gives the row the keyboard back', async () => {
    const user = userEvent.setup()
    const onSaveSessionName = vi.fn()
    show([session(1, 'One', { status: 'working' })], { onSaveSessionName })
    const field = await renameOne(user)
    expect(field).toHaveValue('One')
    await user.clear(field)
    await user.keyboard('Fix the cart{Enter}')
    expect(onSaveSessionName).toHaveBeenCalledExactlyOnceWith('t1', 'Fix the cart')
    expect(screen.queryByRole('textbox', { name: 'Session name' })).toBeNull()
    expect(screen.getByRole('button', { name: /^One,/ })).toHaveFocus()
  })

  it('saves on leaving the field, and Escape changes nothing', async () => {
    const user = userEvent.setup()
    const onSaveSessionName = vi.fn()
    show([session(1, 'One', { status: 'working' })], { onSaveSessionName })
    await user.type(await renameOne(user), ' more')
    await user.keyboard('{Escape}')
    expect(onSaveSessionName).not.toHaveBeenCalled()
    await user.type(await renameOne(user), ' more')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(onSaveSessionName).toHaveBeenCalledExactlyOnceWith('t1', 'One more')
  })

  it('changes nothing for an empty or an unchanged name', async () => {
    const user = userEvent.setup()
    const onSaveSessionName = vi.fn()
    show([session(1, 'One', { status: 'working' })], { onSaveSessionName })
    await renameOne(user)
    await user.keyboard('{Enter}')
    await user.clear(await renameOne(user))
    await user.keyboard('{Enter}')
    expect(onSaveSessionName).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Session name' })).toBeNull()
  })

  it('asks the window to rename where it cannot save a name itself', async () => {
    const user = userEvent.setup()
    const onRenameSession = vi.fn()
    show([session(1, 'One', { status: 'working' })], { onRenameSession })
    act(() => { screen.getByRole('button', { name: /^One,/ }).focus() })
    await user.keyboard('{F2}')
    expect(onRenameSession).toHaveBeenCalledWith('t1')
  })
})

describe('the header and the foot', () => {
  it('collapses, searches, opens a project on this computer, adds a machine and opens Settings', async () => {
    const user = userEvent.setup()
    const calls = { onToggleRail: vi.fn(), onSearch: vi.fn(), onOpenProject: vi.fn(), onAddMachine: vi.fn(), onOpenSettings: vi.fn() }
    show([], calls)
    await user.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.click(screen.getByRole('button', { name: 'Open a project' }))
    await user.click(screen.getByRole('button', { name: 'Add a remote machine' }))
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(calls.onToggleRail).toHaveBeenCalledTimes(1)
    expect(calls.onSearch).toHaveBeenCalledTimes(1)
    expect(calls.onOpenProject).toHaveBeenCalledWith(null)
    expect(calls.onAddMachine).toHaveBeenCalledTimes(1)
    expect(calls.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('narrows the list to one project or one machine, and Reset shows everything again', async () => {
    const user = userEvent.setup()
    show([session(1, 'Here', { status: 'working' }), session(2, 'Docs', { status: 'working', cwd: '/home/me/docs' }), onDevbox(3, 'There', { status: 'working' })], { machines: [LOCAL_HEAD, DEVBOX] })
    const shown = () => screen.getAllByRole('list').map((list) => list.getAttribute('aria-label'))
    await user.click(screen.getByRole('button', { name: 'Sort and filter' }))
    await user.click(within(screen.getByRole('group', { name: 'Projects' })).getByRole('button', { name: /docs/ }))
    expect(shown()).toEqual(['docs'])
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(shown()).toHaveLength(3)
    await user.click(within(screen.getByRole('group', { name: 'Machines' })).getByRole('button', { name: /devbox/ }))
    expect(shown()).toEqual(['api'])
    expect(screen.getByRole('button', { name: 'Sort and filter (on)' })).toBeTruthy()
  })

  it('orders the projects as picked in its menu', async () => {
    const user = userEvent.setup()
    const onSort = vi.fn()
    show([session(1, 'Zed', { cwd: '/home/me/zoo' }), session(2, 'Alpha', { cwd: '/home/me/apps' })], { onSort, sort: 'name' })
    expect(screen.getAllByRole('list').map((list) => list.getAttribute('aria-label'))).toEqual(['apps', 'zoo'])
    await user.click(screen.getByRole('button', { name: 'Sort and filter' }))
    const sorts = within(screen.getByRole('group', { name: 'Sort by' }))
    expect(sorts.getByRole('button', { name: 'Name, A to Z' })).toHaveAttribute('aria-pressed', 'true')
    // Machine is offered only once there is more than this computer.
    expect(sorts.queryByRole('button', { name: 'Machine' })).toBeNull()
    await user.click(sorts.getByRole('button', { name: 'Recently opened' }))
    expect(onSort).toHaveBeenCalledWith('recent')
  })

  it('shows the project just opened whatever the filter said', async () => {
    const user = userEvent.setup()
    const { again } = show([session(1, 'Here', { status: 'working' }), session(2, 'Docs', { status: 'working', cwd: '/home/me/docs' })])
    await user.click(screen.getByRole('button', { name: 'Sort and filter' }))
    await user.click(within(screen.getByRole('group', { name: 'Projects' })).getByRole('button', { name: /docs/ }))
    await user.keyboard('{Escape}')
    again({ selectedProject: SHOP })
    expect(screen.getByRole('list', { name: 'shop' })).toBeTruthy()
  })
})

describe('the rail of a narrow window', () => {
  const railMarks = (project: string) => within(screen.getByRole('list', { name: project })).getAllByRole('button').map((button) => button.getAttribute('aria-label')?.split(' · ')[0])

  it('lists each project with something going on as one mark per session, in the sidebar\'s order, and leaves the idle ones out', async () => {
    const user = userEvent.setup()
    const onShowSession = vi.fn()
    show([session(1, 'Quiet'), session(2, 'Busy', { status: 'working' }), session(4, 'Shipped', { status: 'done' }), session(3, 'Asking', { status: 'needs-you', cwd: '/home/me/docs' })], { mode: 'rail', onShowSession })
    expect(screen.getAllByRole('list').map((list) => list.getAttribute('aria-label'))).toEqual(['docs', 'shop'])
    expect(railMarks('docs')).toEqual(['Asking'])
    expect(railMarks('shop')).toEqual(['Busy', 'Shipped'])
    await user.click(screen.getByRole('button', { name: /^Busy/ }))
    expect(onShowSession).toHaveBeenCalledWith('t2')
  })

  it('shows a lead for its helpers, saying how many of them need you', () => {
    show([session(1, 'Lead', { status: 'working' }), session(2, 'Cache', { status: 'needs-you', ...startedBy('t1') }), session(3, 'Resize', { status: 'working', ...startedBy('t1') })], { mode: 'rail' })
    expect(railMarks('shop')).toEqual(['Lead'])
    expect(screen.getByRole('button', { name: /^Lead · .*2 helpers, 1 needs you$/ })).toBeTruthy()
  })

  it('keeps the session on screen listed when looking at it turns done into idle', () => {
    const { again } = show([session(1, 'Shipped', { status: 'done' })], { mode: 'rail', focusedId: 't1' })
    const sessions = [session(1, 'Shipped')]
    again({ sessions, projects: groupByProject(sessions, []).machines })
    expect(railMarks('shop')).toEqual(['Shipped'])
  })

  it('opens the row\'s menu from the keyboard, and Rename asks the window', async () => {
    const user = userEvent.setup()
    const onRenameSession = vi.fn()
    show([session(2, 'Busy', { status: 'working' })], { mode: 'rail', onRenameSession, onSaveSessionName: vi.fn() })
    screen.getByRole('button', { name: /^Busy/ }).focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    await user.click(screen.getByRole('menuitem', { name: /^Rename/ }))
    expect(onRenameSession).toHaveBeenCalledWith('t2')
  })

  it('keeps its own buttons: expand at the top, Open a project and Settings at the foot', async () => {
    const user = userEvent.setup()
    const calls = { onToggleRail: vi.fn(), onOpenProject: vi.fn(), onOpenSettings: vi.fn() }
    show([], { mode: 'rail', ...calls })
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    await user.click(screen.getByRole('button', { name: 'Open a project' }))
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(calls.onToggleRail).toHaveBeenCalledTimes(1)
    expect(calls.onOpenProject).toHaveBeenCalledWith(null)
    expect(calls.onOpenSettings).toHaveBeenCalledTimes(1)
  })
})

/** The props of a plain sidebar over `sessions`, for a test that mounts it twice. */
function propsOf(sessions: SessionView[]): SidebarProps {
  const none = () => undefined
  return {
    sessions, listed: true, machines: [LOCAL_HEAD], projects: groupByProject(sessions, []).machines, opened: groupByProject(sessions, []).opened, sort: 'recent', onSort: none, selectedProject: null, installedAgents: null, focusedId: null, mode: 'docked', online: true, canStart: true, portalContainer: null,
    onToggleRail: none, side: 'left', width: 264, onResize: none, onResizeEnd: none, onSearch: none,
    onOpenProject: none, onAddMachine: none, onMachineSettings: none, onRetryMachine: none, onSignInMachine: none, onCopyCommand: none, onRenameMachine: none, onUpdateMachine: none, onShowSession: none, onRenameSession: none,
    onCopyPath: none, onEndSession: none, onOpenSettings: none,
  }
}
