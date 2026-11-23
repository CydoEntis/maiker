import { memo, type CSSProperties, type ReactNode } from 'react'
import { WindowPortal } from '@/components/ui/portal'
import { StatusIcon } from '@/components/ui/status-icon'
import { useNow } from '@/lib/clock'
import type { SessionView } from '../model/session'
import { hoverCardText, lastActiveWords, type CardPlace, type HoverRow, type HoverRowKind } from '../model/hoverCard'
import { projectColor, projectOf, rowTitle } from '../model/sidebar'
import { type HelperCount } from '../model/helpers'
import type { MachineHead } from '../model/machines'
import { AppIcon, Icon } from './glyphs'

type Props = { session: SessionView; namesMachine: boolean; machine: MachineHead | null; starter: string | null; helpers: HelperCount | null; place: CardPlace; open: boolean; cold: boolean; portalContainer: HTMLElement | null }

const ICON_PX = 13
const MARK_PX = 14

/** What a screen reader hears before a row whose text does not say what it is. */
const SPOKEN: Partial<Record<HoverRowKind, string>> = { place: 'Folder', branch: 'Branch', machine: 'Machine', agent: 'Agent' }

/** A row's small mark: the agent's own, else a plain line drawing. */
function rowIcon(row: HoverRow, session: SessionView): ReactNode {
  switch (row.kind) {
    case 'starter': case 'helpers': return <Icon name="helpers" size={ICON_PX} />
    case 'place': return <Icon name="folderPlain" size={ICON_PX} />
    case 'branch': return <Icon name="branch" size={ICON_PX} strokeWidth={1.9} stroke="currentColor" />
    case 'machine': return <Icon name={session.machineName === null ? 'monitor' : 'server'} size={ICON_PX} />
    case 'agent': return <AppIcon process={session.process} size={MARK_PX} />
    case 'active': return <Icon name="clock" size={ICON_PX} />
  }
}

/** "Last active 3m ago", following the shared second clock while the card is up. */
function LastActive({ at }: { at: number }) {
  return <>{lastActiveWords(useNow() - at)}</>
}

/**
 * The card beside a sidebar row the pointer rests on: the session's name, its state and what it is doing, then where
 * and how it runs, and how full its context is. It only tells; it takes no pointer input, so it can never be in the way
 * of the next row.
 */
function RowHoverCardView({ session, namesMachine, machine, starter, helpers, place, open, cold, portalContainer }: Props) {
  // The place is known before the first draw (worked out from the row), so the card is never drawn hidden, measured and moved.
  const text = hoverCardText(session, { title: rowTitle(session), namesMachine, machine, starter, helpers })
  return (
    <WindowPortal container={portalContainer}>
    <div role="tooltip" className={`mx-hover-card${cold ? ' is-cold' : ''}`} data-float data-open={open} style={place satisfies CSSProperties}>
      <b className="mx-hover-title">{text.title}</b>
      <div className={`mx-hover-state is-${text.state}`}>
        <StatusIcon status={session.status} size={MARK_PX} className="mx-hover-status" />
        <span className="mx-hover-word">{text.word}</span>
        {text.activity !== null && <span className="mx-hover-activity">{text.activity}</span>}
      </div>
      <div className="mx-hover-rows">
        {text.rows.map((row) => (
          <div key={row.kind} className="mx-hover-row">
            {/* An agent's folder takes its project's colour, as the project's badge does; a shell's has no project. */}
            <span className="mx-hover-row-icon" aria-hidden="true" style={row.kind === 'place' && row.mono !== true ? { color: projectColor(projectOf(session)) } : undefined}>{rowIcon(row, session)}</span>
            {SPOKEN[row.kind] !== undefined && <span className="sr-only">{SPOKEN[row.kind]}</span>}
            {row.kind === 'active'
              ? <span className="mx-hover-value"><LastActive at={row.at} /></span>
              : (
                <>
                  <span className={`mx-hover-value${row.mono === true ? ' is-mono' : ''}${row.tone === undefined ? '' : ` is-${row.tone}`}`}>{row.text}</span>
                  {row.detail !== undefined && <span className="mx-hover-detail">{row.detail}</span>}
                </>
              )}
          </div>
        ))}
      </div>
      {text.context !== null && (
        <div className="mx-hover-context">
          <span>Context</span>
          <span className={`mx-hover-bar${text.context.hot ? ' is-hot' : ''}`} aria-hidden="true"><i style={{ width: `${String(text.context.percent)}%` }} /></span>
          <span className="mx-hover-percent">{text.context.percent}%</span>
        </div>
      )}
    </div>
    </WindowPortal>
  )
}

export const RowHoverCard = memo(RowHoverCardView)
