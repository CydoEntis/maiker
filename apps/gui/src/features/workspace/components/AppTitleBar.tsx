import { TitleBar } from '@/components/TitleBar'

/**
 * The window's title bar as the workspace fills it (layout 2h): the logo and name at the left, the window buttons at the
 * right. What the old Maitty menu started is in the command palette; the view toggles moved to the tools bar.
 */
export function AppTitleBar() {
  const start = (
    <span className="mx-tbar-logo" data-tauri-drag-region>
      <img src="/maiker-logo.png" alt="" />
      <span className="mx-tbar-word">M<span className="mx-tbar-ai">ai</span>ker</span>
    </span>
  )
  return <TitleBar start={start} />
}
