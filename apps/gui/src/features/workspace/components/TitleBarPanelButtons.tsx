import { activeArrangement } from '../model/layout'
import { LOCAL_MACHINE } from '@/api/machines'
import { useTipWithKeys } from '@/features/shortcuts/platform'
import { useWorkspace } from '../workspaceContext'
import { IconButton } from '@/components/ui/icon-button'
import { Icon } from './glyphs'

/**
 * Changes and Files, in the window's title bar: they open the side panel for the pane that has the focus, so there is one
 * pair for the window and not one in every pane's header. Beside them, in the Chat view, a Terminal button shows or hides
 * the terminal docked under the chat; in the Terminal view the panes are terminals already, so it is not drawn.
 */
export function TitleBarPanelButtons() {
  const { layout, sessionMap, repoPaneOf, inspectOpen, inspectView, focusedId, diffStat, togglePanel, chatOf, canDock, terminalShown, toggleTerminal } = useWorkspace()
  const tip = useTipWithKeys()
  const tab = activeArrangement(layout)
  const pane = tab?.panes.find((candidate) => candidate.id === tab.focus)
  const session = pane === undefined ? undefined : sessionMap.get(pane.sessionId)
  if (pane === undefined || session === undefined) return null
  // The panel has something for this pane: its repository, or the machine's it runs on.
  const hasPanel = session.machine !== LOCAL_MACHINE || repoPaneOf(session) !== null
  const dockable = canDock && chatOf(session).view === 'chat'
  if (!hasPanel && !dockable) return null
  const showing = (view: 'changes' | 'files') => inspectOpen && focusedId === session.id && inspectView === view
  const changed = diffStat.data?.files ?? 0
  return (
    <span className="mx-tbar-panels">
      {dockable && (
        <IconButton label="Terminal" tip={tip(terminalShown ? 'Hide terminal' : 'Terminal', 'terminal')} aria-pressed={terminalShown} onClick={toggleTerminal}><Icon name="terminalBox" /></IconButton>
      )}
      {hasPanel && (
        <>
          <IconButton label="Changes" tip={tip('Changes', 'inspect')} aria-pressed={showing('changes')} onClick={() => { togglePanel(pane.id, session.id, 'changes') }}>
            <Icon name="gitChanges" />
            {changed > 0 && <span className="mx-pane-count" aria-label={`${String(changed)} changed`}>{changed}</span>}
          </IconButton>
          <IconButton label="Files" aria-pressed={showing('files')} onClick={() => { togglePanel(pane.id, session.id, 'files') }}><Icon name="files" /></IconButton>
        </>
      )}
    </span>
  )
}
