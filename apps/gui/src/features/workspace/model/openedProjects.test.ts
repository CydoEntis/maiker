import { afterEach, describe, expect, it } from 'vitest'
import { conversationsFromSnapshot } from '@/api/daemon'
import { forgetMachines, registerMachine } from '@/api/machines'
import { closeProject, groupByProject, openProject, sameProject, type OpenedProject, type ProjectGrouping } from './openedProjects'
import { toSessionView, type SessionView } from './session'

afterEach(() => { forgetMachines() })

const HOME = '/home/me'

type Pane = { id: number; cwd: string; root?: string; top?: string; linked?: boolean }

/** A pane as the daemon lists it (`TermInfo`): `root` is the main checkout, `top` the checkout the pane is in. */
function term({ id, cwd, root, top, linked = false }: Pane) {
  return {
    id, cols: 80, rows: 24, title: 't', process: 'bash', agent: null, status: 'Idle', cwd, summary: '', name: 'n',
    label: '', pinned: false, archived: false, model: '', said: '', branch: root === undefined ? null : 'main', linked,
    conversation_id: null, popup: false, remote: null, root: root ?? null, top: top ?? null, since: 0, asleep: false, win32_input: false,
  }
}

/** The sessions the window builds from one machine's list; `machine` names another machine. */
function sessionsOf(panes: Pane[], machine?: { id: number; name: string }): SessionView[] {
  if (machine !== undefined) registerMachine(machine.name, machine.id)
  const snapshot = { terms: Object.fromEntries(panes.map((pane) => [String(pane.id), term(pane)])), workspaces: [], conversations: [] }
  return conversationsFromSnapshot(snapshot, machine).map((conversation) => toSessionView(conversation, HOME))
}

const here = (folder: string): OpenedProject => ({ machineName: null, folder })

/** Each machine's projects as `folder: session ids`, to read a grouping at a glance. */
function shape(grouping: ProjectGrouping): Record<string, Record<string, string[]>> {
  return Object.fromEntries(grouping.machines.map((machine) => [
    machine.machineName ?? 'here',
    Object.fromEntries(machine.projects.map((entry) => [entry.project.folder, entry.sessions.map((session) => session.id)])),
  ]))
}

