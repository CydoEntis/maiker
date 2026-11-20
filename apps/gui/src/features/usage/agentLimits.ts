import { usageItems, type PlanLimit, type UsageItem } from '@/features/chat/usageStrip'
import { agentLabel } from '@/features/workspace/model/session'

/** What an agent's limits come to across the sessions that reported them. */
export type AgentUsage = {
  /** The agent's process name (`claude`). */
  readonly agent: string
  /** As a person writes it (`Claude`). */
  readonly name: string
  /** The account's plan when the agent named one (`max`); empty otherwise. */
  readonly plan: string
  /** Every limit that applies to the plan, the standard windows first. */
  readonly items: readonly UsageItem[]
  /** The limit closest to full: the one the status bar shows. */
  readonly tightest: UsageItem
}

type Reporter = { readonly process: string; readonly limits: readonly PlanLimit[] }

/** Plans with no 5-hour window: the agent may still send one, but it does not bind. */
const WEEKLY_ONLY_PLANS: Readonly<Record<string, readonly string[]>> = { claude: ['max'] }
const FIVE_HOUR = '5h'

const appliesTo = (agent: string, plan: string, limit: PlanLimit): boolean =>
  !(limit.name === FIVE_HOUR && (WEEKLY_ONLY_PLANS[agent] ?? []).includes(plan.toLowerCase()))

/** Each window once, as the freshest session reported it: a later reset means a later report. */
function latestPerWindow(reporters: readonly Reporter[]): PlanLimit[] {
  const byName = new Map<string, PlanLimit>()
  for (const limit of reporters.flatMap((one) => one.limits)) {
    const held = byName.get(limit.name)
    if (held === undefined || limit.resetsAt > held.resetsAt) byName.set(limit.name, limit)
  }
  return [...byName.values()]
}

/**
 * One entry per agent that has reported a limit, in the order the sessions list them. An agent with no live session or no
 * report is left out: usage is what the agent said, never an estimate. `plans` maps an agent to its plan name; `now` is unix seconds.
 */
export function agentUsages(sessions: readonly Reporter[], plans: Readonly<Record<string, string>>, now: number): AgentUsage[] {
  const agents = [...new Set(sessions.filter((one) => one.limits.length > 0).map((one) => one.process))]
  return agents.flatMap((agent) => {
    const plan = plans[agent] ?? ''
    const limits = latestPerWindow(sessions.filter((one) => one.process === agent)).filter((limit) => appliesTo(agent, plan, limit))
    const items = usageItems({ context: null, limits }, now)
    const tightest = items.reduce<UsageItem | null>((worst, item) => (worst === null || item.percent > worst.percent ? item : worst), null)
    return tightest === null ? [] : [{ agent, name: agentLabel(agent), plan, items, tightest }]
  })
}
