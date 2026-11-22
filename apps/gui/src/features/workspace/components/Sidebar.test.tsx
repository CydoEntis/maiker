import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/data/preview'
import { writeSidebarFolds } from '@/data/sidebarFolds'
import { currentToasts, resetToasts } from '@/lib/toast'
import { LOCAL_HEAD, type MachineHead } from '../model/machines'
import { closeProject, groupByProject, type OpenedProject } from '../model/openedProjects'
import { machineFoldKey } from '../model/sidebarTree'
import { toSessionView, type SessionView } from '../model/session'
import { Sidebar, type SidebarProps } from './Sidebar'
import { flipKey } from './flipKey'
import type { ProjectActions } from './projectMenu'

vi.mock('@/api/daemon', () => ({ terminalOf: (id: string) => Number(id.slice(id.indexOf('t') + 1)) }))

const DEVBOX: MachineHead = { ...LOCAL_HEAD, key: 'machine-4', machine: 4, name: 'devbox', label: 'devbox', chip: { glyph: '●', word: 'connected', tone: 'ok' } }

/** A session as the daemon reports it. `extra` sets what the daemon says of it. */
function session(pane: number, extra: Partial<Conversation> = {}): SessionView {
  const cwd = extra.cwd ?? `/home/me/app${String(pane)}`
  return toSessionView(
    { id: `t${String(pane)}`, generation: 0, kind: 'terminal', title: '', project: '', folder: cwd, cwd, repo: null, branch: 'working tree', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: null, ...extra },
    '/home/me',
  )
}


function show(sessions: SessionView[], more: Partial<SidebarProps> = {}) {
  const none = vi.fn()
  const props: SidebarProps = {
    sessions, listed: true, machines: [LOCAL_HEAD], projects: groupByProject(sessions, []).machines, selectedProject: null, statusHeadings: true, focusedId: null, mode: 'docked', online: true, canStart: true, portalContainer: null,
    onToggleRail: none, side: 'left', width: 264, onResize: none, onResizeEnd: none, onSearch: none,
    onOpenProject: none, onNewShell: none, onAddMachine: none, onMachineSettings: none, onRetryMachine: none, onSignInMachine: none, onCopyCommand: none, onRenameMachine: none, onUpdateMachine: none, onShowSession: none, onRenameSession: none,
    onSplitSession: none, onCopyPath: none, onCopyText: none, onShowChanges: none, onMarkDone: none, onBringBack: none, onUnsnooze: none, onGetFile: none,
    onEndSession: none, onOpenSettings: none, onRecentSessions: none,
    ...more,
  }
  const view = render(<Sidebar {...props} />)
  // Draws the same sidebar again with some props changed, as the window does when the selection moves.
  return { ...view, again: (next: Partial<SidebarProps>) => { view.rerender(<Sidebar {...props} {...next} />) } }
}

// Folded headings are kept in this window's storage; each test starts with none.
beforeEach(() => { localStorage.clear() })

const rows = () => screen.getAllByRole('button', { name: /, (idle|working|needs you|done|stopped|offline)$/ })
const names = () => rows().map((row) => row.getAttribute('aria-label')?.split(',')[0])

describe('the sidebar', () => {
  it('groups sessions by machine, this computer first, each with its count', () => {
    show([session(1, { agent: 'claude', named: true, title: 'Here' }), session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, DEVBOX] })
    const here = screen.getByRole('group', { name: 'Projects on This computer' })
    const there = screen.getByRole('group', { name: 'Projects on devbox' })
    expect(within(here).getByRole('button', { name: /^Here,/ })).toBeTruthy()
    expect(within(there).getByRole('button', { name: /^There,/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^This computer/, expanded: true })).toHaveTextContent('1')
  })
})

