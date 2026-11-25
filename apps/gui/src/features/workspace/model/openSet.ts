import type { SavedSession } from '@/api/daemon'
import { isChatSession } from './chatSession'
import { isShell } from './sidebar'
import type { SessionView } from './session'

const MS_PER_SECOND = 1000

/**
 * The agent's own conversation id a session resumes by: a terminal's from its pane, a chat's from its conversation.
 * Null for a plain terminal, and for an agent that has not said one yet, since there is nothing to open again.
 */
function resumeIdOf(session: SessionView): string | null {
  const id = isChatSession(session.conversation) ? session.conversation.chat?.session : isShell(session) ? null : session.agentSession
  return id === undefined || id === null || id === '' ? null : id
}

/**
 * The records a project's saved open set keeps for `sessions` (`Command::SaveWorkspace`), in the order given, stamped
 * `nowMs`: each agent and chat session with a conversation to resume, plain terminals left out. A session in a linked
 * worktree names that worktree and its repository's main checkout, so a removed folder can be made again, as a closed
 * session's record does.
 */
export function openSetOf(sessions: readonly SessionView[], nowMs: number): SavedSession[] {
  const at = Math.floor(nowMs / MS_PER_SECOND)
  return sessions.flatMap((session) => {
    const id = resumeIdOf(session)
    if (id === null) return []
    const linked = session.worktree && session.checkout !== null && session.repoRoot !== null
    return [{
      agent: session.process,
      session: id,
      cwd: session.cwd,
      branch: session.branch,
      title: session.name,
      at,
      worktree: linked ? session.checkout : null,
      repo: linked ? session.repoRoot : null,
    }]
  })
}
