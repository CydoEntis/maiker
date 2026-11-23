import { describe, expect, it } from 'vitest'
import { failureTone, hostRequest, knownAs, machineRows, nicknameOf, stageHints, stageKeyAction, stageOf, typedRequest, type KnownMachine, type MachineDraft } from './newMachine'
import type { KeyPress } from './openPalette'

const draft = (text: string, more: Partial<MachineDraft> = {}): MachineDraft => ({ text, port: '', keyFile: '', ...more })
const BUILD: KnownMachine = { machine: 3, name: 'build', label: 'Build box', target: 'ci@build.lan' }
const HOSTS = [{ alias: 'pi', detail: 'me@192.168.1.5', added: false }, { alias: 'build', detail: 'ci@build.lan', added: true }, { alias: 'gone', detail: 'me@gone', added: true }]
const press = (key: string, more: Partial<KeyPress> = {}): KeyPress => ({ key, ctrl: false, shift: false, alt: false, ...more })
const actions = (rows: ReturnType<typeof machineRows>) => rows.map((row) => row.action)

describe('what Enter sends', () => {
  it('reads the typed address with the port and key of the options, and names the machine after its host', () => {
    expect(typedRequest(draft(' dev@10.0.4.12 ', { port: '2222', keyFile: ' ~/.ssh/work ' }), [])).toEqual({ ok: true, request: { target: 'dev@10.0.4.12', name: 'server-12', port: 2222, keyFile: '~/.ssh/work', shown: '10.0.4.12' } })
    expect(typedRequest(draft('me@build.lan:2200'), [BUILD])).toEqual({ ok: true, request: { target: 'me@build.lan', name: 'build-2', port: 2200, keyFile: null, shown: 'build.lan' } })
  })

  it('sends nothing for an address that cannot be one, or a port given twice', () => {
    expect(typedRequest(draft('me@10.0.4'), []).ok).toBe(false)
    expect(typedRequest(draft('two words'), []).ok).toBe(false)
    expect(typedRequest(draft('me@host:22', { port: '2222' }), []).ok).toBe(false)
  })

  it('sends a host of the SSH config as its alias, for ssh to resolve', () => {
    expect(hostRequest('pi', draft('', { keyFile: '~/.ssh/pi' }), [])).toEqual({ target: 'pi', name: 'pi', port: null, keyFile: '~/.ssh/pi', shown: 'pi' })
  })
})

describe('the rows under the field', () => {
  it('offers the hosts of the SSH config before anything is typed, and none the window cannot show', () => {
    expect(actions(machineRows(draft(''), HOSTS, [BUILD]))).toEqual([{ do: 'add', alias: 'pi' }, { do: 'browse', machine: 3, path: '~' }])
  })

  it('puts connecting to an address first, and a matching alias first for a bare word', () => {
    expect(actions(machineRows(draft('me@192.168.1.5'), HOSTS, []))).toEqual([{ do: 'add', alias: null }, { do: 'add', alias: 'pi' }])
    expect(actions(machineRows(draft('pi'), HOSTS, []))).toEqual([{ do: 'add', alias: 'pi' }, { do: 'add', alias: null }])
    expect(actions(machineRows(draft('nothing-like-it'), HOSTS, []))).toEqual([{ do: 'add', alias: null }])
  })

  it('browses a machine that is already added instead of adding it again, by its name or its address', () => {
    expect(knownAs([BUILD], ' CI@build.lan ')).toBe(BUILD)
    expect(knownAs([BUILD], '')).toBeNull()
    expect(actions(machineRows(draft('build'), HOSTS, [BUILD]))).toEqual([{ do: 'browse', machine: 3, path: '~' }])
    expect(actions(machineRows(draft('ci@build.lan'), HOSTS, [BUILD]))).toEqual([{ do: 'browse', machine: 3, path: '~' }])
  })
})

describe('the stages after Enter', () => {
  const request = { target: 'pi', name: 'pi', port: null, keyFile: null, shown: 'pi' }

  it('follows the add: the field, the spinner, the sentence, the machine', () => {
    expect(stageOf({ kind: 'idle' })).toBe('editing')
    expect(stageOf({ kind: 'busy', run: 1, request, installing: false })).toBe('connecting')
    expect(stageOf({ kind: 'failed', request, failure: { message: 'no', kind: null, fixCommand: null, saved: null } })).toBe('failed')
    expect(stageOf({ kind: 'added', name: 'pi' })).toBe('done')
  })

  it('Enter tries again and Backspace edits the address after a failure', () => {
    expect(stageKeyAction('failed', press('Enter'))).toBe('retry')
    expect(stageKeyAction('failed', press('Backspace'))).toBe('edit')
    expect(stageKeyAction('failed', press('Enter', { ctrl: true }))).toBeNull()
  })

  it('Enter browses the new machine, and Backspace stays the Name field’s', () => {
    expect(stageKeyAction('done', press('Enter'))).toBe('browse')
    expect(stageKeyAction('done', press('Backspace'))).toBeNull()
  })

  it('takes no key while it connects', () => {
    expect(stageKeyAction('connecting', press('Enter'))).toBeNull()
    expect(stageKeyAction('connecting', press('Backspace'))).toBeNull()
  })

  it('names in the foot the keys each stage takes', () => {
    expect(stageHints('connecting').map((hint) => hint.keys)).toEqual(['Esc'])
    expect(stageHints('failed').map((hint) => hint.keys)).toEqual(['Enter', '⌫', 'Esc'])
    expect(stageHints('done').map((hint) => hint.keys)).toEqual(['Enter', 'Esc'])
  })

  it('marks as the person’s to finish only what they can: a key, a sign-in, a host key to accept', () => {
    expect(failureTone({ kind: 'needs-person' })).toBe('needs')
    expect(failureTone({ kind: 'key-refused' })).toBe('needs')
    expect(failureTone({ kind: 'unreachable' })).toBe('bad')
    expect(failureTone({ kind: null })).toBe('bad')
  })

  it('keeps no nickname for the machine’s own name or an empty field', () => {
    expect(nicknameOf(' Lab ', 'server-12')).toBe('Lab')
    expect(nicknameOf('server-12', 'server-12')).toBe('')
    expect(nicknameOf('  ', 'server-12')).toBe('')
  })
})
