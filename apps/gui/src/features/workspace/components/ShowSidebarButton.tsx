import { Icon } from './glyphs'

/** Show sidebar, at the start of a header while the sidebar is hidden (layout 2h); `tip` names the keys that do the same. */
export function ShowSidebarButton({ onShow, tip }: { onShow: () => void; tip: string }) {
  return <button type="button" className="mx-pane-show-sidebar" aria-label="Show sidebar" title={tip} onClick={onShow}><Icon name="panelLeft" size={14} /></button>
}
