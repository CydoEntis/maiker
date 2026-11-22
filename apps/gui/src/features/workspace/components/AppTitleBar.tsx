import { TitleBar } from '@/components/TitleBar'
import { MaikerMark } from '@/components/ui/maiker-mark'
import { useTipWithKeys } from '@/features/shortcuts/platform'
import { useWorkspace } from '../workspaceContext'
import { SidePanelButton } from './SidePanelButton'
import { WindowServiceChip } from './WindowServiceStatus'

/**
 * The window's title bar as the workspace fills it: the Maiker mark and name at the left, then the service's chip while
 * it cannot be reached; at the right the one side-panel button and the window buttons. Everything else the window can
 * do is in the command palette.
 */
export function AppTitleBar() {
  const { inspectOpen, inspectRefusal, focusedSession, focusMode, toggleInspect } = useWorkspace()
  const tip = useTipWithKeys()
  // Pressed only while the panel is drawn: it is kept open across sessions, and one it has nothing for has no panel.
  const shown = inspectOpen && !focusMode && focusedSession !== undefined && inspectRefusal === null
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
    <span className="mx-tbar-panels">
      <SidePanelButton shown={shown} available={focusedSession !== undefined && !focusMode} tip={tip('Side panel', 'inspect')} onToggle={toggleInspect} />
    </span>
  )
  return <TitleBar start={start} end={end} />
}
