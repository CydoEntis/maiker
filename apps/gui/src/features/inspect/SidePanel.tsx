import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Icon } from '@/features/workspace/components/glyphs'
import { MenuPopup, type MenuEntry } from '@/features/workspace/components/MenuPopup'
import type { PanelTab, SurfaceKind } from './panelTabs'
import { clampWidth, DEFAULT_WIDTH_PX, storedWidth } from './panelWidth'
import { surfaceForKey, SURFACES } from './surfaces'
import './inspect.css'

const KEY_STEP_PX = 24
// A new key since a file opens in its own pane and the panel holds lists only; the key before it is read until a width
// is chosen again, to carry over one that still fits.
const WIDTH_KEY = 'maiker.inspect.width.v5'
const EARLIER_WIDTH_KEY = 'maiker.inspect.width.v4'

const BODY_ID = 'mx-side-panel-body'

/** The width someone dragged it to, or null for the default. */
function readWidth(): number | null {
  try {
    return storedWidth(window.localStorage.getItem(WIDTH_KEY), window.localStorage.getItem(EARLIER_WIDTH_KEY))
  } catch {
    return null
  }
}

function writeWidth(width: number | null): void {
  try {
    // From the first drag or reset on, the current key alone says the width.
    window.localStorage.removeItem(EARLIER_WIDTH_KEY)
    if (width === null) window.localStorage.removeItem(WIDTH_KEY)
    else window.localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // The width is only remembered, never needed.
  }
}

/** A tab's id in the document, for the body to say which tab it belongs to. */
function tabElementId(id: string): string {
  return `mx-side-tab-${id.replace(/[^\w-]/g, '-')}`
}

type Props = {
  tabs: readonly PanelTab[]
  /** The id of the tab that shows; null while there is none, and the surface picker shows instead. */
  active: string | null
  /** The surfaces this session can open, in the order they are offered. */
  offered: readonly SurfaceKind[]
  /** What a tab is called: a surface's own name, or which terminal it is. */
  nameOf: (tab: PanelTab) => string
  /** Where the menus mount, so they read the theme's colours. */
  menuRoot: HTMLElement | null
  /** It is sliding out: drawn, but not clicked. */
  leaving?: boolean
  /** It lies over the pane beside it (a file is open there) instead of taking room as a card of its own. */
  floating?: boolean
  /** Opens a surface: the one already open comes forward, and a terminal is a new one each time. */
  onOpen: (kind: SurfaceKind) => void
  /** Brings a tab to the front; `by` says whether it was clicked or reached with the arrow keys. */
  onShow: (id: string, by: 'pointer' | 'keys') => void
  onClose: (id: string) => void
  onCloseOthers: (id: string) => void
  /** Moves a terminal tab to the drawer under the main pane. */
  onPin: (id: string) => void
  onClosePanel: () => void
  /** The body of the tab that shows. */
  children: (tab: PanelTab) => ReactNode
}

/** The rows that open a surface, in the `+` menu and in the empty panel: icon, name, what it is for, and its letter. */
function SurfaceRow({ kind }: { kind: SurfaceKind }) {
  const surface = SURFACES[kind]
  return (
    <>
      <Icon name={surface.icon} size={14} />
      <span className="mx-sp-pick-name">{surface.label}</span>
      <span className="mx-sp-pick-hint">{surface.hint}</span>
      <kbd aria-hidden="true">{surface.key}</kbd>
    </>
  )
}

/** The letter typed with no modifier, as the surface it opens; null for anything else. */
function typedSurface(event: ReactKeyboardEvent, offered: readonly SurfaceKind[]): SurfaceKind | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  return surfaceForKey(event.key, offered)
}

/** The empty panel: every surface it can open, each on its letter while the picker has the keys. */
function SurfacePicker({ offered, onOpen }: { offered: readonly SurfaceKind[]; onOpen: (kind: SurfaceKind) => void }) {
  const picker = useRef<HTMLDivElement>(null)
  // The letters work as soon as the picker shows, so it takes the keys then; it is the whole of an empty panel.
  useEffect(() => { picker.current?.focus({ preventScroll: true }) }, [])
  return (
    <div
      ref={picker}
      className="mx-sp-picker"
      role="group"
      aria-label="Open a surface"
      tabIndex={-1}
      onKeyDown={(event) => {
        const kind = typedSurface(event, offered)
        if (kind === null) return
        event.preventDefault()
        onOpen(kind)
      }}
    >
      <h2 className="mx-sp-picker-title">Open a surface</h2>
      <div className="mx-sp-picks">
        {offered.map((kind) => (
          <button key={kind} type="button" className="mx-sp-pick-row" aria-keyshortcuts={SURFACES[kind].key} onClick={() => { onOpen(kind) }}><SurfaceRow kind={kind} /></button>
        ))}
      </div>
    </div>
  )
}

/**
 * The side panel: a card beside the main pane that holds tabs of surfaces. The tab in front shows its icon, its name and
 * a close; the others their icon alone, so several fit. `+` opens another surface, a right-click on a tab closes it or
 * the others (and pins a terminal to the bottom), and with no tab open the panel offers the surfaces instead.
 */
