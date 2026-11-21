import { toast } from '@/lib/toast'
import type { CloseResult, OpenedProject } from '../model/openedProjects'
import { closeRefusalWords, worktreeSourceOf } from '../model/projectActions'
import { offersOpenWorktree } from '../model/projectWorktrees'
import type { SessionView } from '../model/session'
import type { MenuEntry } from './MenuPopup'

/** One refusal toast at a time: a second refused Close project replaces the first instead of stacking. */
const CLOSE_REFUSED_TOAST = 'close-project-refused'

/** What the window does for a project heading's buttons and menu. */
export type ProjectActions = {
  /** Opens the new-chat draft on `machine`, its folder set to the project's. */
  onNewSession: (machine: number, project: OpenedProject) => void
  /**
   * Starts a session in a new worktree of the project. With `from`, a session in the project's repository on its machine
   * (`worktreeSourceOf`), the New worktree dialog opens off it; with none, the new-chat draft opens with Own worktree on.
   */
  onNewWorktree: (machine: number, project: OpenedProject, from: SessionView | null) => void
  /** Starts a plain terminal in the project's folder; absent in the Chat view, which makes none. */
  onNewTerminal?: ((machine: number, project: OpenedProject) => void) | undefined
  /** Opens the Open worktree dialog: the project's linked worktrees, to start a session in one. `name` is the heading's. */
  onOpenWorktree: (machine: number, project: OpenedProject, name: string) => void
  /** Takes the project off the list, or refuses while a session runs in it (`useOpenedProjects().close`). */
  onClose: (project: OpenedProject) => CloseResult
}

/** The project a heading stands for, and what decides which of its actions can run. */
export type ProjectTarget = {
  machine: number
  project: OpenedProject
  /** What the heading calls it (`projectName`). */
  name: string
  /** Every session placed in the project, put-away ones included (`useOpenedProjects().machines`). */
  sessions: readonly SessionView[]
  /** A session can be started on the project's machine now. */
  canStart: boolean
  online: boolean
}

type ProjectCommand = { label: string; disabled: boolean; run: () => void }

/** A heading's actions, each once, for its buttons and its menu to share. New and Open worktree are null where not offered. */
export type ProjectCommands = {
  newSession: ProjectCommand
  newTerminal: ProjectCommand | null
  newWorktree: ProjectCommand | null
  openWorktree: ProjectCommand | null
  close: ProjectCommand
}

export function projectCommands(actions: ProjectActions, target: ProjectTarget): ProjectCommands {
  const from = worktreeSourceOf(target.sessions)
  const { onNewTerminal } = actions
  // A project with no session may be a git repository, and one with sessions is when one of them is in git.
  const mayBeGit = offersOpenWorktree(target.project, target.sessions)
  return {
    newSession: { label: 'New session', disabled: !target.canStart, run: () => { actions.onNewSession(target.machine, target.project) } },
    newTerminal: onNewTerminal === undefined ? null : { label: 'New terminal', disabled: !target.canStart, run: () => { onNewTerminal(target.machine, target.project) } },
    newWorktree: mayBeGit ? { label: 'New worktree…', disabled: from === null ? !target.canStart : !target.online, run: () => { actions.onNewWorktree(target.machine, target.project, from) } } : null,
    openWorktree: mayBeGit
      ? { label: 'Open worktree…', disabled: !target.online, run: () => { actions.onOpenWorktree(target.machine, target.project, target.name) } }
      : null,
    close: { label: 'Close project', disabled: false, run: () => { closeOrSayWhy(actions, target) } },
  }
}

/** A project heading's right-click and ⋯ menu: what starts in the project, then Close project after a divider. */
export function projectMenuEntries(commands: ProjectCommands): MenuEntry[] {
  return [
    commands.newSession,
    ...(commands.newTerminal === null ? [] : [commands.newTerminal]),
    ...(commands.newWorktree === null ? [] : [commands.newWorktree]),
    ...(commands.openWorktree === null ? [] : [commands.openWorktree]),
    'separator',
    commands.close,
  ]
}

/** Closing never hides a running session: a refusal names the sessions in the way, so the person knows what to close. */
function closeOrSayWhy(actions: ProjectActions, target: ProjectTarget): void {
  const result = actions.onClose(target.project)
  if (result.ok) return
  const { title, description } = closeRefusalWords(target.name, result.error)
  toast.info(title, { id: CLOSE_REFUSED_TOAST, description })
}
