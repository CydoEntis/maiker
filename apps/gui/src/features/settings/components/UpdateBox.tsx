import { ArrowDownToLine, RotateCw } from 'lucide-react'
import { StatusIcon } from '@/components/ui/status-icon'
import { percentOf } from '@/features/updates/downloadEta'
import type { SettingsUpdates } from './DesktopSettings'

/** A version as the box writes it: always with its leading v. */
function vee(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

/** The working mark beside "Updating", a step smaller than a row's. */
const SPIN_PX = 12

/** What sits at the right of the line for each state of the update: nothing while there is nothing to do. */
function Action({ updates }: { updates: SettingsUpdates }) {
  const target = updates.version === undefined ? 'the update' : vee(updates.version)
  switch (updates.status) {
    case 'available':
      return (
        <button type="button" className="mx-settings-update-act" title={`Download ${target}; nothing installs until you restart`} onClick={updates.onDownload}>
          <ArrowDownToLine size={13} aria-hidden="true" />Update
        </button>
      )
    case 'downloading': {
      const percent = percentOf(updates.download?.progress ?? null)
      return (
        <span className="mx-settings-update-busy" role="status" aria-label={`Downloading ${target}`}>
          <StatusIcon status="working" size={SPIN_PX} />{percent === null ? 'Updating' : `Updating ${String(percent)}%`}
        </span>
      )
    }
    case 'ready':
      return (
        <button type="button" className="mx-settings-update-act is-primary" title={`${target} is downloaded. Installs now; never while an agent is working.`} onClick={updates.onRestart}>
          <RotateCw size={13} aria-hidden="true" />Restart to update
        </button>
      )
    case 'failed':
      return <button type="button" className="mx-settings-update-act" onClick={updates.onCheck}>Try again</button>
    case 'current':
    case 'idle':
    case 'checking':
      return null
  }
}

/**
 * The foot of the Settings nav: the version running now, and only when there is something to do, the one control for it
 * (Update, then a working mark while it downloads, then Restart to update). Checking happens on its own, so there is no
 * Check button and no "Up to date".
 */
export function UpdateBox({ updates, appVersion }: { updates: SettingsUpdates; appVersion: string | null }) {
  return (
    <div className={`mx-settings-update${updates.status === 'failed' ? ' is-failed' : ''}`} aria-label="Updates" role="group">
      <div className="mx-settings-update-line">
        <span className="mx-settings-update-now" title="The version running now">{appVersion === null ? 'Maiker' : `Maiker ${vee(appVersion)}`}</span>
        <Action updates={updates} />
      </div>
      {updates.status === 'failed' && <span className="mx-settings-update-note" role="status">Update failed: {updates.summary}</span>}
    </div>
  )
}
