import { Fragment, useState } from 'react'
import { SplitHandle } from './SplitHandle'
import { FindBar } from '@/features/find/FindBar'
import { chatFindOf } from '@/features/chat/chatSearch'
import { EmptyState } from './states'
import { useUpdateReadyToast } from './useUpdateReadyToast'
import { paneColumns, setColumnWidths, setPaneHeights } from '../model/layout'
import { displayName } from '../model/session'
import { WorkspacePane } from './WorkspacePane'
import { DocPane } from './DocPane'
import { usePresence } from '@/lib/usePresence'
import { useReducedMotion } from './motion'
import { useWorkspace } from '../workspaceContext'
import { TerminalDock, TERMINAL_DOCK_EXIT_MS } from './TerminalDock'

/** The middle of the window: find, the service's state, and the panes of each mounted tab. */
export function WorkspaceMain() {
  const { sessionsListed, newChatOpen, sessions, focusedSession, preferences, setSettingsSection, findOpen, online, heads, focusedId, terminalHandles, showSessionById, setFindOpen, tab, mountedTabs, layout, narrow, setLayout, closingPanes, startFolderLabel, canStart, newSession, focusedMachineNumber, updater, restartNow, terminalShown, setDockFocused, sessionMap } = useWorkspace()
  useUpdateReadyToast(updater.state.status === 'ready' ? updater.state.version : null, restartNow)
  const reduced = useReducedMotion()
  const terminal = usePresence(terminalShown, TERMINAL_DOCK_EXIT_MS, reduced)
  // The dock shows the focused session's terminals; while it slides out it keeps the session it was showing.
  const [dockAgentId, setDockAgentId] = useState(focusedSession?.id)
  if (terminalShown && focusedSession !== undefined && focusedSession.id !== dockAgentId) setDockAgentId(focusedSession.id)
  const dockAgent = dockAgentId === undefined ? undefined : sessionMap.get(dockAgentId)
  const dock = terminal.shown && dockAgent !== undefined ? preferences.terminalDock : null
  return (
    <div className="mx-main-wrap">
              <div className="mx-termwrap" data-dock={dock ?? undefined} data-leaving={terminal.leaving ? 'true' : undefined}>
              <main className="mx-main" aria-label="Terminals" onPointerDownCapture={() => { setDockFocused(false) }}>
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
                  return (
                  <div key={tab.id} className={`mx-panes${tab.panes.length > 1 && tab.max === null ? ' is-split' : ''}${kept ? ' is-kept' : ''}`} aria-hidden={kept ? true : undefined} inert={kept}>
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
                ) : (
                  <EmptyState
                    hasSessions={sessions.length > 0}
                    listed={sessionsListed}
                    startFolderLabel={startFolderLabel}
                    canStart={canStart}
                    onNewSession={() => { newSession(focusedMachineNumber) }}
                    onChangeStartFolder={() => { setSettingsSection('general') }}
                  />
                )}
              </main>
              {dock !== null && dockAgent !== undefined && <TerminalDock agent={dockAgent} leaving={terminal.leaving} />}
              </div>
            </div>
  )
}
