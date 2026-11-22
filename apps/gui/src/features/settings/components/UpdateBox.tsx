import { DownloadProgress } from '@/features/updates/DownloadProgress'
import { percentOf } from '@/features/updates/downloadEta'
import type { SettingsUpdates } from './DesktopSettings'

/** A version as the box writes it: always with its leading v. */
function vee(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

type Tone = 'ok' | 'accent' | 'quiet' | 'danger'
type Face = { tone: Tone; line: string; note: string | null; button: { label: string; run: () => void; primary: boolean } | null }

/** What the box says and offers for each state of the update. The design draws only the ready state; the others keep its shape. */
function faceOf(updates: SettingsUpdates): Face {
  const target = updates.version === undefined ? 'An update' : vee(updates.version)
  switch (updates.status) {
    case 'ready': return { tone: 'ok', line: `${target} is ready`, note: 'Installs when you restart. Never while an agent is working.', button: { label: 'Restart to update', run: updates.onRestart, primary: true } }
    case 'available': return { tone: 'accent', line: `${target} is available`, note: 'Downloads in the background. Nothing installs until you restart.', button: { label: 'Download', run: updates.onDownload, primary: true } }
    case 'downloading': {
      const percent = percentOf(updates.download?.progress ?? null)
      return { tone: 'accent', line: percent === null ? `Downloading ${target}` : `Downloading ${target} · ${String(percent)}%`, note: null, button: null }
    }
    case 'checking': return { tone: 'quiet', line: 'Checking for updates…', note: null, button: null }
    case 'current': return { tone: 'quiet', line: 'Up to date', note: null, button: { label: 'Check now', run: updates.onCheck, primary: false } }
    case 'idle': return { tone: 'quiet', line: 'Not checked yet', note: null, button: { label: 'Check now', run: updates.onCheck, primary: false } }
    case 'failed': return { tone: 'danger', line: 'Update failed', note: updates.summary, button: { label: 'Try again', run: updates.onCheck, primary: false } }
  }
}

/** The foot of the Settings nav: where the app's update is, with the one thing to do about it. */
export function UpdateBox({ updates, appVersion }: { updates: SettingsUpdates; appVersion: string | null }) {
  const face = faceOf(updates)
  return (
    <div className="mx-settings-update" aria-label="Updates" role="group">
      <div className="mx-settings-update-line">
        <span className={`mx-settings-update-dot is-${face.tone}`} aria-hidden="true" />
        <span className="mx-settings-update-word" role="status">{face.line}</span>
        {appVersion !== null && <span className="mx-settings-update-now" title="The version running now">{vee(appVersion)}</span>}
      </div>
      {face.note !== null && <span className="mx-settings-update-note">{face.note}</span>}
      {updates.status === 'downloading' && <DownloadProgress progress={updates.download?.progress ?? null} transfer={updates.download?.transfer ?? null} />}
      {face.button !== null && (
        <button type="button" className={`mx-scard-button mx-settings-update-button${face.button.primary ? ' is-primary' : ''}`} onClick={face.button.run}>{face.button.label}</button>
      )}
    </div>
  )
}
