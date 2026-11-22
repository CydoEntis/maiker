import { describe, expect, it } from 'vitest'
import type { Conversation } from '@/data/preview'
import { LOCAL_HEAD, type MachineHead } from './machines'
import { groupByProject, type OpenedProject } from './openedProjects'
import { toSessionView, type SessionView } from './session'
import { badgeLetters, filterChoices, machineKey, needsYou, NO_FILTER, orderPlacement, passesFilter, projectFoldKey, projectName, sessionNodes, sidebarOrder, type ProjectGroup } from './sidebarTree'

const DEVBOX: MachineHead = { ...LOCAL_HEAD, key: 'machine-4', machine: 4, name: 'devbox', label: 'devbox' }
const HEADS = [LOCAL_HEAD, DEVBOX]

function session(pane: number, folder: string, extra: Partial<Conversation> = {}): SessionView {
  return toSessionView({ id: `t${String(pane)}`, generation: 0, kind: 'terminal', title: '', project: '', folder, cwd: folder, repo: null, branch: '', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: 'claude', ...extra }, '/home/me')
}

/** What the daemon says of a helper: the session whose agent started it. */
const startedBy = (id: string): Partial<Conversation> => ({ details: { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, startedBy: id } })
const remote: Partial<Conversation> = { machine: 4, machineName: 'devbox' }

const order = (sessions: readonly SessionView[], saved: readonly OpenedProject[] = [], ...rest: [filter?: Parameters<typeof sidebarOrder>[2], held?: Parameters<typeof sidebarOrder>[3]]) =>
  sidebarOrder(HEADS, groupByProject(sessions, saved).machines, ...rest)
const ids = (group: ProjectGroup) => group.rows.map((node) => node.session.id)
const shape = (groups: readonly ProjectGroup[]) => groups.map((group) => [group.name, ids(group)])

describe('the order of the sidebar', () => {
  it('puts the project with the most urgent session first: needs you, then working, then done', () => {
    const { active } = order([
      session(1, '/home/me/done', { status: 'done' }),
      session(2, '/home/me/working', { status: 'working' }),
      session(3, '/home/me/needs', { status: 'needs-you' }),
    ])
    expect(active.map((group) => group.name)).toEqual(['needs', 'working', 'done'])
  })

  it('keeps projects of the same rank in the order they were opened, so a heading moves only when its rank does', () => {
    const machines = groupByProject([session(1, '/home/me/a', { status: 'working' }), session(2, '/home/me/b', { status: 'working' }), session(3, '/home/me/c', { status: 'working' })], []).machines
    const opened = machines.flatMap((machine) => machine.projects.map(projectName))
    expect(sidebarOrder(HEADS, machines).active.map((group) => group.name)).toEqual(opened)
  })

  it('orders the sessions of a project by urgency', () => {
    const { active } = order([
      session(1, '/home/me/shop', { status: 'done' }),
      session(2, '/home/me/shop', { status: 'needs-you' }),
      session(3, '/home/me/shop', { status: 'working' }),
    ])
    expect(shape(active)).toEqual([['shop', ['t2', 't3', 't1']]])
  })

  it('treats one folder on two machines as two projects', () => {
    const { active } = order([session(1, '/srv/api', { status: 'working' }), session(2, '/srv/api', { status: 'working', ...remote })])
    expect(active.map((group) => [group.name, group.head.name])).toEqual([['api', null], ['api', 'devbox']])
    expect(new Set(active.map((group) => group.key)).size).toBe(2)
  })

  it('lists a session that is stopped or of unknown state with the idle ones, so none goes missing', () => {
    const sessions = [session(1, '/home/me/shop', { status: 'recovery' }), session(2, '/home/me/shop', { status: 'unknown' }), session(3, '/home/me/shop')]
    const { active, idle, idleCount } = order(sessions)
    expect(active).toEqual([])
    expect(new Set(idle.flatMap(ids))).toEqual(new Set(['t1', 't2', 't3']))
    expect(idleCount).toBe(3)
  })
})

