/** A lost line shorter than this is a blip: only the title bar's chip says it, and nothing dims. */
export const OFFLINE_AFTER_MS = 3000

/** How long the offline dialog shows "Reconnecting…" in green once the service answers, before the Back online toast. */
export const FOUND_FOR_MS = 1200

const RETRY_FIRST_MS = 2000
const RETRY_SECOND_MS = 4000
const RETRY_THIRD_MS = 8000
const RETRY_EVERY_MS = 15_000
/** While the service does not answer, the window tries again after 2, 4, 8, then every 15 seconds. */
export const RETRY_DELAYS_MS: readonly number[] = [RETRY_FIRST_MS, RETRY_SECOND_MS, RETRY_THIRD_MS, RETRY_EVERY_MS]

/** The wait before the next try, after `failures` failed tries in a row. */
export function retryDelayAfter(failures: number): number {
  const last = RETRY_DELAYS_MS.length - 1
  return RETRY_DELAYS_MS[Math.min(last, Math.max(0, failures - 1))] ?? RETRY_DELAYS_MS[last] ?? 0
}

/**
 * Where the window is with its service (docs/DESIGN.md, Errors → Service offline):
 * - `ok`: it answers;
 * - `blip`: it stopped answering under three seconds ago (the chip says Reconnecting…);
 * - `offline`: it has not answered for three seconds (the window dims under one dialog, or Not now leaves the Offline chip);
 * - `found`: it answers again, and the dialog says so in green for a moment before the Back online toast.
 * A service on another protocol answers, so it is never offline; the window asks to restart or update it instead.
 */
export type ServiceStage = 'ok' | 'blip' | 'offline' | 'found'

/** The stage from what the window knows: is the line down, has it been down three seconds, was it down that long and is now back. */
export function serviceStageOf({ down, late, found }: { down: boolean; late: boolean; found: boolean }): ServiceStage {
  if (down) return late ? 'offline' : 'blip'
  return found ? 'found' : 'ok'
}
