import { useMemo, type ReactNode } from 'react'
import { LOCAL_MACHINE } from '@/api/machines'
import { PlaceActionsContext, type PlaceActions } from '@/features/chat/place/placeActions'
import { machineProjects } from '../model/newSession'
import { resolveStartFolder } from '../model/startFolder'
import { useOpenProject } from '../useOpenProject'
import { useWorkspace } from '../workspaceContext'

/**
 * Gives the row under every chat box what its folder menu needs from the window: the projects of the machine the
 * focused session runs on, a new session in one of them, and the Open a project palette.
 */
export function WorkspacePlaceActions({ children }: { children: ReactNode }) {
  const { sessions, focusedSession, preferences, home, setSettingsSection, setNewChatMachine, setNewChatSeed, setNewChatOpen } = useWorkspace()
  const openProject = useOpenProject()
  const machine = focusedSession?.machine ?? LOCAL_MACHINE
  const startFolder = machine === LOCAL_MACHINE ? resolveStartFolder(preferences.startFolder, home) : '~'
  const { open } = openProject
  const actions = useMemo<PlaceActions>(() => ({
    projects: machineProjects(sessions, machine, focusedSession, startFolder).map(({ name, folder }) => ({ name, folder })),
    onNewSessionIn: (folder) => {
      setSettingsSection(null)
      setNewChatMachine(machine)
      setNewChatSeed({ folder, message: '' })
      setNewChatOpen(true)
    },
    onOpenFolder: () => { open('folder') },
    onClone: () => { open('url') },
  }), [sessions, machine, focusedSession, startFolder, setSettingsSection, setNewChatMachine, setNewChatSeed, setNewChatOpen, open])
  return <PlaceActionsContext.Provider value={actions}>{children}</PlaceActionsContext.Provider>
}
