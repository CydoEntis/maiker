import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/data/preview'
import { writeMachineNicknames } from '@/data/machineNicknames'
import { LOCAL_HEAD, type MachineHead } from '../model/machines'
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


function show(sessions: SessionView[], more: Partial<SidebarProps> = {}) {
  const none = vi.fn()
  const props: SidebarProps = {
    sessions, listed: true, machines: [LOCAL_HEAD], order: 'creation', focusedId: null, mode: 'docked', online: true, canStart: true, portalContainer: null,
    onToggleRail: none, side: 'left', width: 264, onResize: none, onResizeEnd: none, grouping: 'machine', onGrouping: none, onSearch: none,
    onNewSession: none, onNewShell: none, onAddMachine: none, onMachineSettings: none, onRenameMachine: none, onUpdateMachine: none, onShowSession: none, onRenameSession: none,
    onSplitSession: none, onCopyPath: none, onCopyText: none, onShowChanges: none, onMarkDone: none, onPutAway: none, onBringBack: none, onSnooze: none, onUnsnooze: none, onGetFile: none,
    onEndSession: none, onOpenSettings: none, onRecentSessions: none, updateSlot: null, railUpdateSlot: null,
    ...more,
  }
  const view = render(<Sidebar {...props} />)
  // Draws the same sidebar again with some props changed, as the window does when the selection moves.
  return { ...view, again: (next: Partial<SidebarProps>) => { view.rerender(<Sidebar {...props} {...next} />) } }
}

const rows = () => screen.getAllByRole('button', { name: /, (idle|working|needs you|finished|stopped|offline)$/ })
const names = () => rows().map((row) => row.getAttribute('aria-label')?.split(',')[0])

