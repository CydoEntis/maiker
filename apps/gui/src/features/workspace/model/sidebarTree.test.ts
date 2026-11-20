import { describe, expect, it } from 'vitest'
import type { Conversation } from '@/data/preview'
import { LOCAL_HEAD, type MachineHead } from './machines'
import { groupByProject } from './openedProjects'
import { toSessionView, type SessionView } from './session'
import { machineFoldKey, projectFoldKey, projectName, showsStatusHeadings, sidebarTree, STATUS_HEADINGS_FROM, treePlacement, withSessionsOnly } from './sidebarTree'

const DEVBOX: MachineHead = { ...LOCAL_HEAD, key: 'machine-4', machine: 4, name: 'devbox', label: 'devbox' }

function session(pane: number, folder: string, extra: Partial<Conversation> = {}): SessionView {
  return toSessionView({ id: `t${String(pane)}`, generation: 0, kind: 'terminal', title: '', project: '', folder, cwd: folder, repo: null, branch: '', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: 'claude', ...extra }, '/home/me')
}

const all = () => true

describe('the sidebar tree', () => {
  it('lists every machine, this computer first, with its opened projects and their sessions', () => {
    const sessions = [session(1, '/home/me/shop'), session(2, '/srv/api', { machine: 4, machineName: 'devbox' })]
    const tree = sidebarTree([LOCAL_HEAD, DEVBOX], groupByProject(sessions, [{ machineName: null, folder: '/home/me/notes' }]).machines, all, null)
    expect(tree.map((machine) => [machine.head.key, machine.count, machine.projects.map((project) => [project.name, project.count])])).toEqual([
      ['machine-0', 1, [['notes', 0], ['shop', 1]]],
      ['machine-4', 1, [['api', 1]]],
    ])
  })

  it('draws only the sessions it is told to, keeping their project open', () => {
    const sessions = [session(1, '/home/me/shop')]
    const tree = sidebarTree([LOCAL_HEAD], groupByProject(sessions, []).machines, () => false, null)
    expect(tree[0]?.projects.map((project) => project.count)).toEqual([0])
  })

  it('narrows to the projects with a session shown, keeping a machine only when asked', () => {
    const sessions = [session(1, '/home/me/shop'), session(2, '/home/me/docs'), session(3, '/srv/api', { machine: 4, machineName: 'devbox' })]
    const tree = sidebarTree([LOCAL_HEAD, DEVBOX], groupByProject(sessions, []).machines, (row) => row.id === 't2', null)
    expect(withSessionsOnly(tree, () => false).map((machine) => [machine.head.key, machine.projects.map((project) => project.name)])).toEqual([['machine-0', ['docs']]])
    expect(withSessionsOnly(tree, (head) => head.name === 'devbox').map((machine) => machine.head.key)).toEqual(['machine-0', 'machine-4'])
  })

  it('has no heading for a lone machine with nothing on it, unless something waits there', () => {
    expect(sidebarTree([LOCAL_HEAD], [], all, null)).toEqual([])
    expect(sidebarTree([LOCAL_HEAD], [], all, null, true)).toHaveLength(1)
    expect(sidebarTree([LOCAL_HEAD, DEVBOX], [], all, null)).toHaveLength(2)
  })

  it('names a git project by its repository, else by its folder, on Windows too', () => {
    expect(projectName({ project: { machineName: null, folder: '/home/me/code/sf' }, sessions: [session(1, '/home/me/code/sf', { repo: 'Storefront' })] })).toBe('Storefront')
    expect(projectName({ project: { machineName: null, folder: 'C:\\dev\\notes' }, sessions: [] })).toBe('notes')
  })

  it('keys a fold by machine name and folder, never by the machine number', () => {
    expect(machineFoldKey('DevBox')).toBe(machineFoldKey('devbox'))
    expect(machineFoldKey(null)).not.toBe(machineFoldKey('devbox'))
    expect(projectFoldKey({ machineName: 'devbox', folder: '/srv/api' })).not.toBe(projectFoldKey({ machineName: null, folder: '/srv/api' }))
  })

  it('heads statuses only from three sessions, and never with the setting off', () => {
    expect(STATUS_HEADINGS_FROM).toBe(3)
    expect([1, 2, 3].map((count) => showsStatusHeadings(count, true))).toEqual([false, false, true])
    expect(showsStatusHeadings(9, false)).toBe(false)
  })

  it('places rows the same way when nothing moved, and differently when the headings change', () => {
    const sessions = [session(1, '/home/me/shop'), session(2, '/home/me/shop'), session(3, '/home/me/shop', { status: 'working' })]
    const tree = sidebarTree([LOCAL_HEAD], groupByProject(sessions, []).machines, all, null)
    expect(treePlacement(tree, true)).toBe(treePlacement(sidebarTree([LOCAL_HEAD], groupByProject([...sessions], []).machines, all, null), true))
    expect(treePlacement(tree, true)).not.toBe(treePlacement(tree, false))
  })
})
