import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { FolderPlus } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { StatusIcon } from '@/components/ui/status-icon'
import { markOf } from '@/lib/statusMark'
import { useShortcutText, useTipWithKeys } from '@/features/shortcuts/platform'
import { SESSION_ROW_ATTRIBUTE } from '../keyTargets'
import { helperSummary, summarySpoken } from '../model/helpers'
import { STATUS_WORD, type SessionView } from '../model/session'
import { rowTitle } from '../model/sidebar'
import { NO_FILTER, sidebarOrder, type SessionNode } from '../model/sidebarTree'
import { Icon } from './glyphs'
import { MenuPopup, type MenuEntry } from './MenuPopup'
import { isMenuKey } from './menuPoint'
import { ProjectBadge } from './ProjectBadge'
import { RowHoverHost } from './RowHoverHost'
import type { SidebarProps } from './Sidebar'
import { sessionMenuEntries } from './sessionMenu'
import { useHeldRow } from './useHeldRow'
import { useHoverController } from './useHoverController'

type OpenMenu = { owner: string; title: string; at: { x: number; y: number }; items: MenuEntry[] }

/** The gap between a mark and the menu the menu key opens under it. */
const MENU_GAP_PX = 4
/** A session's mark in the rail, the size of a row's. */
const MARK_PX = 14

/**
 * The sidebar as a narrow strip: the expand button, then each project with something going on as its badge over one
 * status mark per session, in the sidebar's own order, with Open a project and Settings at the foot. A lead stands for
 * its helpers: while any of them needs you its mark is the needs-you one with how many on its corner. Idle sessions and
 * helpers are the full sidebar's to list; a session with no mark of its own (the one on screen, held where it was
 * picked, or an idle lead whose helpers work) is a dim dot. A mark's hover card and menu are the row's; with no name to type on, Rename
 * asks the window.
 */
export function SidebarRail(props: SidebarProps) {
  const tip = useTipWithKeys()
  const shortcutText = useShortcutText()
  const hover = useHoverController()
  const endHover = () => { hover.leave() }
  const beginHover = (id: string, element: HTMLElement) => { hover.enter(id, () => element.getBoundingClientRect()) }
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const order = sidebarOrder(props.machines, props.projects, NO_FILTER, useHeldRow(props.focusedId, props.sessions))
  const openMenu = (event: MouseEvent | KeyboardEvent, session: SessionView, at: { x: number; y: number }) => {
    event.preventDefault()
    // Some web views also send a right-click for the menu key; the menu the key opened under the mark stays where it is.
    if (menu?.owner === session.id) return
    endHover()
    setMenu({ owner: session.id, title: rowTitle(session), at, items: sessionMenuEntries(props, session, shortcutText('close'), { worktreeHint: shortcutText('new-worktree') }) })
  }
  const item = ({ session, helpers }: SessionNode) => {
    const summary = helperSummary(helpers)
    const asking = summary.needs > 0
    // A helper that asks is the most urgent thing under its lead, whatever the lead itself is doing.
    const shown = asking ? 'needs' : session.status
    const selected = session.id === props.focusedId
    return (
      <div key={session.id} role="listitem">
        <button
          type="button"
          className="mx-rail-session"
          {...{ [SESSION_ROW_ATTRIBUTE]: session.id }}
          aria-label={[rowTitle(session), STATUS_WORD[session.status], ...(summary.count > 0 ? [summarySpoken(summary)] : [])].join(' · ')}
          aria-current={selected ? 'page' : undefined}
          onClick={() => { endHover(); props.onShowSession(session.id) }}
          onContextMenu={(event) => { openMenu(event, session, { x: event.clientX, y: event.clientY }) }}
          onKeyDown={(event) => {
            if (event.key === 'F2') {
              event.preventDefault()
              endHover()
              props.onRenameSession(session.id)
            } else if (isMenuKey(event)) {
              const box = event.currentTarget.getBoundingClientRect()
              openMenu(event, session, { x: box.left, y: box.bottom + MENU_GAP_PX })
            }
          }}
          onPointerEnter={(event) => { beginHover(session.id, event.currentTarget); props.onHoverSession?.(session.id) }}
          onPointerLeave={() => { endHover(); props.onHoverSession?.(null) }}
          onFocus={(event) => { beginHover(session.id, event.currentTarget); props.onHoverSession?.(session.id) }}
          onBlur={() => { endHover(); props.onHoverSession?.(null) }}
        >
          {markOf(shown) === 'idle' ? <span className="mx-rail-dot" /> : <StatusIcon status={shown} size={MARK_PX} />}
          {asking && <span className="mx-rail-count">{summary.needs}</span>}
        </button>
      </div>
    )
  }
  return (
    <div className="mx-rail">
      <IconButton label="Expand sidebar" tip={tip('Expand sidebar', 'toggle-sidebar')} onClick={props.onToggleRail}><Icon name="expand" /></IconButton>
      <div className="mx-rail-list mx-no-scrollbar" onScroll={endHover}>
        {order.active.map((group) => (
          <div key={group.key} className="mx-rail-group" role="list" aria-label={group.name}>
            {/* The name is on the badge alone: on the group it would also show over each mark, against its hover card. */}
            <span className="mx-rail-badge" title={group.name}><ProjectBadge name={group.name} /></span>
            {group.rows.map(item)}
          </div>
        ))}
      </div>
      <span className="mx-spacer" />
      <IconButton label="Open a project" tip={tip('Open a project', 'open-folder')} disabled={!props.canStart} onClick={() => { props.onOpenProject(null) }}><FolderPlus strokeWidth={1.9} aria-hidden="true" /></IconButton>
      <IconButton label="Settings" tip={tip('Settings', 'settings')} onClick={props.onOpenSettings}><Icon name="gear" /></IconButton>
      <RowHoverHost controller={hover} sessions={props.sessions} namesMachine={props.machines.some((head) => head.name !== null)} machines={props.machines} portalContainer={props.portalContainer} />
      {menu && <MenuPopup key={`${String(menu.at.x)},${String(menu.at.y)}`} title={menu.title} at={menu.at} items={menu.items} portalContainer={props.portalContainer} onClose={() => { setMenu(null) }} />}
    </div>
  )
}
