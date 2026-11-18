import { useAppearsAfter } from '@/lib/useAppearsAfter'
import { useShortcutText } from '@/features/shortcuts/platform'
import { Icon } from './glyphs'

/** Before the daemon's first list: says it is looking, once the wait is long enough to notice. */
function LookingForSessions() {
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

export function EmptyState({ hasSessions, listed, startFolderLabel, canStart, onNewSession, onChangeStartFolder }: {
  hasSessions: boolean
  /** The daemon has sent its first list. Until then nothing is said about sessions: there may be some running. */
  listed: boolean
  startFolderLabel: string
  canStart: boolean
  onNewSession: () => void
  onChangeStartFolder: () => void
}) {
  const shortcutText = useShortcutText()
  if (!listed) return <LookingForSessions />
  return (
    <div className="mx-empty">
      <div className="mx-empty-column">
        <span className="mx-empty-tile"><Icon name="prompt" /></span>
        <div className="mx-empty-copy">
          <h1>{hasSessions ? 'No tab open' : 'No sessions running'}</h1>
          {hasSessions ? (
            <p>Your sessions keep running in the sidebar. Pick one to show it here, or start a new one.</p>
          ) : (
            <p>A new session starts an agent in a project you pick, from <span className="mono">{startFolderLabel}</span> if you pick none. An agent you start from any shell shows up in the sidebar too.</p>
          )}
        </div>
        <div className="mx-empty-actions">
          <button type="button" className="mx-primary" disabled={!canStart} onClick={onNewSession}>New session<kbd>{shortcutText('new-session')}</kbd></button>
          <button type="button" className="mx-quiet" onClick={onChangeStartFolder}>Change start folder</button>
        </div>
        <span className="mx-empty-note-small">Sessions live in the Maiker service. Closing this window never stops them, and the Maiker TUI sees the same sessions.</span>
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


