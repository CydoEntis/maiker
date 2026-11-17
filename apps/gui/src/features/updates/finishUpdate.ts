/**
 * What to do about a service still on the older release, once this app is newer:
 * - `restart` it now, with nothing to ask: its sessions are saved and no agent is mid-turn, so each comes back as it was;
 * - `wait` for the agents at work to finish, then restart: the person already chose to update, so it is not asked again;
 * - `ask` first, with what a restart would stop.
 * Right after an app update the service's update is part of it (one update, no second question); otherwise the
 * restart is unasked only under Settings › General › Install updates when idle.
 */
export type ServiceStep = 'restart' | 'wait' | 'ask'

/** How often a service waiting for its agents to finish is asked again whether they have. */
export const WAIT_POLL_MS = 10_000

export function serviceStep({ afterAppUpdate, restartWhenIdle, canRestart, activeTurnCount }: {
  afterAppUpdate: boolean
  restartWhenIdle: boolean
  canRestart: boolean
  /** Agents mid-turn; null when the service cannot say. */
  activeTurnCount: number | null
}): ServiceStep {
  if (!canRestart) return 'ask'
  if (activeTurnCount === 0 && (afterAppUpdate || restartWhenIdle)) return 'restart'
  if (afterAppUpdate && activeTurnCount !== null) return 'wait'
  return 'ask'
}
