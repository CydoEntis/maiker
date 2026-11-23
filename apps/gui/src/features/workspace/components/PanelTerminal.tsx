import { TerminalView } from '@/TerminalView'
import { useWorkspace } from '../workspaceContext'

/**
 * A terminal as a surface of the side panel: one of the focused session's own shells, edge to edge under the tabs. The
 * daemon owns the shell; the panel only shows it, so hiding the panel or switching tabs leaves it running.
 */
export function PanelTerminal({ terminalId, leaving }: { terminalId: string; leaving: boolean }) {
  const { sessionMap, preferences, look, online, modalOpen, openPath, pasteImage, terminalHandles, panelFocused, setPanelFocused } = useWorkspace()
  const shell = sessionMap.get(terminalId)
  if (shell === undefined) return null
  return (
    // `data-terminal-surface` tells the panel that Esc here is the program's, not the panel's close.
    <div className="mx-sp-term" data-terminal-surface onPointerDownCapture={() => { setPanelFocused(true) }}>
      <TerminalView
        conversation={shell.conversation}
        desktop
        fontSize={preferences.terminalFontSize}
        look={look}
        label={`Terminal in ${shell.cwdLabel}`}
        inputDisabled={!online}
        ended={shell.ended}
        focused={panelFocused && !modalOpen && !leaving}
        onOpenPath={(path, line) => { openPath(shell, path, line) }}
        onPasteImage={(image) => { pasteImage(shell.id, image) }}
        onHandle={(handle) => {
          if (handle) terminalHandles.current.set(shell.id, handle)
          else terminalHandles.current.delete(shell.id)
        }}
      />
    </div>
  )
}
