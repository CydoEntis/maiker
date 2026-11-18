import { TitleBar } from '@/components/TitleBar'
import { MaikerMark } from '@/components/ui/maiker-mark'
import { WindowServiceChip } from './WindowServiceStatus'

/**
 * The window's title bar as the workspace fills it: the M mark and the name at the left, then the service's chip while
 * it cannot be reached, the window buttons at the right. What the old menu started is in the command palette.
 */
export function AppTitleBar() {
  const start = (
    <>
      <span className="mx-tbar-logo" data-tauri-drag-region>
        <MaikerMark />
        <span className="mx-tbar-word">Maiker</span>
      </span>
      <WindowServiceChip />
    </>
  )
  return <TitleBar start={start} />
}
