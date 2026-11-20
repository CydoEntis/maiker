/** One of the agent's plan limits, as the daemon last heard it: the window (`5h`, `week`), the share used and when it starts over. */
export type PlanLimit = { readonly name: string; readonly used: number; readonly resetsAt: number }

/** What a session's agent reported using: how full its context is, and its plan's limits. Each is absent when the agent did not say. */
export type SessionUsage = { readonly context: number | null; readonly limits: readonly PlanLimit[] }

export type UsageItem = {
  readonly key: string
  readonly label: string
  /** 0 to 100, whole. */
  readonly percent: number
  /** How long until the limit starts over (`2d 4h`); null for the context, which does not. */
  readonly resetsIn: string | null
  /** The limit's window as the meter says it beside the figure (`week`, `5h`); null for the context. */
  readonly window: string | null
  /** Which of the theme's four meter colours it wears. */
  readonly tone: 'ok' | 'mid' | 'high' | 'max'
}

const FULL = 100
/** Where a meter moves to the theme's next colour (the desktop mock's steps): a quarter, a half, three quarters. */
const MID_FROM = 25
const HIGH_FROM = 50
const MAX_FROM = 75
/** A meter shows by the message box from here: below half there is nothing to act on, and a 0% meter on a new chat is noise. */
export const METER_SHOWN_FROM = HIGH_FROM
const MINUTE = 60
const HOUR = 3600
const DAY = 86_400

/** The names the daemon gives the limit windows, as the strip says them; any other is shown as it came. */
const LIMIT_LABEL: Readonly<Record<string, string>> = { '5h': '5-hour limit', week: 'Weekly limit' }

const toneOf = (percent: number): UsageItem['tone'] => (percent >= MAX_FROM ? 'max' : percent >= HIGH_FROM ? 'high' : percent >= MID_FROM ? 'mid' : 'ok')
const whole = (value: number): number => Math.min(FULL, Math.max(0, Math.round(value)))

/** `2d 4h`, `3h 10m`, `12m`: the two largest parts of a wait, or `now` when it is over. */
export function waitWords(seconds: number): string {
  if (seconds < MINUTE) return 'now'
  const days = Math.floor(seconds / DAY)
  const hours = Math.floor((seconds % DAY) / HOUR)
  const minutes = Math.floor((seconds % HOUR) / MINUTE)
  if (days > 0) return hours > 0 ? `${String(days)}d ${String(hours)}h` : `${String(days)}d`
  if (hours > 0) return minutes > 0 ? `${String(hours)}h ${String(minutes)}m` : `${String(hours)}h`
  return `${String(minutes)}m`
}

/** The plan windows Claude and Codex report, in the order the strip always shows them. */
const STANDARD_LIMITS = ['5h', 'week'] as const
const standardFirst = (item: UsageItem): number => {
  const at = STANDARD_LIMITS.findIndex((name) => name === item.window)
  return at === -1 ? STANDARD_LIMITS.length : at
}

/**
 * The meters of the strip under the message box: the context first, then the 5-hour and weekly limits, then any other
 * limit the daemon gave. A limit shows only once the agent has reported it: a plan without a 5-hour window (an API key,
 * some Codex plans) never reports one, so a meter for it would be a dash for ever. With `always` (an agent that reports
 * its context) the context is drawn from the start, at 0% until the agent first says otherwise: a chat that has not
 * run a turn has used none of it. Without it, a context not reported has no meter. `now` is unix seconds.
 */
export function usageItems(usage: SessionUsage, now: number, always = false): UsageItem[] {
  const shown = usage.context ?? (always ? 0 : null)
  const context: UsageItem[] = shown === null
    ? []
    : [{ key: 'context', label: 'Context', percent: whole(shown), resetsIn: null, window: null, tone: toneOf(whole(shown)) }]
  const reported = usage.limits.map((limit): UsageItem => ({
    key: `limit-${limit.name}`,
    label: LIMIT_LABEL[limit.name] ?? limit.name,
    percent: whole(limit.used),
    resetsIn: limit.resetsAt > 0 ? waitWords(limit.resetsAt - now) : null,
    window: limit.name,
    tone: toneOf(whole(limit.used)),
  }))
  // A stable sort: the other limits keep the order the daemon gave them.
  return [...context, ...[...reported].sort((one, other) => standardFirst(one) - standardFirst(other))]
}
