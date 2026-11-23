import { useCallback, useEffect, useState } from 'react'
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

/** How long the docked sidebar takes to slide in or out: `--panel-in` in workspace.css. */
const SLIDE_MS = 280

type SidebarMode = 'docked' | 'rail'

/**
 * Keeps the sidebar on screen while it slides out, and says when it slides in. Hiding unmounts it, so without this it
 * vanished at once: the last mode stays drawn, marked `out`, for the slide's length. Shown again it is marked `in` for
 * the same time. The first draw is never a slide, so the window does not animate as it opens.
 */
function useSidebarSlide(mode: SidebarMode | 'hidden'): { drawn: SidebarMode | null; slide: 'in' | 'out' | undefined } {
  const [was, setWas] = useState(mode)
  const [last, setLast] = useState<SidebarMode | null>(mode === 'hidden' ? null : mode)
  const [slide, setSlide] = useState<'in' | 'out' | undefined>(undefined)
  // Worked out while drawing (React's "state from the previous render"), so the slide starts on the same frame.
  if (was !== mode) {
    setWas(mode)
    if (mode !== 'hidden') setLast(mode)
    if (was === 'hidden' || mode === 'hidden') setSlide(mode === 'hidden' ? 'out' : 'in')
  }
  useEffect(() => {
    if (slide === undefined) return
    const done = window.setTimeout(() => { setSlide(undefined) }, SLIDE_MS)
    return () => { window.clearTimeout(done) }
  }, [slide, was])
  const drawn = mode !== 'hidden' ? mode : slide === 'out' ? last : null
  return { drawn, slide }
}

/** The sidebar: the docked column or the rail, and the full one in a drawer over a narrow window. */
export function WorkspaceSidebars() {
  const { sessionsListed, sidebarSessions, sidebarMachineHeads, openedProjects, focusedId, online, canStart, root, preferences, sidebarWidth, setLiveSidebarWidth, setPreferences, setPaletteOpen, setSettingsSection, setPullsOf, retryNamed, openLoginNamed, copyCommand, setRenamingMachine, setUpdateAsk, showSessionById, setRenameId, saveName, copyPathOf, endSession, updateProgress, focusMode, sidebarMode, toggleSidebar, drawerShown, setDrawerOpen, sessionMap, setWorktreeFrom, setProjectWorktreeFrom, setOpenWorktreeFor, setOpenProject, pullRequests, focusedSession } = useWorkspace()
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
  const { drawn, slide } = useSidebarSlide(sidebarMode)
  const renderSidebar = (mode: SidebarMode, afterPick: () => void, onToggle: () => void, sliding?: 'in' | 'out') => (
    <Sidebar
      slide={sliding}
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
      opened={openedProjects.opened}
      sort={preferences.sidebarSort}
      onSort={(sort) => { setPreferences((current) => ({ ...current, sidebarSort: sort })) }}
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
      onOpenSettings={() => { afterPick(); setSettingsSection('general') }}
      pullRequests={{
        needYou: pullRequests.needsYou,
        onOpen: () => {
          afterPick()
          // The list is a project's, found through the session in front, so with none there is no project to list.
          if (focusedSession === undefined) toast.info('Open a session to see its project’s pull requests')
          else setPullsOf(focusedSession.id)
        },
      }}
      updateProgress={updateProgress}
    />
  )

  return (
    <>
      {/* Hidden, the sidebar leaves no rail: the pane header's Show sidebar button brings it back. */}
      {!focusMode && drawn !== null && renderSidebar(drawn, noop, toggleSidebar, slide)}
            {!focusMode && drawerShown && (
              <Panel label="Sessions" onClose={() => { setDrawerOpen(false) }} scrimClassName="mx-drawer-scrim" className="mx-drawer">
                {renderSidebar('docked', () => { setDrawerOpen(false) }, () => { setDrawerOpen(false) })}
              </Panel>
            )}
    </>
  )
}
