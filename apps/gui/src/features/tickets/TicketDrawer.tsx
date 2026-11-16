import { openLink } from '@/api/daemon'
import type { TicketDetail, TicketSummary } from '@/api/tickets'
import { toast } from '@/lib/toast'
import { errorMessage } from '@/lib/error-message'
import { TicketTextSkeleton } from './TicketRows'
import { CATEGORY_LOOK, initials, labelColor, PROVIDER_LOOK, shortAge, ticketKey, type FactoryRun, type Provider } from './model/tickets'

type Props = {
  provider: Provider
  /** The ticket as the list had it, shown at once while the whole one is read. */
  summary: TicketSummary
  detail: TicketDetail | null
  /** Why the whole ticket could not be read, or null. */
  failed: string | null
  /** Where it sits: the project and the group it is in. */
  where: string
  known: ReadonlyMap<string, TicketSummary>
  leaving: boolean
  now: number
  run: FactoryRun | null
  /** Null when there is no chat to send into. */
  onSendHere: (() => void) | null
  onFactory: () => void
  onStart: () => void
  /** Opens the comment dialog; nothing is posted until it is confirmed there. */
  onComment: () => void
  /** Opens the mark-done dialog; nothing is closed until it is confirmed there. */
  onMarkDone: () => void
  onOpenWork: (sessionId: string) => void
  onOpenTicket: (id: string) => void
  onClose: () => void
}

