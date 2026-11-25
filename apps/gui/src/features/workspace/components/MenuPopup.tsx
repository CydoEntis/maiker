import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { EDGE_PX } from './menuPoint'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

/** A row that can be chosen. */
export type MenuItem = {
  label: string
  /** A mark before the label (an agent's, a terminal's). */
  icon?: ReactNode
  /** A key or a word shown dim at the right. */
  hint?: string
  /** A key that chooses this row while the menu is open (`1` to `9` for the agents of a New session list). */
  pick?: string
  run?: () => void
  /** Red. */
  danger?: boolean
  disabled?: boolean
  /** Why it is disabled, as its tooltip. */
  why?: string
  /** The rows of a menu this row opens beside it (`Switch to…`'s projects); such a row runs nothing of its own. */
  items?: readonly MenuItem[]
}

/** One row of a menu, a separator line between groups of rows, or a dim heading over a group. */
export type MenuEntry = 'separator' | { heading: string } | MenuItem

type Props = {
  /** What the menu is for (a session's name, a machine), read out to a screen reader. */
  title: string
  at: { x: number; y: number }
  items: readonly MenuEntry[]
  /** A line over the rows saying where the menu acts (`In shop · This computer`), with its mark. */
  context?: ReactNode
  /** Where the menu mounts, so it reads the theme's colours. */
  portalContainer: HTMLElement | null
  onClose: () => void
}

/** The first item takes focus, as a menu opened from the keyboard does, whichever way this one was opened. */
function focusFirstItem(menu: HTMLDivElement | null): void {
  if (menu === null) return
  queueMicrotask(() => { menu.querySelector<HTMLElement>('[data-radix-collection-item]:not([data-disabled])')?.focus() })
}

const isItem = (entry: MenuEntry): entry is MenuItem => entry !== 'separator' && !('heading' in entry)

/**
 * A right-click or button menu, opened at a point. It is the shared dropdown menu anchored to an empty point:
 * Radix keeps it inside the window, puts focus on the first item, moves with the arrows, closes on Esc or a
 * click outside, and focus returns to where it was.
 */
export function MenuPopup({ title, at, items, context, portalContainer, onClose }: Props) {
  const returnTo = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const choose = (entry: MenuItem) => {
    onClose()
    entry.run?.()
  }
  const pickByKey = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const picked = items.filter(isItem).find((entry) => entry.pick === event.key && entry.disabled !== true)
    if (picked === undefined) return
    event.preventDefault()
    choose(picked)
  }
  return (
    <DropdownMenu open modal={false} onOpenChange={(open) => { if (!open) onClose() }}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden="true" style={{ position: 'fixed', left: at.x, top: at.y, width: 0, height: 0, pointerEvents: 'none' }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        container={portalContainer}
        aria-label={title}
        aria-labelledby={undefined}
        loop
        side="bottom"
        align="start"
        sideOffset={0}
        collisionPadding={EDGE_PX}
        className={`mx-ctx${context === undefined ? '' : ' has-context'}`}
        style={{ position: 'static' }}
        ref={focusFirstItem}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnTo.current?.isConnected === true) returnTo.current.focus()
        }}
        onContextMenu={(event) => { event.preventDefault() }}
        onKeyDown={pickByKey}
      >
        {context !== undefined && <div className="mx-ctx-context">{context}</div>}
        {items.map((entry, index) => entry === 'separator'
          ? <DropdownMenuSeparator key={`sep-${String(index)}`} className="mx-ctx-sep" />
          : !isItem(entry)
            ? <DropdownMenuLabel key={`head-${entry.heading}`} className="mx-ctx-heading">{entry.heading}</DropdownMenuLabel>
            : entry.items === undefined
              ? <Row key={entry.label} entry={entry} onChoose={choose} />
              : (
              <DropdownMenuSub key={entry.label}>
                <DropdownMenuSubTrigger className="mx-ctx-item" disabled={entry.disabled === true} title={entry.disabled === true ? entry.why : undefined}>
                  <RowText entry={entry} />
                </DropdownMenuSubTrigger>
                {/* In the app root as the menu is, so it reads the theme and no scrolling menu clips it. */}
                <DropdownMenuPortal container={portalContainer ?? document.querySelector<HTMLElement>('.mx-app')}>
                  <DropdownMenuSubContent className="mx-ctx" style={{ position: 'static' }} collisionPadding={EDGE_PX} onContextMenu={(event) => { event.preventDefault() }}>
                    {entry.items.map((item, at) => <Row key={`${item.label}-${String(at)}`} entry={item} onChoose={choose} />)}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A row's mark, label and key. */
function RowText({ entry }: { entry: MenuItem }) {
  return (
    <>
      {entry.icon !== undefined && <span className="mx-ctx-icon" aria-hidden="true">{entry.icon}</span>}
      <span className="mx-ctx-label">{entry.label}</span>
      {entry.hint !== undefined && <span className="mx-ctx-hint" aria-hidden="true">{entry.hint}</span>}
    </>
  )
}

/** A row that runs when chosen. */
function Row({ entry, onChoose }: { entry: MenuItem; onChoose: (entry: MenuItem) => void }) {
  return (
    <DropdownMenuItem
      className={`mx-ctx-item${entry.danger === true ? ' is-danger' : ''}`}
      disabled={entry.disabled === true}
      title={entry.disabled === true ? entry.why : undefined}
      onSelect={() => { onChoose(entry) }}
    >
      <RowText entry={entry} />
    </DropdownMenuItem>
  )
}
