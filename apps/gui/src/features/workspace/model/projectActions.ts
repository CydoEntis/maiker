import type { SessionView } from './session'

/**
 * The session a project's New worktree is made from, or null when the project offers none. The New worktree dialog and the
 * host's `new_worktree_session` work from a session's terminal, not from a folder, so a project needs a live session in its
 * repository; the daemon of the session's machine makes the worktree, this computer's or another's. One in the main checkout
 * comes first, so the new branch starts from the repository's own checkout rather than from another worktree.
 */
export function worktreeSourceOf(sessions: readonly SessionView[]): SessionView | null {
  const inRepository = sessions.filter((session) => session.repoRoot !== null && !session.ended)
  return inRepository.find((session) => !session.worktree) ?? inRepository[0] ?? null
}
