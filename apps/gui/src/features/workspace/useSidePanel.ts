import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react'
import { machineNameOf } from '@/api/machines'
import type { AgentTerminals } from '@/data/agentTerminals'
import { livePanel, openTab, tabOf, type PanelTabs, type SingleSurfaceKind } from '@/features/inspect/panelTabs'
import { readPanelTabs, writePanelTabs, type SavedPanels } from '@/features/inspect/panelTabsStorage'
import type { SessionView } from './model/session'

/**
 * `panels` without what no longer exists, so the saved tabs never grow for ever: a session of this computer the daemon
 * no longer lists. Another machine's sessions are kept, since its list is missing whenever it is not connected.
 */
function withoutGone(panels: SavedPanels, sessionMap: ReadonlyMap<string, SessionView>): Map<string, PanelTabs> {
  // An empty list is one that has not arrived yet, never a reason to forget every session's tabs.
  if (sessionMap.size === 0) return new Map(panels)
  return new Map([...panels].filter(([id]) => sessionMap.has(id) || machineNameOf(id) !== null))
}

/**
 * The side panel's tabs. Each session has its own (a terminal belongs to its session, and so does a pinned one), kept
 * between runs; whether the panel is open is the window's, so switching sessions keeps it open on that session's tabs.
 */
export function useSidePanel({ agentTerminals, sessionMap, setInspectOpen }: {
  agentTerminals: AgentTerminals
  sessionMap: ReadonlyMap<string, SessionView>
  setInspectOpen: Dispatch<SetStateAction<boolean>>
}) {
  const [saved, setSaved] = useState<SavedPanels>(readPanelTabs)
  useEffect(() => { writePanelTabs(saved) }, [saved])

  const panelOf = useCallback((sessionId: string): PanelTabs => livePanel(saved.get(sessionId), agentTerminals.get(sessionId) ?? []), [saved, agentTerminals])

  const changePanel = useCallback((sessionId: string, change: (panel: PanelTabs) => PanelTabs) => {
    setSaved((current) => withoutGone(current, sessionMap).set(sessionId, change(livePanel(current.get(sessionId), agentTerminals.get(sessionId) ?? []))))
  }, [sessionMap, agentTerminals])

  /** Files, Changes or Pull requests for `sessionId`, in front, with the panel open: the one way anything outside the panel opens them. */
  const openSurface = useCallback((sessionId: string, kind: SingleSurfaceKind) => {
    changePanel(sessionId, (panel) => openTab(panel, tabOf(kind)))
    setInspectOpen(true)
  }, [changePanel, setInspectOpen])

  return { panelOf, changePanel, openSurface }
}
