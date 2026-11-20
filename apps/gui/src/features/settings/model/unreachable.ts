const DEFAULT_SSH_PORT = 22

export type Unreachable = 'no-answer' | 'refused' | 'cannot-resolve' | 'other'

/** What ssh's own words about a computer it could not reach come to, so the screen can say what to try. */
export function unreachableKind(said: string): Unreachable {
  if (/refused/i.test(said)) return 'refused'
  if (/could not resolve|not known|no such host|name or service|nodename/i.test(said)) return 'cannot-resolve'
  if (/timed out|timeout|no route|unreachable|did not answer|deadline/i.test(said)) return 'no-answer'
  return 'other'
}

/** The step's name when the computer could not be reached: what happened, in plain words. */
export function unreachableTitle(kind: Unreachable, host: string): string {
  switch (kind) {
    case 'no-answer': return `${host} didn't answer`
    case 'refused': return `${host} refused the connection`
    case 'cannot-resolve': return `Couldn't find ${host}`
    case 'other': return `Couldn't reach ${host}`
  }
}

/** What to check for each way reaching a computer can fail: the address, the power and the SSH port. */
export function unreachableAdvice(kind: Unreachable, host: string, port: number | null): string {
  const shown = String(port ?? DEFAULT_SSH_PORT)
  switch (kind) {
    case 'no-answer': return `Check that the address is right, that the computer is on and on your network or VPN, and that SSH is listening on port ${shown}.`
    case 'refused': return `It's on, but nothing is listening for SSH on port ${shown}.`
    case 'cannot-resolve': return `Couldn't find a computer called ${host}. Check the spelling, or use its IP address.`
    case 'other': return 'ssh said the words under Details.'
  }
}