describe('a machine that needs maiker installed or updated', () => {
  const needing = (action: MachineHead['updateAction']): MachineHead => ({ ...DEVBOX, chip: { glyph: '▲', word: 'needs update', tone: 'bad' }, down: true, updateAction: action })
  const machineMenuItems = () => {
    fireEvent.contextMenu(screen.getByRole('button', { name: /^devbox/ }))
    return within(screen.getByRole('menu', { name: 'devbox' })).getAllByRole('menuitem').map((item) => item.textContent)
  }

  it('offers one Install button when it is down, which asks to install, and its dot says it is not installed', async () => {
    const user = userEvent.setup()
    const onUpdateMachine = vi.fn()
    show([], { machines: [LOCAL_HEAD, needing('install')], onUpdateMachine })
    expect(screen.getByRole('img', { name: /^devbox is / })).toHaveClass('is-warn')
    expect(screen.queryByRole('button', { name: 'Retry devbox' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Install Maiker on devbox' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Install Maiker on devbox' }))
    expect(onUpdateMachine).toHaveBeenCalledWith('devbox', 'install')
  })

  it('offers Update in its header for another version, and offers Update Maiker in its menu', async () => {
    const user = userEvent.setup()
    const onUpdateMachine = vi.fn()
    show([session(1)], { machines: [LOCAL_HEAD, needing('update')], onUpdateMachine })
    expect(screen.getByRole('img', { name: 'devbox is needs update' })).toHaveClass('is-warn')
    expect(screen.getByRole('button', { name: 'Update Maiker on devbox' })).toBeInTheDocument()
    expect(machineMenuItems()).toContain('Update Maiker')
    await user.click(screen.getByRole('menuitem', { name: 'Update Maiker' }))
    expect(onUpdateMachine).toHaveBeenCalledWith('devbox', 'update')
  })

  it('shows how far its update has got in the header, in place of the Update button', () => {
    show([], { machines: [LOCAL_HEAD, needing('update')], updateProgress: { devbox: 55 } })
    expect(screen.getByText('55%')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update Maiker on devbox' })).toBeNull()
    expect(screen.getByRole('progressbar', { name: 'Updating devbox' })).toHaveAttribute('aria-valuenow', '55')
  })
})

describe('a session row', () => {

  it('offers Mark as done on a finished agent only, and asks for that session', async () => {
    const onMarkDone = vi.fn()
    show([session(1, { agent: 'claude', named: true, title: 'Finished', status: 'done' }), session(2, { agent: 'claude', named: true, title: 'Busy', status: 'working' })], { onMarkDone })
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Busy,/ }))
    expect(screen.queryByRole('menuitem', { name: 'Mark as done' })).toBeNull()
    await userEvent.keyboard('{Escape}')
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Finished,/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark as done' }))
    expect(onMarkDone).toHaveBeenCalledWith('t1')
  })

  it('offers Bring back in the menu of a put-away session', async () => {
    const onBringBack = vi.fn()
    show([session(1, { agent: 'claude', named: true, title: 'Away', archived: true })], { onBringBack })
    await userEvent.click(screen.getByRole('button', { name: /^Put away/ }))
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Away,/ }))
    expect(screen.queryByRole('menuitem', { name: 'Put away' })).toBeNull()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Bring back' }))
    expect(onBringBack).toHaveBeenCalledWith('t1')
  })

  describe('snoozing', () => {
    const UNTIL = new Date(2026, 0, 5, 14, 5).getTime()
    const withDetails = (extra: object) => ({ asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, ...extra })

    it('lists a snoozed session under Put away with when it returns, and Unsnooze wakes it', async () => {
      const onUnsnooze = vi.fn()
      const snoozed = toSessionView({ ...session(1, { agent: 'claude', named: true, title: 'Napping', status: 'done', details: withDetails({ snoozedUntil: UNTIL / 1000 }) }).conversation }, '/home/me', UNTIL - 3_600_000)
      // Which day it names depends on when the test runs; the clock is the point.
      show([snoozed, session(2, { agent: 'claude', named: true, title: 'Here' })], { onUnsnooze })
      expect(names()).toEqual(['Here'])
      await userEvent.click(screen.getByRole('button', { name: /^Put away/ }))
      const list = screen.getByRole('list', { name: 'Put away' })
      expect(within(list).getByRole('button', { name: /^Napping,/ })).toHaveTextContent(/until (\w{3} )?14:05/)
      fireEvent.contextMenu(within(list).getByRole('button', { name: /^Napping,/ }))
      expect(screen.queryByRole('menuitem', { name: 'Bring back' })).toBeNull()
      expect(screen.queryByRole('menuitem', { name: 'Put away' })).toBeNull()
      await userEvent.click(screen.getByRole('menuitem', { name: 'Unsnooze' }))
      expect(onUnsnooze.mock.calls).toEqual([['t1']])
    })
  })

  it('offers Get a file on a session of another machine, and asks for that session', async () => {
    const user = userEvent.setup()
    const onGetFile = vi.fn()
    show([session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, DEVBOX], onGetFile })
    fireEvent.contextMenu(screen.getByRole('button', { name: /^There,/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Get a file…' }))
    expect(onGetFile).toHaveBeenCalledWith('t2')
  })

  it('asks for the rename dialog from the menu, and a double click renames nothing in place', async () => {
    const onRenameSession = vi.fn()
    show([session(1, { agent: 'claude', named: true, title: 'Growth' })], { onRenameSession })
    fireEvent.doubleClick(screen.getByRole('button', { name: /^Growth,/ }))
    expect(onRenameSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Session name' })).toBeNull()
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Growth,/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^Rename/ }))
    expect(onRenameSession).toHaveBeenCalledWith('t1')
  })

  it('opens a session in a new pane beside the focused one from its menu', async () => {
    const onSplitSession = vi.fn()
    show([session(1, { agent: 'claude', named: true, title: 'Growth' }), session(2)], { focusedId: 't2', onSplitSession })
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Growth,/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open in a new pane' }))
    expect(onSplitSession).toHaveBeenCalledWith('t1', 'right')
  })

  describe('whose agent started helpers', () => {
    const startedBy = (id: string) => ({ details: { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, startedBy: id } })
    const lead = () => session(1, { agent: 'claude', named: true, title: 'Growth', status: 'working' })
    const helper = (pane: number, title: string, extra: Partial<Conversation> = {}) => session(pane, { agent: 'codex', named: true, title, status: 'working', cwd: '/home/me/app1', ...startedBy('t1'), ...extra })

    it('says how many helpers wait on you, in the needs-you colour', () => {
      show([lead(), helper(2, 'Review the diff', { status: 'needs-you' }), helper(3, 'Write the tests')])
      const growth = screen.getByRole('button', { name: 'Growth, claude, 2 helpers, 1 needs you, working' })
      expect(growth.querySelector('.mx-row-helpers')?.classList.contains('is-needs')).toBe(true)
    })
  })
})

