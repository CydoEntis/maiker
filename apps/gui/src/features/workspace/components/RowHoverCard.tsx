import { memo, type CSSProperties, type ReactNode } from 'react'
import { WindowPortal } from '@/components/ui/portal'
import { StatusIcon } from '@/components/ui/status-icon'
import type { SessionView } from '../model/session'
import { hoverCardText, type CardPlace } from '../model/hoverCard'
import { rowTitle } from '../model/sidebar'
import { type HelperCount } from '../model/helpers'
import { AppIcon, Icon, type IconName } from './glyphs'
import { Ago } from './times'

type Props = { session: SessionView; starter: string | null; helpers: HelperCount | null; place: CardPlace; open: boolean; cold: boolean; portalContainer: HTMLElement | null }

/** One line of the card: its icon hangs in the margin left of the text, and a screen reader hears what it is. */
function CardRow({ icon, what, children }: { icon: IconName; what: string; children: ReactNode }) {
  return (
    <div className="mx-hover-row">
      <span className="mx-hover-row-icon" aria-hidden="true"><Icon name={icon} size={13} /></span>
      <span className="sr-only">{what}</span>
      {children}
    </div>
  )
}

/**
 * The card beside a sidebar row the pointer rests on: what the session is doing, then its folder, branch, changes and
 * pull request, and who runs it and when it last moved. It only tells; it takes no pointer input, so it can never be
 * in the way of the next row.
 */
function RowHoverCardView({ session, starter, helpers, place, open, cold, portalContainer }: Props) {
  // The place is known before the first draw (worked out from the row), so the card is never drawn hidden, measured and moved.
  const text = hoverCardText(session, rowTitle(session), starter, helpers)
  return (
    <WindowPortal container={portalContainer}>
    <div role="tooltip" className={`mx-hover-card${cold ? ' is-cold' : ''}`} data-float data-open={open} style={place satisfies CSSProperties}>
      <div className="mx-hover-head">
        <StatusIcon status={session.status} className="mx-hover-status" />
        <span className="mx-hover-head-text">
          <b>{text.title}</b>
          <span className={`mx-hover-activity${text.activity === null ? ' is-word' : ''}`}>{text.activity ?? text.word}</span>
        </span>
      </div>
      <div className="mx-hover-rows">
        <CardRow icon={session.worktree ? 'folderLocked' : 'folderPlain'} what="Folder"><span className={text.folder.mono ? 'is-mono' : ''}>{text.folder.text}</span></CardRow>
        {text.branch !== null && (
          <CardRow icon="branch" what="Branch">
            <span className="is-mono">{text.branch}</span>
            {text.folder.ownWorktree && <span className="mx-hover-tag">own worktree</span>}
          </CardRow>
        )}
        {text.changes !== null && (
          <CardRow icon="diffStat" what="Changes">
            <span className="is-add is-mono">+{text.changes.added}</span>
            <span className="is-del is-mono">−{text.changes.removed}</span>
          </CardRow>
        )}
        {text.startedBy !== null && <CardRow icon="arrowUpRight" what="Started by"><span>Started by {text.startedBy}</span></CardRow>}
        {text.helpers !== null && <CardRow icon="list" what="Helpers"><span className={text.helpers.needs ? 'is-needs' : ''}>{text.helpers.text}</span></CardRow>}
        {text.pr !== null && (
          <CardRow icon="pullRequest" what="Pull request">
            <span className="is-mono">{text.pr.number}</span>
            <span className={`is-pr-${text.pr.tone}`}>{text.pr.state}</span>
          </CardRow>
        )}
      </div>
      <div className="mx-hover-foot">
        <AppIcon process={session.process} size={14} />
        <span className="mx-hover-who">{text.who}</span>
        <span className="mx-spacer" />
        {session.statusSince !== null && <span className="mx-hover-when"><Ago at={session.statusSince} /> ago</span>}
      </div>
    </div>
    </WindowPortal>
  )
}

export const RowHoverCard = memo(RowHoverCardView)
