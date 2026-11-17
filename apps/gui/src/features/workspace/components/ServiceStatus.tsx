import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { RECONNECT_TRIES, serviceStateOf, tryNumber } from '../model/serviceState'
import { OfflineBanner, type AppBehindOffer, type RestartOffer } from './states'
import { DAEMON_NAME } from '@/brand'

const SECOND_MS = 1000

/** The number of whole seconds left until `at`, never below one while a try is still to come. */
function secondsUntil(at: number | null, now: number): number | null {
  return at === null ? null : Math.max(1, Math.ceil((at - now) / SECOND_MS))
}

/** Re-renders each second so a countdown ticks. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, SECOND_MS)
    return () => { window.clearInterval(timer) }
  }, [])
  return now
}

/** Under the pane header while the daemon does not answer and more tries are coming. */
function ReconnectingBar({ failures, retryAt, onRetry }: { failures: number; retryAt: number | null; onRetry: () => void }) {
  const seconds = secondsUntil(retryAt, useNow())
  return (
    <div className="mx-offline" role="status">
      <span className="mx-offline-dot" aria-hidden="true" />
      <span className="mx-offline-text">
        <strong>Reconnecting to {DAEMON_NAME}</strong> · your sessions are still running
      </span>
      <span className="mx-offline-count mono">
        Try {tryNumber(failures)} of {RECONNECT_TRIES}{seconds !== null && ` · next in ${String(seconds)}s`}
      </span>
      <button type="button" className="mx-offline-button" onClick={onRetry}>Retry now</button>
    </div>
  )
}

const POWER = <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v9" /><path d="M6.3 7.3a8 8 0 1 0 11.4 0" /></svg>
const RESTART = <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>

/** The veil over the main card, and the glass card centred on it. The chat behind stays faintly visible but cannot be used. */
/**
 * A card over a veil behaves as a modal one: Tab stays among its buttons and Esc is Later. `labelledBy` is its heading's id.
 * It stays in the chat column rather than in the shared Dialog's window-wide portal, which would cover the sidebar too.
 */
