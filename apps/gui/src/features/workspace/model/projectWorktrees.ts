import { baseName } from './folderPick'
import { inFolder, samePath, type OpenedProject } from './openedProjects'
import { inCreationOrder, type SessionView } from './session'

/** A linked worktree of a project's repository, as its machine listed it, with whether its folder is still there. */
export type ListedWorktree = { readonly path: string; readonly branch: string | null; readonly present: boolean }

/**
 * What Open worktree can do with one worktree: start a session there, show the session already running there instead of
 * starting a second, or nothing, because its folder is gone (the worktree manager can make it again or remove it).
 */
export type WorktreeChoice =
  | { readonly kind: 'open'; readonly worktree: ListedWorktree; readonly name: string }
  | { readonly kind: 'running'; readonly worktree: ListedWorktree; readonly name: string; readonly session: SessionView; readonly others: number }
  | { readonly kind: 'missing'; readonly worktree: ListedWorktree; readonly name: string }

/**
 * Whether a project's menu offers Open worktree: a project of this computer that may be a git repository. Worktrees are
 * listed from the machine's daemon (`loadFolderBranches`), which needs no session, so a project with no session is offered
 * it and the dialog says when its folder is not in git; one whose sessions all run outside git is a plain folder.
 * Other machines wait for worktree actions to work there.
 */
export function offersOpenWorktree(project: OpenedProject, sessions: readonly SessionView[]): boolean {
  return project.machineName === null && (sessions.length === 0 || sessions.some((session) => session.repoRoot !== null))
}

/**
 * Each worktree with what picking it does, in the machine's order. A session runs in a worktree when its checkout is the
 * worktree's folder (its folder is in the worktree's when the daemon did not say the checkout); the first started is the
 * one shown. A session that ended runs nowhere; a put-away one still runs.
 */
export function worktreeChoices(worktrees: readonly ListedWorktree[], sessions: readonly SessionView[], machine: number): WorktreeChoice[] {
  const live = inCreationOrder(sessions.filter((session) => session.machine === machine && !session.ended))
  return worktrees.map((worktree) => {
    const name = baseName(worktree.path)
    const inIt = live.filter((session) => (session.checkout === null ? inFolder(worktree.path, session.cwd) : samePath(session.checkout, worktree.path)))
    const [first] = inIt
    if (first !== undefined) return { kind: 'running', worktree, name, session: first, others: inIt.length - 1 }
    return worktree.present ? { kind: 'open', worktree, name } : { kind: 'missing', worktree, name }
  })
}
