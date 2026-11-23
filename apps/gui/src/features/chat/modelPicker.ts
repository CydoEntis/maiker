import { CHAT_AGENTS, type ChatAgent } from '@/features/workspace/model/chatView'
import { DEFAULT_PICK, effortAllowed, effortInUse, effortWord, leadingModels, REASONING_LABEL, REASONING_LEVELS, type ModelOption } from './agentChoice'
import { AGENT_LABEL } from './modelName'

/** An agent that runs over ACP in place of a built-in one: its id is what the daemon runs, its name what the picker says. */
export type OtherAgent = { readonly id: string; readonly name: string }

/** One mark on the picker's rail. `key` is the agent's name, or `acp:<id>` for one that runs over ACP. */
export type RailAgent = {
  readonly key: string
  readonly label: string
  /** What the mark is drawn from (`AppIcon`): the agent's program, or the ACP agent's name. */
  readonly mark: string
  /** A built-in agent, whose models and reasoning levels the picker lists; null for one over ACP, which keeps its own. */
  readonly agent: ChatAgent | null
  /** The agent this session runs: the rail puts its dot on it. */
  readonly current: boolean
}

const ACP_PREFIX = 'acp:'
export const acpKey = (id: string): string => `${ACP_PREFIX}${id}`
export const acpIdOf = (key: string): string | null => (key.startsWith(ACP_PREFIX) ? key.slice(ACP_PREFIX.length) : null)

/**
 * The rail: the built-in agents that are installed, then the ACP agents that are ready. The session's own agent is
 * always on it, installed or not, so the rail never lacks its dot. `installed` is null while that is not known (or on
 * another machine, where it cannot be), and then every built-in agent is offered.
 */
export function railAgents(current: ChatAgent, installed: readonly string[] | null, others: readonly OtherAgent[] = [], currentOther: string | null = null): RailAgent[] {
  const builtIn = CHAT_AGENTS
    .filter((name) => name === current || installed === null || installed.includes(name))
    .map((name): RailAgent => ({ key: name, label: AGENT_LABEL[name], mark: name, agent: name, current: currentOther === null && name === current }))
  const overAcp = others.map((other): RailAgent => ({ key: acpKey(other.id), label: other.name, mark: other.name, agent: null, current: other.id === currentOther }))
  return [...builtIn, ...overAcp]
}

export type ShownModels = { readonly rows: readonly ModelOption[]; readonly canShowMore: boolean }

/**
 * The model rows under the search field. A search looks through every model; with none, the earlier models wait
 * behind "Show more" (the picked one is never hidden).
 */
export function shownModels(rows: readonly ModelOption[], picked: string, query: string, expanded: boolean): ShownModels {
  const needle = query.trim().toLowerCase()
  if (needle !== '') return { rows: rows.filter((row) => row.label.toLowerCase().includes(needle)), canShowMore: false }
  if (expanded) return { rows, canShowMore: false }
  const leading = leadingModels(rows, picked)
  return { rows: leading, canShowMore: leading.length < rows.length }
}

export type ReasoningRow = {
  readonly value: string
  readonly label: string
  /** The level the model runs at when none is picked. */
  readonly isDefault: boolean
  readonly selected: boolean
  /** A level the agent runs at that cannot be picked from here (Codex's `xhigh`): shown so the column is true, not offered. */
  readonly fixed: boolean
}

/**
 * The reasoning column for a model: the levels it takes, the default marked, and the one in use selected. Empty for an
 * agent with no reasoning setting. `inUse` is the level the chat runs at (`effortInUse`), null when that is not shown.
 */
export function reasoningRows(agent: ChatAgent, model: ModelOption | undefined, inUse: string | null): ReasoningRow[] {
  const usual = effortInUse(agent, model, DEFAULT_PICK, null).level
  const rows = REASONING_LEVELS.filter((level) => effortAllowed(agent, model, level)).map((level): ReasoningRow => ({
    value: level, label: REASONING_LABEL[level], isDefault: level === usual, selected: level === inUse, fixed: false,
  }))
  if (usual === null) return []
  const word = effortWord(inUse)
  if (inUse === null || word === null || rows.some((row) => row.value === inUse)) return rows
  return [...rows, { value: inUse, label: word, isDefault: false, selected: true, fixed: true }]
}
