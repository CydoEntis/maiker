import { describe, expect, it } from 'vitest'
import type { Conversation } from '@/data/preview'
import { LOCAL_HEAD, type MachineHead } from './machines'
import { groupByProject, type OpenedProject } from './openedProjects'
import { toSessionView, type SessionView } from './session'
import { badgeLetters, filterChoices, machineKey, NO_FILTER, orderPlacement, passesFilter, projectFoldKey, projectName, sessionNodes, SIDEBAR_SORTS, sidebarOrder, type HeldRow, type ProjectGroup, type SidebarFilter, type SidebarSort } from './sidebarTree'

const DEVBOX: MachineHead = { ...LOCAL_HEAD, key: 'machine-4', machine: 4, name: 'devbox', label: 'devbox' }
const HEADS = [LOCAL_HEAD, DEVBOX]

function session(pane: number, folder: string, extra: Partial<Conversation> = {}): SessionView {
  return toSessionView({ id: `t${String(pane)}`, generation: 0, kind: 'terminal', title: '', project: '', folder, cwd: folder, repo: null, branch: '', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: 'claude', ...extra }, '/home/me')
}

/** What the daemon says of a helper: the session whose agent started it. */
const startedBy = (id: string): Partial<Conversation> => ({ details: { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, startedBy: id } })
const remote: Partial<Conversation> = { machine: 4, machineName: 'devbox' }

const order = (sessions: readonly SessionView[], saved: readonly OpenedProject[] = [], filter: SidebarFilter = NO_FILTER, held: HeldRow | null = null, sort: SidebarSort = 'recent') => {
  const grouping = groupByProject(sessions, saved)
  return sidebarOrder(HEADS, grouping.machines, filter, held, sort, grouping.opened).projects
}
const ids = (group: ProjectGroup) => group.rows.map((node) => node.session.id)
const shape = (groups: readonly ProjectGroup[]) => groups.map((group) => [group.name, ids(group)])

describe('the order of the sidebar', () => {
  const folder = (name: string) => ({ machineName: null, folder: `/home/me/${name}` })

  it('lists the project opened last first, whatever its sessions are doing', () => {
    const projects = order([session(1, '/home/me/a', { status: 'needs-you' }), session(2, '/home/me/c', { status: 'working' })], [folder('a'), folder('b'), folder('c')])
    expect(projects.map((group) => group.name)).toEqual(['c', 'b', 'a'])
  })

  it('lists by name from A to Z, or by machine with this computer first', () => {
    const sessions = [session(1, '/srv/api', remote), session(2, '/home/me/Zoo'), session(3, '/home/me/beta')]
    expect(order(sessions, [], NO_FILTER, null, 'name').map((group) => group.name)).toEqual(['api', 'beta', 'Zoo'])
    expect(order(sessions, [], NO_FILTER, null, 'machine').map((group) => [group.name, group.head.name])).toEqual([['beta', null], ['Zoo', null], ['api', 'devbox']])
  })

  it('keeps every session of a project under it in the order they were made, idle ones last', () => {
    const projects = order([
      session(1, '/home/me/shop', { status: 'done' }),
      session(2, '/home/me/shop', { status: 'needs-you' }),
      session(3, '/home/me/shop'),
      session(4, '/home/me/shop', { status: 'working' }),
    ])
    expect(shape(projects)).toEqual([['shop', ['t1', 't2', 't4', 't3']]])
  })

  it('gives each project its own state, its most urgent session\'s, and none to a project with no session', () => {
    const projects = order([session(1, '/home/me/a', { status: 'done' }), session(2, '/home/me/a', { status: 'working' }), session(3, '/home/me/b')], [folder('a'), folder('b'), folder('c')])
    expect(projects.map((group) => [group.name, group.mark])).toEqual([['c', null], ['b', 'idle'], ['a', 'working']])
  })

  it('treats one folder on two machines as two projects', () => {
    const projects = order([session(1, '/srv/api', { status: 'working' }), session(2, '/srv/api', { status: 'working', ...remote })], [], NO_FILTER, null, 'machine')
    expect(projects.map((group) => [group.name, group.head.name])).toEqual([['api', null], ['api', 'devbox']])
    expect(new Set(projects.map((group) => group.key)).size).toBe(2)
  })

  it('lists a session that is stopped or of unknown state as idle, so none goes missing', () => {
    const [shop] = order([session(1, '/home/me/shop', { status: 'recovery' }), session(2, '/home/me/shop', { status: 'unknown' }), session(3, '/home/me/shop')])
    expect(new Set(shop === undefined ? [] : ids(shop))).toEqual(new Set(['t1', 't2', 't3']))
    expect(shop?.mark).toBe('idle')
  })
})