describe('the Idle section', () => {
  it('groups idle sessions by project and counts them', () => {
    const { active, idle, idleCount } = order([session(1, '/home/me/shop'), session(2, '/home/me/shop'), session(3, '/home/me/docs')])
    expect(active).toEqual([])
    expect(idle.map((group) => [group.name, group.rows.length])).toEqual([['shop', 2], ['docs', 1]])
    expect(idleCount).toBe(3)
  })

  it('lists a project with both kinds of session in both places', () => {
    const { active, idle, idleCount } = order([session(1, '/home/me/shop', { status: 'working' }), session(2, '/home/me/shop')])
    expect(shape(active)).toEqual([['shop', ['t1']]])
    expect(shape(idle)).toEqual([['shop', ['t2']]])
    expect(idleCount).toBe(1)
    expect(active[0]?.key).toBe(idle[0]?.key)
  })

  it('lists a project with no session, counting nothing for it', () => {
    const { idle, idleCount } = order([], [{ machineName: null, folder: '/home/me/notes' }])
    expect(shape(idle)).toEqual([['notes', []]])
    expect(idleCount).toBe(0)
  })

  it('puts the projects with nothing going on before the ones also listed above', () => {
    const { idle } = order([session(1, '/home/me/busy', { status: 'working' }), session(2, '/home/me/busy'), session(3, '/home/me/quiet')])
    expect(idle.map((group) => group.name)).toEqual(['quiet', 'busy'])
  })

  it('leaves a busy project with no idle session out', () => {
    expect(order([session(1, '/home/me/shop', { status: 'working' })]).idle).toEqual([])
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

  it('are not counted as rows of the Idle section', () => {
    const { idleCount, idle } = order([session(1, '/home/me/shop'), session(2, '/home/me/shop', startedBy('t1'))])
    expect(idleCount).toBe(1)
    expect(idle.flatMap((group) => group.rows.map((node) => [node.session.id, node.helpers.map((each) => each.id)]))).toEqual([['t1', ['t2']]])
  })

  it('float their project to the top when one of them needs you', () => {
    const sessions = [
      session(1, '/home/me/shop', { status: 'working' }),
      session(5, '/home/me/docs', { status: 'working' }),
      session(6, '/home/me/docs', { status: 'working', ...startedBy('t5') }),
    ]
    expect(order(sessions).active.map((group) => group.name)).toEqual(['shop', 'docs'])
    const asking = sessions.map((each) => (each.id === 't6' ? session(6, '/home/me/docs', { status: 'needs-you', ...startedBy('t5') }) : each))
    expect(order(asking).active.map((group) => group.name)).toEqual(['docs', 'shop'])
  })

  it('keep an idle lead out of the Idle section while one of them is at work', () => {
    const { active, idle } = order([session(1, '/home/me/shop'), helper(2)])
    expect(shape(active)).toEqual([['shop', ['t1']]])
    expect(idle).toEqual([])
  })

  it('that have finished rank their lead as done, under the rows still working', () => {
    const nodes = sessionNodes([session(1, '/home/me/shop'), helper(2, { status: 'done' }), session(5, '/home/me/shop', { status: 'working' })])
    expect(nodes.map((node) => [node.session.id, node.mark])).toEqual([['t5', 'working'], ['t1', 'done']])
  })

  it('whose starter is not listed are ordinary rows', () => {
    expect(sessionNodes([session(2, '/home/me/shop', startedBy('t9'))]).map((node) => node.session.id)).toEqual(['t2'])
  })
})

describe('the session on screen', () => {
  it('stays where it was picked when looking at it turns done into idle', () => {
    const seen = [session(1, '/home/me/shop', { status: 'idle' })]
    expect(shape(order(seen).active)).toEqual([])
    expect(shape(order(seen, [], NO_FILTER, { id: 't1', mark: 'done' }).active)).toEqual([['shop', ['t1']]])
  })

  it('moves at once when it starts working or asks', () => {
    const asking = [session(1, '/home/me/shop', { status: 'needs-you' }), session(2, '/home/me/shop', { status: 'working' })]
    expect(shape(order(asking, [], NO_FILTER, { id: 't1', mark: 'idle' }).active)).toEqual([['shop', ['t1', 't2']]])
  })
})

describe('the filter', () => {
  const sessions = [session(1, '/home/me/shop', { status: 'working' }), session(2, '/home/me/docs'), session(3, '/srv/api', { status: 'working', ...remote })]

  it('narrows both sections to one project or one machine', () => {
    const byProject = order(sessions, [], { project: 'docs', machine: null })
    expect([shape(byProject.active), shape(byProject.idle)]).toEqual([[], [['docs', ['t2']]]])
    const byMachine = order(sessions, [], { project: null, machine: machineKey('devbox') })
    expect([shape(byMachine.active), shape(byMachine.idle)]).toEqual([[['api', ['t3']]], []])
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
    const waiting = order([session(1, '/home/me/shop', { status: 'working' }), session(2, '/home/me/shop', { status: 'needs-you', ...startedBy('t1') })]).active[0]
    const busy = order([session(1, '/home/me/shop', { status: 'working' })]).active[0]
    expect(waiting !== undefined && needsYou(waiting)).toBe(true)
    expect(busy !== undefined && needsYou(busy)).toBe(false)
  })
})

describe('what decides when rows are measured to slide', () => {
  it('is the same while nothing moved, and differs when a row changes section', () => {
    const working = [session(1, '/home/me/shop', { status: 'working' }), session(2, '/home/me/shop')]
    expect(orderPlacement(order(working))).toBe(orderPlacement(order(working.map((each) => ({ ...each })))))
    expect(orderPlacement(order(working))).not.toBe(orderPlacement(order([session(1, '/home/me/shop'), session(2, '/home/me/shop')])))
  })
})
