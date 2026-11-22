import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/data/preview'
import { currentToasts, resetToasts } from '@/lib/toast'
import { LOCAL_HEAD, type MachineHead } from '../model/machines'
import { closeProject, groupByProject, type OpenedProject } from '../model/openedProjects'
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
    onClose: vi.fn((project: OpenedProject) => closeProject(grouping.opened, project, sessions)),
  } satisfies ProjectActions
  const props: SidebarProps = {
    sessions, listed: true, machines: [LOCAL_HEAD], projects: grouping.machines, selectedProject: null, installedAgents: ['claude', 'codex', 'gemini'], focusedId: null, mode: 'docked', online: true, canStart: true, portalContainer: null,
    onToggleRail: none, side: 'left', width: 264, onResize: none, onResizeEnd: none, onSearch: none, projectActions,
    onOpenProject: none, onAddMachine: none, onMachineSettings: none, onRetryMachine: none, onSignInMachine: none, onCopyCommand: none, onRenameMachine: none, onUpdateMachine: none, onShowSession: none, onRenameSession: none,
    onSplitSession: none, onCopyPath: none, onShowChanges: none, onMarkDone: none, onGetFile: none, onEndSession: none, onOpenSettings: none,
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
const idleSection = () => screen.getByRole('region', { name: /^(Idle|Projects)$/ })
const heading = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, \\d+ sessions?$`) })
/** What each row of the open menu says, without its mark and its key, which are hidden from a screen reader. */
const menuItems = () => screen.getAllByRole('menuitem').map((item) => {
  const spoken = item.cloneNode(true) as HTMLElement
  spoken.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => { hidden.remove() })
  return spoken.textContent
})

describe('the list', () => {
  it('lists the projects with something going on, the most urgent first, and each session with its status in its name', () => {
    show([session(1, 'Tidy up', { status: 'working', cwd: '/home/me/docs' }), session(2, 'Which key?', { status: 'needs-you' }), session(3, 'Shipped', { status: 'done' })])
    const lists = screen.getAllByRole('list').map((list) => list.getAttribute('aria-label'))
    expect(lists).toEqual(['shop', 'docs'])
    expect(rowsIn(screen.getByRole('list', { name: 'shop' }))).toEqual(['Which key?', 'Shipped'])
    expect(screen.getByRole('button', { name: 'Which key?, claude, needs you' })).toBeTruthy()
    expect(heading('shop')).toHaveAccessibleName('shop, 2 sessions')
  })

  it('keeps a helper under the session that started it', () => {
    show([session(1, 'Lead', { status: 'working' }), session(2, 'Helper', { status: 'working', ...startedBy('t1') }), session(3, 'Other', { status: 'needs-you' })])
    expect(rowsIn(screen.getByRole('list', { name: 'shop' }))).toEqual(['Other', 'Lead', 'Helper'])
    expect(screen.getByRole('button', { name: 'Helper, claude, helper of Lead, working' })).toBeTruthy()
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

  it('reaches a row from the keyboard, and F2 asks to rename it', async () => {
    const user = userEvent.setup()
    const onRenameSession = vi.fn()
    const onShowSession = vi.fn()
    show([session(1, 'One', { status: 'working' })], { onRenameSession, onShowSession })
    act(() => { screen.getByRole('button', { name: /^One,/ }).focus() })
    await user.keyboard('{F2}')
    expect(onRenameSession).toHaveBeenCalledWith('t1')
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

describe('the Idle section', () => {
  it('holds every idle session under its project with a count, and the project with no session', () => {
    show([session(1, 'Busy', { status: 'working' }), session(2, 'Quiet'), session(3, 'Old notes', { cwd: '/home/me/docs' })], {}, [NOTES])
    const idle = idleSection()
    expect(within(idle).getByRole('button', { name: /^Idle\s*2$/, expanded: true })).toBeTruthy()
    expect(rowsIn(idle)).toEqual(expect.arrayContaining(['Quiet', 'Old notes']))
    expect(rowsIn(idle)).not.toContain('Busy')
    expect(within(idle).getByRole('button', { name: 'notes, no sessions' })).toBeTruthy()
    // The project with both kinds is in both places.
    expect(rowsIn(screen.getByRole('list', { name: 'shop' }))).toEqual(['Busy'])
    expect(rowsIn(within(idle).getByRole('list', { name: 'Idle in shop' }))).toEqual(['Quiet'])
  })

  it('folds from its heading and stays folded after a restart', async () => {
    const user = userEvent.setup()
    const sessions = [session(1, 'Quiet')]
    const first = render(<Sidebar {...propsOf(sessions)} />)
    await user.click(within(idleSection()).getByRole('button', { name: /^Idle/, expanded: true }))
    expect(within(idleSection()).getByRole('button', { name: /^Idle/, expanded: false })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Quiet,/ })).toBeNull()
    first.unmount()
    render(<Sidebar {...propsOf(sessions)} />)
    expect(within(idleSection()).getByRole('button', { name: /^Idle/, expanded: false })).toBeTruthy()
  })

  it('lists a session that stopped or whose machine is out of reach, so none goes missing', () => {
    show([session(1, 'Crashed', { status: 'recovery' }), session(2, 'Far away', { status: 'unknown' })])
    expect(within(idleSection()).getByRole('button', { name: 'Crashed, claude, stopped' })).toBeTruthy()
    expect(within(idleSection()).getByRole('button', { name: 'Far away, claude, offline' })).toBeTruthy()
  })

  it('is headed Projects while it only lists projects with no session', () => {
    show([], {}, [NOTES])
    expect(within(idleSection()).getByRole('button', { name: 'Projects', expanded: true })).toBeTruthy()
  })
})

describe('a project heading', () => {
  it('folds its sessions, says so while one of them needs you, and keeps the fold after a restart', async () => {
    const user = userEvent.setup()
    const sessions = [session(1, 'Which key?', { status: 'needs-you' })]
    const first = render(<Sidebar {...propsOf(sessions)} />)
    expect(screen.queryByRole('img', { name: 'Something here needs you' })).toBeNull()
    await user.click(heading('shop'))
    expect(heading('shop')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /^Which key\?,/ })).toBeNull()
    expect(screen.getByRole('img', { name: 'Something here needs you' })).toBeTruthy()
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
    expect(menuItems()).toEqual(['New session', 'New worktree…', 'Copy path', 'Show files', 'Remove from sidebar…'])
    await user.click(screen.getByRole('menuitem', { name: /New session/ }))
    expect(projectActions.onNewSession).toHaveBeenLastCalledWith(4, API)
    fireEvent.contextMenu(heading('api'))
    await user.click(await screen.findByRole('menuitem', { name: 'Copy path' }))
    expect(projectActions.onCopyPath).toHaveBeenCalledWith(API)
    fireEvent.contextMenu(heading('api'))
    await user.click(await screen.findByRole('menuitem', { name: 'Show files' }))
    expect(projectActions.onShowFiles).toHaveBeenCalledWith('t1')
  })

  it('offers no worktree in a project whose sessions run outside git', async () => {
    const user = userEvent.setup()
    show([session(1, 'One', { status: 'working' })])
    await user.click(screen.getByRole('button', { name: 'New session or worktree in shop' }))
    await screen.findByRole('menu', { name: 'New in shop' })
    expect(menuItems()).toEqual(['Claude', 'Codex', 'Gemini', 'Terminal'])
  })

  it('removes a project with no running session and says nothing', async () => {
    const user = userEvent.setup()
    const { projectActions } = show([], {}, [NOTES])
    fireEvent.contextMenu(screen.getByRole('button', { name: 'notes, no sessions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from sidebar…' }))
    expect(projectActions.onClose).toHaveBeenCalledWith(NOTES, 'notes')
    expect(currentToasts().items).toHaveLength(0)
  })

  it('refuses to remove a project a session runs in, and says so', async () => {
    const user = userEvent.setup()
    const { projectActions } = show([session(1, 'One', { status: 'working' })])
    fireEvent.contextMenu(heading('shop'))
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from sidebar…' }))
    expect(projectActions.onClose.mock.results[0]?.value).toMatchObject({ ok: false, error: { code: 'sessions-running' } })
    expect(currentToasts().items).toHaveLength(1)
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
  it('renames, opens beside the focused pane and closes, and offers Mark as done on a finished agent only', async () => {
    const user = userEvent.setup()
    const onRenameSession = vi.fn()
    const onSplitSession = vi.fn()
    const onMarkDone = vi.fn()
    show([session(1, 'Shipped', { status: 'done' }), session(2, 'Busy', { status: 'working' })], { onRenameSession, onSplitSession, onMarkDone })
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Busy,/ }))
    expect(menuItems()).toEqual(expect.arrayContaining(['Rename', 'Open in a new pane', 'Copy folder path', 'Close session']))
    expect(menuItems()).not.toContain('Mark as done')
    await user.click(screen.getByRole('menuitem', { name: /Open in a new pane/ }))
    expect(onSplitSession).toHaveBeenCalledWith('t2', 'right')
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Shipped,/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Mark as done' }))
    expect(onMarkDone).toHaveBeenCalledWith('t1')
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Shipped,/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Rename/ }))
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
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(within(screen.getByRole('group', { name: 'Projects' })).getByRole('button', { name: /docs/ }))
    expect(shown()).toEqual(['docs'])
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(shown()).toHaveLength(3)
    await user.click(within(screen.getByRole('group', { name: 'Machines' })).getByRole('button', { name: /devbox/ }))
    expect(shown()).toEqual(['api'])
    expect(screen.getByRole('button', { name: 'Filter (on)' })).toBeTruthy()
  })

  it('shows the project just opened whatever the filter said', async () => {
    const user = userEvent.setup()
    const { again } = show([session(1, 'Here', { status: 'working' }), session(2, 'Docs', { status: 'working', cwd: '/home/me/docs' })])
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(within(screen.getByRole('group', { name: 'Projects' })).getByRole('button', { name: /docs/ }))
    await user.keyboard('{Escape}')
    again({ selectedProject: SHOP })
    expect(screen.getByRole('list', { name: 'shop' })).toBeTruthy()
  })
})

describe('the rail of a narrow window', () => {
  it('lists every session as a mark in the sidebar\'s order, the idle ones after a divider, and keeps its buttons', async () => {
    const user = userEvent.setup()
    const onShowSession = vi.fn()
    const onAddMachine = vi.fn()
    show([session(1, 'Quiet'), session(2, 'Busy', { status: 'working' }), session(3, 'Asking', { status: 'needs-you', cwd: '/home/me/docs' })], { mode: 'rail', onShowSession, onAddMachine })
    const list = screen.getByRole('list', { name: 'Sessions' })
    expect(within(list).getAllByRole('button').map((button) => button.getAttribute('aria-label')?.split(' · ')[0])).toEqual(['Asking', 'Busy', 'Quiet'])
    expect(within(list).getByRole('separator')).toBeTruthy()
    await user.click(within(list).getByRole('button', { name: /^Busy/ }))
    expect(onShowSession).toHaveBeenCalledWith('t2')
    await user.click(screen.getByRole('button', { name: 'Add a remote machine' }))
    expect(onAddMachine).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy()
  })
})

/** The props of a plain sidebar over `sessions`, for a test that mounts it twice. */
function propsOf(sessions: SessionView[]): SidebarProps {
  const none = () => undefined
  return {
    sessions, listed: true, machines: [LOCAL_HEAD], projects: groupByProject(sessions, []).machines, selectedProject: null, installedAgents: null, focusedId: null, mode: 'docked', online: true, canStart: true, portalContainer: null,
    onToggleRail: none, side: 'left', width: 264, onResize: none, onResizeEnd: none, onSearch: none,
    onOpenProject: none, onAddMachine: none, onMachineSettings: none, onRetryMachine: none, onSignInMachine: none, onCopyCommand: none, onRenameMachine: none, onUpdateMachine: none, onShowSession: none, onRenameSession: none,
    onSplitSession: none, onCopyPath: none, onShowChanges: none, onMarkDone: none, onGetFile: none, onEndSession: none, onOpenSettings: none,
  }
}
