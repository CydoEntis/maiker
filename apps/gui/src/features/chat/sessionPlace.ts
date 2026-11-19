import type { SessionView } from '@/features/workspace/model/session'
import type { SessionPlace } from './components/SessionBar'

/**
 * Where a session runs, for the row under its input, from what the session list already holds (the daemon's reading of
 * git); nothing here runs git. Outside a repository the folder stands in for the project.
 */
export function placeOf(session: Pick<SessionView, 'machineName' | 'repoName' | 'cwdLabel' | 'cwd' | 'branch' | 'worktree'>): SessionPlace {
  return { machine: session.machineName, project: session.repoName ?? session.cwdLabel, branch: session.branch, worktree: session.worktree, folder: session.cwd }
}
