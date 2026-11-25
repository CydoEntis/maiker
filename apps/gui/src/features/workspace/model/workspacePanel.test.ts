import { describe, expect, it } from 'vitest'
import type { SavedSession } from '@/api/daemon'
import type { Conversation } from '@/data/preview'
import { groupByProject, type OpenedProject } from './openedProjects'
import { toSessionView, type SessionView } from './session'
import { rowWhen, rowWhere, tickableWorktrees, workspaceRows, workspaceTargetOf, worktreeRows, worktreeWhen, worktreeWhere, type WorktreeRow } from './workspacePanel'

const NOW = 2_000_000_000
const HOUR = 3600
const MS_PER_SECOND = 1000
const SHOP: OpenedProject = { machineName: null, folder: '/home/me/shop' }
const NOTES: OpenedProject = { machineName: null, folder: '/home/me/notes' }
const API: OpenedProject = { machineName: 'devbox', folder: '/srv/api' }

function session(pane: number, title: string, extra: Partial<Conversation> = {}, view: Partial<SessionView> = {}): SessionView {
  const cwd = extra.cwd ?? SHOP.folder
  return {
    ...toSessionView(
      { id: `t${String(pane)}`, generation: 0, kind: 'terminal', title, named: true, project: '', folder: cwd, cwd, repo: 'shop', branch: 'main', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: 'claude', ...extra },
      '/home/me',
    ),
    ...view,
  }
}

function saved(id: string, at: number, extra: Partial<SavedSession> = {}): SavedSession {
  return { agent: 'claude', session: id, cwd: SHOP.folder, branch: 'feat/login', title: `Saved ${id}`, at, worktree: null, repo: null, ...extra }
}

describe('the workspace rows', () => {
  it('lists the running sessions first, then the saved ones newest first', () => {
    const rows = workspaceRows(
      [session(1, 'Fix the login', {}, { statusSince: (NOW - HOUR) * MS_PER_SECOND }), session(2, 'Port the parser', {}, { ended: true })],
      [saved('old', NOW - 3 * HOUR), saved('new', NOW - HOUR)],
    )
    expect(rows.map((row) => [row.name, row.state])).toEqual([
      ['Fix the login', 'running'],
      ['Port the parser', 'ended'],
      ['Saved new', 'closed'],
      ['Saved old', 'closed'],
    ])
  })

  it('leaves out plain terminals and a saved session whose conversation runs again', () => {
    const rows = workspaceRows(
      [session(1, 'Again', {}, { agentSession: 'abc' }), session(2, 'A shell', {}, { process: 'shell' })],
      [saved('abc', NOW - HOUR), saved('abc', NOW - HOUR, { agent: 'codex', title: 'Same id, other agent' })],
    )
    expect(rows.map((row) => row.name)).toEqual(['Again', 'Same id, other agent'])
  })

  it('says the agent and branch, and the state with how long ago', () => {
    const [running, closed] = workspaceRows([session(1, 'Fix', {}, { statusSince: (NOW - 2 * HOUR) * MS_PER_SECOND })], [saved('a', NOW - HOUR, { agent: 'codex', branch: null, title: null })])
    if (running === undefined || closed === undefined) throw new Error('two rows expected')
    expect(rowWhere(running)).toBe('Claude · main')
    expect(rowWhen(running, NOW)).toBe('running · 2h ago')
    expect(closed.name).toBe('Codex session')
    expect(rowWhere(closed)).toBe('Codex')
    expect(rowWhen(closed, NOW)).toBe('closed · 1h ago')
  })
})

describe('the project Workspace… opens from the palette', () => {
  it('is the project in front, else the one picked, and only on this computer', () => {
    const notes = session(1, 'Notes work', { cwd: NOTES.folder, repo: null })
    const there = session(2, 'There', { machine: 4, machineName: 'devbox', cwd: API.folder, repo: 'api' })
    const { machines } = groupByProject([notes, there], [SHOP])
    expect(workspaceTargetOf(machines, 't1', SHOP)).toEqual({ project: { machineName: null, folder: NOTES.folder }, name: 'notes' })
    expect(workspaceTargetOf(machines, null, SHOP)).toEqual({ project: SHOP, name: 'shop' })
    expect(workspaceTargetOf(machines, 't2', null)).toBeNull()
  })

  it('is never the No project group, which is no project', () => {
    const loose = session(1, 'Loose', { cwd: '/home/me', repo: null })
    const { machines } = groupByProject([loose], [], '/home/me')
    expect(machines[0]?.projects[0]?.loose).toBe(true)
    expect(workspaceTargetOf(machines, 't1', null)).toBeNull()
  })
})

describe('the workspace worktree rows', () => {
  const READ = { dirty: 0, branch: 'b', merged: true, last_commit: '2 days ago', inactive_days: null, missing: false }
  const MAIN = { path: '/code/shop', branch: 'main', main: true, when: null }
  const FIX = { path: '/code/shop-fix', branch: 'fix', main: false, when: null }
  const DETACHED = { path: '/code/shop-detached', branch: null, main: false, when: null }

  it('keeps git’s order, keys each by its folder, and names one on no branch by its folder', () => {
    const rows = worktreeRows([MAIN, FIX, DETACHED], () => ({ kind: 'checking' }))
    expect(rows.map((row) => [row.key, row.name, row.main])).toEqual([
      ['worktree:/code/shop', 'main', true],
      ['worktree:/code/shop-fix', 'fix', false],
      ['worktree:/code/shop-detached', 'shop-detached', false],
    ])
  })

  it('never offers the main checkout a tick', () => {
    const rows = worktreeRows([MAIN, FIX, DETACHED], () => ({ kind: 'checking' }))
    expect(tickableWorktrees({ kind: 'listed', rows }).map((row) => row.name)).toEqual(['fix', 'shop-detached'])
    expect(tickableWorktrees({ kind: 'loading' })).toEqual([])
  })

  it('says what is on a worktree once its standing is read, and checking until then', () => {
    const says = (rows: readonly WorktreeRow[]) => rows.map((row) => [worktreeWhere(row), worktreeWhen(row)])
    expect(says(worktreeRows([MAIN, FIX], () => ({ kind: 'read', standing: { ...READ, dirty: 1, inactive_days: 1 } })))).toEqual([
      ['main checkout · stays', ''],
      ['1 uncommitted change · merged', 'inactive 1 day'],
    ])
    expect(says(worktreeRows([FIX], () => ({ kind: 'read', standing: { ...READ, merged: false } })))).toEqual([['nothing uncommitted · not merged', '2 days ago']])
    expect(says(worktreeRows([FIX], () => ({ kind: 'checking' })))).toEqual([['checking…', '']])
    expect(says(worktreeRows([FIX], () => ({ kind: 'read', standing: { ...READ, missing: true } })))).toEqual([['its folder is gone', '']])
    expect(says(worktreeRows([FIX], () => ({ kind: 'failed', why: 'No answer.' })))).toEqual([['could not check where it stands', '']])
  })
})
