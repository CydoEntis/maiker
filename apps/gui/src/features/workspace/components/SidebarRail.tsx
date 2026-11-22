import { useState } from 'react'
import { StatusIcon } from '@/components/ui/status-icon'
import { useShortcutText, useTipWithKeys } from '@/features/shortcuts/platform'
import { STATUS_WORD, type SessionView } from '../model/session'
import { rowTitle, sectionOf } from '../model/sidebar'
import { sessionsInOrder, sidebarOrder } from '../model/sidebarTree'
import { Icon } from './glyphs'
import { MenuPopup, type MenuEntry } from './MenuPopup'
import { RowHoverHost } from './RowHoverHost'
import type { SidebarProps } from './Sidebar'
import { sessionMenuEntries } from './sessionMenu'
import { useHoverController } from './useHoverController'

type OpenMenu = { title: string; at: { x: number; y: number }; items: MenuEntry[] }

/**
 * The slim strip of a narrow window: the sidebar toggle, Open a project and Search, then one status mark per session in
 * the sidebar's own order (the projects with something going on, a hairline, then the idle ones), with Remote machine and
 * Settings at the foot. A session's hover card and right-click menu are the expanded row's.
 */
export function SidebarRail(props: SidebarProps) {
  const tip = useTipWithKeys()
  const shortcutText = useShortcutText()
  const hover = useHoverController()
  const endHover = () => { hover.leave() }
  const beginHover = (id: string, element: HTMLElement) => { hover.enter(id, () => element.getBoundingClientRect()) }
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const order = sidebarOrder(props.machines, props.projects)
  const active = sessionsInOrder(order.active)
  const idle = sessionsInOrder(order.idle)
  const item = (session: SessionView) => (
    <div key={session.id} role="listitem" className={`mx-rail-item${session.id === props.focusedId ? ' is-selected' : ''}${sectionOf(session) === 'idle' ? ' is-idle' : ''}`}>
      <span className="mx-rail-bar" aria-hidden="true" />
      <button
        type="button"
        className="mx-rail-session"
        aria-label={`${rowTitle(session)} · ${STATUS_WORD[session.status]}`}
        aria-current={session.id === props.focusedId ? 'page' : undefined}
        onClick={() => { endHover(); props.onShowSession(session.id) }}
        onContextMenu={(event) => { event.preventDefault(); endHover(); setMenu({ title: rowTitle(session), at: { x: event.clientX, y: event.clientY }, items: sessionMenuEntries(props, session, shortcutText('close')) }) }}
        onPointerEnter={(event) => { beginHover(session.id, event.currentTarget); props.onHoverSession?.(session.id) }}
        onPointerLeave={() => { endHover(); props.onHoverSession?.(null) }}
        onFocus={(event) => { beginHover(session.id, event.currentTarget); props.onHoverSession?.(session.id) }}
        onBlur={() => { endHover(); props.onHoverSession?.(null) }}
      >
        <StatusIcon status={session.status} />
      </button>
    </div>
  )
  return (
    <div className="mx-rail">
      <div className="mx-rail-top">
        <button type="button" className="mx-head-button is-rail" aria-label="Expand sidebar" title={tip('Expand sidebar', 'toggle-sidebar')} onClick={props.onToggleRail}><Icon name="expand" /></button>
        <button type="button" className="mx-head-button is-rail" aria-label="Open a project" title={tip('Open a project', 'open-folder')} disabled={!props.canStart} onClick={() => { props.onOpenProject(null) }}><Icon name="plus" size={15} /></button>
        <button type="button" className="mx-head-button is-rail" aria-label="Search" title={tip('Search', 'palette')} onClick={props.onSearch}><Icon name="search" size={15} /></button>
      </div>
      <div className="mx-rail-rule" aria-hidden="true" />
      <div className="mx-rail-list mx-no-scrollbar" role="list" aria-label="Sessions">
        {active.map(item)}
        {active.length > 0 && idle.length > 0 && <div role="separator" aria-label={`Idle · ${String(idle.length)}`} className="mx-rail-sep" />}
        {idle.map(item)}
      </div>
      <div className="mx-rail-bottom">
        <button type="button" className="mx-head-button is-rail" aria-label="Add a remote machine" title="Add a remote machine" onClick={props.onAddMachine}><Icon name="serverPlus" size={15} /></button>
        <button type="button" className="mx-head-button is-rail" aria-label="Settings" title={tip('Settings', 'settings')} onClick={props.onOpenSettings}><Icon name="gear" /></button>
      </div>
      <RowHoverHost controller={hover} sessions={props.sessions} namesMachine={props.machines.some((head) => head.name !== null)} portalContainer={props.portalContainer} />
      {menu && <MenuPopup key={`${String(menu.at.x)},${String(menu.at.y)}`} title={menu.title} at={menu.at} items={menu.items} portalContainer={props.portalContainer} onClose={() => { setMenu(null) }} />}
    </div>
  )
}
