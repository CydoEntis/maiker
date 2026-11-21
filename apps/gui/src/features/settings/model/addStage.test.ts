import { describe, expect, it } from 'vitest'
import type { Added } from '@/api/machines'
import { addressOf, stageAfterAdd, stageAfterFailure, type AddRequest } from './addStage'

const request: AddRequest = { target: 'dev@10.0.4.12', name: 'server-12', port: null, host: '10.0.4.12', user: 'dev', keyFile: null, fromConfig: false, entry: { address: 'dev@10.0.4.12', port: '', keyFile: '' } }
const added = (extra: Partial<Extract<Added, { outcome: 'added' }>>): Added => ({ outcome: 'added', name: 'server-12', version: '0.46.0', reach: 'answered', took_ms: 9, ...extra })

describe('where an answer from the host leads', () => {
  it('goes to Machine added for a machine that answered, with what the host told', () => {
    const stage = stageAfterAdd(added({ reach_ms: 38, key: 'id_ed25519' }), request)
    expect(stage).toMatchObject({ kind: 'connected', reached: { name: 'server-12', reachMs: 38, key: 'id_ed25519', helperVersion: '0.46.0' } })
  })

  it('counts a helper that was put on as a machine that answered', () => {
    expect(stageAfterAdd(added({ reach: 'missing', helper_install: { installed: true, said: 'ok' } }), request)?.kind).toBe('connected')
  })

  it('stops on the helper step when it could not be put on, with the host\'s sentence', () => {
    const message = 'Maiker could not be installed or started on server-12 (No space.); only Linux and macOS machines are supported.'
    expect(stageAfterAdd(added({ reach: 'missing', helper_install: { installed: false, said: 'No space.' }, message }), request)).toMatchObject({ kind: 'helper', reason: 'missing', message })
  })

  it('stops on the key step for a refused login, and leaves a cancelled add alone', () => {
    const login: Added = { outcome: 'login', name: 'server-12', target: 'dev@10.0.4.12', said: 'Permission denied (publickey).', message: 'server-12 refused your key: run `ssh-copy-id dev@10.0.4.12` in a terminal, then try again.', failure: 'key-refused', fix_command: 'ssh-copy-id dev@10.0.4.12', command: null }
    expect(stageAfterAdd(login, request)?.kind).toBe('key')
    expect(stageAfterAdd({ outcome: 'cancelled' }, request)).toBeNull()
  })

  it('stops on the host step for a changed host key, by the failure the host named and not by ssh\'s words', () => {
    const message = "server-12's host key has changed, so Maiker won't connect: confirm with whoever runs it that the change is expected, then run `ssh-keygen -R '10.0.4.12'` in a terminal and try again."
    const changed: Added = { outcome: 'login', name: 'server-12', target: 'dev@10.0.4.12', said: '', message, failure: 'host-key-changed', fix_command: "ssh-keygen -R '10.0.4.12'", command: null }
    expect(stageAfterAdd(changed, request)).toEqual({ kind: 'unverified', name: 'server-12', message })
  })

  it('tells a saved name that is taken from a machine that could not be reached', () => {
    expect(stageAfterFailure('You already have a machine called server-12. Remove it, or pick another name.')).toEqual({ kind: 'name-taken', name: 'server-12' })
    expect(stageAfterFailure('ssh: connect to host x port 22: Connection timed out').kind).toBe('no-answer')
  })

  it('shows the port with the address only when it is not the default one', () => {
    expect(addressOf(request)).toBe('dev@10.0.4.12')
    expect(addressOf({ ...request, port: 2222 })).toBe('dev@10.0.4.12:2222')
  })
})
