import { Fragment, useState } from 'react'
import { LOCAL_MACHINE } from '@/api/machines'
import { useShortcutText, useTipWithKeys } from '@/features/shortcuts/platform'
import { busyBranchesOf, machineProjects } from '../model/newSession'
import { discardDraft } from '../model/newSessionDraft'
import { rowTitle } from '../model/sidebar'
import { resolveStartFolder } from '../model/startFolder'
import { useOpenProject } from '../useOpenProject'
import { PullRequestsPage } from './PullRequestsPage'
import { NewChatPage } from './NewChatPage'
import { ShowSidebarButton } from './ShowSidebarButton'
import { useFolderPick } from './useFolderPick'
import { osOfPlatform, paletteMachinesOf } from '@/features/open-project/paletteMachines'
import { usePlatform } from '@/features/shortcuts/platform'
import { SplitHandle } from './SplitHandle'
import { FindBar } from '@/features/find/FindBar'
import { chatFindOf } from '@/features/chat/chatSearch'
import { LookingForSessions } from './states'
import { EmptyStart } from './EmptyStart'
import { pickedPlace, startPlaces } from '../model/emptyStart'
import { useInstalledAgents } from '../model/newChatHost'
import type { OpenedProject } from '../model/openedProjects'
import { ADD_MACHINE, PROJECT_FROM_SOURCES } from '../useOpenProject'
import { useProjectActions } from '../useProjectActions'
import { useUpdateReadyToast } from './useUpdateReadyToast'
import { paneColumns, setColumnWidths, setPaneHeights } from '../model/layout'
import { displayName } from '../model/session'
import { WorkspacePane } from './WorkspacePane'
import { DocPane } from './DocPane'
import { usePresence } from '@/lib/usePresence'
import { useReducedMotion } from './motion'
import { useWorkspace } from '../workspaceContext'
import { TerminalDock, TERMINAL_DOCK_EXIT_MS } from './TerminalDock'

const noop = () => undefined

/**
 * The main area with no tab and no draft in it: the empty state once the service has listed its sessions. An agent
 * picked there starts the way a project heading's `+` menu starts it (`useProjectActions`), so the two never differ.
 */
function MainEmpty() {
  const { sessionsListed, sessions, sidebarMachineHeads, openedProjects, canStart, modalOpen, welcomeOpen, shortcutsOpen, pendingConfirm, root, setOpenProject } = useWorkspace()
  const installed = useInstalledAgents()
  const shortcutText = useShortcutText()
  const actions = useProjectActions()(noop)
  const [picked, setPicked] = useState<OpenedProject | null>(null)
  if (!sessionsListed) return <LookingForSessions />
  const places = startPlaces(sidebarMachineHeads, openedProjects.machines)
  return (
    <EmptyStart
      running={sessions.length > 0}
      places={places}
      place={pickedPlace(places, picked, openedProjects.selected, openedProjects.opened)}
      installed={installed}
      canStart={canStart}
      covered={modalOpen || welcomeOpen || shortcutsOpen || pendingConfirm !== null}
      openProjectKeys={shortcutText('open-folder')}
      portalContainer={root}
      onPick={(place) => { setPicked(place.project) }}
      onStart={(place, agent) => { actions.onNewSession(place.machine, place.project, agent) }}
      onOpenProject={() => { setOpenProject(PROJECT_FROM_SOURCES) }}
      onAddMachine={() => { setOpenProject(ADD_MACHINE) }}
    />
  )
}

