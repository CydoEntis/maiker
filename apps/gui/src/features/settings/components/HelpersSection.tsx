import { useEffect, useState } from 'react'
import { listenSharedSettings, requestSharedSettings, setHelperSetting } from '@/api/sharedSettings'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import { errorMessage } from '@/lib/error-message'
import { changeFailed, daemonSaid, HELPER_SETTINGS_UNKNOWN, HELPERS_AT_ONCE_CHOICES, HELPERS_MAY_CHOICES, isChange, type HelperSettings, type HelperSettingsState } from '../model/helperSettings'
import { Card, Row } from './DesktopSettings'

/**
 * Whether agents may start helpers, and how many of one session's work at once. Both are this computer's daemon's
 * (`[sessions] helpers` and `helpers_at_once`), shared with the terminal app: the page shows what the daemon says,
 * asks it for a change, and shows the change only once the daemon says it. Nothing is kept in this window.
 */
export function HelpersSection() {
  const [state, setState] = useState<HelperSettingsState>(HELPER_SETTINGS_UNKNOWN)

  useEffect(() => {
    let stop: (() => void) | undefined
    let stopped = false
    void listenSharedSettings((shared) => { setState(daemonSaid(shared)) })
      .then((unlisten) => {
        if (stopped) unlisten()
        else stop = unlisten
        return requestSharedSettings()
      })
      .catch((error: unknown) => { setState((current) => changeFailed(current, errorMessage(error, 'Could not read the helper settings'))) })
    return () => {
      stopped = true
      stop?.()
    }
  }, [])

  const change = <K extends keyof HelperSettings>(key: K, picked: HelperSettings[K]) => {
    if (!isChange(state, key, picked)) return
    setState((current) => ({ ...current, failure: null }))
    setHelperSetting(key, picked).catch((error: unknown) => { setState((current) => changeFailed(current, errorMessage(error, 'Could not save that'))) })
  }
  const unknown = state.said === null

  return (
    <Card title="Helpers" foot="These are this computer's settings. Sessions on another machine follow that machine's own.">
      <Row label="When an agent wants helpers" detail="Helpers are sessions an agent starts for itself, each in its own worktree. Ask shows an Allow prompt in the lead's chat.">
        <Segmented
          aria-label="When an agent wants helpers"
          disabled={unknown}
          value={state.said?.helpers ?? ''}
          onValueChange={(next) => {
            const picked = HELPERS_MAY_CHOICES.find(([word]) => word === next)
            if (picked) change('helpers', picked[0])
          }}
        >
          {HELPERS_MAY_CHOICES.map(([word, text]) => <SegmentedItem key={word} value={word}>{text}</SegmentedItem>)}
        </Segmented>
      </Row>
      <Row label="Helpers working at once" detail="More than this wait their turn.">
        <Segmented
          aria-label="Helpers working at once"
          disabled={unknown}
          value={state.said === null ? '' : String(state.said.helpers_at_once)}
          onValueChange={(next) => {
            const picked = HELPERS_AT_ONCE_CHOICES.find((limit) => String(limit) === next)
            if (picked !== undefined) change('helpers_at_once', picked)
          }}
        >
          {HELPERS_AT_ONCE_CHOICES.map((limit) => <SegmentedItem key={limit} value={String(limit)}>{limit}</SegmentedItem>)}
        </Segmented>
      </Row>
      {unknown && state.failure === null && <p className="mx-scard-note">Waiting for the Maiker service to say them.</p>}
      {state.failure !== null && <p className="mx-commit-error" role="alert">{state.failure}</p>}
    </Card>
  )
}
