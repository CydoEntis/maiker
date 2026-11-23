import { DEFAULT_PICK, REASONING_PICKS, type AgentChoice, type ReasoningPick } from '@/features/chat/agentChoice'
import { CHAT_AGENTS, type ChatAgent } from './chatView'

/**
 * The agent, and each agent's model and effort, the person last started a session with: the New session dialog opens on
 * them. A convenience of this window only; storage that is blocked simply leaves the Settings default.
 */
const KEY = 'maiker.new-session.who'

export type LastWho = { agent: ChatAgent; choices: Partial<Record<ChatAgent, AgentChoice>> }

const isAgent = (value: unknown): value is ChatAgent => CHAT_AGENTS.some((agent) => agent === value)

export function readLastWho(): LastWho | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) return null
    const saved = JSON.parse(raw) as { agent?: unknown; choices?: unknown }
    if (!isAgent(saved.agent)) return null
    const choices: Partial<Record<ChatAgent, AgentChoice>> = {}
    if (typeof saved.choices === 'object' && saved.choices !== null) {
      for (const agent of CHAT_AGENTS) {
        const one = (saved.choices as Record<string, { model?: unknown; reasoning?: unknown } | undefined>)[agent]
        if (typeof one?.model === 'string' && REASONING_PICKS.some((pick) => pick === one.reasoning)) choices[agent] = { model: one.model, reasoning: one.reasoning as ReasoningPick }
      }
    }
    return { agent: saved.agent, choices }
  } catch {
    // Storage is blocked or holds something else: there is no last agent.
    return null
  }
}

/**
 * The model and effort a start that skips the draft (the Terminal view's) gives `agent`: what it was last started with or
 * last picked in a chat, else the agent's own default, which adds nothing to its command line.
 */
export function startChoiceFor(agent: ChatAgent): AgentChoice {
  return readLastWho()?.choices[agent] ?? { model: DEFAULT_PICK, reasoning: DEFAULT_PICK }
}

/** A model or effort picked in a chat becomes that agent's next start, in either view; the last agent stays as it was. */
export function rememberChoice(agent: ChatAgent, choice: AgentChoice): void {
  const last = readLastWho()
  rememberWho({ agent: last?.agent ?? agent, choices: { ...last?.choices, [agent]: choice } })
}

export function rememberWho(who: LastWho): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(who))
  } catch {
    // Storage is blocked or full: the next dialog opens on the Settings default.
  }
}
