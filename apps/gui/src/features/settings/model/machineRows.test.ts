import { describe, expect, it } from 'vitest'
import { machineHeads, type MachineHead, type RemoteMachine } from '@/features/workspace/model/machines'
import { matching, maikerLine, ordered, foldStatusOf, rowOf, updatable } from './machineRows'

type State = RemoteMachine['state']

const SINCE = 1_000

function head(name: string, state: State['state'], extra: Partial<State> = {}): MachineHead {
  const machine: RemoteMachine = { state: { machine: 1, name, state, why: null, attempt: null, since: SINCE, target: `me@${name}.lan`, ...extra }, conversations: [], heard: true, listedAt: 0 }
  const found = machineHeads(new Map([[1, machine]])).find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error('no head')
  return found
}

/** The host's sentences and failure kinds, as crates/maitty-machines link_failure gives them. */
const OLDER: Partial<State> = { why: 'box runs an older Maiker: run `maiker machine update box`, then try again.', failure: 'update', fix_command: 'maiker machine update box' }
const MISSING: Partial<State> = { why: 'Maiker isn\'t installed on box: run `maiker machine update box --install` (Linux and macOS machines only), then try again.', failure: 'install', fix_command: 'maiker machine update box --install' }
const NEWER: Partial<State> = { why: 'box runs a newer Maiker than this computer: update Maiker here (`maiker update`, or the desktop app\'s own update), then try again.', failure: 'update-here' }
const REFUSING_WHY = 'box may be refusing new connections for a while, after failed sign-ins or too many at once: wait a few minutes and try again, and if it keeps happening, check its sshd and fail2ban settings.'
const REFUSED_KEY: Partial<State> = { why: 'box refused your key: run `ssh-copy-id me@box.lan` in a terminal, then try again.', failure: 'key-refused', fix_command: 'ssh-copy-id me@box.lan', said: 'me@box: Permission denied (publickey).' }

describe('a machine row', () => {
  it('says how many sessions a healthy machine has, and offers nothing', () => {
    expect(rowOf(head('box', 'connected'), 5)).toMatchObject({ glyph: '●', tone: 'ok', line: '5 sessions', action: null })
    expect(rowOf(head('box', 'connected'), 1).line).toBe('1 session')
    expect(rowOf(head('box', 'connected'), 0).line).toBe('No sessions')
  })

  it('offers Fix for a rejected key, and tells a changed host key and a sign-in apart from a key by the host\'s failure', () => {
    const rejected = head('box', 'needs-login', REFUSED_KEY)
    expect(rowOf(rejected, 0)).toMatchObject({ glyph: '×', tone: 'bad', line: 'Key rejected', action: 'fix' })
    const changedHost = head('box', 'needs-login', { failure: 'host-key-changed', said: 'Host key verification failed.' })
    expect(rowOf(changedHost, 0).line).toBe('Host key changed')
    const newHost = head('box', 'needs-login', { failure: 'host-key-unknown', fix_command: 'ssh -o StrictHostKeyChecking=ask box' })
    expect(rowOf(newHost, 0)).toMatchObject({ line: 'Host key not accepted yet', action: 'fix' })
    expect(foldStatusOf(newHost, 0)).toMatchObject({ lead: 'Host key not accepted yet.', command: 'ssh -o StrictHostKeyChecking=ask box' })
    expect(rowOf(head('box', 'needs-login', { failure: 'needs-person' }), 0).line).toBe('Needs a sign-in')
  })

  it('offers Retry for a machine it cannot reach, and counts how long', () => {
    expect(rowOf(head('box', 'unreachable', { why: 'no answer' }), 0)).toMatchObject({ glyph: '×', line: "Can't reach it", showsSince: true, action: 'retry' })
    expect(rowOf(head('box', 'refused'), 0)).toMatchObject({ line: 'Refused the connection', action: 'retry' })
  })

  it('says a machine that hangs up before signing in may be refusing connections for now, and still offers Retry', () => {
    const refusing = head('box', 'unreachable', { why: REFUSING_WHY, failure: 'refusing-connections' })
    expect(rowOf(refusing, 0)).toMatchObject({ glyph: '×', tone: 'bad', line: 'Refusing connections for now', showsSince: true, action: 'retry' })
    expect(foldStatusOf(refusing, 0)).toMatchObject({ lead: 'Refusing connections for now', more: REFUSING_WHY, showsSince: true, command: null, action: 'retry' })
    expect(rowOf(head('box', 'unreachable', { why: 'no answer', failure: 'unreachable' }), 0).line).toBe("Can't reach it")
  })

  it('offers Update for an older Maiker and Install when there is none, in amber', () => {
    expect(rowOf(head('box', 'needs-update', OLDER), 2)).toMatchObject({ glyph: '!', tone: 'needs', line: 'Needs an update to connect', action: 'update' })
    expect(rowOf(head('box', 'needs-update', MISSING), 0)).toMatchObject({ line: 'Maiker not installed', action: 'install' })
  })

  it('offers nothing for a Maiker newer than this app, since updating from here would be a downgrade', () => {
    const newer = head('box', 'needs-update', NEWER)
    expect(rowOf(newer, 1)).toMatchObject({ line: '1 session · newer Maiker', action: null })
  })

  it('shows a machine that is still connecting as waiting, not as connected', () => {
    expect(rowOf(head('box', 'connecting'), 0)).toMatchObject({ glyph: '○', tone: 'quiet', line: 'Connecting…', action: null })
    expect(rowOf(head('box', 'reconnecting', { attempt: 2 }), 0).line).toBe('Reconnecting #2…')
  })
})

