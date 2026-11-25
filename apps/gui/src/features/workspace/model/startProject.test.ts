import { describe, expect, it } from 'vitest'
import type { MachineProjects, OpenedProject } from './openedProjects'
import type { SessionView } from './session'
import { draftFolderOn, projectOfSession, startProjectOn } from './startProject'

const SHOP: OpenedProject = { machineName: null, folder: '/home/me/shop' }
const BLOG: OpenedProject = { machineName: null, folder: '/home/me/blog' }
const THERE: OpenedProject = { machineName: 'devbox', folder: '/srv/api' }

/** Only the id is read here. */
const session = (id: string) => ({ id }) as SessionView

const MACHINES: readonly MachineProjects[] = [
  { machineName: null, projects: [{ project: SHOP, sessions: [session('t1')] }, { project: BLOG, sessions: [] }] },
  { machineName: 'devbox', projects: [{ project: THERE, sessions: [session('m4:t2')] }] },
]

describe('the project a new session starts in', () => {
  it('is the project of the session in front, before the one last picked', () => {
    expect(startProjectOn(null, MACHINES, 't1', BLOG)).toBe(SHOP)
  })

  it('is the project last opened or picked when no session of that machine is in front', () => {
    expect(startProjectOn(null, MACHINES, null, BLOG)).toBe(BLOG)
    expect(startProjectOn(null, MACHINES, 'm4:t2', BLOG)).toBe(BLOG)
  })

  it('is a project of the machine asked for, never another machine\'s', () => {
    expect(startProjectOn('DevBox', MACHINES, 'm4:t2', SHOP)).toBe(THERE)
    expect(startProjectOn('devbox', MACHINES, 't1', SHOP)).toBeNull()
  })

  it('is none when nothing is opened there, or the pick was closed since', () => {
    expect(startProjectOn(null, [], null, null)).toBeNull()
    expect(startProjectOn(null, MACHINES, null, { machineName: null, folder: '/home/me/gone' })).toBeNull()
  })
})

describe('the folder New session opens the draft in', () => {
  const START = '/home/me'

  it('is the project in front, on this computer or another machine', () => {
    expect(draftFolderOn(true, SHOP, START, true)).toBe(SHOP.folder)
    expect(draftFolderOn(false, THERE, START, false)).toBe(THERE.folder)
  })

  it('is this computer\'s start folder with no project open there, for the draft\'s No project', () => {
    expect(draftFolderOn(true, startProjectOn(null, [], null, null), START, false)).toBe(START)
  })

  it('is none when a project is opened first: another machine with none in front, this computer with projects open but none in front, or the start folder not known', () => {
    expect(draftFolderOn(false, null, START, false)).toBeNull()
    expect(draftFolderOn(true, null, START, true)).toBeNull()
    expect(draftFolderOn(true, null, null, false)).toBeNull()
    expect(draftFolderOn(true, null, '', false)).toBeNull()
  })

  it('is the start folder while a session of the No project group is in front', () => {
    const loose: MachineProjects[] = [{ machineName: null, projects: [{ project: { machineName: null, folder: START }, sessions: [session('t5')], loose: true }] }]
    expect(draftFolderOn(true, startProjectOn(null, loose, 't5', null), START, false)).toBe(START)
  })
})

describe('the project a session is placed in', () => {
  it('is found on any machine, and is none for a session nothing lists', () => {
    expect(projectOfSession(MACHINES, 'm4:t2')?.project).toBe(THERE)
    expect(projectOfSession(MACHINES, 't9')).toBeNull()
  })
})
