import { afterEach, describe, expect, it } from 'vitest'
import { conversationsFromSnapshot } from '@/api/daemon'
import { forgetMachines, parseSessionId, registerMachine, type MachineKind, type MachineState } from '@/api/machines'
import type { Conversation } from '@/data/preview'
import type { Layout } from './layout'
import { idsOfMachinesNotHeard, announcementFor, machineChip, machineHeads, machineTitle, remoteStartRefusal, remoteTargetOf, remoteTerminals, updateActionOf, updateCommandOf, withUnconnected, withoutUnconnected, type MachineHead, type RemoteMachine } from './machines'
import { folderNameOf, toSessionView } from './session'

afterEach(() => { forgetMachines() })

function term(id: number, cwd: string) {
  return {
    id, cols: 80, rows: 24, title: 't', process: 'bash', agent: null, status: 'Idle', cwd, summary: '', name: 'n',
    label: '', pinned: false, archived: false, model: '', said: '', branch: null, linked: false, helperAsk: [], startedBy: null, subagents: [],
    conversation_id: null, popup: false, remote: null, root: null, top: null, since: 0, asleep: false, win32_input: false,
  }
}

function snapshot(terms: ReturnType<typeof term>[]) {
  return { terms: Object.fromEntries(terms.map((item) => [String(item.id), item])), workspaces: [], conversations: [] }
}

function state(machine: number, name: string, kind: MachineKind = 'connected'): MachineState {
  return { machine, name, state: kind, why: null, attempt: null }
}

function machineOf(id: number, name: string, terms: ReturnType<typeof term>[], kind: MachineKind = 'connected', heard = true): RemoteMachine {
  registerMachine(name, id)
  return { state: state(id, name, kind), conversations: conversationsFromSnapshot(snapshot(terms), { id, name }), heard, listedAt: 0 }
}

describe('merging the snapshots of several machines', () => {
  it('keeps the pane that two machines both number 5 apart, by the machine in its id', () => {
    const here = conversationsFromSnapshot(snapshot([term(5, '/home/me/app')]))
    const build = machineOf(2, 'build', [term(5, '/srv/app')])
    const box = machineOf(1, 'box', [term(5, '/home/x/app'), term(6, '/home/x/other')])
    const all = [...here, ...remoteTerminals(new Map([[2, build], [1, box]]))]

    expect(all.map((item) => item.id)).toEqual(['t5', 'box/t5', 'box/t6', 'build/t5'])
    expect(new Set(all.map((item) => item.id)).size).toBe(all.length)
    expect(all.map((item) => [item.machine ?? 0, item.nativePane])).toEqual([[0, 5], [1, 5], [1, 6], [2, 5]])
    expect(all[0]?.machineName).toBeUndefined()
    expect(all[1]?.machineName).toBe('box')
  })

  it('shows what a machine last listed, as unknown, while its line is down', () => {
    const busy = { ...term(3, '/srv'), status: 'Working' }
    const down = machineOf(1, 'box', [busy], 'unreachable')
    const [session] = remoteTerminals(new Map([[1, down]]))
    expect(session?.status).toBe('unknown')
    expect(session?.lastKnownStatus).toBe('working')
    const up = machineOf(1, 'box', [busy], 'connected')
    expect(remoteTerminals(new Map([[1, up]]))[0]?.status).toBe('working')
  })

  it('takes the needs-you and done marks of a machine that is down out of the counts and the Inbox', () => {
    const asking = { ...term(3, '/srv'), status: 'Blocked' }
    const finished = { ...term(4, '/srv'), status: 'Done' }
    const inboxStatuses = new Set(['needs', 'error', 'done'])
    const views = (kind: MachineKind) => remoteTerminals(new Map([[1, machineOf(1, 'box', [asking, finished], kind)]])).map((item) => toSessionView(item, '/home/me'))
    expect(views('connected').map((view) => view.status)).toEqual(['needs', 'done'])
    const down = views('unreachable')
    expect(down.some((view) => inboxStatuses.has(view.status))).toBe(false)
    expect(down.every((view) => view.status === 'unknown')).toBe(true)
  })

  it('says a session of this computer is exactly what it was, with one machine', () => {
    const [session] = conversationsFromSnapshot(snapshot([term(12, '/home/me/app')]))
    expect(session?.id).toBe('t12')
    expect(session).not.toHaveProperty('machine')
    expect(session).not.toHaveProperty('machineName')
    expect(remoteTerminals(new Map())).toEqual([])
  })

  it('does not let one machine\'s unreadable pane take another\'s last good state', () => {
    const broken = { ...term(9, '/srv'), status: 'Nonsense' }
    const first = machineOf(1, 'box', [term(9, '/srv/box-9')])
    expect(first.conversations[0]?.cwd).toBe('/srv/box-9')
    // The same pane number on another machine reads fine; box's now fails and keeps box's own.
    machineOf(2, 'build', [term(9, '/srv/build-9')])
    const again = conversationsFromSnapshot(snapshot([broken]), { id: 1, name: 'box' })
    expect(again[0]?.cwd).toBe('/srv/box-9')
  })

  it('names the sessions of another machine in its id so a saved layout survives a restart', () => {
    registerMachine('build', 2)
    expect(parseSessionId('t5')).toEqual({ machine: 0, machineName: null, term: 5 })
    expect(parseSessionId('build/t5')).toEqual({ machine: 2, machineName: 'build', term: 5 })
    expect(parseSessionId('BUILD/t5')?.machine).toBe(2)
    // A different run gives the machine another number; the id still finds it.
    registerMachine('build', 7)
    expect(parseSessionId('build/t5')?.machine).toBe(7)
  })
})

