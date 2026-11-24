import { HoverCard } from 'radix-ui'
import { StatusIcon } from '@/components/ui/status-icon'
import { Icon } from '@/features/workspace/components/glyphs'
import { noteLines } from './noteLines'
import { DownloadProgress } from './DownloadProgress'
import { percentOf } from './downloadEta'
import type { UpdaterState } from './useUpdater'
import { copyText } from '@/lib/clipboard'

const CARD_GAP_PX = 8
const CARD_EDGE_PX = 12
const CARD_OPEN_DELAY_MS = 120
const CARD_CLOSE_DELAY_MS = 120
/** The running light in the button while the update downloads: the live box's own size. */
const LIGHT_SIZE_PX = 12

type Props = {
  state: UpdaterState
  /** The running version, named on the card. It is never shown in the sidebar itself: the version lives in Settings. */
  version: string | null
  /** A release the user chose to skip: it gets no button. */
  skipped: string | null
  portalContainer: HTMLElement | null
  onInstall: () => void
  onRestartNow: () => void
  onCheck: () => void
  onSkip: (version: string) => void
}

type Offer = Exclude<UpdaterState, { status: 'idle' | 'checking' | 'current' }>

function offerOf(state: UpdaterState, skipped: string | null): Offer | null {
  if (state.status === 'available') return state.version === skipped ? null : state
  // A failed check is not something you started, so it gets no button; Settings still says so.
  if (state.status === 'failed') return state.during === 'update' ? state : null
  if (state.status === 'downloading' || state.status === 'ready') return state
  return null
}

const vee = (version: string) => `v${version.replace(/^v/, '')}`

/**
 * The status bar's update button (design: Update button): a download icon with an accent dot, then a running light while
 * the update comes down, then a restart icon once it needs one. A card beside it says what is ready and what is new; the
 * click does the next step. With nothing to do it draws nothing, because the version number lives only in Settings.
 */
export function UpdateSlot({ state, version, skipped, portalContainer, onInstall, onRestartNow, onCheck, onSkip }: Props) {
  const offer = offerOf(state, skipped)
  if (!offer) return null

  const percent = offer.status === 'downloading' ? percentOf(offer.progress) : null
  const label = offer.status === 'available' ? `Update to ${offer.version}`
    : offer.status === 'downloading' ? (percent === null ? 'Downloading…' : `${String(percent)}%`)
    : offer.status === 'ready' ? 'Restart to update'
    : 'Update failed'
  const click = offer.status === 'available' ? onInstall : offer.status === 'ready' ? onRestartNow : offer.status === 'failed' ? onCheck : undefined
  const icon = offer.status === 'downloading'
    ? <StatusIcon status="working" size={LIGHT_SIZE_PX} />
    : offer.status === 'ready' ? <Icon name="restart" />
    : <Icon name="download" />

  const cardBody = (() => {
    switch (offer.status) {
      case 'available': {
        const lines = noteLines(offer.notes)
        return (
          <>
            <div className="mx-upd-head">
              <span className="mx-upd-title">Update ready</span>
              <span className="mx-upd-versions">{version === null ? '' : <>{vee(version)} <span className="mx-upd-arrow">→</span> </>}<span className="mx-upd-new">{vee(offer.version)}</span></span>
            </div>
            {lines.length > 0 && (
              <div className="mx-upd-log">
                <span className="mx-upd-log-title">What’s new</span>
                {lines.map((line) => <div key={line} className="mx-upd-line"><span aria-hidden="true">–</span><span>{line}</span></div>)}
              </div>
            )}
            <div className="mx-upd-foot">
              <span>Click to download · installs on restart</span>
              <button type="button" className="mx-upd-skip" onClick={() => { onSkip(offer.version) }}>Skip this version</button>
            </div>
          </>
        )
      }
      case 'downloading':
        return (
          <>
            <div className="mx-upd-head"><span className="mx-upd-title">Updating…</span><span className="mx-upd-versions"><span className="mx-upd-new">{vee(offer.version)}</span></span></div>
            <div className="mx-upd-log"><DownloadProgress progress={offer.progress} transfer={offer.transfer} /></div>
          </>
        )
      case 'ready':
        return (
          <>
            <div className="mx-upd-head"><span className="mx-upd-title">Restart to finish</span><span className="mx-upd-versions"><span className="mx-upd-new">{vee(offer.version)}</span></span></div>
            <div className="mx-upd-foot"><span>Click to restart · sessions are saved, a turn in progress stops</span></div>
          </>
        )
      case 'failed':
        return (
          <>
            <div className="mx-upd-head"><span className="mx-upd-title">Update failed</span></div>
            <div className="mx-upd-log"><p className="mx-upd-error">{offer.message}</p></div>
            <div className="mx-upd-foot">
              <span>Click to retry</span>
              <button type="button" className="mx-upd-skip" onClick={() => { void copyText(offer.message) }}>Copy details</button>
            </div>
          </>
        )
    }
  })()

  // The card is for the pointer. What it holds that a keyboard or screen reader needs is also here, in the button's own
  // description and in two buttons that appear on focus, because a hover card cannot take focus.
  const description = offer.status === 'failed' ? offer.message : offer.status === 'available' ? noteLines(offer.notes).join('. ') : ''
  const describedBy = description === '' ? undefined : 'mx-upd-description'
  const keyAction = offer.status === 'available'
    ? <button type="button" className="mx-upd-keyonly" onClick={() => { onSkip(offer.version) }}>{`Skip version ${offer.version}`}</button>
    : offer.status === 'failed'
      ? <button type="button" className="mx-upd-keyonly" onClick={() => { void copyText(offer.message) }}>Copy update error details</button>
      : null

  return (
    <>
    <HoverCard.Root openDelay={CARD_OPEN_DELAY_MS} closeDelay={CARD_CLOSE_DELAY_MS}>
      <HoverCard.Trigger asChild>
        <button
          type="button"
          className={`mx-upd-button is-${offer.status}`}
          aria-label={label}
          aria-describedby={describedBy}
          {...(click === undefined ? { 'aria-disabled': true } : { onClick: click })}
        >
          {icon}
          <span className="mx-upd-label">{label}</span>
          {offer.status === 'available' && <span className="mx-upd-dot" aria-hidden="true" />}
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal container={portalContainer}>
        <HoverCard.Content side="top" align={portalContainer?.dataset.side === 'right' ? 'end' : 'start'} sideOffset={CARD_GAP_PX} collisionPadding={CARD_EDGE_PX} className="mx-upd-card" data-float>
          {cardBody}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
    {describedBy !== undefined && <span id={describedBy} className="sr-only">{description}</span>}
    {keyAction}
    </>
  )
}
