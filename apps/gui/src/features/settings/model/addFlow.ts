import type { Added, FailureKind, HostChoice } from '@/api/machines'

/** What Add sends the host, and what the spinner calls the machine meanwhile. */
export type AddRequest = {
  target: string
  /** The name the machine is saved under. */
  name: string
  port: number | null
  keyFile: string | null
  /** What the person picked or typed it as: the SSH config alias, or the host of the address. */
  shown: string
}

/** Why an add stopped, as the host said it. */
export type AddFailure = {
  /** The host's one sentence: what failed and the fix. */
  message: string
  /** Which failure it is, when the host named one. Buttons are picked by it, never by the words. */
  kind: FailureKind | null
  /** The command the sentence names, for Copy. */
  fixCommand: string | null
  /** The machine the host saved for this add (it logs in after writing it); null when nothing was saved. */
  saved: string | null
}

/** Where adding a machine is: the field, the spinner, the one sentence, or done. */
export type AddState =
  | { kind: 'idle' }
  /** `installing` once the host reports it is putting Maiker on the machine. */
  | { kind: 'busy'; run: number; request: AddRequest; installing: boolean }
  | { kind: 'failed'; request: AddRequest; failure: AddFailure }
  | { kind: 'added'; name: string }

/** What happened. `run` ties an answer to the add that asked, so a cancelled add's late answer changes nothing. */
export type AddEvent =
  | { type: 'start'; run: number; request: AddRequest }
  | { type: 'installing'; name: string }
  | { type: 'answered'; run: number; result: Added }
  /** The host refused the request before looking (a bad target, a taken name), in its own words. */
  | { type: 'rejected'; run: number; message: string }
  | { type: 'cancel' }
  /** A machine the window lists is connected now. */
  | { type: 'connected'; name: string }

export const IDLE: AddState = { kind: 'idle' }

/** The next state. Pure: the hook that runs the add does the asking and the cleaning up. */
export function addStep(state: AddState, event: AddEvent): AddState {
  switch (event.type) {
    case 'start': return { kind: 'busy', run: event.run, request: event.request, installing: false }
    case 'installing': return state.kind === 'busy' && state.request.name === event.name ? { ...state, installing: true } : state
    case 'answered': return isAnswerTo(state, event.run) ? afterAnswer(state.request, event.result) : state
    case 'rejected': return isAnswerTo(state, event.run) ? failed(state.request, { message: event.message, kind: null, fixCommand: null, saved: null }) : state
    case 'cancel': return state.kind === 'busy' ? IDLE : state
    // A saved machine that connects after all (a key installed, a sign-in in the terminal) is added: nothing is left to fix.
    case 'connected': return state.kind === 'failed' && state.failure.saved === event.name ? { kind: 'added', name: event.name } : state
  }
}

function isAnswerTo(state: AddState, run: number): state is Extract<AddState, { kind: 'busy' }> {
  return state.kind === 'busy' && state.run === run
}

function failed(request: AddRequest, failure: AddFailure): AddState {
  return { kind: 'failed', request, failure }
}

type AddedOutcome = Extract<Added, { outcome: 'added' }>

/**
 * Whether a machine the host wrote is in. A Maiker of another version counts: the machine is listed, and its sidebar heading
 * offers the update, so adding does not ask about it.
 */
function isIn(result: AddedOutcome): boolean {
  if (result.reach === 'missing') return result.helper_install?.installed === true
  return result.reach !== 'not-running'
}

function afterAnswer(request: AddRequest, result: Added): AddState {
  switch (result.outcome) {
    case 'cancelled': return IDLE
    case 'needs-name': return failed(request, { message: `Type ${request.target} as user@host, so Maiker can name it.`, kind: null, fixCommand: null, saved: null })
    case 'failed': return failed(request, { message: result.message, kind: result.failure, fixCommand: result.fix_command, saved: null })
    case 'login': return failed(request, { message: result.message, kind: result.failure, fixCommand: result.fix_command, saved: result.name })
    case 'added': {
      if (isIn(result)) return { kind: 'added', name: result.name }
      const kind: FailureKind = result.reach === 'not-running' ? 'not-running' : result.helper_install?.installed === false ? 'install-failed' : 'install'
      const message = result.message ?? result.helper_install?.said ?? `Maiker could not be set up on ${result.name}.`
      return failed(request, { message, kind, fixCommand: null, saved: result.name })
    }
  }
}

/** The machine an answer saved, which must go again when nobody is waiting for it (the add was cancelled or the palette closed). */
export function savedNameOf(result: Added): string | null {
  return result.outcome === 'added' || result.outcome === 'login' ? result.name : null
}

/** The SSH config's hosts offered for what is typed: all of them before anything is, then those whose alias or address holds it. */
export function offeredHosts(typed: string, hosts: readonly HostChoice[]): readonly HostChoice[] {
  const lower = typed.trim().toLowerCase()
  if (lower === '') return hosts
  return hosts.filter((host) => host.alias.toLowerCase().includes(lower) || host.detail.toLowerCase().includes(lower))
}