describe('the sidebar groups of several machines', () => {
  it('never joins a folder of another machine to a folder here with the same path', () => {
    const here = conversationsFromSnapshot(snapshot([term(1, '/work/app')]))
    const there = remoteTerminals(new Map([[1, machineOf(1, 'box', [term(1, '/work/app')])]]))
    const views = [...here, ...there].map((conversation) => toSessionView(conversation, '/home/me'))
    // Same folder name on two machines: two rows, told apart by their machine, not merged.
    expect(views.map((view) => [folderNameOf(view), view.machineName])).toEqual([['app', null], ['app', 'box']])
    expect(views[1]?.cwdLabel).toBe('/work/app')
  })

  it('writes the home folder as ~ only for this computer', () => {
    const here = toSessionView(conversationsFromSnapshot(snapshot([term(1, '/home/me/app')]))[0] as Conversation, '/home/me')
    const there = toSessionView(machineOf(1, 'box', [term(1, '/home/me/app')]).conversations[0] as Conversation, '/home/me')
    expect(here.cwdLabel).toBe('~/app')
    expect(there.cwdLabel).toBe('/home/me/app')
    expect(there.machine).toBe(1)
    expect(there.machineName).toBe('box')
  })
})

describe('a saved layout at launch', () => {
  const layout: Layout = {
    arrangements: [{
      id: 'tab1',
      panes: [
        { id: 'p1', sessionId: 't3', col: 0 },
        { id: 'p2', sessionId: 'box/t4', col: 1 },
        { id: 'p3', sessionId: 'build/t9', col: 2 },
      ],
      focus: 'p1',
      max: null,
    }],
    activeId: 'tab1',
  }

  it('keeps the panes of machines that have not answered yet', () => {
    expect(idsOfMachinesNotHeard(layout, new Map())).toEqual(['box/t4', 'build/t9'])
  })

  it('lets the panes of a machine that answered be judged by what it listed', () => {
    const box = machineOf(1, 'box', [term(4, '/srv')], 'connected', true)
    const build = machineOf(2, 'build', [], 'connecting', false)
    expect(idsOfMachinesNotHeard(layout, new Map([[1, box], [2, build]]))).toEqual(['build/t9'])
  })
})