/** The middle of the window: find, the service's state, and the panes of each mounted tab. */
export function WorkspaceMain() {
  const { newChatOpen, pullsOf, setPullsOf, sessions, focusedSession, preferences, findOpen, online, heads, focusedId, terminalHandles, showSessionById, setFindOpen, tab, mountedTabs, layout, narrow, setLayout, closingPanes, paneCountOf, updater, restartNow, terminalShown, setDockFocused, sessionMap, chatView, newChatMachine, setNewChatMachine, setNewChatAgent, newChatSeed, setNewChatSeed, sidebarMachineHeads, setNewChatOpen, home, startNewChat, warmNewChat, sidebarMode, toggleSidebar, focusMode } = useWorkspace()
  const tip = useTipWithKeys()
  const openProject = useOpenProject()
  useUpdateReadyToast(updater.state.status === 'ready' ? updater.state.version : null, restartNow)
  const reduced = useReducedMotion()
  const terminal = usePresence(terminalShown, TERMINAL_DOCK_EXIT_MS, reduced)
  // The dock shows the focused session's terminals; while it slides out it keeps the session it was showing.
  const [dockAgentId, setDockAgentId] = useState(focusedSession?.id)
  if (terminalShown && focusedSession !== undefined && focusedSession.id !== dockAgentId) setDockAgentId(focusedSession.id)
  const dockAgent = dockAgentId === undefined ? undefined : sessionMap.get(dockAgentId)
  const dock = terminal.shown && dockAgent !== undefined ? preferences.terminalDock : null
  const folderPick = useFolderPick(paletteMachinesOf(sidebarMachineHeads, resolveStartFolder(preferences.startFolder, home)), osOfPlatform(usePlatform()), home)
  const newChatStartFolder = newChatMachine === LOCAL_MACHINE ? resolveStartFolder(preferences.startFolder, home) : '~'
  return (
    <div className="mx-main-wrap">
              {folderPick.dialog}
              <div className="mx-termwrap" data-dock={dock ?? undefined} data-leaving={terminal.leaving ? 'true' : undefined}>
              <main className="mx-main" aria-label="Terminals" onPointerDownCapture={() => { setDockFocused(false) }}>
                {newChatOpen && (
                  <NewChatPage
                    key={`${newChatSeed?.folder ?? ''}|${newChatSeed?.agent ?? ''}`}
                    leading={sidebarMode === 'hidden' && !focusMode ? <ShowSidebarButton onShow={toggleSidebar} tip={tip('Show sidebar', 'toggle-sidebar')} /> : undefined}
                    seed={newChatSeed}
                    machine={newChatMachine}
                    machines={sidebarMachineHeads.map((head) => ({ machine: head.machine, label: head.label, name: head.name, local: head.machine === LOCAL_MACHINE, down: head.machine === LOCAL_MACHINE || head.chip?.tone === 'ok' ? null : head.why ?? head.chip?.word ?? 'not reachable' }))}
                    onOtherMachine={setNewChatMachine}
                    projects={machineProjects(sessions, newChatMachine, focusedSession, newChatStartFolder)}
                    busy={busyBranchesOf(sessions, newChatMachine, rowTitle)}
                    defaultAgent={preferences.defaultAgent}
                    bypassOff={preferences.bypassOff}
                    pickFolder={folderPick.pick}
                    onOpenProject={openProject.open}
                    onStart={startNewChat}
                    otherAgents={chatView}
                    looseFolder={newChatStartFolder}
                    onWarm={warmNewChat}
                    onAgentChange={setNewChatAgent}
                    onAddMachine={openProject.addMachine}
                    onCancel={() => { discardDraft(); setNewChatOpen(false); setNewChatSeed(null) }}
                  />
                )}
                {/* Pull requests are the focused session's project's: showing another session leaves the page. */}
                {pullsOf !== null && focusedSession?.id === pullsOf && (
                  <PullRequestsPage
                    session={focusedSession}
                    leading={sidebarMode === 'hidden' && !focusMode ? <ShowSidebarButton onShow={toggleSidebar} tip={tip('Show sidebar', 'toggle-sidebar')} /> : undefined}
                    onClose={() => { setPullsOf(null) }}
                  />
                )}
                {findOpen && (
                  <FindBar
                    online={online}
                    otherMachines={heads.length > 0}
                    findInPane={(query, direction) => {
                      if (!focusedId) return false
                      // A pane that shows its chat is searched as the chat; its terminal is under it and out of sight.
                      const chat = chatFindOf(focusedId)
                      return chat ? chat.find(query, direction) : terminalHandles.current.get(focusedId)?.find(query, direction) ?? false
                    }}
                    clearPane={() => {
                      if (!focusedId) return
                      chatFindOf(focusedId)?.clear()
                      terminalHandles.current.get(focusedId)?.clearFind()
                    }}
                    nameOf={(term, machine) => { const found = sessions.find((item) => item.machine === machine && item.pane === term); return found ? displayName(found) : null }}
                    onOpenSession={(term, machine) => { const found = sessions.find((item) => item.machine === machine && item.pane === term); if (found) showSessionById(found.id) }}
                    onClose={() => { setFindOpen(false); if (focusedId) terminalHandles.current.get(focusedId)?.focus() }}
                  />
                )}
                {tab ? (
                  <div className="mx-pane-stack" inert={newChatOpen}>
                  {mountedTabs.map((tab) => {
                  const kept = tab.id !== layout.activeId
                  // Two panes or more on screen, whether the arrangement holds several or a session is split: each is a card of its own.
                  const onScreen = tab.max === null ? tab.panes : tab.panes.filter((pane) => pane.id === tab.max)
                  const paneCount = onScreen.reduce((count, pane) => count + paneCountOf(pane), 0)
                  return (
                  <div key={tab.id} className={`mx-panes${paneCount > 1 ? ' is-split' : ''}${kept ? ' is-kept' : ''}`} aria-hidden={kept ? true : undefined} inert={kept}>
                    {paneColumns(tab, narrow).map((column, columnIndex, columns) => (
                      <Fragment key={column[0]?.id ?? columnIndex}>
                        {columnIndex > 0 && tab.max === null && !narrow && (
                          <SplitHandle
                            axis="columns"
                            index={columnIndex - 1}
                            onResize={(widths) => { setLayout((current) => setColumnWidths(current, tab.id, widths)) }}
                            onReset={() => { setLayout((current) => setColumnWidths(current, tab.id, null)) }}
                          />
                        )}
                      <div className={`mx-pane-column${column.every((pane) => closingPanes.has(pane.id)) ? ' is-closing' : ''}`} style={tab.widths && tab.max === null && !narrow && tab.widths.length === columns.length ? { flexGrow: tab.widths[columnIndex] } : undefined}>
                        {column.map((pane, rowIndex) => (
                          <Fragment key={pane.id}>
                            {rowIndex > 0 && tab.max === null && !narrow && (
                              <SplitHandle
                                axis="rows"
                                index={rowIndex - 1}
                                onResize={(heights) => { setLayout((current) => setPaneHeights(current, tab.id, pane.col, heights)) }}
                                onReset={() => { setLayout((current) => setPaneHeights(current, tab.id, pane.col, null)) }}
                              />
                            )}
                            <div className={`mx-pane-cell${closingPanes.has(pane.id) ? ' is-closing' : ''}`} style={pane.h !== undefined && tab.max === null && !narrow ? { flexGrow: pane.h } : undefined}>
                              {pane.doc ? <DocPane shown={tab} pane={pane} kept={kept} /> : <WorkspacePane shown={tab} pane={pane} kept={kept} />}
                            </div>
                          </Fragment>
                        ))}
                      </div>
                      </Fragment>
                    ))}
                  </div>
                  )
                  })}
                  </div>
                ) : !newChatOpen && <MainEmpty />}
              </main>
              {dock !== null && dockAgent !== undefined && <TerminalDock agent={dockAgent} leaving={terminal.leaving} />}
              </div>
            </div>
  )
}
