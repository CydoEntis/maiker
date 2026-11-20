import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/data/preview'
import { writeMachineNicknames } from '@/data/machineNicknames'
import { LOCAL_HEAD, type MachineHead } from '../model/machines'
import { groupByProject, type OpenedProject } from '../model/openedProjects'
import { toSessionView, type SessionView } from '../model/session'
import { Sidebar, type SidebarProps } from './Sidebar'
import { flipKey } from './flipKey'

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


/** The window keeps which machine the + menu is open for; this stands in for it, starting from `startMenu`. */
function Host(props: SidebarProps) {
  const [startMenu, setStartMenu] = useState(props.startMenu)
  return <Sidebar {...props} startMenu={startMenu} onStartMenu={(machine) => { setStartMenu(machine); props.onStartMenu(machine) }} />
}

function show(sessions: SessionView[], more: Partial<SidebarProps> = {}) {
  const none = vi.fn()
  const props: SidebarProps = {
    sessions, listed: true, machines: [LOCAL_HEAD], projects: groupByProject(sessions, []).machines, selectedProject: null, statusHeadings: true, focusedId: null, mode: 'docked', online: true, canStart: true, portalContainer: null,
    onToggleRail: none, side: 'left', width: 264, onResize: none, onResizeEnd: none, onSearch: none,
    startMenu: null, onStartMenu: none, start: { installedAgents: ['claude', 'codex'], onAgent: none }, onNewShell: none, onAddMachine: none, onMachineSettings: none, onFixMachine: none, onRenameMachine: none, onUpdateMachine: none, onShowSession: none, onRenameSession: none,
    onSplitSession: none, onCopyPath: none, onCopyText: none, onShowChanges: none, onMarkDone: none, onBringBack: none, onUnsnooze: none, onGetFile: none,
    onEndSession: none, onOpenSettings: none, onRecentSessions: none,
    ...more,
  }
  const view = render(<Host {...props} />)
  // Draws the same sidebar again with some props changed, as the window does when the selection moves.
  return { ...view, again: (next: Partial<SidebarProps>) => { view.rerender(<Host {...props} {...next} />) } }
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

  it('leaves the machine\'s name off a row under its heading, which says it, behind a server or a monitor icon; a put-away row names it', async () => {
    show([
      session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There', repo: 'app2' }),
      session(3, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'Away', repo: 'app3', archived: true }),
      session(1, { agent: 'claude', named: true, title: 'Here', repo: 'app1' }),
    ], { machines: [LOCAL_HEAD, DEVBOX] })
    const there = screen.getByRole('button', { name: /^There,/ }).querySelector('.mx-row-sub')
    const here = screen.getByRole('button', { name: /^Here,/ }).querySelector('.mx-row-sub')
    expect(there?.querySelector('.mx-row-machine')).toBeNull()
    expect(there?.textContent).toBe('app2')
    expect(there?.querySelectorAll('svg rect')).toHaveLength(2)
    expect(here?.querySelector('.mx-row-machine')).toBeNull()
    expect(here?.querySelectorAll('svg rect')).toHaveLength(1)
    expect(here?.textContent).toBe('app1')
    await userEvent.click(screen.getByRole('button', { name: /^Put away/ }))
    expect(screen.getByRole('button', { name: /^Away,/ }).querySelector('.mx-row-sub')?.textContent).toBe('devbox·app3')
  })

  const MIXED = () => [
    session(1, { named: true, title: 'Exited shell', details: { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, exit: { code: 1, at: 1 } } }),
    session(2, { agent: 'claude', named: true, title: 'Idle agent' }),
    session(3, { agent: 'claude', named: true, title: 'Working', status: 'working' }),
    session(4, { agent: 'claude', named: true, title: 'Asking', status: 'needs-you' }),
    session(5, { agent: 'claude', named: true, title: 'Finished', status: 'done' }),
  ]

  it('says a shell that exited is exited, at the right of its row', () => {
    show(MIXED())
    expect(screen.getByRole('button', { name: /^Exited shell/ })).toHaveTextContent('exited')
  })

  it('lists a session stopped by its plan limit under Needs you, saying until when', () => {
    const resume = new Date(2026, 0, 5, 14, 5).getTime()
    const details = { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, resumeAt: resume / 1000 }
    const today = vi.spyOn(Date, 'now').mockReturnValue(resume - 60_000)
    try {
      const shop = { cwd: '/home/me/shop', folder: '/home/me/shop' }
      const limited = session(6, { ...shop, agent: 'claude', named: true, title: 'Out of plan', status: 'done', details })
      show([session(2, { ...shop, agent: 'claude', named: true, title: 'Idle agent' }), session(3, { ...shop, agent: 'claude', named: true, title: 'Other idle' }), limited])
      const row = within(screen.getByRole('list', { name: 'Needs you in shop' })).getByRole('button', { name: 'Out of plan, claude, limited until 14:05' })
      expect(row).toHaveTextContent('limited until 14:05')
    } finally {
      today.mockRestore()
    }
  })

  it('puts the status mark, the name and the age on line 1, and the project and worktree on line 2', () => {
    const since = Math.floor(Date.now() / 1000) - 180
    show([
      session(1, { agent: 'claude', named: true, title: 'Growth', repo: 'AeVoxGrowth', branch: 'agent/grow-025', linked: true, folder: '/home/me/AeVoxGrowth', cwd: '/home/me/AeVoxGrowth', details: { since } as NonNullable<Conversation['details']> }),
      session(2, { cwd: '/home/me/dev', folder: '/home/me/dev' }),
    ])
    const growth = screen.getByRole('button', { name: /^Growth,/ })
    const first = growth.querySelector('.mx-row-title')
    expect(first?.firstElementChild?.getAttribute('data-slot')).toBe('status-icon')
    expect(first?.querySelector('.mx-row-name')?.textContent).toBe('Growth')
    expect(first?.querySelector('.mx-row-when')).toHaveTextContent('3m')
    const second = growth.querySelector('.mx-row-sub')
    expect(second?.querySelector('.mx-row-project-name')?.textContent).toBe('AeVoxGrowth')
    expect(second?.querySelector('.mx-row-branch-name')?.textContent).toBe('agent/grow-025')
    expect(growth.querySelector('.mx-app-icon')).toBeNull()
    expect(screen.getByRole('button', { name: /^dev, shell/ })).toBeTruthy()
  })

  it('leaves the branch off a session that is not in a worktree', () => {
    show([session(1, { agent: 'claude', named: true, title: 'Plain', repo: 'app', branch: 'main' })])
    expect(screen.getByRole('button', { name: /^Plain,/ }).querySelector('.mx-row-branch-name')).toBeNull()
  })

  it('has no group-by-project toggle on a machine: its projects are always listed, and no such entry is in its menu', () => {
    show([session(1, { agent: 'claude', cwd: '/home/me/a', folder: '/home/me/a' }), session(2, { agent: 'claude', cwd: '/home/me/b', folder: '/home/me/b' })])
    expect(screen.queryByRole('button', { name: /Group by project|Show one list/ })).toBeNull()
    expect(within(screen.getByRole('group', { name: 'Projects on This computer' })).getAllByRole('button', { expanded: true }).map((head) => head.textContent)).toEqual(['a', 'b'])
    fireEvent.contextMenu(screen.getByRole('button', { name: /^This computer/ }))
    expect(screen.queryByRole('menuitem', { name: /Group by project|Show as one list/ })).toBeNull()
  })

  it('folds a machine away from its heading', async () => {
    const user = userEvent.setup()
    show([session(1, { agent: 'claude' })])
    await user.click(screen.getByRole('button', { name: /^This computer/ }))
    expect(screen.getByRole('button', { name: /^This computer/ })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('a machine that needs maiker installed or updated', () => {
  const needing = (action: MachineHead['updateAction']): MachineHead => ({ ...DEVBOX, chip: { glyph: '▲', word: 'needs update', tone: 'bad' }, down: true, updateAction: action })
  const machineMenuItems = () => {
    fireEvent.contextMenu(screen.getByRole('button', { name: /^devbox/ }))
    return within(screen.getByRole('menu', { name: 'devbox' })).getAllByRole('menuitem').map((item) => item.textContent)
  }

  it('offers one Install button when it is down, which opens its fix, and its dot says it is not installed', async () => {
    const user = userEvent.setup()
    const onFixMachine = vi.fn()
    show([], { machines: [LOCAL_HEAD, needing('install')], onFixMachine })
    expect(screen.getByRole('img', { name: /^devbox is / })).toHaveClass('is-warn')
    expect(screen.queryByRole('button', { name: 'Fix devbox' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Install Maiker on devbox' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Install Maiker on devbox' }))
    expect(onFixMachine).toHaveBeenCalledWith(expect.objectContaining({ name: 'devbox' }))
  })

  it('has no + on a machine, and a machine that is down still says why from its dot and its menu', () => {
    const down: MachineHead = { ...needing('update'), why: 'ssh: connection refused' }
    show([], { machines: [LOCAL_HEAD, down] })
    expect(screen.queryByRole('button', { name: /^New (session|agent chat) on / })).toBeNull()
    expect(screen.getByRole('img', { name: /^devbox is / })).toHaveAttribute('title', 'ssh: connection refused')
    fireEvent.contextMenu(screen.getByRole('button', { name: /^devbox/ }))
    expect(screen.getByRole('menuitem', { name: 'New session here' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: /Not reachable: ssh: connection refused/ })).toBeTruthy()
  })

  it('offers Install Maiker first in its menu', async () => {
    const user = userEvent.setup()
    const onUpdateMachine = vi.fn()
    show([], { machines: [LOCAL_HEAD, needing('install')], onUpdateMachine })
    expect(machineMenuItems()[0]).toBe('Install Maiker')
    await user.click(screen.getByRole('menuitem', { name: 'Install Maiker' }))
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

  it('offers Update in the heading of a connected machine that has a project, above its projects', () => {
    const onUpdateMachine = vi.fn()
    show([session(1, { agent: 'claude', named: true, title: 'Here' }), session(8, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, { ...DEVBOX, updateAction: 'update' }], onUpdateMachine })
    const card = screen.getByRole('group', { name: 'Projects on devbox' }).closest('.mx-machine') as HTMLElement
    fireEvent.click(within(card.querySelector('.mx-machine-head') as HTMLElement).getByRole('button', { name: 'Update Maiker on devbox' }))
    expect(onUpdateMachine).toHaveBeenCalledWith('devbox', 'update')
  })

  it('shows how far its update has got in the header, in place of the Update button', () => {
    show([], { machines: [LOCAL_HEAD, needing('update')], updateProgress: { devbox: 55 } })
    expect(screen.getByText('55%')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update Maiker on devbox' })).toBeNull()
    expect(screen.getByRole('progressbar', { name: 'Updating devbox' })).toHaveAttribute('aria-valuenow', '55')
  })

  it('shows no progress for a machine that is not updating', () => {
    show([], { machines: [LOCAL_HEAD, needing('update')], updateProgress: { other: 55 } })
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByRole('button', { name: 'Update Maiker on devbox' })).toBeInTheDocument()
  })

  it('offers neither on a machine that is up to date, nor on this computer', () => {
    show([session(1)], { machines: [LOCAL_HEAD, DEVBOX] })
    expect(machineMenuItems().filter((item) => item.endsWith('Maiker'))).toEqual([])
    fireEvent.contextMenu(screen.getByRole('button', { name: /^This computer/ }))
    expect(screen.queryByRole('menuitem', { name: /Maiker$/ })).toBeNull()
    expect(screen.queryByRole('img', { name: /needs update|not installed/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Maiker on/ })).toBeNull()
  })
})

describe('a session row', () => {
  it('shows a live age on line 1 for an agent', () => {
    const since = Math.floor(Date.now() / 1000) - 180
    show([session(1, { agent: 'claude', named: true, title: 'Timed', details: { since } as NonNullable<Conversation['details']> })])
    const row = screen.getByRole('button', { name: /^Timed,/ })
    expect(row.querySelector('.mx-row-title .mx-row-when')).toHaveTextContent('3m')
    expect(row.querySelector('.mx-row-sub .mx-row-when')).toBeNull()
  })

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

  it('lists put-away sessions, terminals included, only under a folded Put away section at the bottom', async () => {
    show([
      session(1, { agent: 'claude', named: true, title: 'Away agent', status: 'done', archived: true }),
      session(2, { named: true, title: 'Away shell', archived: true }),
      session(3, { agent: 'claude', named: true, title: 'Here' }),
    ])
    expect(names()).toEqual(['Here'])
    const head = screen.getByRole('button', { name: /^Put away/, expanded: false })
    expect(head).toHaveTextContent('2')
    await userEvent.click(head)
    const list = screen.getByRole('list', { name: 'Put away' })
    expect(within(list).getAllByRole('button', { name: /, (idle|done)$/ }).map((row) => row.getAttribute('aria-label')?.split(',')[0])).toEqual(['Away agent', 'Away shell'])
    expect(screen.queryByRole('list', { name: 'Terminals' })).toBeNull()
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

  it('lists a put-away session that needs you in its project, not under Put away', () => {
    show([session(1, { agent: 'claude', named: true, title: 'Asking', status: 'needs-you', archived: true })])
    expect(within(screen.getByRole('list', { name: 'app1' })).getByRole('button', { name: /^Asking,/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Put away/ })).toBeNull()
  })

  it('offers no Get a file on a session of this computer', () => {
    show([session(1, { agent: 'claude' })])
    fireEvent.contextMenu(screen.getByRole('button', { name: /^New session,/ }))
    expect(screen.queryByRole('menuitem', { name: /Get a file/ })).toBeNull()
  })

  it('offers Get a file on a session of another machine, and asks for that session', async () => {
    const user = userEvent.setup()
    const onGetFile = vi.fn()
    show([session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, DEVBOX], onGetFile })
    fireEvent.contextMenu(screen.getByRole('button', { name: /^There,/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Get a file…' }))
    expect(onGetFile).toHaveBeenCalledWith('t2')
  })

  it('cannot get a file while the daemon is offline', () => {
    show([session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, DEVBOX], online: false })
    fireEvent.contextMenu(screen.getByRole('button', { name: /^There,/ }))
    expect(screen.getByRole('menuitem', { name: 'Get a file…' })).toHaveAttribute('aria-disabled', 'true')
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

  it('shows a card beside a row the pointer rests on, and puts it away when the pointer leaves', () => {
    vi.useFakeTimers()
    try {
      show([session(1, { agent: 'claude', named: true, title: 'Growth', status: 'needs-you' })])
      const row = screen.getByRole('button', { name: /^Growth,/ }).closest('.mx-row-wrap') as HTMLElement
      fireEvent.mouseEnter(row)
      expect(screen.queryByRole('tooltip')).toBeNull()
      act(() => { vi.advanceTimersByTime(450) })
      const card = screen.getByRole('tooltip')
      expect(card).toHaveTextContent('Growth')
      expect(card).toHaveTextContent('Needs you')
      expect(card).toHaveTextContent('Claude · This computer')
      expect(card).toHaveAttribute('data-open', 'true')
      fireEvent.mouseLeave(row)
      // Hidden at once, kept mounted a moment so the next row's card needs no delay, then gone.
      expect(screen.getByRole('tooltip', { hidden: true })).toHaveAttribute('data-open', 'false')
      act(() => { vi.advanceTimersByTime(250) })
      expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the next row\'s card at once when the pointer moves on within the warm time', () => {
    vi.useFakeTimers()
    try {
      show([session(1, { agent: 'claude', named: true, title: 'Growth' }), session(2, { agent: 'claude', named: true, title: 'Billing' })])
      const first = screen.getByRole('button', { name: /^Growth,/ }).closest('.mx-row-wrap') as HTMLElement
      const second = screen.getByRole('button', { name: /^Billing,/ }).closest('.mx-row-wrap') as HTMLElement
      fireEvent.mouseEnter(first)
      act(() => { vi.advanceTimersByTime(450) })
      fireEvent.mouseLeave(first)
      fireEvent.mouseEnter(second)
      expect(screen.getByRole('tooltip')).toHaveTextContent('Billing')
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers the session menu on right-click, with the design\'s items first and the rest after a divider, and hands Close session to the app, which asks first', async () => {
    const user = userEvent.setup()
    const onEndSession = vi.fn()
    show([session(1, { agent: 'claude', named: true, title: 'Growth' }), session(2)], { focusedId: 't2', onEndSession })
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Growth,/ }))
    const menu = screen.getByRole('menu', { name: 'Growth' })
    const items = within(menu).getAllByRole('menuitem').map((item) => item.textContent)
    expect(items.slice(0, 4)).toEqual(['RenameF2', 'Open in a new pane', 'Copy folder path', expect.stringMatching(/^Close session/)])
    expect(items.slice(4)).toEqual(expect.arrayContaining(['Open', 'Open in split down', 'Show changes']))
    expect(within(menu).getAllByRole('separator')).toHaveLength(2)
    await user.click(within(menu).getByRole('menuitem', { name: /^Close session/ }))
    expect(onEndSession).toHaveBeenCalledWith('t1')
  })

  it('opens a session in a new pane beside the focused one from its menu', async () => {
    const onSplitSession = vi.fn()
    show([session(1, { agent: 'claude', named: true, title: 'Growth' }), session(2)], { focusedId: 't2', onSplitSession })
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Growth,/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open in a new pane' }))
    expect(onSplitSession).toHaveBeenCalledWith('t1', 'right')
  })

  it('does not offer Put away or Snooze in the menu of a finished agent', () => {
    show([session(1, { agent: 'claude', named: true, title: 'Finished', status: 'done' })])
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Finished,/ }))
    const names = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(names.filter((name) => /^(Put away|Snooze)/.test(name))).toEqual([])
  })

  it('offers Close shell, not Stop, for a shell', () => {
    show([session(1)])
    fireEvent.contextMenu(screen.getByRole('button', { name: /^app1,/ }))
    expect(screen.getByRole('menuitem', { name: 'Close shell' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'New terminal' })).toBeNull()
  })
})

describe('a machine heading', () => {
  it('has its own + that opens the start menu on that machine, and offers the menu or a terminal from its right-click menu', async () => {
    const user = userEvent.setup()
    const onStartMenu = vi.fn()
    const onNewShell = vi.fn()
    show([session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, DEVBOX], onStartMenu, onNewShell })
    await user.click(screen.getByRole('button', { name: 'Add a session to devbox' }))
    expect(await screen.findByRole('menu', { name: 'Start' })).toBeTruthy()
    expect(screen.getByText('On devbox')).toBeTruthy()
    await user.keyboard('{Escape}')
    fireEvent.contextMenu(screen.getByRole('button', { name: /^devbox/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'New session here' }))
    expect(onStartMenu).toHaveBeenCalledWith(4)
    fireEvent.contextMenu(screen.getByRole('button', { name: /^devbox/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'New terminal here' }))
    expect(onNewShell).toHaveBeenCalledWith(4)
  })

  it('opens a project on its machine from its own +, this computer or another; the header\'s + does not offer it', async () => {
    const user = userEvent.setup()
    const onOpenProject = vi.fn()
    show([session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, DEVBOX], onOpenProject })
    await user.click(screen.getByRole('button', { name: 'Add a session to This computer' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Open a project…' }))
    expect(onOpenProject).toHaveBeenLastCalledWith(0)
    await user.click(screen.getByRole('button', { name: 'Add a session to devbox' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Open a project…' }))
    expect(onOpenProject).toHaveBeenLastCalledWith(4)
    await user.click(screen.getByRole('button', { name: 'New session' }))
    await screen.findByRole('menu', { name: 'Start' })
    expect(screen.queryByRole('menuitem', { name: 'Open a project…' })).toBeNull()
  })

  it('lists a connected saved machine with no sessions: its name, its own + and "No sessions yet"', () => {
    show([], { machines: [LOCAL_HEAD, DEVBOX] })
    expect(screen.getByRole('button', { name: /^devbox/ })).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add a session to devbox' }).disabled).toBe(false)
    expect(within(screen.getByRole('group', { name: 'Projects on devbox' }).parentElement as HTMLElement).getByText('No sessions yet')).toBeTruthy()
  })

  it('says Connecting… on a machine whose first dial is still going', () => {
    show([], { machines: [LOCAL_HEAD, { ...DEVBOX, chip: { glyph: '○', word: 'connecting', tone: 'quiet' } }] })
    expect(screen.getByText('Connecting…')).toBeTruthy()
  })

  it('marks a machine that is not up with a red dot, Offline and a Fix button, the reason as its tooltip, and offers no new session on it', async () => {
    const user = userEvent.setup()
    const onFixMachine = vi.fn()
    show([], { machines: [LOCAL_HEAD, { ...DEVBOX, down: true, why: 'connection refused', chip: { glyph: '✕', word: 'unreachable', tone: 'bad' } }], onFixMachine })
    expect(screen.getByText('Offline')).toBeTruthy()
    expect(screen.getByText('Offline').closest('.mx-machine-why')).toHaveAttribute('title', 'connection refused')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add a session to devbox' }).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Fix devbox' }))
    expect(onFixMachine).toHaveBeenCalledWith(expect.objectContaining({ name: 'devbox' }))
  })

  it('collapses its sessions when the name is clicked', async () => {
    const user = userEvent.setup()
    show([session(1, { agent: 'claude', named: true, title: 'Here' })])
    await user.click(screen.getByRole('button', { name: /^This computer/ }))
    expect(screen.getByRole('button', { name: /^This computer/, expanded: false })).toBeTruthy()
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
  it('is listed last on its machine while it waits for a first message, as a twin of a session row, and the empty note steps aside', () => {
    show([], { draft: { machine: 0, process: 'claude' } })
    const draft = screen.getByRole('status', { name: 'New session, waiting for the first message' })
    expect((screen.getByRole('button', { name: /^This computer/ }).closest('.mx-machine') as HTMLElement).contains(draft)).toBe(true)
    expect(screen.queryByText('No agents running. New chat starts one.')).toBeNull()
    expect(draft.querySelector('.mx-row')).not.toBeNull()
  })

  it('shows the agent picked for it, drawn as a session row draws its agent', () => {
    show([], { draft: { machine: 0, process: 'codex' } })
    const icon = screen.getByRole('status', { name: 'New session, waiting for the first message' }).querySelector('.mx-app-icon')
    expect(icon?.classList.contains('is-codex')).toBe(true)
    expect(icon?.classList.contains('size-16')).toBe(true)
    expect(icon?.classList.contains('is-flat')).toBe(true)
  })

  it('stays after every session of its machine, wherever they sort', () => {
    show([session(1, { agent: 'claude', named: true, title: 'First' }), session(2, { agent: 'claude', named: true, title: 'Second', status: 'needs-you' })], { draft: { machine: 0, process: 'claude' } })
    const draft = screen.getByRole('status', { name: 'New session, waiting for the first message' })
    const rows = Array.from((screen.getByRole('button', { name: /^This computer/ }).closest('.mx-machine') as HTMLElement).querySelectorAll('.mx-row-wrap'))
    expect(rows.at(-1)).toBe(draft)
  })

  it('is listed under every project of its machine, after their status headings', () => {
    const shop = { cwd: '/home/me/shop', folder: '/home/me/shop' }
    show([
      session(1, { ...shop, agent: 'claude', named: true, title: 'Asking', status: 'needs-you' }),
      session(2, { ...shop, agent: 'claude', named: true, title: 'Busy', status: 'working' }),
      session(3, { ...shop, agent: 'claude', named: true, title: 'Idle one' }),
      session(4, { agent: 'claude', named: true, title: 'Docs', cwd: '/home/me/docs', folder: '/home/me/docs' }),
    ], { draft: { machine: 0, process: 'claude' } })
    const draft = screen.getByRole('status', { name: 'New session, waiting for the first message' })
    const card = screen.getByRole('button', { name: /^This computer/ }).closest('.mx-machine') as HTMLElement
    expect(Array.from(card.querySelectorAll('.mx-row-wrap')).at(-1)).toBe(draft)
    expect(card.querySelector('.mx-status-head')).not.toBeNull()
  })

  it('is a button that opens the draft again when it is set aside with text in it', async () => {
    const onOpen = vi.fn()
    show([], { draft: { machine: 0, process: 'claude', onOpen } })
    expect(screen.queryByRole('status', { name: /New session/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^New session draft/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('is not listed once there is no draft, nor on another machine', () => {
    show([session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, DEVBOX], draft: { machine: 0, process: 'claude' } })
    expect(screen.getAllByRole('status', { name: /New session/ })).toHaveLength(1)
    expect(within(screen.getByRole('button', { name: /^devbox/ }).closest('.mx-machine') as HTMLElement).queryByRole('status')).toBeNull()
  })
})

describe('with nothing running', () => {
  it('says how to start one, under no heading', () => {
    show([])
    expect(screen.getByText('Chats and shells you start appear here, sorted by what needs you.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^This computer/ })).toBeNull()
  })

  it('says nothing is running only once the daemon has listed its sessions', () => {
    show([], { listed: false })
    expect(screen.queryByText('No agents running. New chat starts one.')).toBeNull()
    expect(screen.getByText('Looking for your sessions…')).toBeTruthy()
  })
})

describe('the tree of machine, project and status', () => {
  const SHOP = { cwd: '/home/me/shop', folder: '/home/me/shop' }
  const NOW = Math.floor(Date.now() / 1000)
  /** When a session last changed state, `ago` seconds back. */
  const changed = (ago: number) => ({ details: { since: NOW - ago } as NonNullable<Conversation['details']> })
  const mixed = () => [
    session(1, { ...SHOP, agent: 'claude', named: true, title: 'Idle old', ...changed(900) }),
    session(2, { ...SHOP, agent: 'claude', named: true, title: 'Busy', status: 'working', ...changed(60) }),
    session(3, { ...SHOP, agent: 'claude', named: true, title: 'Asking', status: 'needs-you', ...changed(30) }),
    session(4, { ...SHOP, agent: 'claude', named: true, title: 'Idle new', ...changed(120) }),
    session(5, { ...SHOP, agent: 'claude', named: true, title: 'Finished', status: 'done', ...changed(300) }),
  ]
  const statusHeads = (project: HTMLElement) => Array.from(project.querySelectorAll('.mx-status-head .mx-section-name')).map((head) => head.textContent)
  const projectOf = (name: string) => screen.getByRole('button', { name, expanded: true }).closest('.mx-project') as HTMLElement

  it('lists every machine\'s opened projects, one with no sessions too, and under each project its sessions', () => {
    const sessions = [
      session(1, { ...SHOP, agent: 'claude', named: true, title: 'Here' }),
      session(2, { ...SHOP, agent: 'claude', named: true, title: 'Also here' }),
      session(3, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There', cwd: '/srv/api', folder: '/srv/api' }),
    ]
    show(sessions, { machines: [LOCAL_HEAD, DEVBOX], projects: groupByProject(sessions, [{ machineName: null, folder: '/home/me/notes' }]).machines })
    const here = screen.getByRole('group', { name: 'Projects on This computer' })
    expect(within(here).getAllByRole('button', { expanded: true }).map((head) => head.textContent)).toEqual(['notes', 'shop'])
    expect(within(projectOf('notes')).getByText('No sessions')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'shop' })).getAllByRole('listitem')).toHaveLength(2)
    const there = screen.getByRole('group', { name: 'Projects on devbox' })
    expect(within(within(there).getByRole('list', { name: 'api' })).getByRole('button', { name: /^There,/ })).toBeTruthy()
  })

  it('names a git project by its repository and gives it the folder as its tooltip', () => {
    show([session(1, { agent: 'claude', named: true, title: 'Coding', repo: 'Storefront', folder: '/home/me/code/storefront', cwd: '/home/me/code/storefront' })])
    const head = screen.getByRole('button', { name: 'Storefront', expanded: true })
    expect(head).toHaveAttribute('title', '/home/me/code/storefront')
  })

  it('counts a same-named folder on two machines as two projects, one under each machine', () => {
    show([
      session(1, { ...SHOP, agent: 'claude', named: true, title: 'Here' }),
      session(2, { ...SHOP, machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' }),
    ], { machines: [LOCAL_HEAD, DEVBOX] })
    expect(within(screen.getByRole('group', { name: 'Projects on This computer' })).getByRole('button', { name: /^Here,/ })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Projects on devbox' })).getByRole('button', { name: /^There,/ })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'shop', expanded: true })).toHaveLength(2)
  })

  it('orders a project\'s sessions Needs you, Working, Done, Idle, the latest change first, with a heading only for a status that has sessions', () => {
    show(mixed())
    expect(names()).toEqual(['Asking', 'Busy', 'Finished', 'Idle new', 'Idle old'])
    expect(statusHeads(projectOf('shop'))).toEqual(['Needs you', 'Working', 'Done', 'Idle'])
    expect(within(screen.getByRole('list', { name: 'Idle in shop' })).getAllByRole('listitem')).toHaveLength(2)
    cleanup()
    show(mixed().filter((row) => row.status !== 'working'))
    expect(statusHeads(projectOf('shop'))).toEqual(['Needs you', 'Done', 'Idle'])
  })

  it('lists a shell with the agents by its status, with no heading of its own', () => {
    show([session(9, { ...SHOP, named: true, title: 'Dev server', status: 'working', ...changed(10) }), ...mixed()])
    expect(within(screen.getByRole('list', { name: 'Working in shop' })).getByRole('button', { name: /^Dev server,/ })).toBeTruthy()
    expect(statusHeads(projectOf('shop'))).toEqual(['Needs you', 'Working', 'Done', 'Idle'])
  })

  it('shows no status heading in a project of one or two sessions: the row\'s dot says the status', () => {
    show([
      session(1, { ...SHOP, agent: 'claude', named: true, title: 'Busy', status: 'working' }),
      session(2, { ...SHOP, agent: 'claude', named: true, title: 'Asking', status: 'needs-you' }),
      session(3, { agent: 'claude', named: true, title: 'Alone', status: 'done', cwd: '/home/me/solo', folder: '/home/me/solo' }),
    ])
    expect(document.querySelector('.mx-status-head')).toBeNull()
    expect(names()).toEqual(['Asking', 'Busy', 'Alone'])
  })

  it('turns the status headings off everywhere with the setting, and keeps the order', () => {
    show(mixed(), { statusHeadings: false })
    expect(document.querySelector('.mx-status-head')).toBeNull()
    expect(names()).toEqual(['Asking', 'Busy', 'Finished', 'Idle new', 'Idle old'])
  })

  it('colours a status heading\'s title and its count by that status', () => {
    show(mixed())
    for (const [name, tone] of [['Needs you', 'needs'], ['Working', 'working'], ['Done', 'done'], ['Idle', 'idle']] as const) {
      const head = Array.from(document.querySelectorAll<HTMLElement>('.mx-status-head')).find((candidate) => candidate.querySelector('.mx-section-name')?.textContent === name)
      expect(head).toHaveAttribute('data-tone', tone)
      expect(head?.querySelector('.mx-section-count')).toHaveAttribute('data-tone', tone)
    }
  })

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
    const view = show(sessions)
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

  it('lists a worktree\'s session under its repository\'s project, with project / worktree on its second line and no level of its own', () => {
    const repo = { agent: 'claude', repo: 'shop', folder: '/home/me/shop' } as const
    show([
      session(1, { ...repo, named: true, title: 'Main', branch: 'main', cwd: '/home/me/shop' }),
      session(2, { ...repo, named: true, title: 'Feature', branch: 'feat-x', linked: true, cwd: '/home/me/.maiker/worktrees/shop/feat-x' }),
    ])
    expect(document.querySelectorAll('.mx-project')).toHaveLength(1)
    expect(document.querySelector('.mx-project .mx-project')).toBeNull()
    const line = screen.getByRole('button', { name: /^Feature,/ }).querySelector('.mx-row-sub')
    expect(line?.querySelector('.mx-row-project-name')?.textContent).toBe('shop')
    expect(line?.querySelector('.mx-row-branch-name')?.textContent).toBe('feat-x')
    expect(within(screen.getByRole('list', { name: 'shop' })).getAllByRole('listitem')).toHaveLength(2)
  })

  it('names another machine by its given name, with no native tooltip, on a put-away row', async () => {
    writeMachineNicknames({ devbox: 'Kingdom' })
    try {
      show([session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There', repo: 'app2', archived: true })], { machines: [LOCAL_HEAD, DEVBOX] })
      await userEvent.click(screen.getByRole('button', { name: /^Put away/ }))
      expect(within(screen.getByRole('button', { name: /^There,/ })).getByText('Kingdom')).not.toHaveAttribute('title')
    } finally {
      writeMachineNicknames({})
    }
  })

  it('keeps a saved machine with no sessions as a card of its own: Offline with Fix, and "No sessions yet"', () => {
    const onFixMachine = vi.fn()
    const down: MachineHead = { ...DEVBOX, down: true, chip: { glyph: '●', word: 'unreachable', tone: 'bad' } }
    show(mixed(), { machines: [LOCAL_HEAD, down], onFixMachine })
    const card = screen.getByRole('group', { name: 'Projects on devbox' }).closest<HTMLElement>('.mx-machine') as HTMLElement
    expect(within(card).getByText('Offline')).toBeTruthy()
    expect(within(card).getByText('No sessions yet')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Fix devbox' }))
    expect(onFixMachine).toHaveBeenCalledWith(down)
  })

  it('shows a session that has done nothing as an italic "New session"', () => {
    show([session(1, { agent: 'claude' })])
    const row = screen.getByRole('button', { name: /^New session,/ })
    expect(row).toHaveClass('is-fresh')
    expect(row.querySelector('.mx-row-name')).toHaveTextContent('New session')
  })
})

describe('the top of the sidebar', () => {
  it('opens the start menu from New session, and the search from Search', async () => {
    const user = userEvent.setup()
    const onSearch = vi.fn()
    show([], { onSearch })
    await user.click(screen.getByRole('button', { name: /^New session/ }))
    expect(await screen.findByRole('menu', { name: 'Start' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /^Search/ }))
    expect(onSearch).toHaveBeenCalledTimes(1)
  })

  it('is the design\'s rail: expand, search and new session on top, one status-icon row per chat in the list\'s groups, Settings below', async () => {
    const user = userEvent.setup()
    const onShowSession = vi.fn()
    const sessions = [session(1, { agent: 'claude', named: true, title: 'Waiting', status: 'needs-you' }), session(2, { agent: 'claude', named: true, title: 'Busy', status: 'working' })]
    show(sessions, { mode: 'rail', onShowSession, focusedId: sessions[0]?.id ?? null })
    for (const name of ['Expand sidebar', 'Search', 'New session', 'Settings']) expect(screen.getByRole('button', { name })).toBeTruthy()
    // No tile, no initials, no connection dot and no Recent sessions button (it is in the palette).
    expect(screen.queryByRole('button', { name: 'Recent sessions' })).toBeNull()
    expect(document.querySelector('.mx-daemon-dot, .mx-app-icon')).toBeNull()
    expect(screen.getAllByRole('separator')).toHaveLength(1)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.classList.contains('is-selected')).toBe(true)
    await user.click(screen.getByRole('button', { name: /^Busy/ }))
    expect(onShowSession).toHaveBeenCalledWith(sessions[1]?.id)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('button', { name: /^Busy/ }) })
    expect(await screen.findByRole('menuitem', { name: 'Open' })).toBeTruthy()
  })

  it('has one plus button, in the header and the rail, that opens the start menu; no second terminal button', async () => {
    const user = userEvent.setup()
    const view = show([])
    expect(screen.queryByRole('button', { name: 'New terminal' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'New session' }))
    expect(await screen.findByRole('menu', { name: 'Start' })).toBeTruthy()
    await user.keyboard('{Escape}')
    view.again({ mode: 'rail' })
    expect(screen.queryByRole('button', { name: 'New terminal' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'New session' }))
    expect(await screen.findByRole('menu', { name: 'Start' })).toBeTruthy()
    await user.keyboard('{Escape}')
    view.again({ mode: 'rail', canStart: false })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'New session' }).disabled).toBe(true)
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

  it('keeps the filter button for the project filter alone: no Group or Sort row', async () => {
    const user = userEvent.setup()
    show([session(1, { agent: 'claude', named: true, title: 'A' })])
    await user.click(screen.getByRole('button', { name: 'Filter and group: All projects' }))
    expect(screen.getByRole('dialog', { name: 'Group, sort and filter' })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Group' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Sort' })).toBeNull()
  })

  it('narrows the tree to one project, and back to all of them, with the menu staying open', async () => {
    const user = userEvent.setup()
    show([session(1, { agent: 'claude', named: true, title: 'Alpha', cwd: '/home/me/shop', folder: '/home/me/shop' }), session(2, { agent: 'claude', named: true, title: 'Beta', cwd: '/home/me/docs', folder: '/home/me/docs' })])
    const names = () => screen.getAllByRole('button', { name: /^(Alpha|Beta),/ }).map((row) => row.querySelector('.mx-row-name')?.textContent)
    await user.click(screen.getByRole('button', { name: 'Filter and group: All projects' }))
    await user.click(within(screen.getByRole('group', { name: 'Show projects' })).getByRole('button', { name: /^docs/ }))
    expect(names()).toEqual(['Beta'])
    expect(screen.queryByRole('button', { name: 'shop', expanded: true })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Group, sort and filter' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^All projects/ }))
    expect(names()).toEqual(['Alpha', 'Beta'])
  })

  it('lists the busiest project first and finds one by typing', async () => {
    const user = userEvent.setup()
    show([
      session(1, { named: true, title: 'A1', cwd: '/home/me/solo' }),
      session(2, { named: true, title: 'B1', cwd: '/home/me/busy' }),
      session(3, { named: true, title: 'B2', cwd: '/home/me/busy' }),
    ])
    await user.click(screen.getByRole('button', { name: /^Filter and group/ }))
    const group = screen.getByRole('group', { name: 'Show projects' })
    expect(within(group).getAllByRole('button').map((button) => button.querySelector('.mx-grp-name')?.textContent)).toEqual(['All projects', 'busy', 'solo'])
    await user.type(screen.getByRole('textbox', { name: 'Filter projects' }), 'so')
    expect(within(group).getAllByRole('button').map((button) => button.querySelector('.mx-grp-name')?.textContent)).toEqual(['solo'])
    await user.type(screen.getByRole('textbox', { name: 'Filter projects' }), 'zz')
    expect(within(group).getByText('No project matches.')).toBeTruthy()
  })

  it('has no Terminals section: a shell is a row like the others', () => {
    show([session(1, { agent: 'claude', named: true, title: 'Agent' }), session(2, { named: true, title: 'Shell' })])
    expect(screen.queryByRole('region', { name: 'Terminals' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Shell,/ })).toBeTruthy()
  })

  it('shows a shell in the rail like any other session, with no terminal glyph', () => {
    show([session(1, { agent: 'claude', named: true, title: 'Agent' }), session(2, { named: true, title: 'Shell' })], { mode: 'rail' })
    expect(screen.getAllByRole('button', { name: /^(Agent|Shell)/ })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Terminals/ })).toBeNull()
  })
})

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

describe('one name for starting an agent', () => {
  const OLD = /^New (agent )?chat/i

  it('is New session on the header button, the rail and a machine\'s menu, never New chat or New agent chat', () => {
    const view = show([session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, DEVBOX] })
    expect(screen.getByRole('button', { name: 'New session' })).toBeTruthy()
    for (const button of screen.getAllByRole('button')) expect(button.getAttribute('aria-label') ?? '').not.toMatch(OLD)
    view.again({ mode: 'rail' })
    expect(screen.getByRole('button', { name: 'New session' })).toBeTruthy()
    for (const button of screen.getAllByRole('button')) expect(button.getAttribute('aria-label') ?? '').not.toMatch(OLD)
  })
})

describe('the filter button', () => {
  it('stays plain on the default filter, and turns to the accent once a project is picked', async () => {
    const user = userEvent.setup()
    show([session(1, { agent: 'claude', named: true, title: 'A', repo: 'alpha' }), session(2, { agent: 'claude', named: true, title: 'B', repo: 'beta' })])
    const button = () => screen.getByRole('button', { name: /^Filter and group/ })
    expect(button()).toHaveAttribute('data-on', 'false')
    await user.click(button())
    await user.click(within(screen.getByRole('group', { name: 'Show projects' })).getByRole('button', { name: /^alpha/ }))
    expect(button()).toHaveAttribute('data-on', 'true')
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(button()).toHaveAttribute('data-on', 'false')
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

describe('the group cards', () => {
  it('gives a machine group a monitor or server icon and its own plus that opens the start menu on that machine', async () => {
    show([session(1, { agent: 'claude', named: true, title: 'Here' })], { machines: [LOCAL_HEAD, DEVBOX] })
    await userEvent.click(screen.getByRole('button', { name: 'Add a session to devbox' }))
    expect(await screen.findByText('On devbox')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Add a session to This computer' })).toBeInTheDocument()
  })
})

