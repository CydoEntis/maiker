/** How long a machine is waited for after its key was set up in a terminal. */
export const KEY_WAIT_MS = 600_000
/** How often it is dialled again while waiting: the person finishes in the terminal at no known moment. */
export const KEY_WAIT_DIAL_MS = 5000

/** `quiet`: whoever asked says it when the machine connects (the Add a machine screen does), so nothing is toasted. */
export type KeyWait = { name: string; since: number; quiet?: boolean }

/** What a look at the waiting machines found: who connected, who is given up on, who is still waited for. */
export function advanceKeyWaits(waits: readonly KeyWait[], connected: ReadonlySet<string>, now: number): { still: KeyWait[]; connected: string[]; gaveUp: string[] } {
  const done = waits.filter((wait) => connected.has(wait.name)).map((wait) => wait.name)
  const rest = waits.filter((wait) => !connected.has(wait.name))
  return {
    still: rest.filter((wait) => now - wait.since < KEY_WAIT_MS),
    connected: done,
    gaveUp: rest.filter((wait) => now - wait.since >= KEY_WAIT_MS).map((wait) => wait.name),
  }
}
