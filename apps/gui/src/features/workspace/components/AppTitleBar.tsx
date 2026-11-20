import { TitleBar } from '@/components/TitleBar'
import { MaikerMark } from '@/components/ui/maiker-mark'
import { useWorkspace } from '../workspaceContext'
import { TitleBarPanelButtons } from './TitleBarPanelButtons'
import { ViewSwitch } from './ViewSwitch'
import { WindowServiceChip } from './WindowServiceStatus'

/**
 * The window's title bar as the workspace fills it: the M mark and the name at the left, then the service's chip while
 * it cannot be reached, the Chat / Terminal switch, Changes and Files for the focused pane, and the window buttons at the right.
 * What the old menu started is in the command palette.
 */
export function AppTitleBar() {
  const { preferences, setPreferences } = useWorkspace()
  const start = (
    <>
      <span className="mx-tbar-logo" data-tauri-drag-region>
        <MaikerMark />
        <span className="mx-tbar-word">Maiker</span>
      </span>
      <WindowServiceChip />
    </>
  )
  const end = (
    <>
      <span className="mx-tbar-view"><ViewSwitch view={preferences.openSessionsIn} onChange={(view) => { setPreferences((current) => ({ ...current, openSessionsIn: view })) }} /></span>
      <TitleBarPanelButtons />
    </>
  )
  return <TitleBar start={start} end={end} />
}
