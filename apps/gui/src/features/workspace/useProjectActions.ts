import { useCallback, useState, type ComponentProps } from 'react'
import type { OpenWorktreeDialog } from './components/OpenWorktreeDialog'
import type { ProjectActions } from './components/projectMenu'
import { sameProject, type OpenedProject } from './model/openedProjects'
import { worktreeSourceOf } from './model/projectActions'
import type { ChatAgent } from './model/chatView'
import type { SessionView } from './model/session'
import { rowTitle } from './model/sidebar'
import { openSetOf } from './model/openSet'
import { saveWorkspace } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import { confirmAsk } from '@/features/confirm/confirm'
import { toast } from '@/lib/toast'
import { useWorkspace } from './workspaceContext'

/**
 * The session a project heading's New worktree is made from, null while that dialog is closed. Kept apart from the window's
 * `worktreeFrom`: opened from a project, the dialog names the branch from no session's task and offers to move no chat,
 * since the session only lends its repository.
 */
export function useProjectWorktreeState() {
  return useState<SessionView | null>(null)
}

/** The project whose Open worktree dialog is open, with its machine and the name its heading gives it; null while closed. */
export type OpenWorktreeFor = { machine: number; project: OpenedProject; name: string }

export function useOpenWorktreeState() {
  return useState<OpenWorktreeFor | null>(null)
}

/** What a draft opened from a project starts with, beyond its folder. */
type DraftStart = { worktree?: boolean; agent?: ChatAgent }

/**
 * Starts a session on `machine` in `folder`, as every start from a project heading does: the new-chat draft in the Chat
 * view, the agent's terminal at once in the Terminal view (`openDraft`).
 */
function useDraftIn() {
  const { openDraft } = useWorkspace()
  return useCallback((machine: number, folder: string, { worktree = false, agent }: DraftStart = {}) => {
    openDraft(machine, { folder, message: '', ...(worktree ? { worktree } : {}), ...(agent === undefined ? {} : { agent }) })
  }, [openDraft])
}

/**
 * Has this computer's service keep what is open in a project as it closes, so the set can be opened again. Another
 * machine's project is not kept, and neither is a set with nothing to resume, so a close never forgets the set kept
 * before. The close goes on whatever the answer: a failure is one toast, and a service from before saved sets is not asked.
 */
function saveOpenSet(project: OpenedProject, name: string, sessions: readonly SessionView[]): void {
  if (project.machineName !== null) return
  const kept = openSetOf(sessions.filter((session) => session.machine === LOCAL_MACHINE), Date.now())
  if (kept.length === 0) return
  saveWorkspace(project.folder, kept).catch((error: unknown) => { toast.failed(`Could not save the sessions open in ${name}`, error) })
}

/**
 * What a project heading's menus do in this window, for `Sidebar`'s `projectActions`. `afterPick` runs first, so the
 * overlay sidebar of a narrow window gets out of the way.
 */
export function useProjectActions(): (afterPick: () => void) => ProjectActions {
  const { setProjectWorktreeFrom, setOpenWorktreeFor, openedProjects, chatView, newTerminal, confirm, copyText, showFilesOf, endSessions } = useWorkspace()
  const draftIn = useDraftIn()
  const { close, closeOnceEmpty, machines } = openedProjects
  return useCallback((afterPick: () => void): ProjectActions => ({
    onNewSession: (machine, project, agent) => { afterPick(); draftIn(machine, project.folder, agent === undefined ? {} : { agent }) },
    onNewWorktree: (machine, project, from) => {
      afterPick()
      if (from === null) draftIn(machine, project.folder, { worktree: true })
      else setProjectWorktreeFrom(from)
    },
    onNewTerminal: chatView ? undefined : (machine, project) => { afterPick(); newTerminal(machine, project.folder) },
    onOpenWorktree: (machine, project, name) => { afterPick(); setOpenWorktreeFor({ machine, project, name }) },
    onCopyPath: (project) => { copyText(project.folder, 'Path') },
    onShowFiles: (sessionId) => { afterPick(); showFilesOf(sessionId) },
    // One question for the whole project: its running sessions are named in it and stop with it. Ended ones close too,
    // since a listed session would open the project again.
    onClose: (project, name) => {
      const listed = machines.flatMap((machine) => machine.projects).filter((entry) => sameProject(entry.project, project)).flatMap((entry) => entry.sessions)
      const running = listed.filter((session) => !session.ended).map(rowTitle)
      confirm(confirmAsk('close-project', { name, running }), () => {
        if (listed.length === 0) {
          close(project)
          return
        }
        saveOpenSet(project, name, listed)
        endSessions(listed.map((session) => session.id))
        closeOnceEmpty(project)
      })
    },
  }), [draftIn, setProjectWorktreeFrom, setOpenWorktreeFor, close, closeOnceEmpty, machines, endSessions, confirm, chatView, newTerminal, copyText, showFilesOf])
}

/**
 * The open Open worktree dialog's props, null while it is closed. A pick closes it: a worktree starts the draft there, one
 * in use shows its session, and New worktree hands over to that dialog, made from the project's session as its heading's is.
 */
export function useOpenWorktreeDialog(): ComponentProps<typeof OpenWorktreeDialog> | null {
  const { openWorktreeFor, setOpenWorktreeFor, setProjectWorktreeFrom, sessions, showSessionById, openedProjects } = useWorkspace()
  const draftIn = useDraftIn()
  if (openWorktreeFor === null) return null
  const { machine, project, name } = openWorktreeFor
  const placed = openedProjects.machines.flatMap((entry) => entry.projects).find((entry) => sameProject(entry.project, project))
  const from = worktreeSourceOf(placed?.sessions ?? [])
  const done = () => { setOpenWorktreeFor(null) }
  return {
    machine,
    project,
    name,
    sessions,
    onNewWorktree: () => {
      done()
      if (from === null) draftIn(machine, project.folder, { worktree: true })
      else setProjectWorktreeFrom(from)
    },
    onStart: (folder) => { done(); draftIn(machine, folder) },
    onShow: (sessionId) => { done(); showSessionById(sessionId) },
    onCancel: done,
  }
}
