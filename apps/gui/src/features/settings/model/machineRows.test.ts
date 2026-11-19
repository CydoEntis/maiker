import { describe, expect, it } from 'vitest'
import { machineHeads, type MachineHead, type RemoteMachine } from '@/features/workspace/model/machines'
import { matching, maikerLine, ordered, pageStatusOf, rowOf, stoppedOnHostKey, updatable } from './machineRows'

type State = RemoteMachine['state']

const SINCE = 1_000

function head(name: string, state: State['state'], extra: Partial<State> = {}): MachineHead {
  const machine: RemoteMachine = { state: { machine: 1, name, state, why: null, attempt: null, since: SINCE, target: `me@${name}.lan`, ...extra }, conversations: [], heard: true, listedAt: 0 }
  const found = machineHeads(new Map([[1, machine]])).find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error('no head')
  return found
}

const OLDER = 'run `maiker machine update box`, then retry'
const MISSING = 'run `maiker machine update box --install`, then retry'

describe('a machine row', () => {
  it('says how many sessions a healthy machine has, and offers nothing', () => {
    expect(rowOf(head('box', 'connected'), 5)).toMatchObject({ glyph: '●', tone: 'ok', line: '5 sessions', action: null })
    expect(rowOf(head('box', 'connected'), 1).line).toBe('1 session')
    expect(rowOf(head('box', 'connected'), 0).line).toBe('No sessions')
  })

  it('offers Fix for a rejected key, and says a host key apart from a key', () => {
    const rejected = head('box', 'needs-login', { said: 'me@box: Permission denied (publickey).' })
    expect(rowOf(rejected, 0)).toMatchObject({ glyph: '×', tone: 'bad', line: 'Key rejected', action: 'fix' })
    const unknownHost = head('box', 'needs-login', { said: 'Host key verification failed.' })
    expect(stoppedOnHostKey(unknownHost)).toBe(true)
    expect(rowOf(unknownHost, 0).line).toBe('Host key not trusted')
  })

  it('offers Retry for a machine it cannot reach, and counts how long', () => {
    expect(rowOf(head('box', 'unreachable', { why: 'no answer' }), 0)).toMatchObject({ glyph: '×', line: "Can't reach it", showsSince: true, action: 'retry' })
    expect(rowOf(head('box', 'refused'), 0)).toMatchObject({ line: 'Refused the connection', action: 'retry' })
  })

  it('offers Update for an older Maiker and Install when there is none, in amber', () => {
    expect(rowOf(head('box', 'needs-update', { why: OLDER }), 2)).toMatchObject({ glyph: '!', tone: 'needs', line: '2 sessions · older Maiker', action: 'update' })
    expect(rowOf(head('box', 'needs-update', { why: MISSING }), 0)).toMatchObject({ line: 'Maiker not installed', action: 'install' })
  })

  it('offers nothing for a Maiker newer than this app, since updating from here would be a downgrade', () => {
    const newer = head('box', 'needs-update', { why: 'update maiker on this computer first' })
    expect(rowOf(newer, 1)).toMatchObject({ line: '1 session · newer Maiker', action: null })
  })

  it('shows a machine that is still connecting as waiting, not as connected', () => {
    expect(rowOf(head('box', 'connecting'), 0)).toMatchObject({ glyph: '○', tone: 'quiet', line: 'Connecting…', action: null })
    expect(rowOf(head('box', 'reconnecting', { attempt: 2 }), 0).line).toBe('Reconnecting #2…')
  })

  it('says Just added for a machine added a moment ago that has no sessions yet', () => {
    expect(rowOf(head('box', 'connected'), 0, true).line).toBe('Just added')
    expect(rowOf(head('box', 'connected'), 3, true).line).toBe('3 sessions')
  })
})

describe('the order of the list', () => {
  it('puts failed machines first, then those to update, then connected ones busiest first', () => {
    const heads = [head('a-quiet', 'connected'), head('b-busy', 'connected'), head('c-old', 'needs-update', { why: OLDER }), head('d-down', 'unreachable')]
    const sessions: Record<string, number> = { 'a-quiet': 1, 'b-busy': 9, 'c-old': 4, 'd-down': 0 }
    const names = ordered(heads, (each) => sessions[each.label] ?? null).map((each) => each.label)
    expect(names).toEqual(['d-down', 'c-old', 'b-busy', 'a-quiet'])
  })

  it('puts the machine just added at the top of the connected ones', () => {
    const heads = [head('busy', 'connected'), head('fresh', 'connected')]
    const names = ordered(heads, (each) => (each.label === 'busy' ? 5 : 0), 'fresh').map((each) => each.label)
    expect(names).toEqual(['fresh', 'busy'])
  })
})

describe('finding machines', () => {
  it('matches the name and the address in any case', () => {
    const heads = [head('devbox', 'connected'), head('gpu', 'connected', { target: 'ubuntu@10.0.4.12' })]
    expect(matching(heads, 'DEV').map((each) => each.label)).toEqual(['devbox'])
    expect(matching(heads, '10.0.4').map((each) => each.label)).toEqual(['gpu'])
    expect(matching(heads, '  ')).toHaveLength(2)
  })

  it('updates only machines with an older Maiker, never a first install', () => {
    const heads = [head('a', 'needs-update', { why: OLDER }), head('b', 'needs-update', { why: MISSING }), head('c', 'connected')]
    expect(updatable(heads).map((each) => each.label)).toEqual(['a'])
  })
})

describe("a machine's page status", () => {
  it('says connected with the sessions', () => {
    expect(pageStatusOf(head('box', 'connected'), 2)).toMatchObject({ glyph: '●', lead: 'Connected · 2 sessions', action: null })
  })

  it('gives the ssh-copy-id command for a rejected key', () => {
    expect(pageStatusOf(head('box', 'needs-login'), 0)).toMatchObject({ lead: 'Key rejected.', command: 'ssh-copy-id me@box.lan', action: 'retry' })
  })

  it('leaves the time to the page, so it keeps counting', () => {
    expect(pageStatusOf(head('box', 'unreachable', { why: 'no answer' }), 0)).toMatchObject({ lead: "Can't reach it", more: 'no answer', showsSince: true, action: 'retry' })
  })
})

describe("a machine's Maiker line", () => {
  it('says up to date, older, not installed, newer, or unknown', () => {
    expect(maikerLine(head('box', 'connected'), '0.46.0')).toBe('Up to date')
    expect(maikerLine(head('box', 'needs-update', { why: OLDER }), '0.46.0')).toBe('Older · this computer has 0.46.0')
    expect(maikerLine(head('box', 'needs-update', { why: MISSING }), '0.46.0')).toBe('Not installed')
    expect(maikerLine(head('box', 'needs-update', { why: 'update maiker on this computer first' }), '0.46.0')).toBe('Newer than this app')
    expect(maikerLine(head('box', 'unreachable'), '0.46.0')).toBe('Unknown until it connects')
  })
})
