/** One of the agent's plan limits, as the daemon last heard it: the window (`5h`, `week`), the share used and when it starts over. */
export type PlanLimit = { readonly name: string; readonly used: number; readonly resetsAt: number }

/** What a session's agent reported using: how full its context is, and its plan's limits. Each is absent when the agent did not say. */
export type SessionUsage = { readonly context: number | null; readonly limits: readonly PlanLimit[] }

export type UsageItem = {
  readonly key: string
  readonly label: string
  /** 0 to 100, whole; null while the agent has not reported it (ADR 0009: never a made-up zero). */
  readonly percent: number | null
  /** How long until the limit starts over (`2d 4h`); null for the context, which does not. */
  readonly resetsIn: string | null
  /** The limit's window as the meter says it beside the figure (`week`, `5h`); null for the context. */
  readonly window: string | null
  /** Which of the theme's four meter colours it wears; `none` for a figure not reported yet. */
  readonly tone: 'ok' | 'mid' | 'high' | 'max' | 'none'
}

const FULL = 100
/** Where a meter moves to the theme's next colour (the desktop mock's steps): a quarter, a half, three quarters. */
const MID_FROM = 25
const HIGH_FROM = 50
const MAX_FROM = 75
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

const notReported = (name: string): UsageItem => ({ key: `limit-${name}`, label: LIMIT_LABEL[name] ?? name, percent: null, resetsIn: null, window: name, tone: 'none' })

/**
 * The meters of the strip under the message box: the context first, then each limit in the order the daemon gave
 * them. A figure the agent did not report is never a zero (ADR 0009): with `always` (an agent that reports them),
 * the context, 5-hour and weekly meters are all drawn, in that order, a missing one as not reported yet; without it, a
 * missing one has no meter. `now` is unix seconds.
 */
export function usageItems(usage: SessionUsage, now: number, always = false): UsageItem[] {
  const context: UsageItem[] = usage.context === null
    ? (always ? [{ key: 'context', label: 'Context', percent: null, resetsIn: null, window: null, tone: 'none' }] : [])
    : [{ key: 'context', label: 'Context', percent: whole(usage.context), resetsIn: null, window: null, tone: toneOf(whole(usage.context)) }]
  const reported = usage.limits.map((limit): UsageItem => ({
    key: `limit-${limit.name}`,
    label: LIMIT_LABEL[limit.name] ?? limit.name,
    percent: whole(limit.used),
    resetsIn: limit.resetsAt > 0 ? waitWords(limit.resetsAt - now) : null,
    window: limit.name,
    tone: toneOf(whole(limit.used)),
  }))
  if (!always) return [...context, ...reported]
  const standard = STANDARD_LIMITS.map((name) => reported.find((item) => item.window === name) ?? notReported(name))
  const others = reported.filter((item) => !STANDARD_LIMITS.some((name) => name === item.window))
  return [...context, ...standard, ...others]
}
