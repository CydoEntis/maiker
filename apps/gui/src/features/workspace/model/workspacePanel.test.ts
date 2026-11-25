import { describe, expect, it } from 'vitest'
import type { ClosedSession } from '@/api/daemon'
import type { Conversation } from '@/data/preview'
import { groupByProject, type OpenedProject } from './openedProjects'
import { toSessionView, type SessionView } from './session'
import { openTargets, openWords, removalCheck, removalItems, removedWords, rowWhen, rowWhere, tickableWorktrees, workspaceRows, workspaceTargetOf, worktreeRows, worktreesInUse, worktreeWhen, worktreeWhere, type LinkedWorktreeRow, type StandingRead, type WorktreeRow } from './workspacePanel'

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

function saved(id: string, at: number, extra: Partial<ClosedSession> = {}): ClosedSession {
  return { agent: 'claude', session: id, cwd: SHOP.folder, branch: 'feat/login', title: `Saved ${id}`, at, folder_present: true, worktree: null, repo: null, ...extra }
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

describe('what Open opens and what it says after', () => {
  it('opens only the closed rows, never a session already in the window', () => {
    const parser = saved('p', NOW - HOUR)
    const rows = workspaceRows([session(1, 'Running'), session(2, 'Ended', {}, { ended: true })], [parser])
    expect(openTargets(rows)).toEqual([parser])
  })

  it('counts what opened, what failed, what was skipped and what started anew, naming each skip and new one and why', () => {
    const skip = { name: 'Port the parser', why: 'folder removed; cannot be made again' }
    const anew = { name: 'Ask Gemini', why: 'Gemini cannot continue a conversation from here' }
    const cases: [Parameters<typeof openWords>[0], ReturnType<typeof openWords>][] = [
      [{ opened: 3, failed: 0, lastError: null, skipped: [], fresh: [] }, { kind: 'success', title: 'Opened 3 sessions', note: null }],
      [{ opened: 0, failed: 2, lastError: null, skipped: [], fresh: [] }, { kind: 'failed', title: 'Could not open the 2 sessions', note: null }],
      [{ opened: 2, failed: 1, lastError: null, skipped: [skip], fresh: [] }, { kind: 'failed', title: 'Opened 2, but 1 could not start, and 1 was skipped', note: null }],
      [{ opened: 1, failed: 0, lastError: null, skipped: [skip], fresh: [] }, { kind: 'warning', title: 'Opened 1 session, skipped 1', note: 'Skipped “Port the parser”: folder removed; cannot be made again.' }],
      [{ opened: 0, failed: 0, lastError: null, skipped: [skip], fresh: [] }, { kind: 'warning', title: 'Could not open 1 session', note: 'Skipped “Port the parser”: folder removed; cannot be made again.' }],
      [{ opened: 2, failed: 0, lastError: null, skipped: [], fresh: [anew] }, { kind: 'warning', title: 'Opened 2 sessions, 1 as a new conversation', note: '“Ask Gemini” started a new conversation: Gemini cannot continue a conversation from here.' }],
      [{ opened: 1, failed: 0, lastError: null, skipped: [skip], fresh: [anew] }, { kind: 'warning', title: 'Opened 1 session, skipped 1', note: 'Skipped “Port the parser”: folder removed; cannot be made again. “Ask Gemini” started a new conversation: Gemini cannot continue a conversation from here.' }],
      [{ opened: 1, failed: 1, lastError: null, skipped: [], fresh: [anew] }, { kind: 'failed', title: 'Opened 1 (1 as a new conversation), but 1 could not start', note: null }],
    ]
    for (const [outcome, words] of cases) expect(openWords(outcome)).toEqual(words)
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
  const NONE: ReadonlySet<string> = new Set()

  it('keeps git’s order, keys each by its folder, and names one on no branch by its folder', () => {
    const rows = worktreeRows([MAIN, FIX, DETACHED], () => ({ kind: 'checking' }), NONE)
    expect(rows.map((row) => [row.key, row.name, row.main])).toEqual([
      ['worktree:/code/shop', 'main', true],
      ['worktree:/code/shop-fix', 'fix', false],
      ['worktree:/code/shop-detached', 'shop-detached', false],
    ])
  })

  it('never offers the main checkout a tick', () => {
    const rows = worktreeRows([MAIN, FIX, DETACHED], () => ({ kind: 'checking' }), NONE)
    expect(tickableWorktrees({ kind: 'listed', rows }).map((row) => row.name)).toEqual(['fix', 'shop-detached'])
    expect(tickableWorktrees({ kind: 'loading' })).toEqual([])
  })

  it('says what is on a worktree once its standing is read, and checking until then', () => {
    const says = (rows: readonly WorktreeRow[]) => rows.map((row) => [worktreeWhere(row), worktreeWhen(row)])
    expect(says(worktreeRows([MAIN, FIX], () => ({ kind: 'read', standing: { ...READ, dirty: 1, inactive_days: 1 } }), NONE))).toEqual([
      ['main checkout · stays', ''],
      ['1 uncommitted change · merged', 'inactive 1 day'],
    ])
    expect(says(worktreeRows([FIX], () => ({ kind: 'read', standing: { ...READ, merged: false } }), NONE))).toEqual([['nothing uncommitted · not merged', '2 days ago']])
    expect(says(worktreeRows([FIX], () => ({ kind: 'checking' }), NONE))).toEqual([['checking…', '']])
    expect(says(worktreeRows([FIX], () => ({ kind: 'read', standing: { ...READ, missing: true } }), NONE))).toEqual([['its folder is gone', '']])
    expect(says(worktreeRows([FIX], () => ({ kind: 'failed', why: 'No answer.' }), NONE))).toEqual([['could not check where it stands', '']])
  })

  it('marks a worktree a session of the window runs in, by its checkout, and gives it no tick', () => {
    const inFix = session(1, 'Fix', { cwd: '/code/shop-fix/src' }, { checkout: '/code/shop-fix' })
    const inMain = session(2, 'Main', { cwd: '/code/shop' }, { checkout: '/code/shop' })
    const elsewhere = session(3, 'Remote', { cwd: '/code/shop-detached' }, { machine: 4 })
    const gone = session(4, 'Ended', { cwd: '/code/shop-detached' }, { ended: true })
    const inUse = worktreesInUse([MAIN, FIX, DETACHED], [inFix, inMain, elsewhere, gone], 0)
    expect([...inUse]).toEqual(['/code/shop-fix'])

    const rows = worktreeRows([MAIN, FIX, DETACHED], () => ({ kind: 'read', standing: READ }), inUse)
    expect(tickableWorktrees({ kind: 'listed', rows }).map((row) => row.name)).toEqual(['shop-detached'])
    expect(rows.map(worktreeWhere)).toEqual(['main checkout · stays', 'nothing uncommitted · merged · a session runs in it', 'nothing uncommitted · merged'])
  })
})

describe('removing worktrees from the workspace panel', () => {
  const READ = { dirty: 0, branch: 'b', merged: true, last_commit: '2 days ago', inactive_days: null, missing: false }
  const row = (name: string, standing: StandingRead): LinkedWorktreeRow => ({ key: `worktree:/code/shop-${name}`, path: `/code/shop-${name}`, name, main: false, standing, running: false })
  const CLEAN = row('clean', { kind: 'read', standing: READ })
  const DIRTY = row('dirty', { kind: 'read', standing: { ...READ, dirty: 2, merged: false } })
  const UNMERGED = row('unmerged', { kind: 'read', standing: { ...READ, merged: false } })
  const CHECKING = row('checking', { kind: 'checking' })
  const FAILED = row('failed', { kind: 'failed', why: 'No answer.' })
  const GONE = row('gone', { kind: 'read', standing: { ...READ, missing: true } })

  it('lets only a clean, merged worktree (or one whose folder is gone) go without a question of its own', () => {
    expect([CLEAN, GONE].map((one) => removalCheck(one).loss)).toEqual([null, null])
    expect(removalCheck(DIRTY).loss).toBe('its 2 uncommitted changes')
    expect(removalCheck(UNMERGED).loss).toBe('commits that are on no other branch (the branch is kept, the folder goes)')
    expect(removalCheck(CHECKING).loss).toBe('whatever is in it: where it stands is not known')
    expect(removalCheck(FAILED).loss).toBe('whatever is in it: where it stands is not known')
  })

  it('sends one that would lose something only once its own question is confirmed, and only then lets it go past changes', () => {
    const checks = [CLEAN, DIRTY, UNMERGED, CHECKING].map(removalCheck)
    expect(removalItems(checks, new Map())).toEqual([{ path: '/code/shop-clean', force: false }])
    const sure = new Map([
      [DIRTY.key, 'its 2 uncommitted changes'],
      [UNMERGED.key, 'commits that are on no other branch (the branch is kept, the folder goes)'],
      [CHECKING.key, 'whatever is in it: where it stands is not known'],
    ])
    expect(removalItems(checks, sure)).toEqual([
      { path: '/code/shop-clean', force: false },
      { path: '/code/shop-dirty', force: true },
      { path: '/code/shop-unmerged', force: false },
      { path: '/code/shop-checking', force: true },
    ])
  })

  it('does not send one whose loss changed after its question was confirmed', () => {
    const confirmedClean = new Map([[UNMERGED.key, 'commits that are on no other branch (the branch is kept, the folder goes)']])
    const nowDirty = row('unmerged', { kind: 'read', standing: { ...READ, dirty: 1, merged: false } })
    expect(removalItems([removalCheck(nowDirty)], confirmedClean)).toEqual([])
  })

  it('says how a removal went, and what an older service leaves to the list', () => {
    expect(removedWords({ removed: ['/a', '/b'], kept: [] })).toBe('Removed 2 worktrees.')
    expect(removedWords({ removed: ['/a'], kept: [{ path: '/b', why: 'something is running in it' }] })).toBe('Removed 1 worktree. 1 worktree stayed: the reason is on its row.')
    expect(removedWords({ removed: [], kept: [{ path: '/a', why: 'x' }, { path: '/b', why: 'y' }] })).toBe('Removed nothing. 2 worktrees stayed: the reason is on each row.')
    expect(removedWords(null)).toMatch(/^Asked the service to remove them\./)
  })
})
