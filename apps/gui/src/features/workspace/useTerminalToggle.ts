import { activeArrangement } from './model/layout'
import { isShell } from './model/sidebar'
import { useWorkspace } from './workspaceContext'

/**
 * Shows and hides the focused session's own terminal, wherever Settings docks it: under an agent's chat, or in the side
 * panel (a shell's further terminals always live there). A session with none gets its first one.
 */
export function useTerminalToggle(): { shown: boolean; tip: string; toggle: () => void } {
  const { focusedSession, layout, preferences, agentTerminals, drawerFoldedOf, setDrawerFolded, addAgentTerminal, inspectOpen, inspectView, togglePanel } = useWorkspace()
  const session = focusedSession ?? null
  const terminals = session === null ? [] : agentTerminals.get(session.id) ?? []
  const underChat = session !== null && !isShell(session) && preferences.terminalDock === 'under'
  const shown = session !== null && terminals.length > 0 && (underChat ? !drawerFoldedOf(session.id) : inspectOpen && inspectView === 'terminal')
  const focusedPane = activeArrangement(layout)?.focus ?? null
  const toggle = () => {
    if (session === null) return
    if (terminals.length === 0) addAgentTerminal(session.id)
    else if (underChat) setDrawerFolded(session.id, shown)
    else if (focusedPane !== null) togglePanel(focusedPane, session.id, 'terminal')
  }
  const tip = session === null ? 'Terminal: open a session first' : shown ? 'Hide terminal' : 'Open terminal'
  return { shown, tip, toggle }
}