/** Opens an address in the browser, only when it is a web address, and says so when it cannot. */
function openInBrowser(url: string): void {
  if (!/^https?:\/\//.test(url)) return
  openLink(url).catch((error: unknown) => { toast.error(errorMessage(error, 'Could not open the browser')) })
}

/** A link of the ticket as text with ↗; the browser opens it only on a click. */
function LinkLine({ url }: { url: string }) {
  const kind = /\/pull\/\d+/.test(url) ? 'PR' : 'link'
  return (
    <button type="button" className="mx-tk-link" title="Opens in your browser" onClick={() => { openInBrowser(url) }}>
      <span className="mx-tk-dim mx-tk-mono">{kind}</span><span className="mx-tk-link-text">{url}</span><span className="mx-tk-dim">↗</span>
    </button>
  )
}

/**
 * One ticket over the Tickets view, sliding in from the right: its mark, key and place with **Open in … ↗** and ✕; then
 * the title, the facts, what blocks it (red-edged), its description and comments as plain text in a mono box, its links;
 * and at the foot Comment…, Mark done…, Send to this chat, Send to Factory and Start an agent…. Comment and Mark done only open
 * a dialog that shows exactly what will be written; the ticket changes only when that is confirmed.
 */
export function TicketDrawer({ provider, summary, detail, failed, where, known, leaving, now, run, onSendHere, onFactory, onStart, onComment, onMarkDone, onOpenWork, onOpenTicket, onClose }: Props) {
  const key = ticketKey(summary)
  const look = PROVIDER_LOOK[provider]
  const state = CATEGORY_LOOK[summary.category]
  const age = shortAge(summary.updatedAt, now)
  return (
    <aside className={`mx-tk-drawer${leaving ? ' is-leaving' : ''}`} aria-label={`${key} ${summary.title}`}>
      <div className="mx-tk-drawer-head">
        <span className="mx-tk-mark" style={{ color: look.color }}>{look.mark}</span>
        <span className="mx-tk-drawer-key">{key}</span>
        <span className="mx-tk-drawer-where">{where}</span>
        <span className="mx-spacer" />
        {summary.url !== '' && <button type="button" className="mx-tk-outline" title="Opens in your browser" onClick={() => { openInBrowser(summary.url) }}>Open in {look.name} ↗</button>}
        <button type="button" className="mx-tk-x" aria-label="Close (Esc)" onClick={onClose}>✕</button>
      </div>
      <div className="mx-tk-drawer-body">
        <h2 className="mx-tk-drawer-title">{summary.title}</h2>
        <div className="mx-tk-facts">
          <span>State</span><span style={{ color: state.color }}><span className="mx-tk-glyph">{state.glyph}</span>{summary.stateName === '' ? state.word : summary.stateName}</span>
          <span>Assignee</span><span>{summary.assignee ?? 'Unassigned'}</span>
          <span>Labels</span><span className="mx-tk-facts-labels">{summary.labels.length === 0 ? <span className="mx-tk-dim">None</span> : summary.labels.map((label) => <span key={label} className="mx-tk-label is-boxed"><span style={{ background: labelColor(label) }} />{label}</span>)}</span>
          <span>Updated</span><span className="mx-tk-fg2">{age === '' ? 'Unknown' : `${age} ago`}</span>
        </div>
        {detail !== null && detail.blockedBy.length > 0 && (
          <div className="mx-tk-blockers">
            <span className="mx-tk-blockers-head"><span className="mx-tk-glyph mx-tk-danger">✕</span>Blocked by</span>
            {detail.blockedBy.map((id) => {
              const blocker = known.get(id)
              const blockerLook = blocker === undefined ? null : CATEGORY_LOOK[blocker.category]
              return (
                <button key={id} type="button" className="mx-tk-blocker" disabled={blocker === undefined} onClick={() => { onOpenTicket(id) }}>
                  <span className="mx-tk-dim mx-tk-mono">{ticketKey(blocker ?? { id, url: '' })}</span>
                  <span className="mx-tk-blocker-title">{blocker?.title ?? 'Not in the tickets read'}</span>
                  {blockerLook !== null && <span style={{ color: blockerLook.color }}>{blockerLook.word}</span>}
                </button>
              )
            })}
          </div>
        )}
        <div className="mx-tk-section">
          <span className="mx-tk-section-head">Description<span className="mx-tk-section-note"> · written on {look.name}, shown as plain text</span></span>
          {detail === null && failed !== null ? (
            <div className="mx-tk-text">{failed}</div>
          ) : detail === null ? (
            <div role="status" aria-label={`Reading the ticket from ${look.name}`}><TicketTextSkeleton /></div>
          ) : (
            <div className="mx-tk-text">{detail.body.trim() === '' ? 'No description.' : detail.body}</div>
          )}
        </div>
        {detail !== null && detail.links.length > 0 && (
          <div className="mx-tk-section"><span className="mx-tk-section-head">Links</span>{detail.links.map((url) => <LinkLine key={url} url={url} />)}</div>
        )}
        {detail !== null && (
          <div className="mx-tk-section">
            <span className="mx-tk-section-head">Comments · {detail.comments.length}{detail.commentsMore ? '+' : ''}</span>
            {detail.comments.map((comment, index) => (
              <div key={`${comment.createdAt}-${String(index)}`} className="mx-tk-comment">
                <span className="mx-tk-comment-head"><span className="mx-tk-who">{initials(comment.author, null)}</span><b>{comment.author}</b><span className="mx-tk-dim">{shortAge(comment.createdAt, now) === '' ? '' : `${shortAge(comment.createdAt, now)} ago`}</span></span>
                <span className="mx-tk-comment-text">{comment.body}</span>
              </div>
            ))}
            {detail.commentsMore && summary.url !== '' && <button type="button" className="mx-tk-more" onClick={() => { openInBrowser(summary.url) }}>The rest are on {look.name} ↗</button>}
          </div>
        )}
      </div>
      <div className="mx-tk-drawer-foot">
        {run !== null && <button type="button" className="mx-tk-button" onClick={() => { onOpenWork(run.sessionId) }}>In Factory · {run.step} · Open Work ›</button>}
        <span className="mx-tk-foot-note">Maitty changes a ticket only to add a comment or mark it done, and only after you confirm what it writes.</span>
        <button type="button" className="mx-tk-button" onClick={onComment}>Comment…</button>
        <button type="button" className="mx-tk-button" disabled={summary.category === 'Closed'} title={summary.category === 'Closed' ? 'Already done' : undefined} onClick={onMarkDone}>Mark done…</button>
        <button type="button" className="mx-tk-button" disabled={onSendHere === null || detail === null} title={onSendHere === null ? 'Open a chat first' : undefined} onClick={() => { onSendHere?.() }}>Send to this chat</button>
        <button type="button" className="mx-tk-button" onClick={onFactory}>Send to Factory</button>
        <button type="button" className="mx-tk-button is-primary" disabled={detail === null} onClick={onStart}>Start an agent…<kbd>S</kbd></button>
      </div>
    </aside>
  )
}
