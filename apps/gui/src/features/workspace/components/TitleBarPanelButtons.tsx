import { activeArrangement } from '../model/layout'
import { LOCAL_MACHINE } from '@/api/machines'
import { useTipWithKeys } from '@/features/shortcuts/platform'
import { useWorkspace } from '../workspaceContext'
import { Icon } from './glyphs'

/**
 * Changes and Files, in the window's title bar: they open the side panel for the pane that has the focus, so there is one
 * pair for the window and not one in every pane's header.
 */
export function TitleBarPanelButtons() {
  const { layout, sessionMap, repoPaneOf, inspectOpen, inspectView, focusedId, diffStat, togglePanel } = useWorkspace()
  const tip = useTipWithKeys()
  const tab = activeArrangement(layout)
  const pane = tab?.panes.find((candidate) => candidate.id === tab.focus)
  const session = pane === undefined ? undefined : sessionMap.get(pane.sessionId)
  // The panel has something for this pane: its repository, or the machine's it runs on.
  if (pane === undefined || session === undefined || (session.machine === LOCAL_MACHINE && repoPaneOf(session) === null)) return null
  const showing = (view: 'changes' | 'files') => inspectOpen && focusedId === session.id && inspectView === view
  const changed = diffStat.data?.files ?? 0
  return (
    <span className="mx-tbar-panels">
      <button type="button" className={`mx-pane-control${showing('changes') ? ' is-on' : ''}`} aria-label="Changes" title={tip('Changes', 'inspect')} aria-pressed={showing('changes')} onClick={() => { togglePanel(pane.id, session.id, 'changes') }}>
        <Icon name="gitChanges" />
        {changed > 0 && <span className="mx-pane-count" aria-label={`${String(changed)} changed`}>{changed}</span>}
      </button>
      <button type="button" className={`mx-pane-control${showing('files') ? ' is-on' : ''}`} aria-label="Files" title="Files" aria-pressed={showing('files')} onClick={() => { togglePanel(pane.id, session.id, 'files') }}><Icon name="files" size={15} /></button>
    </span>
  )
}
