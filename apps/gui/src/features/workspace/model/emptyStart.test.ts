import { describe, expect, it } from 'vitest'
import { agentForDigit, agentsToStart, pickedPlace, startPlaces, type DigitPress } from './emptyStart'
import { LOCAL_HEAD, type MachineHead } from './machines'
import type { MachineProjects, OpenedProject } from './openedProjects'

const DEVBOX: MachineHead = { ...LOCAL_HEAD, key: 'machine-4', machine: 4, name: 'devbox', label: 'devbox' }
const HEADS = [LOCAL_HEAD, DEVBOX]

const SHOP: OpenedProject = { machineName: null, folder: '/home/me/shop' }
const DOCS: OpenedProject = { machineName: null, folder: '/home/me/docs' }
const API: OpenedProject = { machineName: 'devbox', folder: '/srv/api' }

const machinesOf = (...projects: OpenedProject[]): MachineProjects[] => [null, 'devbox']
  .map((machineName) => ({ machineName, projects: projects.filter((project) => project.machineName === machineName).map((project) => ({ project, sessions: [] })) }))
  .filter((machine) => machine.projects.length > 0)

const places = (...projects: OpenedProject[]) => startPlaces(HEADS, machinesOf(...projects))
const press = (key: string, extra: Partial<DigitPress> = {}): DigitPress => ({ key, modified: false, typing: false, covered: false, ...extra })

describe('the projects an agent can start in', () => {
  it('lists every opened project with the machine it is on', () => {
    expect(places(SHOP, API).map((place) => [place.label, place.machine, place.remote])).toEqual([['shop', LOCAL_HEAD.machine, false], ['api · devbox', 4, true]])
  })

  it('tells two projects of one name apart', () => {
    const labels = places(SHOP, { machineName: null, folder: '/tmp/shop' }).map((place) => place.label)
    expect(new Set(labels).size).toBe(2)
  })

  it('marks a project whose machine is down', () => {
    const down = startPlaces([LOCAL_HEAD, { ...DEVBOX, down: true }], machinesOf(SHOP, API))
    expect(down.map((place) => place.down)).toEqual([false, true])
  })

  it('ends with No project, this computer\'s start folder, which is the one picked with no project open', () => {
    const withLoose = startPlaces(HEADS, machinesOf(SHOP, API), '/home/me')
    expect(withLoose.map((place) => [place.label, place.loose])).toEqual([['shop', false], ['api · devbox', false], ['No project', true]])
    const alone = startPlaces(HEADS, [], '/home/me')
    expect(pickedPlace(alone, null, null, [])).toMatchObject({ label: 'No project', machine: LOCAL_HEAD.machine, project: { machineName: null, folder: '/home/me' } })
  })

  it('has no No project while the start folder is not known, or is an opened project', () => {
    expect(startPlaces(HEADS, [], '')).toEqual([])
    expect(startPlaces(HEADS, machinesOf({ machineName: null, folder: '/home/me' }), '/home/me/').map((place) => place.loose)).toEqual([false])
  })
})

describe('the project that is picked', () => {
  it('is the one opened most recently when nothing was chosen', () => {
    expect(pickedPlace(places(SHOP, DOCS, API), null, null, [SHOP, API, DOCS])?.project).toEqual(DOCS)
  })

  it('is the one selected in the sidebar before that', () => {
    expect(pickedPlace(places(SHOP, DOCS), null, SHOP, [SHOP, DOCS])?.project).toEqual(SHOP)
  })

  it('is the one picked on the screen before either', () => {
    expect(pickedPlace(places(SHOP, DOCS, API), API, SHOP, [SHOP, API, DOCS])?.project).toEqual(API)
  })

  it('falls back when the picked project was removed', () => {
    expect(pickedPlace(places(SHOP), DOCS, null, [SHOP])?.project).toEqual(SHOP)
  })

  it('is none with no project open', () => {
    expect(pickedPlace([], SHOP, SHOP, [])).toBeNull()
  })
})

describe('the agents listed', () => {
  it('are the installed ones on this computer, in their fixed order', () => {
    expect(agentsToStart(['gemini', 'claude', 'git'], false)).toEqual(['claude', 'gemini'])
  })

  it('are all of them on another machine, and before the installed ones are known', () => {
    expect(agentsToStart(['codex'], true)).toEqual(['claude', 'codex', 'gemini'])
    expect(agentsToStart(null, false)).toEqual(['claude', 'codex', 'gemini'])
  })

  it('are none when nothing is installed', () => {
    expect(agentsToStart([], false)).toEqual([])
  })
})

describe('a number key', () => {
  const agents = agentsToStart(['claude', 'gemini'], false)

  it('starts the agent at that number', () => {
    expect(agentForDigit(press('1'), agents)).toBe('claude')
    expect(agentForDigit(press('2'), agents)).toBe('gemini')
  })

  it('does nothing past the last agent, for 0 and for any other key', () => {
    for (const key of ['3', '9', '0', 'a', 'Enter', '!', '12']) expect(agentForDigit(press(key), agents)).toBeNull()
  })

  it('is ignored with a modifier, in a field, and under something open', () => {
    expect(agentForDigit(press('1', { modified: true }), agents)).toBeNull()
    expect(agentForDigit(press('1', { typing: true }), agents)).toBeNull()
    expect(agentForDigit(press('1', { covered: true }), agents)).toBeNull()
  })
})