describe('helpers', () => {
  const lead = session(1, '/home/me/shop', { status: 'working' })
  const helper = (pane: number, extra: Partial<Conversation> = {}) => session(pane, '/home/me/shop', { status: 'working', ...startedBy('t1'), ...extra })

  it('stay under their lead in the order they were made, whatever their own state', () => {
    const [node, ...others] = sessionNodes([helper(3, { status: 'needs-you' }), lead, helper(2)])
    expect(others).toEqual([])
    expect(node?.session.id).toBe('t1')
    expect(node?.helpers.map((each) => each.id)).toEqual(['t2', 't3'])
  })

  it('rank their lead by the most urgent of them, so a helper that asks lifts the row', () => {
    const other = session(5, '/home/me/shop', { status: 'working' })
    const nodes = sessionNodes([other, session(1, '/home/me/shop', { status: 'idle' }), helper(2, { status: 'needs-you' })])
    expect(nodes.map((node) => [node.session.id, node.mark])).toEqual([['t1', 'needs'], ['t5', 'working']])
  })

  it('are not rows of their own', () => {
    const projects = order([session(1, '/home/me/shop'), session(2, '/home/me/shop', startedBy('t1'))])
    expect(projects.flatMap((group) => group.rows.map((node) => [node.session.id, node.helpers.map((each) => each.id)]))).toEqual([['t1', ['t2']]])
  })

  it('give their project their state when one of them needs you, and leave its place alone', () => {
    const sessions = (helperStatus: Conversation['status']) => [session(1, '/home/me/docs', { status: 'working' }), session(2, '/home/me/docs', { status: helperStatus, ...startedBy('t1') }), session(5, '/home/me/shop', { status: 'working' })]
    expect(order(sessions('working')).map((group) => [group.name, group.mark])).toEqual([['shop', 'working'], ['docs', 'working']])
    expect(order(sessions('needs-you')).map((group) => [group.name, group.mark])).toEqual([['shop', 'working'], ['docs', 'needs']])
  })

  it('make an idle lead count as at work while one of them is', () => {
    expect(order([session(1, '/home/me/shop'), helper(2)]).map((group) => group.mark)).toEqual(['working'])
  })

  it('that have finished rank their lead as done, so it stays above the idle rows', () => {
    const nodes = sessionNodes([session(1, '/home/me/shop'), helper(2, { status: 'done' }), session(5, '/home/me/shop', { status: 'working' })])
    expect(nodes.map((node) => [node.session.id, node.mark])).toEqual([['t1', 'done'], ['t5', 'working']])
  })

  it('whose starter is not listed are ordinary rows', () => {
    expect(sessionNodes([session(2, '/home/me/shop', startedBy('t9'))]).map((node) => node.session.id)).toEqual(['t2'])
  })
})

describe('the session on screen', () => {
  it('stays where it was picked when looking at it turns done into idle', () => {
    const seen = [session(1, '/home/me/shop', { status: 'idle' })]
    expect(order(seen)[0]?.mark).toBe('idle')
    expect(order(seen, [], NO_FILTER, { id: 't1', mark: 'done' })[0]?.mark).toBe('done')
  })

  it('moves at once when it starts working or asks', () => {
    const asking = [session(1, '/home/me/shop', { status: 'needs-you' }), session(2, '/home/me/shop', { status: 'working' })]
    expect(shape(order(asking, [], NO_FILTER, { id: 't1', mark: 'idle' }))).toEqual([['shop', ['t1', 't2']]])
  })
})

describe('the No project group', () => {
  const START = '/home/me'
  const looseOrder = (sessions: readonly SessionView[], saved: readonly OpenedProject[], sort: SidebarSort) => {
    const grouping = groupByProject(sessions, saved, START)
    return sidebarOrder(HEADS, grouping.machines, NO_FILTER, null, sort, grouping.opened).projects
  }

  it('holds this computer\'s sessions in the start folder under one heading, after every opened project whatever the sort', () => {
    const sessions = [session(1, START, { status: 'needs-you' }), session(2, '/home/me/shop'), session(3, START), session(4, '/srv/api', remote)]
    for (const sort of SIDEBAR_SORTS) {
      const groups = looseOrder(sessions, [{ machineName: null, folder: '/home/me/shop' }], sort)
      expect(groups.map((group) => [group.name, group.loose])).toEqual(expect.arrayContaining([['shop', false], ['api', false]]))
      expect(groups.at(-1)).toMatchObject({ name: 'No project', loose: true, mark: 'needs' })
      expect(groups.at(-1)?.rows.map((node) => node.session.id)).toEqual(['t1', 't3'])
      expect(groups.filter((group) => group.loose)).toHaveLength(1)
    }
  })

  it('is not listed while it has no session', () => {
    expect(looseOrder([session(2, '/home/me/shop')], [], 'recent').map((group) => group.name)).toEqual(['shop'])
  })

  it('is offered by the filter as No project', () => {
    const grouping = groupByProject([session(1, START), session(2, '/home/me/shop')], [], START)
    expect(filterChoices(HEADS, grouping.machines).projects).toEqual(expect.arrayContaining([{ name: 'No project', count: 1, loose: true }, { name: 'shop', count: 1, loose: false }]))
  })
})