describe('a machine heading', () => {
  it('opens a project on its machine from its own + and its right-click menu, and offers a terminal there', async () => {
    const user = userEvent.setup()
    const onOpenProject = vi.fn()
    const onNewShell = vi.fn()
    show([session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, DEVBOX], onOpenProject, onNewShell })
    await user.click(screen.getByRole('button', { name: 'Open a project on This computer' }))
    expect(onOpenProject).toHaveBeenLastCalledWith(0)
    await user.click(screen.getByRole('button', { name: 'Open a project on devbox' }))
    expect(onOpenProject).toHaveBeenLastCalledWith(4)
    onOpenProject.mockClear()
    fireEvent.contextMenu(screen.getByRole('button', { name: /^devbox/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Open a project…' }))
    expect(onOpenProject).toHaveBeenCalledWith(4)
    fireEvent.contextMenu(screen.getByRole('button', { name: /^devbox/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'New terminal here' }))
    expect(onNewShell).toHaveBeenCalledWith(4)
  })

  it('lists a connected saved machine with no sessions: its name, its own + and "No sessions yet"', () => {
    show([], { machines: [LOCAL_HEAD, DEVBOX] })
    expect(screen.getByRole('button', { name: /^devbox/ })).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open a project on devbox' }).disabled).toBe(false)
    expect(within(screen.getByRole('group', { name: 'Projects on devbox' }).parentElement as HTMLElement).getByText('No sessions yet')).toBeTruthy()
  })

  it('shows a machine that is not up with its sentence under the heading and Retry, which dials it again, and offers no new session on it', async () => {
    const user = userEvent.setup()
    const onRetryMachine = vi.fn()
    const why = "Can't reach devbox: check the name or address, and that the machine is on (Connection refused)."
    show([], { machines: [LOCAL_HEAD, { ...DEVBOX, down: true, why, failure: 'unreachable', chip: { glyph: '✕', word: 'unreachable', tone: 'bad' } }], onRetryMachine })
    const line = screen.getByRole('group', { name: 'Why devbox is not connected' })
    expect(within(line).getByText(why)).toBeTruthy()
    expect(within(line).queryByRole('button', { name: 'Copy the command' })).toBeNull()
    expect(within(line).queryByRole('button', { name: 'Sign in in a terminal' })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open a project on devbox' }).disabled).toBe(true)
    await user.click(within(line).getByRole('button', { name: 'Retry devbox' }))
    expect(onRetryMachine).toHaveBeenCalledWith('devbox')
  })

  it('offers Copy for the command its sentence names, the whole command', async () => {
    const user = userEvent.setup()
    const onCopyCommand = vi.fn()
    const command = 'ssh-copy-id cydo@devbox.example.internal'
    const why = `devbox refused your key: run \`${command}\` in a terminal, then try again.`
    show([], { machines: [LOCAL_HEAD, { ...DEVBOX, down: true, why, failure: 'key-refused', fixCommand: command, chip: { glyph: '✕', word: 'needs login', tone: 'bad' } }], onCopyCommand })
    const line = screen.getByRole('group', { name: 'Why devbox is not connected' })
    expect(within(line).getByText(why)).toBeTruthy()
    expect(within(line).getByRole('button', { name: 'Retry devbox' })).toBeTruthy()
    expect(within(line).queryByRole('button', { name: 'Sign in in a terminal' })).toBeNull()
    await user.click(within(line).getByRole('button', { name: 'Copy the command' }))
    expect(onCopyCommand).toHaveBeenCalledWith(command)
  })

  it('says a changed host key in the host\'s sentence, with Copy for the command that clears it and Retry, never Trust', async () => {
    const user = userEvent.setup()
    const onCopyCommand = vi.fn()
    const command = "ssh-keygen -R 'devbox.example'"
    const why = `devbox's host key has changed, so Maiker won't connect: confirm with whoever runs it that the change is expected, then run \`${command}\` in a terminal and try again.`
    show([], { machines: [LOCAL_HEAD, { ...DEVBOX, down: true, why, failure: 'host-key-changed', fixCommand: command, said: 'Host key verification failed.', chip: { glyph: '✕', word: 'needs login', tone: 'bad' } }], onCopyCommand })
    const line = screen.getByRole('group', { name: 'Why devbox is not connected' })
    expect(within(line).getByText(why)).toBeTruthy()
    expect(within(line).getByRole('button', { name: 'Retry devbox' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Trust/ })).toBeNull()
    await user.click(within(line).getByRole('button', { name: 'Copy the command' }))
    expect(onCopyCommand).toHaveBeenCalledWith(command)
  })

  it('offers a terminal sign-in only for a login that needs a person', async () => {
    const user = userEvent.setup()
    const onSignInMachine = vi.fn()
    show([], { machines: [LOCAL_HEAD, { ...DEVBOX, down: true, why: "devbox asks for a password or a second code, which Maiker can't answer: set up a key, or sign in in a terminal.", failure: 'needs-person', chip: { glyph: '✕', word: 'needs login', tone: 'bad' } }], onSignInMachine })
    const line = screen.getByRole('group', { name: 'Why devbox is not connected' })
    expect(within(line).getByRole('button', { name: 'Retry devbox' })).toBeTruthy()
    await user.click(within(line).getByRole('button', { name: 'Sign in in a terminal' }))
    expect(onSignInMachine).toHaveBeenCalledWith(4, 'devbox')
  })
})

describe('closing a session', () => {
  it('has no close button on a row: it is in the right-click menu, where a shell says Close shell and an agent Close session', async () => {
    const onEndSession = vi.fn()
    show([session(1, { agent: 'claude', named: true, title: 'Growth' }), session(2, { named: true, title: 'Shell' })], { onEndSession })
    expect(screen.queryByRole('button', { name: /^(Stop|Close) / })).toBeNull()
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Growth,/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^Close session/ }))
    expect(onEndSession).toHaveBeenLastCalledWith('t1')
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Shell,/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^Close shell/ }))
    expect(onEndSession).toHaveBeenLastCalledWith('t2')
  })
})

