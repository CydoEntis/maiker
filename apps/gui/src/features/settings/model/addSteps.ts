/** The four steps of connecting to a computer, and how each looks given how far the look got. */

export type StepMark = 'wait' | 'run' | 'done' | 'needs' | 'bad'
export type StepRow = { readonly title: string; readonly text: string; readonly mark: StepMark }

/** The steps in the order they run. */
export const STEPS = ['find', 'login', 'setup', 'link'] as const
export type StepId = (typeof STEPS)[number]

/** Where the look stopped, if it did: the step and whether it needs the person or failed. */
export type Stop = { readonly step: StepId; readonly mark: 'needs' | 'bad' }

export type StepFacts = {
  readonly name: string
  /** The user ssh logged in as, when it is known. */
  readonly user: string | null
  /** How long the look took, in milliseconds, when it ran to its end. */
  readonly tookMs: number | null
  /** What the app there said its version is, when it answered. */
  readonly version: string | null
  /** The person chose to leave the install or update for later. */
  readonly skipped: boolean
}

const TITLES = (name: string) => [`Find ${name}`, 'Log in with your SSH key', `Set up Maiker on ${name}`, 'Link it to this app'] as const
const WAITING = [
  'Checks that this computer can reach it.',
  'Maiker uses your key. It never asks for or keeps passwords.',
  'Adds a small helper in ~/.maiker (about 40 MB). No admin rights needed.',
  'So its sessions show in your sidebar.',
] as const
const RUNNING = (name: string, user: string | null) => [
  `Looking for ${name}…`,
  `Logging in${user === null ? '' : ` as ${user}`}…`,
  `Checking for Maiker on ${name}…`,
  `Linking ${name}…`,
] as const

function doneText(step: StepId, facts: StepFacts): string {
  switch (step) {
    case 'find': return facts.tookMs === null ? 'Found it' : `Found it · answered in ${String(facts.tookMs)} ms`
    case 'login': return facts.user === null ? 'Logged in with your SSH key' : `Logged in as ${facts.user} with your SSH key`
    case 'setup': return facts.skipped ? 'Skipped · you can install it later from Remote machines' : facts.version === null ? 'Maiker is set up' : `${facts.version} is already there`
    case 'link': return 'Linked to this computer'
  }
}

/**
 * The four rows. With `stop` null the look is running (`running` true: the first step spins) or it ran to
 * its end (every step done). A step before the stop is done; the stop is where the person is asked or it failed.
 */
export function stepRows(facts: StepFacts, state: { readonly stop: Stop | null; readonly running: boolean }): StepRow[] {
  const titles = TITLES(facts.name)
  const waiting = WAITING
  const running = RUNNING(facts.name, facts.user)
  return STEPS.map((step, index): StepRow => {
    const title = titles[index] ?? ''
    const text = waiting[index] ?? ''
    if (state.stop !== null) {
      const stopAt = STEPS.indexOf(state.stop.step)
      if (index < stopAt) return { title, text: doneText(step, facts), mark: 'done' }
      return index === stopAt ? { title, text, mark: state.stop.mark } : { title, text, mark: 'wait' }
    }
    if (state.running) return step === 'find' ? { title, text: running[0], mark: 'run' } : { title, text, mark: 'wait' }
    return { title, text: doneText(step, facts), mark: 'done' }
  })
}

export type Unreachable = 'no-answer' | 'refused' | 'cannot-resolve' | 'other'

/** What ssh's own words about a computer it could not reach come to, so the screen can say what to try. */
export function unreachableKind(said: string): Unreachable {
  if (/refused/i.test(said)) return 'refused'
  if (/could not resolve|not known|no such host|name or service|nodename/i.test(said)) return 'cannot-resolve'
  if (/timed out|timeout|no route|unreachable|did not answer|deadline/i.test(said)) return 'no-answer'
  return 'other'
}