function ServiceLayer({ children, labelledBy, onLater }: { children: ReactNode; labelledBy: string; onLater: () => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onLater()
      return
    }
    if (event.key !== 'Tab') return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const [first, last] = [buttons[0], buttons[buttons.length - 1]]
    if (first === undefined || last === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  return (
    <>
      <div className="mx-service-veil" aria-hidden="true" />
      <section className="mx-service-layer" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>{children}</section>
    </>
  )
}

const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`

/**
 * After every try failed: the service stopped (layout 2h). A banner at the top of the chat column, not a card over it,
 * because nothing is lost: it says so, and Restart service starts it again. Details holds the technical words and the log.
 */
function ServiceDownBanner({ detail, onStart, onRetry, onOpenLog }: { detail: string | null; onStart: () => void; onRetry: () => void; onOpenLog: () => void }) {
  // Not focused when it shows: it sits beside what you were typing in, and your next Enter must not restart the service.
  const [details, setDetails] = useState(false)
  return (
    <section className="mx-banner is-danger" aria-label="Maitty service stopped">
      <div className="mx-banner-row">
        <span className="mx-banner-icon" aria-hidden="true">{POWER}</span>
        <p className="mx-banner-text"><strong>Maitty service stopped.</strong> <span>Chats are paused and nothing is lost. Restart to pick up where they left off.</span></p>
        <button type="button" className="mx-banner-primary" onClick={onStart}>Restart service</button>
        <button type="button" className="mx-banner-ghost" aria-expanded={details} onClick={() => { setDetails(!details) }}>Details</button>
      </div>
      {details && (
        <div className="mx-banner-details">
          <span className="mono">{RECONNECT_TRIES} tries over 30s · no answer from the service{detail !== null && <><br />{detail}</>}</span>
          <span className="mx-spacer" />
          <button type="button" className="mx-banner-ghost" onClick={onRetry}>Try again</button>
          <button type="button" className="mx-banner-ghost" onClick={onOpenLog}>Open log</button>
        </div>
      )}
    </section>
  )
}

/** A downloaded app update waits for a restart (layout 2h): a banner at the top of the chat column until Later. */
export function UpdateReadyBanner({ version, onRestart, onLater }: { version: string; onRestart: () => void; onLater: () => void }) {
  return (
    <section className="mx-banner is-accent" aria-label="Update ready">
      <div className="mx-banner-row">
        <span className="mx-banner-icon" aria-hidden="true">{RESTART}</span>
        <p className="mx-banner-text"><strong>Maitty {version} is ready.</strong> <span>Restart to update. Running chats keep going in the service.</span></p>
        <button type="button" className="mx-banner-primary" onClick={onRestart}>Restart now</button>
        <button type="button" className="mx-banner-ghost" onClick={onLater}>Later</button>
      </div>
    </section>
  )
}

/** What a restart keeps and what it stops, one line each, from the daemon's own counts. A line with a count of 0 is left out. */
function restartFacts(restart: RestartOffer): Array<{ tone: 'ok' | 'warn' | 'dim'; text: string }> {
  if (restart.sessions === 0) return []
  if (!restart.canRestart) return [{ tone: 'warn', text: `The older service owns ${plural(restart.sessions, 'session', 'sessions')} but is not saving them, so Maitty leaves it running.` }]
  return [
    { tone: 'ok', text: `${plural(restart.sessions, 'session reopens', 'sessions reopen')} in the same folders` },
    ...(restart.working > 0 ? [{ tone: 'warn' as const, text: restart.working === 1 ? '1 agent was working. It will offer Resume.' : `${String(restart.working)} agents were working. They will offer Resume.` }] : []),
    { tone: 'dim', text: 'Running shells and commands stop' },
  ]
}

/** The service runs another version: what a restart keeps and stops. Later leaves a slim bar. */
function ServiceUpdateCard({ restart, onLater }: { restart: RestartOffer | null; onLater: () => void }) {
  const [armed, setArmed] = useState(false)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  const facts = restart ? restartFacts(restart) : []
  return (
    <ServiceLayer labelledBy="mx-service-update-title" onLater={onLater}>
      <div className="mx-service-card">
        <div className="mx-service-head">
          <span className="mx-service-tile is-accent" aria-hidden="true">{RESTART}</span>
          <div className="mx-service-copy">
            <h2 id="mx-service-update-title">Restart Maitty to finish updating</h2>
            <p>The app updated, but the service behind it is still the older one.</p>
          </div>
        </div>
        {facts.length > 0 && (
          <ul className="mx-service-facts">
            {facts.map((fact) => <li key={fact.text}><span className={`mx-service-dot is-${fact.tone}`} aria-hidden="true" /><span>{fact.text}</span></li>)}
          </ul>
        )}
        <div className="mx-service-actions">
          {restart && (
            <button
              ref={first}
              type="button"
              className={`mx-svc-primary${armed ? ' is-armed' : ''}`}
              disabled={!restart.canRestart || restart.pending}
              onClick={() => {
                if (!armed) {
                  setArmed(true)
                  return
                }
                setArmed(false)
                restart.onRestart()
              }}
            >
              {restart.pending ? 'Restarting…' : armed ? 'Click again to restart' : restart.label}
            </button>
          )}
          <button type="button" className="mx-svc-secondary" onClick={onLater}>Later</button>
          {restart && <span className="mx-service-versions mono">protocol {restart.from} → {restart.to}</span>}
        </div>
      </div>
    </ServiceLayer>
  )
}

/** The service is newer than this app, so reconnecting needs the app updated. The sessions are untouched. */
function AppBehindCard({ offer, sessions, onLater }: { offer: AppBehindOffer; sessions: number; onLater: () => void }) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  return (
    <ServiceLayer labelledBy="mx-service-behind-title" onLater={onLater}>
      <div className="mx-service-card">
        <div className="mx-service-head">
          <span className="mx-service-tile is-accent" aria-hidden="true">{RESTART}</span>
          <div className="mx-service-copy">
            <h2 id="mx-service-behind-title">Update Maitty to reconnect</h2>
            <p>The service behind this app is newer than the app.{sessions > 0 && ` Your ${plural(sessions, 'session', 'sessions')} keep running.`}</p>
          </div>
        </div>
        <div className="mx-service-actions">
          <button ref={first} type="button" className="mx-svc-primary" disabled={offer.disabled} onClick={offer.onPress}>{offer.label}</button>
          <button type="button" className="mx-svc-secondary" onClick={onLater}>Later</button>
          <span className="mx-service-versions mono">protocol {offer.appProtocol} → {offer.serviceProtocol}</span>
        </div>
      </div>
    </ServiceLayer>
  )
}

/**
 * What the window shows while the daemon cannot be reached: a reconnecting bar for the first tries, the
 * Service stopped banner after the last one, or the update card (then a bar) when the service is another
 * version. Nothing when it is connected.
 */
export function ServiceStatus({ online, failures, mismatch, retryAt, detail, restart, appBehind, sessions, onRetry, onOpenLog }: {
  online: boolean
  failures: number
  mismatch: boolean
  retryAt: number | null
  detail: string | null
  restart: RestartOffer | null
  /** Set when the service is newer than this app; replaces the restart card with an update one. */
  appBehind: AppBehindOffer | null
  /** The sessions this window last knew of, for "your N sessions keep running". */
  sessions: number
  /** Tries to reach the daemon again now. The window's connection starts the service when it is not running, so this is also how it is started. */
  onRetry: () => void
  /** Shows the service's log, the only record of why it stopped. */
  onOpenLog: () => void
}) {
  const [notNow, setNotNow] = useState(false)
  const state = serviceStateOf({ online, failures, mismatch })
  if (state === 'ok') return null
  if (state === 'reconnecting') return <ReconnectingBar failures={failures} retryAt={retryAt} onRetry={onRetry} />
  if (state === 'down') return <ServiceDownBanner detail={detail} onStart={onRetry} onRetry={onRetry} onOpenLog={onOpenLog} />
  if (notNow) return <OfflineBanner retryAt={retryAt} detail={detail} restart={restart} appBehind={appBehind !== null} onRetry={onRetry} />
  if (appBehind) return <AppBehindCard offer={appBehind} sessions={sessions} onLater={() => { setNotNow(true) }} />
  return <ServiceUpdateCard restart={restart} onLater={() => { setNotNow(true) }} />
}