describe('the sidebar', () => {
  it('groups sessions by machine, this computer first, each with its count', () => {
    show([session(1, { agent: 'claude', named: true, title: 'Here' }), session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, DEVBOX] })
    const here = screen.getByRole('list', { name: 'Sessions on This computer' })
    const there = screen.getByRole('list', { name: 'Sessions on devbox' })
    expect(within(here).getByRole('button', { name: /^Here,/ })).toBeTruthy()
    expect(within(there).getByRole('button', { name: /^There,/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^This computer/, expanded: true })).toHaveTextContent('1')
  })

  it('leaves the machine off a row under its own machine heading', () => {
    show([session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There', repo: 'app2', branch: 'feat/remote-branch' })], { machines: [LOCAL_HEAD, DEVBOX] })
    const text = screen.getByRole('button', { name: /^There,/ }).querySelector('.mx-row-text')?.textContent ?? ''
    expect(text).toMatch(/^There/)
    expect(text).not.toContain('devbox')
  })

  const MIXED = () => [
    session(1, { named: true, title: 'Exited shell', details: { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, exit: { code: 1, at: 1 } } }),
    session(2, { agent: 'claude', named: true, title: 'Idle agent' }),
    session(3, { agent: 'claude', named: true, title: 'Working', status: 'working' }),
    session(4, { agent: 'claude', named: true, title: 'Asking', status: 'needs-you' }),
    session(5, { agent: 'claude', named: true, title: 'Finished', status: 'done' }),
  ]

  it('keeps sessions in the order they were created, so a row never moves when its state changes', () => {
    show(MIXED())
    // A shell is an ordinary row, in the order it was created.
    expect(names()).toEqual(['Exited shell', 'Idle agent', 'Working', 'Asking', 'Finished'])
    expect(screen.getByRole('button', { name: /^Exited shell/ })).toHaveTextContent('exited')
  })

  it('lists a session stopped by its plan limit under Needs you, saying until when', () => {
    const resume = new Date(2026, 0, 5, 14, 5).getTime()
    const details = { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, resumeAt: resume / 1000 }
    const today = vi.spyOn(Date, 'now').mockReturnValue(resume - 60_000)
    try {
      const limited = session(6, { agent: 'claude', named: true, title: 'Out of plan', status: 'done', details })
      show([session(2, { agent: 'claude', named: true, title: 'Idle agent' }), limited], { grouping: 'status' })
      const row = within(screen.getByRole('list', { name: 'Needs you' })).getByRole('button', { name: 'Out of plan, claude, limited until 14:05' })
      expect(row).toHaveTextContent('limited until 14:05')
    } finally {
      today.mockRestore()
    }
  })

  it('moves only a session that needs you to the top when the order is priority', () => {
    show(MIXED(), { order: 'priority' })
    expect(names()).toEqual(['Asking', 'Exited shell', 'Idle agent', 'Working', 'Finished'])
  })

  it('puts the name first and the folder, project and branch under it', () => {
    show([session(1, { agent: 'claude', named: true, title: 'Growth', repo: 'AeVoxGrowth', branch: 'agent/grow-025', folder: '/home/me/AeVoxGrowth', cwd: '/home/me/AeVoxGrowth' }), session(2, { cwd: '/home/me/dev', folder: '/home/me/dev' })])
    const growth = screen.getByRole('button', { name: /^Growth,/ })
    expect(growth.querySelector('.mx-row-name')?.textContent).toBe('Growth')
    expect(growth.querySelector('.mx-row-project-name')?.textContent).toBe('AeVoxGrowth')
    expect(growth.querySelector('.mx-row-branch-name')?.textContent).toBe('agent/grow-025')
    expect(screen.getByRole('button', { name: /^dev, shell/ })).toBeTruthy()
  })

  it('has no group-by-project toggle on a machine: one list, and no such entry in its menu', () => {
    show([session(1, { agent: 'claude', cwd: '/home/me/a', folder: '/home/me/a' }), session(2, { agent: 'claude', cwd: '/home/me/b', folder: '/home/me/b' })])
    expect(screen.queryByRole('button', { name: /Group by project|Show one list/ })).toBeNull()
    expect(screen.getByRole('list', { name: 'Sessions on This computer' })).toBeTruthy()
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

  it('offers Install in its header, and its dot says it is not installed', async () => {
    const user = userEvent.setup()
    const onUpdateMachine = vi.fn()
    show([], { machines: [LOCAL_HEAD, needing('install')], onUpdateMachine })
    expect(screen.getByRole('img', { name: /^devbox is / })).toHaveClass('is-warn')
    await user.click(screen.getByRole('button', { name: 'Install Maiker on devbox' }))
    expect(onUpdateMachine).toHaveBeenCalledWith('devbox', 'install')
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
  it('puts the status icon at the right of the name and, under it, the time the window has known the session at the right of the place', () => {
    show([session(1, { agent: 'claude', named: true, title: 'Timed' })])
    const row = screen.getByRole('button', { name: /^Timed,/ })
    expect(row.querySelector('.mx-row-title .mx-row-status')).not.toBeNull()
    expect(row.querySelector('.mx-row-sub .mx-row-when')).toHaveTextContent('now')
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
    ], { grouping: 'status' })
    expect(names()).toEqual(['Here'])
    const head = screen.getByRole('button', { name: /^Put away/, expanded: false })
    expect(head).toHaveTextContent('2')
    await userEvent.click(head)
    const list = screen.getByRole('list', { name: 'Put away' })
    expect(within(list).getAllByRole('button', { name: /, (idle|finished)$/ }).map((row) => row.getAttribute('aria-label')?.split(',')[0])).toEqual(['Away agent', 'Away shell'])
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
      show([snoozed, session(2, { agent: 'claude', named: true, title: 'Here' })], { grouping: 'status', onUnsnooze })
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

  it('lists a put-away session that needs you under Needs you, not under Put away', () => {
    show([session(1, { agent: 'claude', named: true, title: 'Asking', status: 'needs-you', archived: true })], { grouping: 'status' })
    expect(within(screen.getByRole('list', { name: 'Needs you' })).getByRole('button', { name: /^Asking,/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Put away/ })).toBeNull()
  })

  it('offers no Get a file on a session of this computer', () => {
    show([session(1, { agent: 'claude' })])
    fireEvent.contextMenu(screen.getByRole('button', { name: /^claude,/ }))
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
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }))
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

  it('offers the session menu on right-click, and hands Stop session to the app, which asks first', async () => {
    const user = userEvent.setup()
    const onEndSession = vi.fn()
    show([session(1, { agent: 'claude', named: true, title: 'Growth' }), session(2)], { focusedId: 't2', onEndSession })
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Growth,/ }))
    const menu = screen.getByRole('menu', { name: 'Growth' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Open', 'Open in split right', 'Open in split down', 'Show changes', 'Rename…F2', 'Copy folder path', 'Stop session'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Stop session' }))
    expect(onEndSession).toHaveBeenCalledWith('t1')
  })

  it('offers Close shell, not Stop, for a shell', () => {
    show([session(1)])
    fireEvent.contextMenu(screen.getByRole('button', { name: /^app1,/ }))
    expect(screen.getByRole('menuitem', { name: 'Close shell' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'New terminal' })).toBeNull()
  })
})

