import { useCallback } from 'react'
import { Panel } from '@/components/ui/panel'
import { useInstalledAgents } from '../model/newChatHost'
import { Sidebar } from './Sidebar'
import { useWorkspace } from '../workspaceContext'
import { useChatPrefetch } from '../useChatPrefetch'
import { projectRequestFor } from '../useOpenProject'

const noop = () => undefined

/** The sidebar: the docked column or the rail, and the full one in a drawer over a narrow window. */
export function WorkspaceSidebars() {
  const { sessionsListed, sidebarSessions, sidebarMachineHeads, focusedId, online, canStart, root, preferences, sidebarWidth, setLiveSidebarWidth, setPreferences, setPaletteOpen, startMenu, setStartMenu, startAgent, newTerminal, chatView, setSettingsSection, setAddMachineOpen, fixMachine, setRenamingMachine, setUpdateAsk, showSessionById, setRenameId, openInSplit, copyPathOf, copyText, showChangesOf, markDone, bringBack, unsnooze, setGetFileId, endSession, updateProgress, focusMode, sidebarMode, toggleSidebar, drawerShown, setDrawerOpen, setRecentOpen, setSpecialistsId, sessionMap, setWorktreeFrom, setOpenProject } = useWorkspace()
  const warmChat = useChatPrefetch(useCallback((id: string) => sessionMap.get(id), [sessionMap]))
  const installedAgents = useInstalledAgents()
  const start = {
    installedAgents,
    onAgent: startAgent,
  }

  // The sidebar, as the docked column or the 60px rail, or the full one inside the overlay of a narrow window.
  // Two sidebars can be on screen (the rail and its drawer); the window's open + menu belongs to the one in front.
  const renderSidebar = (mode: 'docked' | 'rail', afterPick: () => void, onToggle: () => void, holdsStartMenu: boolean) => (
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
      order={preferences.sidebarOrder}
      grouping={preferences.sidebarGroup}
      onGrouping={(sidebarGroup) => { setPreferences((current) => ({ ...current, sidebarGroup })) }}
      onSearch={() => { afterPick(); setPaletteOpen(true) }}
      width={sidebarWidth}
      onResize={setLiveSidebarWidth}
      onResizeEnd={(width) => {
        setPreferences((current) => ({ ...current, sidebarWidth: width }))
        setLiveSidebarWidth(null)
      }}
      onHoverSession={warmChat}
      startMenu={holdsStartMenu ? startMenu : null}
      onStartMenu={setStartMenu}
      start={{ ...start, onAgent: (program, machine) => { afterPick(); start.onAgent(program, machine) } }}
      onNewShell={chatView ? undefined : (machine) => { afterPick(); newTerminal(machine) }}
      onAddMachine={() => { afterPick(); setAddMachineOpen(true) }}
      onOpenProject={(machine) => { afterPick(); setOpenProject(projectRequestFor(machine)) }}
      onMachineSettings={() => { afterPick(); setSettingsSection('machines') }}
      onFixMachine={(head) => { afterPick(); if (head.name !== null) fixMachine(head.name) }}
      onRenameMachine={setRenamingMachine}
      onUpdateMachine={(name, action) => { afterPick(); setUpdateAsk({ name, action }) }}
      onShowSession={(id) => { afterPick(); showSessionById(id) }}
      onRenameSession={setRenameId}
      onSplitSession={(id, direction) => { afterPick(); openInSplit(id, direction) }}
      onCopyPath={copyPathOf}
      onCopyText={copyText}
      onShowChanges={(id) => { afterPick(); showChangesOf(id) }}
      onMarkDone={markDone}
      onBringBack={bringBack}
      onUnsnooze={unsnooze}
      onGetFile={setGetFileId}
      onSpecialists={setSpecialistsId}
      onNewWorktree={(id) => { afterPick(); const from = sessionMap.get(id); if (from !== undefined) setWorktreeFrom(from) }}
      onEndSession={endSession}
      onOpenSettings={() => { afterPick(); setSettingsSection('appearance') }}
      onRecentSessions={() => { afterPick(); setRecentOpen(true) }}
      updateProgress={updateProgress}
    />
  )

  return (
    <>
      {/* Hidden, the sidebar leaves no rail: the pane header's Show sidebar button brings it back. */}
      {!focusMode && sidebarMode !== 'hidden' && renderSidebar(sidebarMode, noop, toggleSidebar, !drawerShown)}
            {!focusMode && drawerShown && (
              <Panel label="Sessions" onClose={() => { setDrawerOpen(false) }} scrimClassName="mx-drawer-scrim" className="mx-drawer">
                {renderSidebar('docked', () => { setDrawerOpen(false) }, () => { setDrawerOpen(false) }, true)}
              </Panel>
            )}
    </>
  )
}
