import type { SessionView } from '@/features/workspace/model/session'
import type { SessionPlace } from './components/SessionBar'

/** The last folder of a path: a linked worktree's name. */
const lastFolder = (path: string): string => path.split(/[\\/]/).filter((part) => part !== '').at(-1) ?? path

/**
 * Where a session runs, for the row under its input, from what the session list already holds (the daemon's reading of
 * git); nothing here runs git. Outside a repository the folder stands in for the project.
 */
export function placeOf(session: Pick<SessionView, 'machineName' | 'repoName' | 'cwdLabel' | 'cwd' | 'repoRoot' | 'branch' | 'worktree' | 'machine' | 'pane'>): SessionPlace {
  return {
    machine: session.machineName,
    project: session.repoName ?? session.cwdLabel,
    branch: session.branch,
    worktree: session.worktree,
    folder: session.cwd,
    machineId: session.machine,
    pane: session.pane,
    worktreeName: session.worktree ? lastFolder(session.repoRoot ?? session.cwd) : null,
  }
}
