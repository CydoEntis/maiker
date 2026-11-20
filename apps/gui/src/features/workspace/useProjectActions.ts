import { useCallback, useState } from 'react'
import type { ProjectActions } from './components/projectMenu'
import type { SessionView } from './model/session'
import { useWorkspace } from './workspaceContext'

/**
 * The session a project heading's New worktree is made from, null while that dialog is closed. Kept apart from the window's
 * `worktreeFrom`: opened from a project, the dialog names the branch from no session's task and offers to move no chat,
 * since the session only lends its repository.
 */
export function useProjectWorktreeState() {
  return useState<SessionView | null>(null)
}

/**
 * What a project heading's buttons and menu do in this window, for `Sidebar`'s `projectActions`. `afterPick` runs first,
 * so the overlay sidebar of a narrow window gets out of the way.
 */
export function useProjectActions(): (afterPick: () => void) => ProjectActions {
  const { setSettingsSection, setNewChatMachine, setNewChatSeed, setNewChatOpen, setProjectWorktreeFrom, openedProjects } = useWorkspace()
  const { close } = openedProjects
  return useCallback((afterPick: () => void): ProjectActions => ({
    onNewSession: (machine, project) => {
      afterPick()
      setSettingsSection(null)
      setNewChatMachine(machine)
      setNewChatSeed({ folder: project.folder, message: '' })
      setNewChatOpen(true)
    },
    onNewWorktree: (from) => { afterPick(); setProjectWorktreeFrom(from) },
    onClose: close,
  }), [setSettingsSection, setNewChatMachine, setNewChatSeed, setNewChatOpen, setProjectWorktreeFrom, close])
}
