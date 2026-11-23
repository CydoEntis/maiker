import { IconButton } from '@/components/ui/icon-button'
import { Icon } from './glyphs'

/** Show sidebar, at the start of a header while the sidebar is hidden (layout 2h); `tip` names the keys that do the same. */
export function ShowSidebarButton({ onShow, tip }: { onShow: () => void; tip: string }) {
  return <IconButton label="Show sidebar" tip={tip} className="mx-pane-show-sidebar" onClick={onShow}><Icon name="panelLeft" /></IconButton>
}
