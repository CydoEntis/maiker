import type { SignInAgent, SignInFailure } from '@/api/agentSignIn'

/** The names the sign-in card uses for each agent. */
export const SIGN_IN_LABELS: Readonly<Record<SignInAgent, string>> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', github: 'GitHub' }

/** What the card says when a sign-in ended without the agent being signed in, in plain words. */
export function failureWords(agent: SignInAgent, failure: SignInFailure): string {
  const label = SIGN_IN_LABELS[agent]
  switch (failure) {
    case 'not-installed': return `${label} is not installed on this computer.`
    case 'unsupported': return `${label}'s command line has no sign-in to run from here. Open ${label} in a terminal and sign in when it asks.`
    case 'could-not-start': return `Could not start ${label}'s sign-in.`
    case 'timed-out': return `Nobody finished the ${label} sign-in in time.`
    case 'ended': return `The ${label} sign-in ended without signing in.`
  }
}

/** The address as a person should check it before opening: its host, with the rest cut. Empty when it is not an address. */
export function linkHost(link: string): string {
  try {
    return new URL(link).host
  } catch {
    return ''
  }
}