describe('grouping sessions by opened project', () => {
  it('puts every session of every machine under exactly one project of its own machine', () => {
    const sessions = [
      ...sessionsOf([{ id: 1, cwd: '/code/shop', root: '/code/shop' }, { id: 2, cwd: '/code/shop/api', root: '/code/shop' }, { id: 3, cwd: '/notes' }]),
      ...sessionsOf([{ id: 1, cwd: '/code/shop', root: '/code/shop' }], { id: 1, name: 'box' }),
    ]

    const grouping = groupByProject(sessions, [here('/code/shop'), here('/notes')])

    expect(shape(grouping)).toEqual({
      here: { '/code/shop': ['t1', 't2'], '/notes': ['t3'] },
      box: { '/code/shop': ['box/t1'] },
    })
    const placed = grouping.machines.flatMap((machine) => machine.projects.flatMap((entry) => entry.sessions.map((session) => session.id)))
    expect([...placed].sort()).toEqual(sessions.map((session) => session.id).sort())
  })

  it('opens the repository root for a git session, and the folder for any other, when no project fits', () => {
    const sessions = sessionsOf([{ id: 1, cwd: '/code/shop/api/src', root: '/code/shop' }, { id: 2, cwd: '/tmp/scratch' }])

    const grouping = groupByProject(sessions, [])

    expect(grouping.opened).toEqual([here('/code/shop'), here('/tmp/scratch')])
    expect(shape(grouping)).toEqual({ here: { '/code/shop': ['t1'], '/tmp/scratch': ['t2'] } })
  })

  it('hands back the same list when every session already has a project, so nothing needs saving', () => {
    const saved = [here('/code/shop')]

    expect(groupByProject(sessionsOf([{ id: 1, cwd: '/code/shop', root: '/code/shop' }]), saved).opened).toBe(saved)
  })

  it('puts a session in a linked worktree under its main repository, not the worktree folder', () => {
    // As the daemon lists a pane in `git worktree add` output: `root` is the main checkout, `top` the worktree.
    const sessions = sessionsOf([
      { id: 1, cwd: '/code/shop', root: '/code/shop', top: '/code/shop' },
      { id: 2, cwd: '/home/me/.maiker/worktrees/shop/red-kite/web', root: '/code/shop', top: '/home/me/.maiker/worktrees/shop/red-kite', linked: true },
    ])
    expect(sessions[1]).toMatchObject({ worktree: true, repoRoot: '/code/shop', checkout: '/home/me/.maiker/worktrees/shop/red-kite' })

    const grouping = groupByProject(sessions, [])

    expect(grouping.opened).toEqual([here('/code/shop')])
    expect(shape(grouping)).toEqual({ here: { '/code/shop': ['t1', 't2'] } })
  })

  it('puts a session in a subfolder under the deepest opened project around it', () => {
    const sessions = sessionsOf([{ id: 1, cwd: '/home/me/notes/2026/nov' }, { id: 2, cwd: '/home/me/notes/old' }, { id: 3, cwd: '/home/me/notes-archive' }])

    const grouping = groupByProject(sessions, [here('/home/me/notes'), here('/home/me/notes/2026')])

    expect(shape(grouping)).toEqual({ here: { '/home/me/notes': ['t2'], '/home/me/notes/2026': ['t1'], '/home/me/notes-archive': ['t3'] } })
  })

  it('compares Windows folders by drive and folder whatever their case and slashes', () => {
    const sessions = sessionsOf([
      { id: 1, cwd: 'C:\\Users\\me\\Notes\\week' },
      { id: 2, cwd: 'C:\\dev\\shop\\api', root: 'C:/dev/shop' },
      { id: 3, cwd: 'D:\\notes' },
    ])

    const grouping = groupByProject(sessions, [here('c:/users/ME/notes/'), here('C:\\Dev\\Shop')])

    expect(grouping.opened).toEqual([here('c:/users/ME/notes/'), here('C:\\Dev\\Shop'), here('D:\\notes')])
    expect(shape(grouping)).toEqual({ here: { 'c:/users/ME/notes/': ['t1'], 'C:\\Dev\\Shop': ['t2'], 'D:\\notes': ['t3'] } })
  })

  it('keeps the same folder on two machines as two projects', () => {
    const sessions = [...sessionsOf([{ id: 1, cwd: '/srv/api' }]), ...sessionsOf([{ id: 1, cwd: '/srv/api' }], { id: 2, name: 'Build' })]

    const grouping = groupByProject(sessions, [{ machineName: 'build', folder: '/srv/api' }])

    expect(grouping.opened).toEqual([{ machineName: 'build', folder: '/srv/api' }, here('/srv/api')])
    expect(shape(grouping)).toEqual({ here: { '/srv/api': ['t1'] }, build: { '/srv/api': ['Build/t1'] } })
  })

  it('keeps a project with no sessions listed', () => {
    expect(shape(groupByProject([], [here('/code/shop')]))).toEqual({ here: { '/code/shop': [] } })
  })

  it('lets the first session in a new folder decide what is opened, whatever order the list is in', () => {
    const [outer, inner] = sessionsOf([{ id: 1, cwd: '/home/me/notes' }, { id: 2, cwd: '/home/me/notes/nov' }])
    if (outer === undefined || inner === undefined) throw new Error('two sessions expected')

    expect(shape(groupByProject([inner, outer], []))).toEqual({ here: { '/home/me/notes': ['t1', 't2'] } })
  })
})

describe('opening a project', () => {
  it('adds a folder that is not open yet', () => {
    expect(openProject([here('/a')], here('/b'))).toEqual({ opened: [here('/a'), here('/b')], project: here('/b') })
  })

  it('hands back the open project for a folder already open, by any spelling, without adding it twice', () => {
    const opened = [here('C:\\dev\\shop')]

    const result = openProject(opened, here('c:/DEV/shop/'))

    expect(result.opened).toBe(opened)
    expect(result.project).toBe(opened[0])
    expect(sameProject(here('/code/Shop'), here('/code/shop'))).toBe(false)
  })
})

describe('closing a project', () => {
  it('is refused while a session that has not ended is in it, naming those sessions', () => {
    const sessions = sessionsOf([{ id: 1, cwd: '/code/shop', root: '/code/shop' }, { id: 2, cwd: '/notes' }])
    const opened = [here('/code/shop'), here('/notes')]

    const result = closeProject(opened, here('/code/shop'), sessions)

    expect(result).toEqual({ ok: false, error: { code: 'sessions-running', running: [sessions[0]] } })
  })

  it('removes a project whose sessions have all ended', () => {
    const sessions = sessionsOf([{ id: 1, cwd: '/code/shop', root: '/code/shop' }]).map((session) => ({ ...session, ended: true }))

    expect(closeProject([here('/code/shop'), here('/notes')], here('/code/shop'), sessions)).toEqual({ ok: true, value: [here('/notes')] })
  })

  it('removes a project with no sessions, and leaves the list as it is for one that is not open', () => {
    expect(closeProject([here('/notes')], here('/notes'), [])).toEqual({ ok: true, value: [] })
    expect(closeProject([here('/notes')], here('/other'), [])).toEqual({ ok: true, value: [here('/notes')] })
  })
})
