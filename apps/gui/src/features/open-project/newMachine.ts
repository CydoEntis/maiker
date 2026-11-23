import type { HostChoice } from '@/api/machines'
import { offeredHosts, type AddFailure, type AddRequest, type AddState } from '@/features/settings/model/addFlow'
import { checkAddress, suggestedName, withPort } from '@/features/settings/model/addressCheck'
import { targetOf } from '@/features/settings/model/machineTarget'
import { HOME_FOLDER, rowOf, type Hint, type KeyPress, type Row } from './openPalette'

/**
 * The palette's New machine level as data (ADR 0017): the rows under its one field, what Enter sends, and what each
 * stage after Enter shows and takes from the keyboard. Reading the address is `checkAddress`, the same check the host
 * repeats; nothing here parses one.
 */

/** What the person typed: the address, and the two options behind Options. */
export type MachineDraft = { text: string; port: string; keyFile: string }

/** A machine the window already lists, as far as this level needs it. */
export type KnownMachine = { machine: number; name: string | null; label: string; target: string | null }

/** Where the level is: the field, the spinner, the host's one sentence, or the machine is in. */
export type MachineStage = 'editing' | 'connecting' | 'failed' | 'done'

export function stageOf(state: AddState): MachineStage {
  if (state.kind === 'busy') return 'connecting'
  if (state.kind === 'failed') return 'failed'
  return state.kind === 'added' ? 'done' : 'editing'
}

const keyFileOf = (draft: MachineDraft): string | null => (draft.keyFile.trim() === '' ? null : draft.keyFile.trim())

const namesOf = (machines: readonly KnownMachine[]): string[] => machines.flatMap((machine) => (machine.name === null ? [] : [machine.name]))

/** The machine a name, a target or an SSH config alias already is; null when it is none. */
export function knownAs(machines: readonly KnownMachine[], text: string): KnownMachine | null {
  const lower = text.trim().toLowerCase()
  if (lower === '') return null
  return machines.find((machine) => machine.name?.toLowerCase() === lower || machine.target?.toLowerCase() === lower) ?? null
}

/** What Enter on the typed address sends, or the words that say what is wrong with it. */
export function typedRequest(draft: MachineDraft, machines: readonly KnownMachine[]): { ok: true; request: AddRequest } | { ok: false; message: string } {
  const address = withPort(checkAddress(draft.text), draft.port)
  if (!address.ok) return { ok: false, message: address.message }
  return { ok: true, request: { target: targetOf(address.user, address.host), name: suggestedName({ host: address.host }, namesOf(machines)), port: address.port, keyFile: keyFileOf(draft), shown: address.host } }
}

/** What choosing a host of the SSH config sends: its alias, which ssh resolves, under that name. */
export function hostRequest(alias: string, draft: MachineDraft, machines: readonly KnownMachine[]): AddRequest {
  return { target: alias, name: suggestedName({ alias }, namesOf(machines)), port: null, keyFile: keyFileOf(draft), shown: alias }
}

const browse = (machine: KnownMachine): Row['action'] => ({ do: 'browse', machine: machine.machine, path: HOME_FOLDER })

/**
 * The rows under the field: the machine the text already names, **Connect to** what is typed, and the hosts of the SSH
 * config that the text keeps. A bare word is more likely an alias than a host, so the config's rows lead then. A host or
 * an address that is a machine already browses its folders and adds nothing.
 */
export function machineRows(draft: MachineDraft, hosts: readonly HostChoice[], machines: readonly KnownMachine[]): Row[] {
  const typed = draft.text.trim()
  const already = knownAs(machines, typed)
  const known = already === null ? [] : [rowOf({ id: `known:${String(already.machine)}`, title: already.label, detail: 'Already added. Browse its folders.', icon: 'server', tag: 'Added', action: browse(already) })]
  const offered = offeredHosts(draft.text, hosts).flatMap((host) => {
    const machine = host.added ? knownAs(machines, host.alias) : null
    if (machine !== null && machine === already) return []
    // A host the config calls added that the window does not list has nothing to browse and must not be added twice.
    if (host.added && machine === null) return []
    return [rowOf({ id: `host:${host.alias}`, group: 'From your SSH config', title: host.alias, detail: host.detail, icon: 'server', tag: machine === null ? null : 'Added', action: machine === null ? { do: 'add', alias: host.alias } : browse(machine) })]
  })
  if (typed === '' || already !== null) return [...known, ...offered]
  const address = withPort(checkAddress(typed), draft.port)
  const details = address.ok ? [address.port === null ? null : `port ${String(address.port)}`, keyFileOf(draft)].filter((part) => part !== null) : []
  const aliasFirst = offered.length > 0 && !/[@.:\s]/.test(typed)
  const connect = rowOf({ id: 'connect', group: aliasFirst ? 'Or' : null, title: `Connect to ${address.ok ? targetOf(address.user, address.host) : typed}`, detail: details.length === 0 ? null : details.join(' · '), icon: 'plus', action: { do: 'add', alias: null } })
  return aliasFirst ? [...offered, connect] : [connect, ...offered]
}

/** Amber for what only the person can finish (a key to install, a sign-in, a host key of theirs to accept), red for the rest. */
export function failureTone(failure: Pick<AddFailure, 'kind'>): 'needs' | 'bad' {
  return failure.kind === 'key-refused' || failure.kind === 'needs-person' || failure.kind === 'host-key-unknown' ? 'needs' : 'bad'
}

export type StageAction = 'retry' | 'edit' | 'browse'

/**
 * What a key does once Enter was pressed, or null when it does nothing here. After a failure Enter tries again and
 * Backspace goes back to the address; once the machine is in Enter browses its folders (Backspace is the Name field's).
 * Esc is the palette's own at every stage: it closes, which also ends an add that is running.
 */
export function stageKeyAction(stage: MachineStage, press: KeyPress): StageAction | null {
  if (press.alt || press.ctrl) return null
  if (stage === 'failed') return press.key === 'Enter' ? 'retry' : press.key === 'Backspace' ? 'edit' : null
  if (stage === 'done') return press.key === 'Enter' ? 'browse' : null
  return null
}

const CLOSE: Hint = { keys: 'Esc', does: 'Close' }

/** The foot's keys after Enter. While it connects the only key is Esc, and the foot has Cancel. */
export function stageHints(stage: Exclude<MachineStage, 'editing'>): Hint[] {
  if (stage === 'failed') return [{ keys: 'Enter', does: 'Try again' }, { keys: '⌫', does: 'Edit the address' }, CLOSE]
  if (stage === 'done') return [{ keys: 'Enter', does: 'Browse folders' }, CLOSE]
  return [CLOSE]
}

/**
 * The nickname a Name field leaves a machine with: blank when the field is empty or holds the machine's own name, so no
 * nickname is kept for a name that changes nothing.
 */
export function nicknameOf(typed: string, name: string): string {
  const trimmed = typed.trim()
  return trimmed === name ? '' : trimmed
}
