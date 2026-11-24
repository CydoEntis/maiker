import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isDesktop } from '@/api/daemon'
import { APP_NAME, DAEMON_NAME } from '@/brand'
import { RestartServiceDialog } from '@/features/updates/RestartServiceDialog'
import { LOCAL_SERVICE_KEY, SERVICE_STATE_WORDS, serviceState, type ServiceState } from '@/features/updates/serviceRepair'
import { useLocalServiceReport } from '@/features/updates/useLocalServiceReport'
import { downSentence, type MachineHead } from '@/features/workspace/model/machines'
import { Card, Row, type MachinesInfo, type SettingsUpdates } from './DesktopSettings'
import { StatusBlock } from './StatusBlock'
import { UpdateAsk } from './UpdateAsk'
import { useUpdateFlow } from './useUpdateFlow'

const vee = (version: string) => (version.startsWith('v') ? version : `v${version}`)
const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`

/** What the app's own update line offers: the one button its state calls for. */
function appButton(updates: SettingsUpdates): { label: string; run: () => void } | null {
  switch (updates.status) {
    case 'available': return { label: 'Download update', run: updates.onDownload }
    case 'ready': return { label: 'Restart to update', run: updates.onRestart }
    case 'failed': return { label: 'Try again', run: updates.onCheck }
    case 'checking':
    case 'current':
    case 'downloading':
    case 'idle':
      return null
  }
}

type ServiceAsk = { force: boolean } | null

const SERVICE_ACTION: Record<ServiceState, string> = { 'not-running': 'Start service', behind: 'Restart now', 'file-behind': 'Update now', current: 'Restart' }

function serviceDetail(state: ServiceState, version: string | null, sessions: number, appVersion: string | null, saved: boolean): string {
  const what = 'The background program that keeps your chats running when this window closes.'
  const is = version === null ? '' : ` Running ${vee(version)}${appVersion === null ? '' : `, this app is ${vee(appVersion)}`}.`
  const chats = sessions === 0 ? '' : ` ${plural(sessions, 'chat')} open.`
  const later = state === 'behind' ? ' It restarts by itself when no chat is busy, if that is on in General.' : ''
  const unsaved = saved ? '' : ' Its chats are not saved, so Maiker will not restart it for you; Force update does, and can lose them.'
  return `${what}${is}${chats}${later}${unsaved}`
}

function ServiceCard({ appVersion }: { appVersion: string | null }) {
  const queryClient = useQueryClient()
  const query = useLocalServiceReport({ enabled: isDesktop(), poll: true })
  const [ask, setAsk] = useState<ServiceAsk>(null)
  const report = query.data
  const state = report === undefined ? null : serviceState(report)
  return (
    <Card title={`${APP_NAME} service`}>
      <Row
        label={`${APP_NAME} service (${DAEMON_NAME})`}
        detail={report === undefined || state === null
          ? (query.isError ? 'Could not read the service state.' : 'Reading the service…')
          : `${SERVICE_STATE_WORDS[state]}. ${serviceDetail(state, report.daemonVersion, report.sessionCount, appVersion, report.canRestart)}`}
      >
        <button type="button" className="mx-scard-button" onClick={() => { void queryClient.invalidateQueries({ queryKey: LOCAL_SERVICE_KEY }) }}>Check</button>
        {report !== undefined && state !== null && state !== 'current' && report.canRestart && (
          <button type="button" className="mx-scard-button is-primary" onClick={() => { setAsk({ force: false }) }}>{SERVICE_ACTION[state]}</button>
        )}
        <button type="button" className="mx-scard-button" title="Replaces the service's program if needed and restarts it, even when it will not answer" onClick={() => { setAsk({ force: true }) }}>Force update</button>
      </Row>
      {ask !== null && <RestartServiceDialog open onOpenChange={(open) => { if (!open) setAsk(null) }} force={ask.force} report={report} />}
    </Card>
  )
}

const statusOf = (head: MachineHead): string => {
  if (head.updateAction === 'update') return 'Needs an update.'
  if (head.updateAction === 'install') return `${APP_NAME} is not installed there.`
  return head.down ? downSentence(head) : 'Up to date.'
}

function MachinesCard({ machines }: { machines: MachinesInfo }) {
  const flow = useUpdateFlow(machines.onUpdate, machines.onCheckActivity)
  const [askingAll, setAskingAll] = useState(false)
  const remote = machines.list.filter((head) => head.name !== null)
  const behind = remote.filter((head) => head.updateAction === 'update')
  const names = behind.map((head) => head.name ?? head.label)
  return (
    <Card
      title="Remote machines"
      meta={behind.length > 1 ? <button type="button" className="mx-scard-meta-button" disabled={askingAll} onClick={() => { setAskingAll(true) }}>{`Update all ${String(behind.length)}`}</button> : undefined}
    >
      {askingAll && (
        <StatusBlock tone="needs" lead={`Update ${String(behind.length)} machines?`} more="Each machine's service restarts. Their chats are saved and come back asleep, and a turn in progress stops if you update now. Update when idle waits until nothing is open on a machine.">
          <button type="button" className="mx-rm-primary" onClick={() => { flow.runAll(names, false); setAskingAll(false) }}>Update all now</button>
          <button type="button" className="mx-rm-text" onClick={() => { flow.runAll(names, true); setAskingAll(false) }}>Update all when idle</button>
          <button type="button" className="mx-rm-text" onClick={() => { setAskingAll(false) }}>Cancel</button>
        </StatusBlock>
      )}
      {!machines.known && <Row label="Reading machines…" detail="">{null}</Row>}
      {machines.known && remote.length === 0 && <Row label="No remote machines" detail="Add one in Remote machines. Each one that needs an update shows here.">{null}</Row>}
      {remote.map((head) => {
        const name = head.name ?? head.label
        const busy = flow.running.has(name) ? 'Updating…' : flow.checking === name ? 'Checking…' : null
        return (
          <div key={head.key}>
            <Row label={head.label} detail={`${statusOf(head)} ${head.target ?? ''}`.trim()}>
              {busy !== null && <span className="mx-scard-value" role="status">{busy}</span>}
              {busy === null && head.updateAction !== null && (
                <button type="button" className="mx-scard-button is-primary" onClick={() => { flow.ask(head) }}>{head.updateAction === 'install' ? 'Install' : 'Update'}</button>
              )}
            </Row>
            {flow.asking?.name === name && <UpdateAsk flow={flow} plain />}
          </div>
        )
      })}
    </Card>
  )
}

/**
 * Settings › Updates & repair: everything that updates, in one place, in plain words: the app, the service that keeps
 * chats running, and each remote machine. Each shows what it is, its version and state, and the buttons for it.
 * The service's buttons are the host's repair, which works when the service is old, stuck or not running.
 */
export function UpdatesPage({ updates, appVersion, machines }: { updates: SettingsUpdates | undefined; appVersion: string | null; machines: MachinesInfo }) {
  const queryClient = useQueryClient()
  const button = updates === undefined ? null : appButton(updates)
  return (
    <>
      <Card title="Check">
        <Row label="Check for updates" detail="Looks for a newer app and reads the state of the service. Remote machines show here when they need one.">
          <button
            type="button"
            className="mx-scard-button is-primary"
            disabled={updates?.status === 'checking' || updates?.status === 'downloading'}
            onClick={() => { updates?.onCheck(); void queryClient.invalidateQueries({ queryKey: LOCAL_SERVICE_KEY }) }}
          >
            Check for updates
          </button>
        </Row>
      </Card>
      <Card title={`${APP_NAME} app`}>
        <Row
          label={`${APP_NAME} app`}
          detail={`The window you are using. ${appVersion === null ? '' : `Version ${vee(appVersion)}. `}${updates?.summary ?? ''}`.trim()}
        >
          {button !== null && <button type="button" className="mx-scard-button is-primary" onClick={button.run}>{button.label}</button>}
        </Row>
      </Card>
      <ServiceCard appVersion={appVersion} />
      <MachinesCard machines={machines} />
    </>
  )
}
