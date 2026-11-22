import { useAppearsAfter } from '@/lib/useAppearsAfter'
import { Icon } from './glyphs'

/** Before the daemon's first list: says it is looking, once the wait is long enough to notice. Nothing is said about sessions until then: some may be running. */
export function LookingForSessions() {
  const shown = useAppearsAfter()
  return (
    <div className={`mx-empty${shown ? '' : ' invisible'}`} aria-busy="true">
      <div className="mx-empty-column">
        <span className="mx-empty-tile"><Icon name="prompt" /></span>
        <div className="mx-empty-copy">
          <h1>Looking for your sessions…</h1>
          <p>Asking the Maiker service what is running.</p>
        </div>
      </div>
    </div>
  )
}

export type RestartOffer = {
  label: string
  canRestart: boolean
  pending: boolean
  /** `automatic` marks a restart the window ran by itself (Settings › Restart the service when idle). */
  onRestart: (automatic?: boolean) => void
  /** The service's protocol and the one this app needs, for "protocol 75 → 76". They are not app versions. */
  from: number
  to: number
  /** What a restart touches: the sessions the service owns, and how many of them have an agent mid-turn. */
  sessions: number
  working: number
}

/** The card for a service newer than this app: the way out is updating the app, not restarting the service. */
export type AppBehindOffer = {
  label: string
  disabled: boolean
  onPress: () => void
  /** The service's protocol and the one this app speaks, for "protocol 76 → 77". They are not app versions. */
  serviceProtocol: number
  appProtocol: number
}