describe('a machine heading', () => {
  it('starts a session or a terminal on that machine from its right-click menu, not from a +', async () => {
    const user = userEvent.setup()
    const onNewSession = vi.fn()
    const onNewShell = vi.fn()
    show([session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, DEVBOX], onNewSession, onNewShell })
    expect(screen.queryByRole('button', { name: /^New (session|agent chat) on / })).toBeNull()
    fireEvent.contextMenu(screen.getByRole('button', { name: /^devbox/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'New session here' }))
    expect(onNewSession).toHaveBeenCalledWith(4)
    fireEvent.contextMenu(screen.getByRole('button', { name: /^devbox/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'New terminal here' }))
    expect(onNewShell).toHaveBeenCalledWith(4)
  })

  it('collapses its sessions when the name is clicked', async () => {
    const user = userEvent.setup()
    show([session(1, { agent: 'claude', named: true, title: 'Here' })])
    await user.click(screen.getByRole('button', { name: /^This computer/ }))
    expect(screen.getByRole('button', { name: /^This computer/, expanded: false })).toBeTruthy()
  })
})

describe('closing a session', () => {
  it('has no close button on a row: it is in the right-click menu, where a shell says Close and an agent Stop', async () => {
    const onEndSession = vi.fn()
    show([session(1, { agent: 'claude', named: true, title: 'Growth' }), session(2, { named: true, title: 'Shell' })], { onEndSession })
    expect(screen.queryByRole('button', { name: /^(Stop|Close) / })).toBeNull()
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Growth,/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^Stop session/ }))
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
    show([session(1, { agent: 'claude', named: true, title: 'First' }), session(2, { agent: 'claude', named: true, title: 'Second', status: 'needs-you' })], { draft: { machine: 0, process: 'claude' }, order: 'priority' })
    const draft = screen.getByRole('status', { name: 'New session, waiting for the first message' })
    const rows = Array.from((screen.getByRole('button', { name: /^This computer/ }).closest('.mx-machine') as HTMLElement).querySelectorAll('.mx-row-wrap'))
    expect(rows.at(-1)).toBe(draft)
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
    expect(within(screen.getByRole('list', { name: 'Sessions on devbox' })).queryByRole('status')).toBeNull()
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

describe('grouped by status', () => {
  const mixed = () => [
    session(1, { agent: 'claude', named: true, title: 'Idle one' }),
    session(2, { agent: 'claude', named: true, title: 'Busy', status: 'working' }),
    session(3, { agent: 'claude', named: true, title: 'Asking', status: 'needs-you' }),
    session(4, { agent: 'claude', named: true, title: 'Finished one', status: 'done' }),
  ]

  it('lists what needs you, then working, finished and idle, each with its count, and leaves out a status nothing has', () => {
    show(mixed(), { grouping: 'status' })
    expect(screen.getAllByRole('list').map((list) => list.getAttribute('aria-label'))).toEqual(['Needs you', 'Working', 'Finished', 'Idle'])
    expect(within(screen.getByRole('list', { name: 'Needs you' })).getByRole('button', { name: /^Asking,/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Needs you\s*1$/ })).toBeTruthy()
    cleanup()
    show([session(1, { agent: 'claude', named: true, title: 'Idle one' })], { grouping: 'status' })
    expect(screen.getAllByRole('list').map((list) => list.getAttribute('aria-label'))).toEqual(['Idle'])
  })

  it('lists a shell with the agents by its status, with no section of its own', () => {
    show([session(9, { named: true, title: 'Dev server', status: 'working' }), ...mixed()], { grouping: 'status' })
    expect(screen.getAllByRole('list').map((list) => list.getAttribute('aria-label'))).toEqual(['Needs you', 'Working', 'Finished', 'Idle'])
    expect(within(screen.getByRole('list', { name: 'Working' })).getByRole('button', { name: /^Dev server,/ })).toBeTruthy()
  })

  it('says which other machine a row runs on, since no heading does', () => {
    show([session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, DEVBOX], grouping: 'status' })
    expect(within(screen.getByRole('button', { name: /^There,/ })).getByText('devbox')).toBeTruthy()
  })

  it('names another machine by its given name, with no native tooltip, and this computer not at all', () => {
    writeMachineNicknames({ devbox: 'Kingdom' })
    try {
      show([
        session(1, { agent: 'claude', named: true, title: 'Here', repo: 'app1', branch: 'feat/local-branch' }),
        session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There', repo: 'app2', branch: 'feat/remote-branch' }),
      ], { machines: [LOCAL_HEAD, DEVBOX], grouping: 'status' })
      const there = screen.getByRole('button', { name: /^There,/ })
      expect(within(there).getByText('Kingdom')).not.toHaveAttribute('title')
      const here = screen.getByRole('button', { name: /^Here,/ })
      expect(here.querySelector('.mx-row-machine')).toBeNull()
    } finally {
      writeMachineNicknames({})
    }
  })

  it('folds a section away from its heading', async () => {
    const user = userEvent.setup()
    show(mixed(), { grouping: 'status' })
    const head = screen.getByRole('button', { name: /^Working/ })
    expect(head).toHaveAttribute('aria-expanded', 'true')
    await user.click(head)
    expect(head).toHaveAttribute('aria-expanded', 'false')
  })

  it('lists a draft chat first, above every section', () => {
    show(mixed(), { grouping: 'status', draft: { machine: 0, process: 'claude' } })
    const draft = screen.getByRole('status', { name: 'New session, waiting for the first message' })
    expect(Array.from(document.querySelectorAll('.mx-row-wrap'))[0]).toBe(draft)
  })

  it('still offers Update for a machine that needs the app, under the list', () => {
    const onUpdateMachine = vi.fn()
    show(mixed(), { grouping: 'status', machines: [LOCAL_HEAD, { ...DEVBOX, updateAction: 'update' }], onUpdateMachine })
    const notes = screen.getByRole('group', { name: 'Machines that need Maiker' })
    fireEvent.click(within(notes).getByRole('button', { name: 'Update Maiker on devbox' }))
    expect(onUpdateMachine).toHaveBeenCalledWith('devbox', 'update')
  })
})

