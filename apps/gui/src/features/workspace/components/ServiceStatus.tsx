import { useState } from 'react'
import { CopyDetails, FeedbackButton, ScopedAlert } from '@/components/ui/feedback'
import { StatusIcon } from '@/components/ui/status-icon'
import { APP_NAME } from '@/brand'
import { copyText } from '@/lib/clipboard'
import { useNow } from '@/lib/clock'
import type { ServiceStage } from '../model/serviceState'
import type { AppBehindOffer, RestartOffer } from './states'

const SECOND_MS = 1000

/** The number of whole seconds left until `at`, never below one while a try is still to come. */
function secondsUntil(at: number | null, now: number): number | null {
  return at === null ? null : Math.max(1, Math.ceil((at - now) / SECOND_MS))
}

const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`

/** What a restart keeps and what it stops, one line each, from the daemon's own counts. A line with a count of 0 is left out. */
function restartFacts(restart: RestartOffer): Array<{ tone: 'ok' | 'caution' | 'dim'; mark: string; text: string }> {
  if (restart.sessions === 0) return []
  if (!restart.canRestart) return [{ tone: 'caution', mark: '▲', text: `The older service owns ${plural(restart.sessions, 'session', 'sessions')} but is not saving them, so ${APP_NAME} leaves it running.` }]
  return [
    { tone: 'ok', mark: '✓', text: `${plural(restart.sessions, 'session reopens', 'sessions reopen')} in the same folders` },
    ...(restart.working > 0 ? [{ tone: 'caution' as const, mark: '▲', text: restart.working === 1 ? '1 agent was working. It will offer Resume.' : `${String(restart.working)} agents were working. They will offer Resume.` }] : []),
    { tone: 'dim', mark: '–', text: 'Running shells and commands stop' },
  ]
}

/** The service runs an older protocol: what a restart keeps and stops. The restart asks for a second click, as it stops shells. */
function ServiceUpdateAlert({ restart, onLater }: { restart: RestartOffer | null; onLater: () => void }) {
  const [armed, setArmed] = useState(false)
  const facts = restart ? restartFacts(restart) : []
  return (
    <ScopedAlert
      scope="window"
      tone="caution"
      title={`Restart ${APP_NAME} to finish updating`}
      reason="The app updated, but the service behind it is still the older one."
      onEscape={onLater}
      actions={(
        <>
          {restart && (
            <FeedbackButton kind="primary" large disabled={!restart.canRestart || restart.pending} onClick={() => {
              if (!armed) {
                setArmed(true)
                return
              }
              setArmed(false)
              restart.onRestart()
            }}>
              {restart.pending ? 'Restarting…' : armed ? 'Click again to restart' : restart.label}
            </FeedbackButton>
          )}
          <FeedbackButton large onClick={onLater}>Later</FeedbackButton>
          {restart && <span className="mx-alert-count">protocol {restart.from} → {restart.to}</span>}
        </>
      )}
    >
      {facts.length > 0 && (
        <ul className="mx-alert-facts">
          {facts.map((fact) => <li key={fact.text} className={`is-${fact.tone}`}><b aria-hidden="true">{fact.mark}</b><span>{fact.text}</span></li>)}
        </ul>
      )}
    </ScopedAlert>
  )
}

/** The service is newer than this app, so reconnecting needs the app updated. The sessions are untouched. */
function AppBehindAlert({ offer, sessions, onLater }: { offer: AppBehindOffer; sessions: number; onLater: () => void }) {
  return (
    <ScopedAlert
      scope="window"
      tone="caution"
      title={`Update ${APP_NAME} to reconnect`}
      reason={`The service behind this app is newer than the app.${sessions > 0 ? ` Your ${plural(sessions, 'session', 'sessions')} keep running.` : ''}`}
      onEscape={onLater}
      actions={(
        <>
          <FeedbackButton kind="primary" large disabled={offer.disabled} onClick={offer.onPress}>{offer.label}</FeedbackButton>
          <FeedbackButton large onClick={onLater}>Later</FeedbackButton>
          <span className="mx-alert-count">protocol {offer.appProtocol} → {offer.serviceProtocol}</span>
        </>
      )}
    />
  )
}

/** The window's one dialog while its service cannot be reached: Start service, Not now, Copy details, and when it tries next. */
function OfflineAlert({ retryAt, detail, onStart, onNotNow }: { retryAt: number | null; detail: string; onStart: () => Promise<unknown>; onNotNow: () => void }) {
  const seconds = secondsUntil(retryAt, useNow())
  const [starting, setStarting] = useState(false)
  return (
    <ScopedAlert
      scope="window"
      tone="error"
      title={`${APP_NAME} can’t reach its background service`}
      reason="Nothing works until it is back, but your chats are safe and will reconnect on their own. If it stays like this, start the service again."
      onEscape={onNotNow}
      actions={(
        <>
          <FeedbackButton kind="primary" large disabled={starting} onClick={() => {
            setStarting(true)
            void onStart().finally(() => { setStarting(false) })
          }}>
            {starting ? <><StatusIcon status="working" size={12} />Starting…</> : 'Start service'}
          </FeedbackButton>
          <FeedbackButton large onClick={onNotNow}>Not now</FeedbackButton>
          <CopyDetails large text={detail} copy={copyText} />
          {seconds !== null && <span className="mx-alert-count" aria-live="off">Trying again in {seconds}s</span>}
        </>
      )}
    />
  )
}

/**
 * What covers the window while its service is out of reach or on another protocol (docs/DESIGN.md, Errors → Service
 * offline): one dialog over everything under the title bar, until the service is back or you choose Not now (then the
 * title bar's chip, `ServiceChip`, reopens it). Nothing for a blip, which only the chip says.
 */
export function ServiceStatus({ stage, putOff, onPutOff, mismatch, retryAt, detail, restart, appBehind, sessions, onStart }: {
  stage: ServiceStage
  putOff: boolean
  onPutOff: () => void
  mismatch: boolean
  retryAt: number | null
  /** The raw words of the failure, for Copy details. */
  detail: string
  restart: RestartOffer | null
  /** Set when the service is newer than this app; replaces the restart dialog with an update one. */
  appBehind: AppBehindOffer | null
  /** The sessions this window last knew of, for "your N sessions keep running". */
  sessions: number
  /** Tries to reach the service again now. The window's connection starts the service when it is not running, so this is also how it is started. */
  onStart: () => Promise<unknown>
}) {
  if (putOff) return null
  if (mismatch) return appBehind ? <AppBehindAlert offer={appBehind} sessions={sessions} onLater={onPutOff} /> : <ServiceUpdateAlert restart={restart} onLater={onPutOff} />
  if (stage === 'found') return <ScopedAlert scope="window" tone="ok" running title="Reconnecting…" reason="Found the service. Picking your chats back up." />
  if (stage === 'offline') return <OfflineAlert retryAt={retryAt} detail={detail} onStart={onStart} onNotNow={onPutOff} />
  return null
}

/**
 * The title bar's word on the service, only while something is wrong: "Reconnecting…" through a blip; once the dialog was
 * put off, a red "Offline" (or "Restart needed" for another protocol) that opens it again.
 */
export function ServiceChip({ stage, putOff, mismatch, appBehind, onReopen }: { stage: ServiceStage; putOff: boolean; mismatch: boolean; appBehind: boolean; onReopen: () => void }) {
  if (mismatch && putOff) {
    return <button type="button" className="mx-svc-chip is-caution" onClick={onReopen}><b aria-hidden="true">▲</b>{appBehind ? 'Update needed' : 'Restart needed'}</button>
  }
  if (stage === 'blip' || (stage === 'found' && putOff)) {
    return <span className={`mx-svc-chip${stage === 'found' ? ' is-found' : ''}`} role="status"><StatusIcon status="working" size={11} />Reconnecting…</span>
  }
  if (stage === 'offline' && putOff) {
    return <button type="button" className="mx-svc-chip is-offline" aria-label={`Offline: ${APP_NAME} can’t reach its background service. Show what to do`} onClick={onReopen}><b aria-hidden="true">×</b>Offline</button>
  }
  return null
}