describe('the filter', () => {
  const sessions =[session(1, '/home/me/shop', { status: 'working' }), session(2, '/home/me/docs'), session(3, '/srv/api', { status: 'working', ...remote })]

  it('narrows the list to one project or one machine', () => {
    expect(shape(order(sessions, [], { project: 'docs', machine: null }))).toEqual([['docs', ['t2']]])
    expect(shape(order(sessions, [], { project: null, machine: machineKey('devbox') }))).toEqual([['api', ['t3']]])
  })

  it('names a machine by its real name whatever its case', () => {
    expect(passesFilter({ project: null, machine: machineKey('DevBox') }, { head: DEVBOX, name: 'api' })).toBe(true)
    expect(passesFilter({ project: null, machine: machineKey('DevBox') }, { head: LOCAL_HEAD, name: 'api' })).toBe(false)
  })

  it('offers every project and every machine with its session count', () => {
    const choices = filterChoices(HEADS, groupByProject(sessions, [{ machineName: 'devbox', folder: '/srv/shop' }]).machines)
    expect(new Map(choices.projects.map((choice) => [choice.name, choice.count]))).toEqual(new Map([['shop', 1], ['docs', 1], ['api', 1]]))
    expect(choices.machines.map((choice) => [choice.label, choice.remote, choice.count])).toEqual([['This computer', false, 2], ['devbox', true, 1]])
  })

  it('says which machine is not connected', () => {
    const choices = filterChoices([LOCAL_HEAD, { ...DEVBOX, down: true }], [])
    expect(choices.machines.map((choice) => choice.down)).toEqual([false, true])
  })
})

describe('a project heading', () => {
  it('names a git project by its repository, else by its folder, on Windows too', () => {
    expect(projectName({ project: { machineName: null, folder: '/home/me/code/sf' }, sessions: [session(1, '/home/me/code/sf', { repo: 'Storefront' })] })).toBe('Storefront')
    expect(projectName({ project: { machineName: null, folder: 'C:\\dev\\notes' }, sessions: [] })).toBe('notes')
  })

  it('keys a fold by machine name and folder, never by the machine number', () => {
    expect(projectFoldKey({ machineName: 'DevBox', folder: '/srv/api' })).toBe(projectFoldKey({ machineName: 'devbox', folder: '/srv/api' }))
    expect(projectFoldKey({ machineName: 'devbox', folder: '/srv/api' })).not.toBe(projectFoldKey({ machineName: null, folder: '/srv/api' }))
  })

  it('takes its two badge letters from the words of the name, or from its start', () => {
    expect(badgeLetters('chameleon')).toBe('CH')
    expect(badgeLetters('api-server')).toBe('AS')
    expect(badgeLetters('my_big project')).toBe('MB')
    expect(badgeLetters('x')).toBe('X')
    expect(badgeLetters('')).toBe('')
  })

  it('says it needs you while a row under it, or a helper of one, waits', () => {
    expect(order([session(1, '/home/me/shop', { status: 'working' }), session(2, '/home/me/shop', { status: 'needs-you', ...startedBy('t1') })])[0]?.mark).toBe('needs')
  })
})

describe('what decides when rows are measured to slide', () => {
  it('is the same while nothing moved, and differs when a row moves', () => {
    const placement = (sessions: readonly SessionView[]) => orderPlacement({ projects: order(sessions) })
    const working = [session(1, '/home/me/shop'), session(2, '/home/me/shop', { status: 'working' })]
    expect(placement(working)).toBe(placement(working.map((each) => ({ ...each }))))
    expect(placement(working)).not.toBe(placement([session(1, '/home/me/shop', { status: 'working' }), session(2, '/home/me/shop')]))
  })
})
