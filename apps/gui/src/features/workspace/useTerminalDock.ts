import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react'
import { readTerminalTabs, writeTerminalTabs, type SavedTerminalTabs } from '@/data/terminalTabs'
import { openTab, pinTerminal as pinTab, showTab, tabOf, terminalTabIds, unpinTerminal as unpinTab, withPinned, type PanelTabs } from '@/features/inspect/panelTabs'
import type { SessionView } from './model/session'
import { liveTabs, type TerminalPlace, type TerminalTab, withSplit } from './model/terminalTabs'

/** Which terminal outside the panes the keys go to: one in the drawer, the one in the side panel, or none. */
type TerminalKeys = 'drawer' | 'panel' | null

/**
 * Where a session's own terminals show. Each is a tab of the side panel until it is pinned to the bottom, which moves
 * it to the drawer under the main pane (the terminal dock); from there it can be split, and moved back. Whether the
 * drawer is open is the window's, not each session's, so switching sessions keeps it where it was.
 */
export function useTerminalDock({ panelOf, changePanel, inspectOpen, setInspectOpen, setActiveTerminals, sessionMap, focusedSession, ownsTerminals, showSessionById }: {
  panelOf: (sessionId: string) => PanelTabs
  changePanel: (sessionId: string, change: (panel: PanelTabs) => PanelTabs) => void
  inspectOpen: boolean
  setInspectOpen: Dispatch<SetStateAction<boolean>>
  setActiveTerminals: Dispatch<SetStateAction<ReadonlyMap<string, string>>>
  sessionMap: ReadonlyMap<string, SessionView>
  focusedSession: SessionView | undefined
  ownsTerminals: (session: SessionView) => boolean
  showSessionById: (sessionId: string) => void
}) {
  const [terminalOpen, setTerminalOpen] = useState(false)
  // The keys go to a terminal outside the panes from the moment it is used until a pane is.
  const [keys, setKeys] = useState<TerminalKeys>(null)
  const [savedTabs, setSavedTabs] = useState<SavedTerminalTabs>(readTerminalTabs)
  useEffect(() => { writeTerminalTabs(savedTabs) }, [savedTabs])

  /** The drawer's tabs for a session: its pinned terminals, in the splits they were given. */
  const tabsOf = useCallback((agentId: string): TerminalTab[] => liveTabs(savedTabs.get(agentId), panelOf(agentId).pinned), [savedTabs, panelOf])

  const showInDrawer = useCallback((agentId: string, terminalId: string) => {
    setActiveTerminals((current) => new Map(current).set(agentId, terminalId))
    setTerminalOpen(true)
    setKeys('drawer')
  }, [setActiveTerminals])

  const onTerminalAdded = useCallback((agentId: string, terminalId: string, place?: TerminalPlace) => {
    if (place === undefined || place === 'behind') {
      // Behind: the tab is there, and what the person was looking at stays in front.
      changePanel(agentId, (panel) => (place === 'behind' && panel.active !== null ? showTab(openTab(panel, tabOf('terminal', terminalId)), panel.active) : openTab(panel, tabOf('terminal', terminalId))))
      setInspectOpen(true)
      if (place === undefined) setKeys('panel')
    } else {
      changePanel(agentId, (panel) => withPinned(panel, terminalId))
      if (place !== 'drawer') {
        setSavedTabs((current) => {
          // Splits of agents that are gone are dropped here, so the saved arrangement never grows for ever.
          const kept = new Map([...current].filter(([id]) => sessionMap.has(id)))
          return kept.set(agentId, withSplit(liveTabs(current.get(agentId), panelOf(agentId).pinned), terminalId, place))
        })
      }
      showInDrawer(agentId, terminalId)
    }
    showSessionById(agentId)
  }, [sessionMap, panelOf, changePanel, setInspectOpen, showInDrawer, showSessionById])

  /** Pin to the bottom: the side panel's terminal tab becomes a tab of the drawer, which opens on it. */
  const pinTerminal = useCallback((agentId: string, terminalId: string) => {
    changePanel(agentId, (panel) => pinTab(panel, terminalId))
    showInDrawer(agentId, terminalId)
  }, [changePanel, showInDrawer])

  /** Move to the side panel: the drawer's terminals become tabs of the panel again, the last of them in front. */
  const unpinTerminals = useCallback((agentId: string, terminalIds: readonly string[]) => {
    changePanel(agentId, (panel) => terminalIds.reduce(unpinTab, panel))
    setInspectOpen(true)
    setKeys('panel')
  }, [changePanel, setInspectOpen])

  /** The side panel on the session's terminal tab, with the keys in it; false when it has none. */
  const showPanelTerminal = useCallback((agentId: string): boolean => {
    const panel = panelOf(agentId)
    const shown = panel.tabs.find((tab) => tab.id === panel.active)
    const terminalId = shown?.kind === 'terminal' ? shown.id : terminalTabIds(panel)[0]
    if (terminalId === undefined) return false
    changePanel(agentId, (current) => showTab(current, terminalId))
    setInspectOpen(true)
    setKeys('panel')
    return true
  }, [panelOf, changePanel, setInspectOpen])

  const canDock = focusedSession !== undefined && ownsTerminals(focusedSession)
  const focusedPanel = focusedSession === undefined ? undefined : panelOf(focusedSession.id)
  const hasPinned = (focusedPanel?.pinned.length ?? 0) > 0
  const terminalShown = terminalOpen && canDock && hasPinned
  const dockFocused = keys === 'drawer'
  const setDockFocused = useCallback((focused: boolean) => { setKeys(focused ? 'drawer' : null) }, [])
  // The panel's terminal has the keys only while it is the tab that shows.
  const panelFocused = keys === 'panel' && inspectOpen && focusedPanel?.tabs.find((tab) => tab.id === focusedPanel.active)?.kind === 'terminal'
  const setPanelFocused = useCallback((focused: boolean) => { setKeys((current) => (focused ? 'panel' : current === 'panel' ? null : current)) }, [])
  return { terminalOpen, setTerminalOpen, terminalShown, canDock, hasPinned, dockFocused, setDockFocused, panelFocused, setPanelFocused, tabsOf, onTerminalAdded, pinTerminal, unpinTerminals, showPanelTerminal }
}
