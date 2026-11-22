import { useCallback, useState, type ComponentProps } from 'react'
import type { OpenWorktreeDialog } from './components/OpenWorktreeDialog'
import type { ProjectActions } from './components/projectMenu'
import { sameProject, type OpenedProject } from './model/openedProjects'
import { worktreeSourceOf } from './model/projectActions'
import type { ChatAgent } from './model/chatView'
import type { SessionView } from './model/session'
import { rowTitle } from './model/sidebar'
import { confirmAsk } from '@/features/confirm/confirm'
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

/** Opens the new-chat draft on `machine` with `folder` filled in, as every start from a project heading does. */
function useDraftIn() {
  const { setSettingsSection, setNewChatMachine, setNewChatSeed, setNewChatOpen } = useWorkspace()
  return useCallback((machine: number, folder: string, { worktree = false, agent }: DraftStart = {}) => {
    setSettingsSection(null)
    setNewChatMachine(machine)
    setNewChatSeed({ folder, message: '', ...(worktree ? { worktree } : {}), ...(agent === undefined ? {} : { agent }) })
    setNewChatOpen(true)
  }, [setSettingsSection, setNewChatMachine, setNewChatSeed, setNewChatOpen])
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
