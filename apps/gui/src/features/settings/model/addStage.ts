import type { Added, HostKeyReport } from '@/api/machines'

/** What the person typed, as Add a remote machine sends it. `entry` is the raw text, kept so Change address comes back to it. */
export type AddRequest = {
  target: string
  name: string
  port: number | null
  /** The computer's address, as it is reached and shown ('100.78.214.15'), not the alias it was picked by. */
  host: string
  /** The login name, when the address or the SSH config's host line gave one. */
  user: string | null
  keyFile: string | null
  /** The machine was picked from the SSH config, so its name is the config's and stays. */
  fromConfig: boolean
  entry: { address: string; port: string; keyFile: string }
}

type Added1 = Extract<Added, { outcome: 'added' }>
type Login = Extract<Added, { outcome: 'login' }>

/** How the host key stood: already known, trusted just now, or not looked at (the host would not give it). */
export type HostResult = 'known' | 'trusted' | 'unchecked'

/** What adding the machine found out. Every field is only what the host said. */
export type ReachedMachine = {
  /** The name the machine was added under. */
  name: string
  address: string
  /** Whether the name is the SSH config's (kept as it is) rather than one made up from an IP address. */
  fromConfig: boolean
  reachMs: number | null
  /** The key file's name that signed in, never a path. */
  key: string | null
  helperVersion: string | null
}

/**
 * What the machine's own daemon could say once connected: its system and the agents on it. The host does not report these yet, so
 * nothing supplies them today and the rows are left out; none is ever made up.
 */
export type MachineFacts = {
  /** "Ubuntu 24.04 · 8 cores". */
  system?: string
  agents?: readonly string[]
  /** The name the machine reports for itself: suggested for a machine added by a bare IP address. */
  reportedName?: string
}

/** Where the add is. Each one maps to a step of the checklist (`positionOf` in AddRun). */
export type Stage =
  /** Reaching the machine and asking it for its host key. */
  | { kind: 'checking' }
  | { kind: 'trust'; report: Extract<HostKeyReport, { status: 'unknown' }>; trusting: boolean; problem: string | null }
  | { kind: 'changed'; report: Extract<HostKeyReport, { status: 'changed' }> }
  /** Signing in and, once the host says how far it has got, putting the helper on. */
  | { kind: 'adding'; helper: boolean; action: 'install' | 'update'; percent: number | null }
  | { kind: 'no-answer'; message: string }
  | { kind: 'no-name' }
  | { kind: 'name-taken'; name: string }
  /** The saved machine of that name is being taken out, so the run can start again from the top. */
  | { kind: 'removing'; name: string }
  /** A machine saved by an earlier try, dialled again: the checklist follows what the host says of it. */
  | { kind: 'saved'; name: string }
  /** ssh refused the host key: the machine is saved, and `message` is the host's sentence for it. */
  | { kind: 'unverified'; name: string; message: string }
  | { kind: 'key'; login: Login }
  /** `message` is the host's sentence for what is still wrong there. */
  | { kind: 'helper'; reason: 'missing' | 'older' | 'not-running'; added: Added1; message: string | null }
  | { kind: 'connected'; reached: ReachedMachine }

/** The host's refusal when the name is already in the saved machines. */
const SAVED_NAME = /already have a machine called (\S+?)\./

/** The address as shown: user@host, with its port when it is not the default one. */
export function addressOf(request: AddRequest): string {
  const login = request.user === null ? request.host : `${request.user}@${request.host}`
  return request.port === null ? login : `${login}:${String(request.port)}`
}

/** What is known of a machine that was reached, from the host's answer when there was one. */
export function reachedOf(request: AddRequest, name: string, added: Added1 | null): ReachedMachine {
  return {
    name,
    address: addressOf(request),
    fromConfig: request.fromConfig,
    reachMs: added?.reach_ms ?? null,
    key: added?.key ?? null,
    helperVersion: added?.version ?? null,
  }
}

/** The stage the host's answer to add_machine leads to; null for an add that was cancelled, which leaves the screen as it is. */
export function stageAfterAdd(result: Added, request: AddRequest): Stage | null {
  switch (result.outcome) {
    case 'cancelled': return null
    case 'needs-name': return { kind: 'no-name' }
    case 'login': return result.failure === 'host-key-changed' ? { kind: 'unverified', name: result.name, message: result.message } : { kind: 'key', login: result }
    case 'added': {
      // The helper was missing and add_machine put it on: the machine is as good as one that had it.
      const putOn = result.reach === 'missing' && result.helper_install?.installed === true
      if (result.reach === 'answered' || result.reach === 'newer-here' || putOn) return { kind: 'connected', reached: reachedOf(request, result.name, result) }
      const message = result.message ?? null
      if (result.reach === 'not-running') return { kind: 'helper', reason: 'not-running', added: result, message }
      if (result.reach === 'older') return { kind: 'helper', reason: 'older', added: result, message }
      return { kind: 'helper', reason: 'missing', added: result, message }
    }
  }
}

/** The stage a rejected add leads to: a saved name that is taken, or a machine that could not be reached. */
export function stageAfterFailure(message: string): Stage {
  const taken = SAVED_NAME.exec(message)?.[1]
  return taken === undefined ? { kind: 'no-answer', message } : { kind: 'name-taken', name: taken }
}

/** The name of a machine the host has saved for this add, and which therefore must go again if it never connects. */
export function savedNameOf(stage: Stage): string | null {
  if (stage.kind === 'key') return stage.login.name
  if (stage.kind === 'unverified') return stage.name
  if (stage.kind === 'helper') return stage.added.name
  return null
}
