import { useCallback } from 'react'
import { Panel } from '@/components/ui/panel'
import { toast } from '@/lib/toast'
import { LOCAL_MACHINE } from '@/api/machines'
import { projectOfSession } from '../model/startProject'
import { projectName } from '../model/sidebarTree'
import { useInstalledAgents } from '../model/newChatHost'
import { Sidebar } from './Sidebar'
import { useWorkspace } from '../workspaceContext'
import { useChatPrefetch } from '../useChatPrefetch'
import { ADD_MACHINE, PROJECT_FROM_SOURCES, projectRequestFor } from '../useOpenProject'
import { useProjectActions } from '../useProjectActions'

const noop = () => undefined

/** The sidebar: the docked column or the rail, and the full one in a drawer over a narrow window. */
export function WorkspaceSidebars() {
  const { sessionsListed, sidebarSessions, sidebarMachineHeads, openedProjects, focusedId, online, canStart, root, preferences, sidebarWidth, setLiveSidebarWidth, setPreferences, setPaletteOpen, setSettingsSection, retryNamed, openLoginNamed, copyCommand, setRenamingMachine, setUpdateAsk, showSessionById, setRenameId, saveName, copyPathOf, endSession, updateProgress, focusMode, sidebarMode, toggleSidebar, drawerShown, setDrawerOpen, sessionMap, setWorktreeFrom, setProjectWorktreeFrom, setOpenWorktreeFor, setOpenProject, pullRequests, showPanelView, focusedSession } = useWorkspace()
  const warmChat = useChatPrefetch(useCallback((id: string) => sessionMap.get(id), [sessionMap]))
  const projectActionsFor = useProjectActions()
  const installedAgents = useInstalledAgents()
  // A session's own New worktree can move its chat into the new worktree, which only this computer's can; another
  // machine's session lends its repository, as it does to its project's heading.
  const newWorktreeFrom = (id: string) => {
    const from = sessionMap.get(id)
    if (from === undefined) return
    if (from.machine === LOCAL_MACHINE) setWorktreeFrom(from)
    else setProjectWorktreeFrom(from)
  }
  const openWorktreeOf = (id: string) => {
    const from = sessionMap.get(id)
    const placed = projectOfSession(openedProjects.machines, id)
    if (from !== undefined && placed !== null) setOpenWorktreeFor({ machine: from.machine, project: placed.project, name: projectName(placed) })
  }

  // The sidebar, as the docked column or the 60px rail, or the full one inside the overlay of a narrow window.
  const renderSidebar = (mode: 'docked' | 'rail', afterPick: () => void, onToggle: () => void) => (
    <Sidebar
      sessions={sidebarSessions}
      listed={sessionsListed}
      machines={sidebarMachineHeads}
      focusedId={focusedId}
      mode={mode}
      online={online}
      canStart={canStart}
      portalContainer={root}
      onToggleRail={onToggle}
      side={preferences.sidebarSide}
      projects={openedProjects.machines}
      selectedProject={openedProjects.selected}
      installedAgents={installedAgents}
      onSearch={() => { afterPick(); setPaletteOpen(true) }}
      width={sidebarWidth}
      onResize={setLiveSidebarWidth}
      onResizeEnd={(width) => {
        setPreferences((current) => ({ ...current, sidebarWidth: width }))
        setLiveSidebarWidth(null)
      }}
      onHoverSession={warmChat}
      onAddMachine={() => { afterPick(); setOpenProject(ADD_MACHINE) }}
      onOpenProject={(machine) => { afterPick(); setOpenProject(machine === null ? PROJECT_FROM_SOURCES : projectRequestFor(machine)) }}
      projectActions={projectActionsFor(afterPick)}
      onMachineSettings={() => { afterPick(); setSettingsSection('machines') }}
      onRetryMachine={retryNamed}
      onSignInMachine={(machine, name) => { afterPick(); openLoginNamed(machine, name) }}
      onCopyCommand={copyCommand}
      onRenameMachine={setRenamingMachine}
      onUpdateMachine={(name, action) => { afterPick(); setUpdateAsk({ name, action }) }}
      onShowSession={(id) => { afterPick(); showSessionById(id) }}
      onRenameSession={setRenameId}
      onSaveSessionName={saveName}
      onCopyPath={copyPathOf}
      onNewWorktree={(id) => { afterPick(); newWorktreeFrom(id) }}
      onOpenWorktree={(id) => { afterPick(); openWorktreeOf(id) }}
      onEndSession={endSession}
      onOpenSettings={() => { afterPick(); setSettingsSection('appearance') }}
      pullRequests={{
        needYou: pullRequests.needsYou,
        onOpen: () => {
          afterPick()
          // The surface is a session's side panel, so with no session in front there is nowhere to show it.
          if (focusedSession === undefined) toast.info('Open a session to see its project’s pull requests')
          else showPanelView('pulls')
        },
      }}
      updateProgress={updateProgress}
    />
  )

  return (
    <>
      {/* Hidden, the sidebar leaves no rail: the pane header's Show sidebar button brings it back. */}
      {!focusMode && sidebarMode !== 'hidden' && renderSidebar(sidebarMode, noop, toggleSidebar)}
            {!focusMode && drawerShown && (
              <Panel label="Sessions" onClose={() => { setDrawerOpen(false) }} scrimClassName="mx-drawer-scrim" className="mx-drawer">
                {renderSidebar('docked', () => { setDrawerOpen(false) }, () => { setDrawerOpen(false) })}
              </Panel>
            )}
    </>
  )
}