describe('machine chips', () => {
  const words: Array<[MachineKind, string, string]> = [
    ['connected', 'connected', 'ok'],
    ['connecting', 'connecting', 'quiet'],
    ['needs-login', 'needs login', 'bad'],
    ['needs-update', 'needs update', 'bad'],
    ['unreachable', 'unreachable', 'bad'],
    ['refused', 'refused', 'bad'],
  ]

  it('never colours a state alone: every kind has its own word, and shapes tell down from up', () => {
    const chips = words.map(([kind]) => machineChip(state(1, 'build', kind)))
    expect(new Set(chips.map((chip) => chip.word)).size).toBe(chips.length)
    expect(machineChip(state(1, 'build', 'connected')).glyph).not.toBe(machineChip(state(1, 'build', 'unreachable')).glyph)
  })
})

describe('machine headers', () => {
  it('are none while this computer is the only machine', () => {
    expect(machineHeads(new Map())).toEqual([])
  })

  it('put this computer first and the others in id order, whatever their names', () => {
    const heads = machineHeads(new Map([
      [3, machineOf(3, 'alpha', [])],
      [1, machineOf(1, 'zeta', [], 'needs-login')],
    ]))
    expect(heads.map((head) => head.label)).toEqual(['this computer', 'zeta', 'alpha'])
    expect(heads[0]).toMatchObject({ name: null, chip: null })
    expect(heads[1]?.chip?.word).toBe('needs login')
  })

  it('say a machine is down only after its first dial, and since when', () => {
    const first = machineOf(1, 'a', [], 'connecting')
    const lost = machineOf(2, 'b', [], 'reconnecting')
    const heads = machineHeads(new Map([[1, first], [2, { ...lost, state: { ...lost.state, since: 5_000 } }], [3, machineOf(3, 'c', [])]]))
    expect(heads.map((head) => head.down)).toEqual([false, false, true, false])
    expect(heads[2]?.downSince).toBe(5_000)
  })

  it('carry the fix a person has to act on', () => {
    const down = machineOf(1, 'box', [], 'needs-update')
    const heads = machineHeads(new Map([[1, { ...down, state: { ...down.state, why: 'run maiker machine update box --install' } }]]))
    expect(heads[1]?.why).toBe('run maiker machine update box --install')
  })
})

describe('a machine the config names but the host never reported', () => {
  it('is listed, so it can be seen and removed', () => {
    const heads = machineHeads(withUnconnected(new Map(), ['kingdom']))
    expect(heads.map((head) => head.name)).toEqual([null, 'kingdom'])
    expect(heads[1]?.chip?.tone).toBe('bad')
  })

  it('is not listed twice when the host reported it, whatever the case', () => {
    const reported = new Map([[1, machineOf(1, 'Kingdom', [])]])
    expect(withUnconnected(reported, ['kingdom'])).toBe(reported)
  })

  it('gives each placeholder its own number, also when added in two rounds', () => {
    const once = withUnconnected(new Map(), ['a'])
    const twice = withUnconnected(once, ['b'])
    expect(new Set(twice.keys())).toEqual(new Set([-1, -2]))
  })

  it('goes once the host reports the machine or it is removed', () => {
    const listed = withUnconnected(new Map([[1, machineOf(1, 'box', [])]]), ['kingdom'])
    expect(withoutUnconnected(listed, 'KINGDOM').size).toBe(1)
    expect(withoutUnconnected(listed, 'box')).toBe(listed)
  })
})

describe('where a new session goes', () => {
  it('is the machine of the focused session, and this computer for anything else', () => {
    expect(remoteTargetOf({ machine: 2, machineName: 'build' })).toEqual({ machine: 2, name: 'build' })
    expect(remoteTargetOf({ machine: 0, machineName: null })).toBeNull()
    expect(remoteTargetOf(undefined)).toBeNull()
  })
})

