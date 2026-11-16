import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react'
import { readTerminalTabs, writeTerminalTabs, type SavedTerminalTabs } from '@/data/terminalTabs'
import type { AgentTerminals } from '@/data/agentTerminals'
import type { SessionView } from './model/session'
import { liveTabs, type SplitPlace, type TerminalTab, withSplit } from './model/terminalTabs'

/**
 * The terminal dock (layout 2h): one card beside the chat, for the focused session's own terminals. Whether it is open
 * is the window's, not each session's, so switching chats keeps it where it was and shows that chat's terminals.
 */
export function useTerminalDock({ agentTerminals, setActiveTerminals, sessionMap, focusedSession, ownsTerminals, showSessionById }: {
  agentTerminals: AgentTerminals
  setActiveTerminals: Dispatch<SetStateAction<ReadonlyMap<string, string>>>
  sessionMap: ReadonlyMap<string, SessionView>
  focusedSession: SessionView | undefined
  ownsTerminals: (session: SessionView) => boolean
  showSessionById: (sessionId: string) => void
}) {
  const [terminalOpen, setTerminalOpen] = useState(false)
  // The keys go to the dock's terminal, not the pane's, from the moment the dock is used until a pane is.
  const [dockFocused, setDockFocused] = useState(false)
  const [savedTabs, setSavedTabs] = useState<SavedTerminalTabs>(readTerminalTabs)
  useEffect(() => { writeTerminalTabs(savedTabs) }, [savedTabs])

  const tabsOf = useCallback((agentId: string): TerminalTab[] => liveTabs(savedTabs.get(agentId), agentTerminals.get(agentId) ?? []), [savedTabs, agentTerminals])

  const onTerminalAdded = useCallback((agentId: string, terminalId: string, place?: SplitPlace) => {
    if (place !== undefined) {
      setSavedTabs((current) => {
        // Splits of agents that are gone are dropped here, so the saved arrangement never grows for ever.
        const kept = new Map([...current].filter(([id]) => sessionMap.has(id)))
        return kept.set(agentId, withSplit(liveTabs(current.get(agentId), agentTerminals.get(agentId) ?? []), terminalId, place))
      })
    }
    setActiveTerminals((current) => new Map(current).set(agentId, terminalId))
    setTerminalOpen(true)
    setDockFocused(true)
    showSessionById(agentId)
  }, [sessionMap, agentTerminals, setActiveTerminals, showSessionById])

  const canDock = focusedSession !== undefined && ownsTerminals(focusedSession)
  const terminalShown = terminalOpen && canDock
  return { terminalOpen, setTerminalOpen, terminalShown, canDock, dockFocused, setDockFocused, tabsOf, onTerminalAdded }
}
