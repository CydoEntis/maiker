import { describe, expect, it } from 'vitest'
import type { Added } from '@/api/machines'
import { addStep, IDLE, offeredHosts, savedNameOf, type AddRequest, type AddState } from './addFlow'

const request: AddRequest = { target: 'dev@10.0.4.12', name: 'server-12', port: null, keyFile: null, shown: '10.0.4.12' }
const busy: AddState = { kind: 'busy', run: 1, request, installing: false }
const added = (extra: Partial<Extract<Added, { outcome: 'added' }>> = {}): Added => ({ outcome: 'added', name: 'server-12', version: '0.46.0', reach: 'answered', took_ms: 9, ...extra })
const REFUSED = 'server-12 refused your key: run `ssh-copy-id dev@10.0.4.12` in a terminal, then try again.'
const login: Added = { outcome: 'login', name: 'server-12', target: 'dev@10.0.4.12', said: 'Permission denied (publickey).', message: REFUSED, failure: 'key-refused', fix_command: 'ssh-copy-id dev@10.0.4.12', command: null }
const answer = (result: Added, state: AddState = busy) => addStep(state, { type: 'answered', run: 1, result })

describe('the add dialog', () => {
  it('spins from Add until the host answers, and says when it is putting Maiker on', () => {
    const started = addStep(IDLE, { type: 'start', run: 1, request })
    expect(started).toEqual(busy)
    expect(addStep(started, { type: 'installing', name: 'server-12' })).toEqual({ ...busy, installing: true })
    expect(addStep(started, { type: 'installing', name: 'another' })).toBe(started)
  })

  it('is done for a machine that answered, one that got Maiker put on, and one with another Maiker the sidebar can update', () => {
    expect(answer(added())).toEqual({ kind: 'added', name: 'server-12' })
    expect(answer(added({ reach: 'missing', helper_install: { installed: true, said: 'ok' } })).kind).toBe('added')
    expect(answer(added({ reach: 'older' })).kind).toBe('added')
    expect(answer(added({ reach: 'newer-here' })).kind).toBe('added')
  })

  it('stops on the host\'s sentence and its command when the machine was not added, with nothing saved', () => {
    const message = "server-12's host key has changed, so Maiker won't connect: confirm with whoever runs it that the change is expected, then run `ssh-keygen -R '10.0.4.12'` in a terminal and try again."
    const state = answer({ outcome: 'failed', message, failure: 'host-key-changed', fix_command: "ssh-keygen -R '10.0.4.12'" })
    expect(state).toEqual({ kind: 'failed', request, failure: { message, kind: 'host-key-changed', fixCommand: "ssh-keygen -R '10.0.4.12'", saved: null } })
  })

  it('stops on a login ssh could not do alone, keeping the saved machine to take out before a retry', () => {
    expect(answer(login)).toEqual({ kind: 'failed', request, failure: { message: REFUSED, kind: 'key-refused', fixCommand: 'ssh-copy-id dev@10.0.4.12', saved: 'server-12' } })
  })

  it('stops on Maiker that could not be put on, or did not start, in the host\'s sentence', () => {
    const message = 'Maiker could not be installed or started on server-12 (No space.); only Linux and macOS machines are supported.'
    expect(answer(added({ reach: 'missing', helper_install: { installed: false, said: 'No space.' }, message }))).toMatchObject({ kind: 'failed', failure: { message, kind: 'install-failed', saved: 'server-12' } })
    expect(answer(added({ reach: 'not-running', message: 'Maiker is on server-12 but did not start.' }))).toMatchObject({ failure: { kind: 'not-running' } })
  })

  it('says the host\'s words for a request it refused, and asks for user@host when no name can be made', () => {
    expect(addStep(busy, { type: 'rejected', run: 1, message: 'You already have a machine called server-12.' })).toMatchObject({ kind: 'failed', failure: { message: 'You already have a machine called server-12.', kind: null, saved: null } })
    expect(answer({ outcome: 'needs-name' })).toMatchObject({ failure: { message: 'Type dev@10.0.4.12 as user@host, so Maiker can name it.' } })
  })

  it('goes back to the field on Cancel, and a cancelled add\'s late answer changes nothing', () => {
    const cancelled = addStep(busy, { type: 'cancel' })
    expect(cancelled).toEqual(IDLE)
    expect(answer(added(), cancelled)).toBe(cancelled)
    expect(addStep(busy, { type: 'answered', run: 2, result: added() })).toBe(busy)
    expect(answer({ outcome: 'cancelled' })).toEqual(IDLE)
  })

  it('is done when the saved machine connects after all, and not for any other machine', () => {
    const stopped = answer(login)
    expect(addStep(stopped, { type: 'connected', name: 'server-12' })).toEqual({ kind: 'added', name: 'server-12' })
    expect(addStep(stopped, { type: 'connected', name: 'other' })).toBe(stopped)
    expect(addStep(busy, { type: 'connected', name: 'server-12' })).toBe(busy)
  })

  it('names the machine an answer saved, so a cancelled one can be taken out', () => {
    expect(savedNameOf(added())).toBe('server-12')
    expect(savedNameOf(login)).toBe('server-12')
    expect(savedNameOf({ outcome: 'failed', message: 'x', failure: 'unreachable', fix_command: null })).toBeNull()
    expect(savedNameOf({ outcome: 'cancelled' })).toBeNull()
  })
})

describe('the SSH config hosts offered', () => {
  const hosts = [{ alias: 'build', detail: 'me@build.example', added: false }, { alias: 'pi', detail: 'cydo@192.168.1.242', added: false }]

  it('are all there before anything is typed, then follow what is typed in the alias or the address', () => {
    expect(offeredHosts('  ', hosts)).toBe(hosts)
    expect(offeredHosts('BU', hosts).map((host) => host.alias)).toEqual(['build'])
    expect(offeredHosts('192.168', hosts).map((host) => host.alias)).toEqual(['pi'])
    expect(offeredHosts('nothing', hosts)).toEqual([])
  })
})
