const DEFAULT_SSH_PORT = 22

export type Unreachable = 'no-answer' | 'refused' | 'cannot-resolve' | 'other'

/** What ssh's own words about a computer it could not reach come to, so the screen can say what to try. */
export function unreachableKind(said: string): Unreachable {
  if (/refused/i.test(said)) return 'refused'
  if (/could not resolve|not known|no such host|name or service|nodename/i.test(said)) return 'cannot-resolve'
  if (/timed out|timeout|no route|unreachable|did not answer|deadline/i.test(said)) return 'no-answer'
  return 'other'
}

/** The second sentence under "Can't reach {name}.": what to check for each way it can fail. */
export function unreachableAdvice(kind: Unreachable, host: string, port: number | null): string {
  switch (kind) {
    case 'no-answer': return "Check it's on, and on your network or VPN."
    case 'refused': return `It's on, but nothing is listening for SSH on port ${String(port ?? DEFAULT_SSH_PORT)}.`
    case 'cannot-resolve': return `Couldn't find a computer called ${host}. Check the spelling, or use its IP address.`
    case 'other': return 'ssh said the words under Details.'
  }
}
