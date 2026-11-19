import type { SessionUsage } from '@/features/chat/usageStrip'
import { isChatSession } from '@/features/workspace/model/chatSession'
import type { SessionView } from '@/features/workspace/model/session'
import { isShell } from '@/features/workspace/model/sidebar'

/** The agents whose context the daemon always reports, so its meter shows from the first turn. */
const CONTEXT_AGENTS: readonly string[] = ['claude', 'codex']

/** The agents a shell hint offers to start. */
export const HINT_AGENTS = ['claude', 'codex', 'gemini'] as const
export type HintAgent = (typeof HINT_AGENTS)[number]

/** What the bar under an agent's terminal says; each field is what the daemon already reports for the session. */
export type TerminalBarFacts = {
  /** The machine's name; null for this computer, which needs no name. */
  machine: string | null
  /** The repository, else the folder, as a shell prompt would show it. */
  project: string
  /** Null outside a repository. */
  branch: string | null
  /** The session runs in a linked worktree. */
  worktree: boolean
  usage: SessionUsage
  /** True when the agent reports its context from the start (a 0% meter before the first turn). */
  contextAlways: boolean
  /** The agent the daemon sees. */
  agent: string
}

/**
 * The bar's facts for a session, or null when it gets no bar: a plain shell (it gets the hint) or a program that is no agent (`ssh`, `vim`), a session whose
 * shell has gone, or a chat with no terminal.
 */
export function terminalBarOf(session: SessionView): TerminalBarFacts | null {
  const agent = session.conversation.agent
  if (!agent || session.ended || isChatSession(session.conversation)) return null
  return {
    machine: session.machineName,
    project: session.repoName ?? session.cwdLabel,
    branch: session.branch,
    worktree: session.worktree,
    usage: { context: session.usage.context, limits: session.limits },
    contextAlways: CONTEXT_AGENTS.includes(agent),
    agent,
  }
}

/** Whether a pane shows the shell hint under its terminal: a live plain shell, never a chat-only session. */
export function showsShellHint(session: SessionView): boolean {
  return isShell(session) && !session.ended && !isChatSession(session.conversation)
}