describe('the command that fixes a machine that needs an update', () => {
  const missing = { ...state(1, 'build', 'needs-update'), why: "Maiker isn't installed on build: run `maiker machine update build --install` (Linux and macOS machines only), then try again.", failure: 'install' as const, fix_command: 'maiker machine update build --install' }
  const other = { ...state(1, 'build', 'needs-update'), why: 'build runs an older Maiker: run `maiker machine update build`, then try again.', failure: 'update' as const, fix_command: 'maiker machine update build' }
  const newer = { ...state(1, 'build', 'needs-update'), why: "build runs a newer Maiker than this computer: update Maiker here (`maiker update`, or the desktop app's own update), then try again.", failure: 'update-here' as const }

  it('is the one the host gave, for a machine that needs an update only', () => {
    expect(updateCommandOf(other)).toBe('maiker machine update build')
    expect(updateCommandOf(missing)).toBe('maiker machine update build --install')
    expect(updateCommandOf({ ...other, state: 'unreachable' })).toBeNull()
    expect(updateCommandOf(state(1, 'build', 'needs-update'))).toBeNull()
  })

  it('installs on a machine with no app, updates one with another version, and does neither otherwise, by the failure the host named', () => {
    expect(updateActionOf(missing)).toBe('install')
    expect(updateActionOf(other)).toBe('update')
    expect(updateActionOf(state(1, 'build', 'needs-update'))).toBe('update')
    expect(updateActionOf({ ...other, why: 'run `maiker machine update build --install`' })).toBe('update')
    expect(updateActionOf(newer)).toBeNull()
    expect(updateCommandOf(newer)).toBeNull()
    expect(machineChip(newer).word).toBe('newer than this app')
    expect(updateActionOf({ ...missing, state: 'unreachable' })).toBeNull()
    expect(updateActionOf(state(1, 'build'))).toBeNull()
    expect(machineChip(missing).word).toBe('not installed')
    expect(machineChip(other).word).toBe('needs update')
  })
})

describe('what a screen reader hears about a machine', () => {
  it('says when a machine went down and why, once, and when it is back', () => {
    const up = state(1, 'build', 'connected')
    expect(announcementFor(up, { ...state(1, 'build', 'reconnecting'), attempt: 1 })).toBe('build disconnected: reconnecting #1')
    expect(announcementFor(state(1, 'build', 'reconnecting'), state(1, 'build', 'unreachable'))).toBeNull()
    expect(announcementFor(state(1, 'build', 'unreachable'), up)).toBe('build is back')
  })

  it('says nothing for a first connection or a machine still on its first dial', () => {
    expect(announcementFor(undefined, state(1, 'build', 'connecting'))).toBeNull()
    expect(announcementFor(state(1, 'build', 'connecting'), state(1, 'build', 'connected'))).toBeNull()
    expect(announcementFor(undefined, state(1, 'build', 'connected'))).toBeNull()
  })

  it('tells a machine that is down when the window first hears of it', () => {
    expect(announcementFor(undefined, state(1, 'build', 'needs-login'))).toBe('build disconnected: needs login')
  })
})

describe('starting a shell from another machine\'s pane', () => {
  it('says why it cannot, naming the machine, so no folder of that machine becomes a local one', () => {
    expect(remoteStartRefusal(true, 'build-box', 'Restarting this pane')).toBe('Restarting this pane is not available on build-box yet')
  })

  it('lets a pane of this computer start a shell', () => {
    expect(remoteStartRefusal(false, null, 'Splitting this pane')).toBeNull()
  })
})

describe('machine nicknames', () => {
  it('shows the nickname while the real name stays what sessions go by', () => {
    const state = { name: 'Build-Box', state: 'connected' } as unknown as MachineState
    const heads = machineHeads(new Map([[1, { state, conversations: [], heard: true, listedAt: 0 }]]), { 'build-box': 'Builder' })
    expect(machineTitle(heads[1] as MachineHead)).toBe('Builder')
    expect(heads[1]).toMatchObject({ name: 'Build-Box' })
    expect(machineTitle(machineHeads(new Map([[1, { state, conversations: [], heard: true, listedAt: 0 }]]))[1] as MachineHead)).toBe('Build-Box')
  })
})