export function SidePanel({ tabs, active, offered, nameOf, menuRoot, leaving = false, floating = false, onOpen, onShow, onClose, onCloseOthers, onPin, onClosePanel, children }: Props) {
  const [dragged, setDragged] = useState(readWidth)
  const [menu, setMenu] = useState<{ tab: PanelTab; at: { x: number; y: number } } | null>(null)
  const width = dragged ?? DEFAULT_WIDTH_PX
  const save = useCallback((next: number | null) => {
    setDragged(next)
    writeWidth(next)
  }, [])
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const from = event.clientX
    const start = width
    // The panel's inner edge faces the chat: on the window's right it grows leftwards.
    const onRight = document.querySelector('.mx-app')?.getAttribute('data-side') !== 'right'
    const at = (pointer: PointerEvent) => clampWidth(onRight ? start + from - pointer.clientX : start + pointer.clientX - from)
    const move = (pointer: PointerEvent) => { setDragged(at(pointer)) }
    const stop = (pointer: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      save(at(pointer))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const nudge = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') save(clampWidth(width + KEY_STEP_PX))
    else if (event.key === 'ArrowRight') save(clampWidth(width - KEY_STEP_PX))
  }

  const shown = tabs.find((tab) => tab.id === active)
  // The arrows walk the tabs, as a tab list's do; the tab they land on shows and keeps the keys.
  const walk = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0 || tabs.length === 0) return
    event.preventDefault()
    const at = tabs.findIndex((tab) => tab.id === active)
    const next = tabs[(at + step + tabs.length) % tabs.length]
    if (next === undefined) return
    onShow(next.id, 'keys')
    document.getElementById(tabElementId(next.id))?.focus()
  }
  const menuItems = (tab: PanelTab): MenuEntry[] => [
    { label: 'Close', run: () => { onClose(tab.id) } },
    { label: 'Close others', disabled: tabs.length <= 1, run: () => { onCloseOthers(tab.id) } },
    ...(tab.kind === 'terminal' ? ['separator' as const, { label: 'Pin to the bottom', run: () => { onPin(tab.id) } }, { label: 'New terminal', run: () => { onOpen('terminal') } }] : []),
  ]

  return (
    <aside
      className={`mx-inspect${leaving ? ' is-leaving' : ''}${floating ? ' is-floating' : ''}`}
      style={{ width: `min(${String(width)}px, var(--inspect-max))` }}
      aria-label="Side panel"
      inert={leaving}
      onKeyDown={(event) => {
        // Esc closes the panel, except in a terminal, where it belongs to the program running there.
        if (event.key !== 'Escape' || (event.target instanceof Element && event.target.closest('[data-terminal-surface]'))) return
        event.stopPropagation()
        onClosePanel()
      }}
    >
      <div className="mx-inspect-grip" role="separator" aria-orientation="vertical" aria-label="Resize the side panel" title="Drag to resize" tabIndex={0} onPointerDown={startDrag} onKeyDown={nudge} onDoubleClick={() => { save(null) }} />
      <header className="mx-inspect-head">
        <div className="mx-sp-tabs" role="tablist" aria-label="Open surfaces" onKeyDown={walk}>
          {tabs.map((tab) => {
            const on = tab.id === active
            const name = nameOf(tab)
            return (
              <span key={tab.id} className={`mx-sp-tab${on ? ' is-on' : ''}`} onContextMenu={(event) => { event.preventDefault(); setMenu({ tab, at: { x: event.clientX, y: event.clientY } }) }}>
                <button type="button" role="tab" id={tabElementId(tab.id)} className="mx-sp-tab-pick" aria-selected={on} aria-controls={on ? BODY_ID : undefined} aria-label={name} title={name} tabIndex={on ? 0 : -1} onClick={() => { onShow(tab.id, 'pointer') }}>
                  <Icon name={SURFACES[tab.kind].icon} size={14} />
                  {on && <span className="mx-sp-tab-name" aria-hidden="true">{name}</span>}
                </button>
                {on && <button type="button" className="mx-sp-tab-close" aria-label={`Close ${name}`} title="Close tab" onClick={() => { onClose(tab.id) }}><Icon name="close" size={10} /></button>}
              </span>
            )
          })}
        </div>
        {/* With no tab open the picker below already lists the surfaces, so the menu would only repeat it. */}
        {tabs.length > 0 && offered.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Open a surface"><Icon name="plus" /></IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              container={menuRoot}
              side="bottom"
              align="start"
              className="mx-sp-add"
              onKeyDown={(event) => {
                const kind = typedSurface(event, offered)
                if (kind === null) return
                event.preventDefault()
                // The menu closes on a pick; a letter is one, so it is sent as Esc would close it, after the surface opens.
                onOpen(kind)
                event.currentTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
              }}
            >
              {offered.map((kind) => (
                <DropdownMenuItem key={kind} className="mx-sp-pick-row" onSelect={() => { onOpen(kind) }}><SurfaceRow kind={kind} /></DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <span className="mx-spacer" />
        {shown?.kind === 'terminal' && <IconButton label="Pin terminal to the bottom" tip="Pin to the bottom" onClick={() => { onPin(shown.id) }}><Icon name="drawer" /></IconButton>}
        <IconButton label="Close panel" tip="Close (Esc)" onClick={onClosePanel}><Icon name="close" /></IconButton>
      </header>
      {shown === undefined
        ? <SurfacePicker offered={offered} onOpen={onOpen} />
        : <div key={shown.id} id={BODY_ID} className="mx-inspect-scroll" role="tabpanel" aria-labelledby={tabElementId(shown.id)}>{children(shown)}</div>}
      {menu && <MenuPopup key={`${String(menu.at.x)},${String(menu.at.y)}`} title={nameOf(menu.tab)} at={menu.at} items={menuItems(menu.tab)} portalContainer={menuRoot} onClose={() => { setMenu(null) }} />}
    </aside>
  )
}
