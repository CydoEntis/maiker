import type { TicketFailure } from '@/api/tickets'
import { PROVIDER_LOOK, type Provider } from './tickets'

/** What a write that did not happen says, in the words the dialog shows. Nothing was written. */
export function writeFailureWords(failure: TicketFailure, provider: Provider): string {
  const name = PROVIDER_LOOK[provider].name
  switch (failure.kind) {
    case 'no-key': return `Add your ${name} key in Settings first.`
    case 'signed-out': return provider === 'github' ? 'GitHub is not signed in. Run gh auth login in a terminal.' : `${name} refused the key, so nothing was written.`
    case 'not-found': return `${name} has no such ticket, or this key cannot see it.`
    case 'rate-limited': return `${name} says too many requests. Try again in a minute.`
    case 'unreachable': return failure.line
    case 'invalid': return failure.line
  }
}
