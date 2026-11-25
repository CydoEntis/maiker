import { useCallback, useMemo, useState, type ComponentProps } from 'react'
import type { OpenWorktreeDialog } from './components/OpenWorktreeDialog'
import type { ProjectActions } from './components/projectMenu'
import { sameProject, type OpenedProject } from './model/openedProjects'
import { switchTargetsOf, worktreeSourceOf } from './model/projectActions'
import type { ChatAgent } from './model/chatView'
import type { SessionView } from './model/session'
import { rowTitle } from './model/sidebar'
import { openSetOf } from './model/openSet'
import { sessionsOfProject } from './model/workspacePanel'
import { saveWorkspace, type SavedSession } from '@/api/daemon'
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
 * What a close of `project` keeps of `sessions` as its open set (`openSetOf`), or null when nothing is sent: another
 * machine's project is not kept, and neither is a set with nothing to resume, so a close never forgets the set kept before.
 */
function openSetToKeep(project: OpenedProject, sessions: readonly SessionView[]): SavedSession[] | null {
  if (project.machineName !== null) return null
  const kept = openSetOf(sessions.filter((session) => session.machine === LOCAL_MACHINE), Date.now())
  return kept.length === 0 ? null : kept
}

/**
 * Has this computer's service keep what is open in a project as it closes, so the set can be opened again. The close goes
 * on whatever the answer: a failure is one toast, and a service from before saved sets is not asked.
 */
function saveOpenSet(project: OpenedProject, name: string, sessions: readonly SessionView[]): void {
  const kept = openSetToKeep(project, sessions)
  if (kept === null) return
  saveWorkspace(project.folder, kept).catch((error: unknown) => { toast.failed(`Could not save the sessions open in ${name}`, error) })
}

/**
 * Saves what is open in a project a switch parks, and says whether the switch may end its sessions. Unlike a close, a
 * switch does not go on without the set: a failed save, or a service too old to keep one, is a toast saying the project
 * stays open and why. Nothing to keep needs no save.
 */
async function parkOpenSet(project: OpenedProject, name: string, sessions: readonly SessionView[]): Promise<boolean> {
  const kept = openSetToKeep(project, sessions)
  if (kept === null) return true
  const stays = `${name} stays open: its sessions could not be saved`
  try {
    if (await saveWorkspace(project.folder, kept)) return true
    toast.error(stays, { description: 'The Maiker service needs a restart to keep them.' })
  } catch (error: unknown) {
    toast.failed(stays, error)
  }
  return false
}

/**
 * What a project heading's menus do in this window, for `Sidebar`'s `projectActions`. `afterPick` runs first, so the
 * overlay sidebar of a narrow window gets out of the way.
 */
export function useProjectActions(): (afterPick: () => void) => ProjectActions {
  const { setProjectWorktreeFrom, setOpenWorktreeFor, setWorkspaceFor, openedProjects, chatView, newTerminal, confirm, copyText, showFilesOf, endSessions } = useWorkspace()
  const draftIn = useDraftIn()
  const { close, closeOnceEmpty, select, machines } = openedProjects
  const switchTargets = useMemo(() => switchTargetsOf(machines), [machines])
  return useCallback((afterPick: () => void): ProjectActions => {
    // One question for the whole project, Close project's: its running sessions are named in it and stop with it.
    const askToClose = (name: string, listed: readonly SessionView[], run: () => void) => {
      confirm(confirmAsk('close-project', { name, running: listed.filter((session) => !session.ended).map(rowTitle) }), run)
    }
    // Ended sessions close too, since a listed session would open the project again; an empty project leaves at once.
    const endAndClose = (project: OpenedProject, listed: readonly SessionView[]) => {
      if (listed.length === 0) {
        close(project)
        return
      }
      endSessions(listed.map((session) => session.id))
      closeOnceEmpty(project)
    }
    return {
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
      onWorkspace: (project, name) => { afterPick(); setWorkspaceFor({ project, name }) },
      switchTargets,
      // Close project once its set is saved, then the other project's panel. It opens none of that project's sessions:
      // what comes back is what the person ticks there.
      onSwitch: (project, name, to) => {
        afterPick()
        const listed = sessionsOfProject(machines, project)
        askToClose(name, listed, () => {
          void parkOpenSet(project, name, listed).then((parked) => {
            if (!parked) return
            endAndClose(project, listed)
            select(to.project)
            setWorkspaceFor(to)
          })
        })
      },
      onClose: (project, name) => {
        const listed = sessionsOfProject(machines, project)
        askToClose(name, listed, () => {
          saveOpenSet(project, name, listed)
          endAndClose(project, listed)
        })
      },
    }
  }, [draftIn, setProjectWorktreeFrom, setOpenWorktreeFor, setWorkspaceFor, close, closeOnceEmpty, select, machines, switchTargets, endSessions, confirm, chatView, newTerminal, copyText, showFilesOf])
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
