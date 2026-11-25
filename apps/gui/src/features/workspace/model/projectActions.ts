import type { MachineProjects } from './openedProjects'
import type { SessionView } from './session'
import { projectName } from './sidebarTree'
import type { WorkspaceFor } from './workspacePanel'

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

/**
 * The projects a project's Switch to… can go to: this computer's opened projects in the order they were opened, each with
 * its heading's name. Another machine's are not, since a parked set is kept by this computer's service and the Workspace
 * panel a switch opens is this computer's only, and neither is the No project group, which is no project.
 */
export function switchTargetsOf(machines: readonly MachineProjects[]): WorkspaceFor[] {
  return machines
    .filter((machine) => machine.machineName === null)
    .flatMap((machine) => machine.projects)
    .filter((entry) => entry.loose !== true)
    .map((entry) => ({ project: entry.project, name: projectName(entry) }))
}
