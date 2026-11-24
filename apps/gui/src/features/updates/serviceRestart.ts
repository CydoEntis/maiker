/** How often the service's state is read again while an automatic restart waits for a quiet moment. */
export const SERVICE_IDLE_POLL_MS = 10_000

/** How often the window asks whether the service is behind this app, with nothing waiting: it only reads two small files. */
export const SERVICE_STATUS_POLL_MS = 60_000

/**
 * A session's status as the daemon words it that means the service must not be restarted yet: an agent is working,
 * one needs the user (a question or an approval pending), one is being restored or started (`recovery`), or the
 * daemon could not say (`unknown`). Anything not listed (idle, done) is safe.
 */
const BUSY_STATUSES: ReadonlySet<string> = new Set(['working', 'needs-you', 'recovery', 'unknown'])

export type ServiceRestartReading = {
  /** Settings › General › Restart the service when idle. */
  enabled: boolean
  /** A restart is already running (this window started it). */
  restarting: boolean
  /** A session is being started from this window right now. */
  starting: boolean
  /** The service's own report of its older version; undefined until it has answered, or when it could not be asked. */
  service: { canRestart: boolean; activeTurnCount: number | null } | undefined
  /** The statuses of the sessions the window last read; null when it cannot read them (a service on another protocol). */
  sessionStatuses: readonly string[] | null
}

export type ServiceRestartStep =
  /** The setting is off: nothing happens by itself. */
  | 'off'
  /** On, but not a safe moment: keep the notice and look again. */
  | 'wait'
  /** Safe now: restart through the usual flow. */
  | 'restart'

/**
 * Whether an older service may be restarted by itself now. Every guard must hold, and anything unknown counts as
 * busy: the service reports no agent working or waiting (`activeTurnCount` 0, never null), it can be restarted
 * (its sessions are saved), no session this window can see is busy, and nothing is starting. An update never ends
 * an agent's turn, so a busy service is left and asked again later.
 */
export function serviceRestartStep({ enabled, restarting, starting, service, sessionStatuses }: ServiceRestartReading): ServiceRestartStep {
  if (!enabled) return 'off'
  if (restarting || starting) return 'wait'
  if (service === undefined || !service.canRestart || service.activeTurnCount !== 0) return 'wait'
  if (sessionStatuses?.some((status) => BUSY_STATUSES.has(status))) return 'wait'
  return 'restart'
}