describe('grouped by project', () => {
  it('gives every project a heading, and a project on another machine one that names the machine', () => {
    show([
      session(1, { agent: 'claude', named: true, title: 'Here', cwd: '/home/me/shop' }),
      session(2, { agent: 'claude', named: true, title: 'Also here', cwd: '/home/me/shop' }),
      session(3, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There', cwd: '/home/me/shop' }),
    ], { machines: [LOCAL_HEAD, DEVBOX], grouping: 'project' })
    expect(within(screen.getByRole('list', { name: 'shop' })).getAllByRole('listitem')).toHaveLength(2)
    expect(within(screen.getByRole('list', { name: 'shop on devbox' })).getByRole('button', { name: /^There,/ })).toBeTruthy()
  })
})

describe('the top of the sidebar', () => {
  it('starts a session on this computer from New session, and opens the search from Search', async () => {
    const user = userEvent.setup()
    const onNewSession = vi.fn()
    const onSearch = vi.fn()
    show([], { onNewSession, onSearch })
    await user.click(screen.getByRole('button', { name: /^New session/ }))
    expect(onNewSession).toHaveBeenCalledWith(0)
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

  it('has one plus button, in the header and the rail, that starts a terminal; no second terminal button', async () => {
    const user = userEvent.setup()
    const onNewSession = vi.fn()
    const view = show([], { onNewSession })
    expect(screen.queryByRole('button', { name: 'New terminal' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'New session' }))
    expect(onNewSession).toHaveBeenCalledWith(0)
    view.again({ mode: 'rail', onNewSession })
    expect(screen.queryByRole('button', { name: 'New terminal' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'New session' }))
    expect(onNewSession).toHaveBeenCalledTimes(2)
    view.again({ mode: 'rail', canStart: false, onNewSession })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'New session' }).disabled).toBe(true)
  })

  it('offers a terminal and a remote machine from a right-click on New session', async () => {
    const user = userEvent.setup()
    const onNewShell = vi.fn()
    show([], { onNewShell })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'New session' }))
    expect(screen.getByRole('menuitem', { name: /Add a remote machine/ })).toBeTruthy()
    await user.click(screen.getByRole('menuitem', { name: /^New terminal/ }))
    expect(onNewShell).toHaveBeenCalledWith(0)
  })

  it('narrows the list to one project, and back to all of them, with the menu staying open', async () => {
    const user = userEvent.setup()
    show([session(1, { agent: 'claude', named: true, title: 'Alpha', cwd: '/home/me/shop' }), session(2, { agent: 'claude', named: true, title: 'Beta', cwd: '/home/me/docs' })], { grouping: 'status' })
    const names = () => screen.getAllByRole('button', { name: /^(Alpha|Beta),/ }).map((row) => row.querySelector('.mx-row-name')?.textContent)
    await user.click(screen.getByRole('button', { name: 'Filter and group: All projects' }))
    await user.click(screen.getByRole('button', { name: /^docs/ }))
    expect(names()).toEqual(['Beta'])
    expect(screen.getByRole('dialog', { name: 'Group, sort and filter' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^All projects/ }))
    expect(names()).toEqual(['Beta', 'Alpha'])
  })

  it('lists the busiest project first and finds one by typing', async () => {
    const user = userEvent.setup()
    show([
      session(1, { named: true, title: 'A1', cwd: '/home/me/solo' }),
      session(2, { named: true, title: 'B1', cwd: '/home/me/busy' }),
      session(3, { named: true, title: 'B2', cwd: '/home/me/busy' }),
    ], { grouping: 'status' })
    await user.click(screen.getByRole('button', { name: /^Filter and group/ }))
    const group = screen.getByRole('group', { name: 'Show projects' })
    expect(within(group).getAllByRole('button').map((button) => button.querySelector('.mx-grp-name')?.textContent)).toEqual(['All projects', 'busy', 'solo'])
    await user.type(screen.getByRole('textbox', { name: 'Filter projects' }), 'so')
    expect(within(group).getAllByRole('button').map((button) => button.querySelector('.mx-grp-name')?.textContent)).toEqual(['solo'])
    await user.type(screen.getByRole('textbox', { name: 'Filter projects' }), 'zz')
    expect(within(group).getByText('No project matches.')).toBeTruthy()
  })

  it('sorts newest first by default, by name on request, and Reset brings the default back', async () => {
    const user = userEvent.setup()
    show([session(1, { named: true, title: 'Mid', agent: 'claude' }), session(2, { named: true, title: 'Zed', agent: 'claude' }), session(3, { named: true, title: 'Amy', agent: 'claude' })], { grouping: 'status' })
    const names = () => screen.getAllByRole('button', { name: /^(Mid|Zed|Amy),/ }).map((row) => row.querySelector('.mx-row-name')?.textContent)
    expect(names()).toEqual(['Amy', 'Zed', 'Mid'])
    await user.click(screen.getByRole('button', { name: /^Filter and group/ }))
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
    await user.click(screen.getByRole('radio', { name: 'A–Z' }))
    expect(names()).toEqual(['Amy', 'Mid', 'Zed'])
    await user.click(screen.getByRole('radio', { name: 'Oldest' }))
    expect(names()).toEqual(['Mid', 'Zed', 'Amy'])
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(names()).toEqual(['Amy', 'Zed', 'Mid'])
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
  })

  it('asks for another grouping from the same menu', async () => {
    const user = userEvent.setup()
    const onGrouping = vi.fn()
    show([], { grouping: 'status', onGrouping })
    await user.click(screen.getByRole('button', { name: /^Filter and group/ }))
    await user.click(screen.getByRole('radio', { name: 'Project' }))
    expect(onGrouping).toHaveBeenCalledWith('project')
  })

  it('has no Terminals section under any grouping: a shell is a row like the others', () => {
    for (const grouping of ['machine', 'project', 'status'] as const) {
      show([session(1, { agent: 'claude', named: true, title: 'Agent' }), session(2, { named: true, title: 'Shell' })], { grouping })
      expect(screen.queryByRole('region', { name: 'Terminals' })).toBeNull()
      expect(screen.getByRole('button', { name: /^Shell,/ })).toBeTruthy()
      cleanup()
    }
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
  const keyFor = (sessions: SessionView[], grouping: 'status' | 'machine' = 'status') => flipKey({ sessions, grouping }, sessions, 'recent', null, false, { signature: '' }, false, '')

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
    const key = (placement: string) => flipKey({ sessions: list, grouping: 'status' }, list, 'recent', null, false, { signature: '' }, false, placement)
    expect(key('needs:t2|working:t1')).not.toBe(key('working:t1,t2'))
  })
})

describe('one name for starting an agent', () => {
  const OLD = /^New (agent )?chat/i

  it('is New session on the header button, its right-click menu, the rail and a machine\'s menu, never New chat or New agent chat', () => {
    const view = show([session(2, { machine: 4, machineName: 'devbox', agent: 'claude', named: true, title: 'There' })], { machines: [LOCAL_HEAD, DEVBOX] })
    expect(screen.getByRole('button', { name: 'New session' })).toBeTruthy()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'New session' }))
    for (const item of screen.getAllByRole('menuitem')) expect(item.textContent).not.toMatch(OLD)
    expect(screen.getByRole('menuitem', { name: /^New session/ })).toBeTruthy()
    for (const button of screen.getAllByRole('button')) expect(button.getAttribute('aria-label') ?? '').not.toMatch(OLD)
    view.again({ mode: 'rail' })
    expect(screen.getByRole('button', { name: 'New session' })).toBeTruthy()
    for (const button of screen.getAllByRole('button')) expect(button.getAttribute('aria-label') ?? '').not.toMatch(OLD)
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
