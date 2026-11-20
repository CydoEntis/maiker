import type { CloseRefusal } from './openedProjects'
import type { SessionView } from './session'
import { rowTitle } from './sidebar'

/** How many running sessions a refused Close project names before it counts the rest. */
const NAMED_RUNNING = 3

/**
 * The session a project's New worktree is made from, or null when the project offers none. The New worktree dialog and the
 * host's `new_worktree_session` work from a session's terminal, not from a folder, and worktrees are this computer's only,
 * so a project needs a session of this computer in its repository. One in the main checkout comes first, so the new branch
 * starts from the repository's own checkout rather than from another worktree.
 */
export function worktreeSourceOf(sessions: readonly SessionView[]): SessionView | null {
  const inRepository = sessions.filter((session) => session.machineName === null && session.repoRoot !== null && !session.ended)
  return inRepository.find((session) => !session.worktree) ?? inRepository[0] ?? null
}

/** What a refused Close project tells the person: which sessions still run in the project, by the names their rows show. */
export function closeRefusalWords(project: string, refusal: CloseRefusal): { title: string; description: string } {
  const names = refusal.running.map(rowTitle)
  const named = names.slice(0, NAMED_RUNNING)
  const rest = names.length - named.length
  const listed = rest > 0 ? `${named.join(', ')} and ${String(rest)} more` : joinWithAnd(named)
  const them = names.length === 1 ? 'it' : 'them'
  return { title: `Could not close ${project}`, description: `Still running in it: ${listed}. Close ${them} first.` }
}

function joinWithAnd(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`
}