describe('the order of the list', () => {
  it('puts failed machines first, then those to update, then connected ones busiest first', () => {
    const heads = [head('a-quiet', 'connected'), head('b-busy', 'connected'), head('c-old', 'needs-update', OLDER), head('d-down', 'unreachable')]
    const sessions: Record<string, number> = { 'a-quiet': 1, 'b-busy': 9, 'c-old': 4, 'd-down': 0 }
    const names = ordered(heads, (each) => sessions[each.label] ?? null).map((each) => each.label)
    expect(names).toEqual(['d-down', 'c-old', 'b-busy', 'a-quiet'])
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
    const heads = [head('a', 'needs-update', OLDER), head('b', 'needs-update', MISSING), head('c', 'connected')]
    expect(updatable(heads).map((each) => each.label)).toEqual(['a'])
  })
})

describe("a machine's fold status", () => {
  it('says connected with the sessions', () => {
    expect(foldStatusOf(head('box', 'connected'), 2)).toMatchObject({ glyph: '●', lead: 'Connected · 2 sessions', action: null })
  })

  it('gives the host\'s sentence and its command for a rejected key', () => {
    expect(foldStatusOf(head('box', 'needs-login', REFUSED_KEY), 0)).toMatchObject({ lead: 'Key rejected.', more: REFUSED_KEY.why, command: 'ssh-copy-id me@box.lan', action: 'retry' })
  })

  it('leaves the time to the fold, so it keeps counting', () => {
    expect(foldStatusOf(head('box', 'unreachable', { why: 'no answer' }), 0)).toMatchObject({ lead: "Can't reach it", more: 'no answer', showsSince: true, action: 'retry' })
  })
})

describe("a machine's Maiker line", () => {
  it('says up to date, older, not installed, newer, or unknown', () => {
    expect(maikerLine(head('box', 'connected'), '0.46.0')).toBe('Up to date')
    expect(maikerLine(head('box', 'needs-update', OLDER), '0.46.0')).toBe('Older · this computer has 0.46.0')
    expect(maikerLine(head('box', 'needs-update', MISSING), '0.46.0')).toBe('Not installed')
    expect(maikerLine(head('box', 'needs-update', NEWER), '0.46.0')).toBe('Newer than this app')
    expect(maikerLine(head('box', 'unreachable'), '0.46.0')).toBe('Unknown until it connects')
  })
})