describe('a draft chat', () => {

  it('is a button that opens the draft again when it is set aside with text in it', async () => {
    const onOpen = vi.fn()
    show([], { draft: { machine: 0, process: 'claude', onOpen } })
    expect(screen.queryByRole('status', { name: /New session/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^New session draft/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

describe('with nothing running', () => {

  it('says nothing is running only once the daemon has listed its sessions', () => {
    show([], { listed: false })
    expect(screen.queryByText('No agents running. New chat starts one.')).toBeNull()
    expect(screen.getByText('Looking for your sessions…')).toBeTruthy()
  })
})

describe('with this computer alone', () => {
  const SHOP = { cwd: '/home/me/shop', folder: '/home/me/shop' }

  it('folds a project, with its counts on the folded heading, and shows the projects whatever its machine\'s fold was', async () => {
    writeSidebarFolds([machineFoldKey(null)])
    show([session(1, { ...SHOP, agent: 'claude', status: 'needs-you' }), session(2, { ...SHOP, agent: 'claude', status: 'done' })])
    expect(screen.getByRole('group', { name: 'Projects' }).closest('[inert]')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'shop', expanded: true }))
    const head = screen.getByRole('button', { name: /^shop/, expanded: false })
    expect(within(head).getByRole('img', { name: '1 session needs you' })).toBeInTheDocument()
    expect(within(head).getByRole('img', { name: '1 finished session not opened yet' })).toBeInTheDocument()
  })
})

describe('the tree of machine, project and status', () => {
  const SHOP = { cwd: '/home/me/shop', folder: '/home/me/shop' }

  it('folds a machine and a project from their headings, and keeps the folds after a restart', async () => {
    const user = userEvent.setup()
    const sessions = [session(1, { ...SHOP, agent: 'claude', named: true, title: 'Here' }), session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })]
    show(sessions, { machines: [LOCAL_HEAD, DEVBOX] })
    await user.click(screen.getByRole('button', { name: 'shop', expanded: true }))
    await user.click(screen.getByRole('button', { name: /^devbox/, expanded: true }))
    cleanup()
    // A new window, as after a restart: the machine's number may differ, its name does not.
    show(sessions, { machines: [LOCAL_HEAD, { ...DEVBOX, key: 'machine-7', machine: 7 }] })
    expect(screen.getByRole('button', { name: 'shop' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /^devbox/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /^This computer/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('unfolds the selected project and its machine, and marks the project, compared by folder and not by identity', async () => {
    const user = userEvent.setup()
    const sessions = [session(1, { ...SHOP, agent: 'claude', named: true, title: 'Here' }), session(2, { agent: 'claude', named: true, title: 'Elsewhere', cwd: '/home/me/docs', folder: '/home/me/docs' })]
    const view = show(sessions, { machines: [LOCAL_HEAD, DEVBOX] })
    await user.click(screen.getByRole('button', { name: 'shop', expanded: true }))
    await user.click(screen.getByRole('button', { name: /^This computer/, expanded: true }))
    const picked: OpenedProject = { machineName: null, folder: '/home/me/shop/' }
    view.again({ selectedProject: picked })
    expect(screen.getByRole('button', { name: /^This computer/ })).toHaveAttribute('aria-expanded', 'true')
    const shop = screen.getByRole('button', { name: 'shop' })
    expect(shop).toHaveAttribute('aria-expanded', 'true')
    expect(shop).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'docs' })).not.toHaveAttribute('aria-current')
    // Folding it again holds while the same project stays selected.
    await user.click(shop)
    expect(screen.getByRole('button', { name: 'shop' })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('the Needs you strip', () => {
  const NOW = Math.floor(Date.now() / 1000)
  const changed = (ago: number) => ({ details: { since: NOW - ago } as NonNullable<Conversation['details']> })
  /** Two sessions asking on different machines, in two projects, and one at work. */
  const asking = () => [
    session(1, { agent: 'claude', named: true, title: 'Older ask', status: 'needs-you', cwd: '/home/me/shop', folder: '/home/me/shop', ...changed(600) }),
    session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'Newer ask', status: 'needs-you', cwd: '/srv/api', folder: '/srv/api', ...changed(20) }),
    session(3, { agent: 'claude', named: true, title: 'Busy', status: 'working', cwd: '/home/me/shop', folder: '/home/me/shop', ...changed(5) }),
  ]
  const strip = () => screen.getByRole('region', { name: 'Needs you' })
  const stripRows = () => within(strip()).getAllByRole('button')

  it('lists every session that needs you, the latest first, with its name, machine and project, whatever is folded', async () => {
    const user = userEvent.setup()
    show(asking(), { machines: [LOCAL_HEAD, DEVBOX] })
    await user.click(screen.getByRole('button', { name: 'shop', expanded: true }))
    await user.click(screen.getByRole('button', { name: /^devbox/, expanded: true }))
    expect(stripRows().map((row) => row.getAttribute('aria-label'))).toEqual(['Newer ask on devbox in api', 'Older ask on This computer in shop'])
    expect(stripRows().map((row) => row.querySelector('.mx-row-sub')?.textContent)).toEqual(['devbox·api', 'This computer·shop'])
    expect(within(strip()).getByText('2')).toBeTruthy()
  })

  it('opens a session from the strip and unfolds its machine and project', async () => {
    const user = userEvent.setup()
    const onShowSession = vi.fn()
    show(asking(), { machines: [LOCAL_HEAD, DEVBOX], onShowSession })
    await user.click(screen.getByRole('button', { name: 'api', expanded: true }))
    await user.click(screen.getByRole('button', { name: /^devbox/, expanded: true }))
    await user.click(within(strip()).getByRole('button', { name: 'Newer ask on devbox in api' }))
    expect(onShowSession).toHaveBeenCalledWith('t2')
    expect(screen.getByRole('button', { name: /^devbox/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'api' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('drops the project filter when it picks a session of another project, so its project is there to unfold', async () => {
    const user = userEvent.setup()
    show(asking(), { machines: [LOCAL_HEAD, DEVBOX] })
    await user.click(screen.getByRole('button', { name: 'Filter by project: All projects' }))
    await user.click(within(screen.getByRole('group', { name: 'Show projects' })).getByRole('button', { name: /^shop/ }))
    expect(screen.queryByRole('button', { name: 'api', expanded: true })).toBeNull()
    expect(stripRows()).toHaveLength(2)
    await user.click(within(strip()).getByRole('button', { name: 'Newer ask on devbox in api' }))
    expect(screen.getByRole('button', { name: 'api', expanded: true })).toBeTruthy()
  })

  it('leaves a waiting session in its own project too', () => {
    show(asking(), { machines: [LOCAL_HEAD, DEVBOX] })
    const api = screen.getByRole('list', { name: 'api' })
    expect(within(api).getByRole('button', { name: /^Newer ask,/ })).toBeTruthy()
    expect(within(strip()).getByRole('button', { name: /^Newer ask on/ })).toBeTruthy()
  })
})

describe('the top of the sidebar', () => {
  it('opens a project on this computer from its +, and the search from Search', async () => {
    const user = userEvent.setup()
    const onSearch = vi.fn()
    const onOpenProject = vi.fn()
    show([], { onSearch, onOpenProject })
    await user.click(screen.getByRole('button', { name: 'Open a project' }))
    expect(onOpenProject).toHaveBeenCalledWith(null)
    expect(screen.queryByRole('menu')).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Search/ }))
    expect(onSearch).toHaveBeenCalledTimes(1)
  })

  it('has a + Remote machine button in the foot and in the rail', async () => {
    const user = userEvent.setup()
    const onAddMachine = vi.fn()
    show([], { onAddMachine })
    await user.click(screen.getByRole('button', { name: /Remote machine/ }))
    cleanup()
    show([], { onAddMachine, mode: 'rail' })
    await user.click(screen.getByRole('button', { name: /Remote machine/ }))
    expect(onAddMachine).toHaveBeenCalledTimes(2)
  })

  it('narrows the tree to one project, and back to all of them, with the menu staying open', async () => {
    const user = userEvent.setup()
    show([session(1, { agent: 'claude', named: true, title: 'Alpha', cwd: '/home/me/shop', folder: '/home/me/shop' }), session(2, { agent: 'claude', named: true, title: 'Beta', cwd: '/home/me/docs', folder: '/home/me/docs' })])
    const names = () => screen.getAllByRole('button', { name: /^(Alpha|Beta),/ }).map((row) => row.querySelector('.mx-row-name')?.textContent)
    await user.click(screen.getByRole('button', { name: 'Filter by project: All projects' }))
    await user.click(within(screen.getByRole('group', { name: 'Show projects' })).getByRole('button', { name: /^docs/ }))
    expect(names()).toEqual(['Beta'])
    expect(screen.queryByRole('button', { name: 'shop', expanded: true })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Filter by project' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^All projects/ }))
    expect(names()).toEqual(['Alpha', 'Beta'])
  })
})

describe('a project heading', () => {
  afterEach(() => { resetToasts() })

  const SHOP: OpenedProject = { machineName: null, folder: '/home/me/shop' }
  const NOTES: OpenedProject = { machineName: null, folder: '/home/me/notes' }
  /** An agent in the shop repository's main checkout, and one in a linked worktree of it. */
  const inShop = () => [
    session(1, { agent: 'claude', named: true, title: 'In a worktree', repo: 'shop', branch: 'feat/x', folder: '/home/me/shop', cwd: '/home/me/.maiker/shop/feat-x', linked: true }),
    session(2, { agent: 'claude', named: true, title: 'On main', repo: 'shop', branch: 'main', folder: '/home/me/shop', cwd: '/home/me/shop' }),
  ]
  /** The window's actions, with Close project deciding as the window does, over `sessions`. */
  function actionsOver(sessions: readonly SessionView[], opened: readonly OpenedProject[]) {
    return { onNewSession: vi.fn(), onNewWorktree: vi.fn(), onOpenWorktree: vi.fn(), onClose: vi.fn((project: OpenedProject) => closeProject(opened, project, sessions)) } satisfies ProjectActions
  }
  function showProjects(sessions: SessionView[], opened: readonly OpenedProject[], more: Partial<SidebarProps> = {}) {
    const grouping = groupByProject(sessions, opened)
    const projectActions = actionsOver(sessions, grouping.opened)
    show(sessions, { projects: grouping.machines, projectActions, ...more })
    return projectActions
  }
  const menuItems = () => screen.getAllByRole('menuitem').map((item) => item.textContent)

  it('starts a new-chat draft on the project\'s machine and folder from its + and from its menu', async () => {
    const user = userEvent.setup()
    const api = { machineName: 'devbox', folder: '/srv/api' }
    const actions = showProjects([], [SHOP, api], { machines: [LOCAL_HEAD, DEVBOX] })
    await user.click(screen.getByRole('button', { name: 'New session in shop' }))
    expect(actions.onNewSession).toHaveBeenLastCalledWith(0, SHOP)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'api', expanded: true }))
    await user.click(await screen.findByRole('menuitem', { name: 'New session' }))
    expect(actions.onNewSession).toHaveBeenLastCalledWith(4, api)
  })

  it('offers New worktree on a git project of this computer and opens the dialog off its main checkout\'s session', async () => {
    const user = userEvent.setup()
    const sessions = inShop()
    const actions = showProjects(sessions, [])
    await user.click(screen.getByRole('button', { name: 'New worktree in shop' }))
    expect(actions.onNewWorktree).toHaveBeenLastCalledWith(0, SHOP, sessions[1])
    fireEvent.contextMenu(screen.getByRole('button', { name: 'shop', expanded: true }))
    await user.click(await screen.findByRole('menuitem', { name: 'New worktree…' }))
    expect(actions.onNewWorktree).toHaveBeenCalledTimes(2)
  })

  it('offers Open worktree on a git project of this computer, and asks the window to open its list', async () => {
    const user = userEvent.setup()
    const actions = showProjects(inShop(), [])
    fireEvent.contextMenu(screen.getByRole('button', { name: 'shop', expanded: true }))
    await user.click(await screen.findByRole('menuitem', { name: 'Open worktree…' }))
    expect(actions.onOpenWorktree).toHaveBeenCalledWith(0, SHOP, 'shop')
  })

  it('starts a new worktree from a project with no session, which has none to make it from', async () => {
    const user = userEvent.setup()
    const actions = showProjects([], [SHOP])
    await user.click(screen.getByRole('button', { name: 'New worktree in shop' }))
    expect(actions.onNewWorktree).toHaveBeenLastCalledWith(0, SHOP, null)
  })

  it('offers New and Open worktree on another machine\'s git project, and both act on that machine', async () => {
    const user = userEvent.setup()
    const there = session(3, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There', repo: 'api', branch: 'main', folder: '/srv/api', cwd: '/srv/api' })
    const actions = showProjects([there], [], { machines: [LOCAL_HEAD, DEVBOX] })
    await user.click(screen.getByRole('button', { name: 'New worktree in api' }))
    expect(actions.onNewWorktree).toHaveBeenLastCalledWith(4, { machineName: 'devbox', folder: '/srv/api' }, there)
    expect(there.machine).toBe(4)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'api', expanded: true }))
    await screen.findByRole('menu', { name: 'api' })
    expect(menuItems()).toEqual(['New session', 'New worktree…', 'Open worktree…', 'Close project'])
    await user.click(screen.getByRole('menuitem', { name: 'Open worktree…' }))
    expect(actions.onOpenWorktree).toHaveBeenCalledWith(4, { machineName: 'devbox', folder: '/srv/api' }, 'api')
  })

  it('closes a project with no running session and says nothing', async () => {
    const user = userEvent.setup()
    const actions = showProjects([], [NOTES])
    fireEvent.contextMenu(screen.getByRole('button', { name: 'notes', expanded: true }))
    await user.click(await screen.findByRole('menuitem', { name: 'Close project' }))
    expect(actions.onClose).toHaveBeenCalledWith(NOTES, 'notes')
    expect(actions.onClose.mock.results[0]?.value).toEqual({ ok: true, value: [] })
    expect(currentToasts().items).toHaveLength(0)
  })

  it('refuses to close a project a session runs in, and names the sessions in the way', async () => {
    const user = userEvent.setup()
    const actions = showProjects(inShop(), [])
    fireEvent.contextMenu(screen.getByRole('button', { name: 'shop', expanded: true }))
    await user.click(await screen.findByRole('menuitem', { name: 'Close project' }))
    expect(actions.onClose.mock.results[0]?.value).toMatchObject({ ok: false, error: { code: 'sessions-running' } })
    const [said] = currentToasts().items
    expect(said?.title).toBe('Could not close shop')
    expect(said?.description).toBe('Still running in it: In a worktree and On main. Close them first.')
  })

  it('reaches every action from the keyboard: the ⋯ button opens the menu, the arrows move and Enter runs', async () => {
    const user = userEvent.setup()
    const sessions = inShop()
    const actions = showProjects(sessions, [])
    screen.getByRole('button', { name: 'More for shop' }).focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('menu', { name: 'shop' })
    expect(menuItems()).toEqual(['New session', 'New worktree…', 'Open worktree…', 'Close project'])
    await waitForFocus('New session')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(actions.onNewWorktree).toHaveBeenCalledWith(0, SHOP, sessions[1])
    screen.getByRole('button', { name: 'More for shop' }).focus()
    await user.keyboard('{Enter}')
    await waitForFocus('New session')
    await user.keyboard('{ArrowUp}{Enter}')
    expect(actions.onClose).toHaveBeenCalledWith(SHOP, 'shop')
  })
})

/** Waits for the menu item named `name` to take focus, as an opened menu gives it to its first item. */
async function waitForFocus(name: string) {
  await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole('menuitem', { name })) })
}

describe('New worktree', () => {
  it('is in a session\'s menu, asks the window to make one from it, and is off outside a repository', async () => {
    const user = userEvent.setup()
    const onNewWorktree = vi.fn()
    show([session(1, { named: true, title: 'In repo', repo: 'app', branch: 'dev', folder: '/home/me/app', cwd: '/home/me/app' }), session(2, { named: true, title: 'At home' })], { onNewWorktree })
    fireEvent.contextMenu(screen.getByRole('button', { name: /^In repo,/ }))
    await user.click(screen.getByRole('menuitem', { name: 'New worktree…' }))
    expect(onNewWorktree).toHaveBeenCalledWith('t1')
    fireEvent.contextMenu(screen.getByRole('button', { name: /^At home,/ }))
    expect(screen.getByRole('menuitem', { name: 'New worktree…' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('Open worktree', () => {
  it('is in a session\'s menu, asks the window to list its project\'s worktrees, and is off outside a repository', async () => {
    const user = userEvent.setup()
    const onOpenWorktree = vi.fn()
    show([session(1, { named: true, title: 'In repo', repo: 'app', branch: 'dev', folder: '/home/me/app', cwd: '/home/me/app' }), session(2, { named: true, title: 'At home' })], { onOpenWorktree })
    fireEvent.contextMenu(screen.getByRole('button', { name: /^In repo,/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Open worktree…' }))
    expect(onOpenWorktree).toHaveBeenCalledWith('t1')
    fireEvent.contextMenu(screen.getByRole('button', { name: /^At home,/ }))
    expect(screen.getByRole('menuitem', { name: 'Open worktree…' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('the key that decides when rows are measured to slide', () => {
  const keyFor = (sessions: SessionView[], placement = '') => flipKey(sessions, false, '', false, placement)

  it('does not change when only the focused session changes, so a click reads no layout', () => {
    const list = [session(1, { agent: 'claude', named: true, title: 'A' }), session(2, { agent: 'claude', named: true, title: 'B' })]
    expect(keyFor(list)).toBe(keyFor([...list]))
  })

  it('changes when a session changes status, which moves its row', () => {
    const before = [session(1, { agent: 'claude', named: true, title: 'A' })]
    const after = [session(1, { agent: 'claude', named: true, title: 'A', status: 'needs-you' })]
    expect(keyFor(before)).not.toBe(keyFor(after))
  })

  it('still changes when moving focus moves a row between sections, through where the rows sit', () => {
    const list = [session(1, { agent: 'claude', named: true, title: 'A', status: 'working' }), session(2, { agent: 'claude', named: true, title: 'B', status: 'needs-you' })]
    expect(keyFor(list, 'needs:t2|working:t1')).not.toBe(keyFor(list, 'working:t1,t2'))
  })

  it('changes when a heading folds', () => {
    const list = [session(1, { agent: 'claude', named: true, title: 'A' })]
    expect(flipKey(list, false, 'machine:devbox', false, '')).not.toBe(flipKey(list, false, '', false, ''))
  })
})

describe('hovering a row', () => {
  it('tells the window which row the pointer or the keyboard is on, and when it leaves', async () => {
    const user = userEvent.setup()
    const onHoverSession = vi.fn()
    show([session(1, { agent: 'claude', named: true, title: 'Growth' })], { onHoverSession })
    const row = screen.getByRole('button', { name: /^Growth,/ })
    await user.hover(row)
    expect(onHoverSession).toHaveBeenLastCalledWith('t1')
    await user.unhover(row)
    expect(onHoverSession).toHaveBeenLastCalledWith(null)
    act(() => { row.focus() })
    expect(onHoverSession).toHaveBeenLastCalledWith('t1')
  })
})


describe('the counts on a folded heading', () => {
  const SHOP = { cwd: '/home/me/shop', folder: '/home/me/shop' }
  const NOW = Math.floor(Date.now() / 1000)
  const limited = { details: { since: NOW, resumeAt: NOW + 3600 } as NonNullable<Conversation['details']> }
  const agent = (pane: number, place: typeof SHOP, extra: Partial<Conversation> = {}) => session(pane, { ...place, agent: 'claude', named: true, title: `S${String(pane)}`, ...extra })
  const badges = (head: HTMLElement) => Array.from(head.querySelectorAll('.mx-fold-badge')).map((badge) => [badge.getAttribute('aria-label'), badge.textContent, badge.className])
  const fold = async (name: string | RegExp) => { await userEvent.click(screen.getByRole('button', { name, expanded: true })) }

  it('shows a folded project how many of its sessions need you, in the needs colour, and none while it is unfolded', async () => {
    show([agent(1, SHOP, { status: 'needs-you' }), agent(2, SHOP, { status: 'needs-you' }), agent(3, SHOP, { status: 'done', ...limited }), agent(4, SHOP, { status: 'working' })])
    expect(document.querySelector('.mx-fold-badge')).toBeNull()
    await fold('shop')
    const head = screen.getByRole('button', { name: /^shop/, expanded: false })
    // The one held by its plan limit waits on the limit, not on you, as in the Needs you strip.
    expect(badges(head)).toEqual([['2 sessions need you', '2', 'mx-fold-badge is-needs']])
    expect(within(head).getByRole('img', { name: '2 sessions need you' })).toBeInTheDocument()
  })
})
