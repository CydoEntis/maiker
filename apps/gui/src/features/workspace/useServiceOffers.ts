import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { restartMismatchedDaemon } from '@/api/daemon'
import type { Conversation } from '@/data/preview'
import { daemonConnectionError } from '@/lib/daemon-connection'
import { appBehindStep } from '@/features/updates/appBehind'
import { useUpdater } from '@/features/updates/useUpdater'
import { serviceRestartStep } from '@/features/updates/serviceRestart'
import { useIdleServiceRestart } from '@/features/updates/useIdleServiceRestart'
import type { AppBehindOffer, RestartOffer } from './components/states'

/**
 * The desktop app: a terminal multiplexer window over sessions the daemon owns. Tabs and
 * splits are this window's arrangement; closing them only detaches.
 */
/** What restarting an older service does to the sessions it owns, in words. */
function olderServiceNote(status: { canRestart: boolean; sessionCount: number; activeTurnCount: number | null } | undefined): string {
  if (!status || status.sessionCount === 0) return ''
  const sessions = `${String(status.sessionCount)} session${status.sessionCount === 1 ? '' : 's'}`
  if (!status.canRestart) return ` The older service owns ${sessions} but is not saving them, so Maitty leaves it running.`
  const midTurn = status.activeTurnCount ? ` ${String(status.activeTurnCount)} working or waiting agent${status.activeTurnCount === 1 ? '' : 's'} will offer a Resume.` : ''
  return ` Restarting it stops what is running in its ${sessions}. They reopen in the same folders.${midTurn}`
}

/** What the window offers when it and the service speak different protocols: restart the older service, or update the older app. */
export function useServiceOffers({ mismatch, serviceNewer, restartStatusQuery, refetchSessions, updater, restartNow, sessionsQuery, restartServiceWhenIdle, starting }: {
  mismatch: { daemonProtocol: number; guiProtocol: number } | null
  serviceNewer: boolean
  restartStatusQuery: UseQueryResult<{ daemonProtocol: number; guiProtocol: number; canRestart: boolean; sessionCount: number; activeTurnCount: number | null }>
  refetchSessions: () => Promise<unknown>
  updater: ReturnType<typeof useUpdater>
  restartNow: () => void
  sessionsQuery: UseQueryResult<Conversation[]>
  /** Settings › General › Restart the service when idle. */
  restartServiceWhenIdle: boolean
  /** A session is being started from this window. */
  starting: boolean
}) {
  const [restartPending, setRestartPending] = useState(false)
  const restartOffer: RestartOffer | null = mismatch && !serviceNewer
    ? {
        label: restartStatusQuery.isPending ? 'Checking service…' : restartStatusQuery.isError ? 'Restart check failed' : restartStatusQuery.data.canRestart ? (restartStatusQuery.data.sessionCount > 0 ? `Restart and restore ${String(restartStatusQuery.data.sessionCount)} session${restartStatusQuery.data.sessionCount === 1 ? '' : 's'}` : 'Restart service') : 'Service in use',
        canRestart: Boolean(restartStatusQuery.data?.canRestart),
        pending: restartPending,
        from: mismatch.daemonProtocol,
        to: mismatch.guiProtocol,
        sessions: restartStatusQuery.data?.sessionCount ?? 0,
        working: restartStatusQuery.data?.activeTurnCount ?? 0,
        onRestart: (automatic = false) => {
          setRestartPending(true)
          void restartMismatchedDaemon(mismatch.daemonProtocol)
            .then(async () => {
              await refetchSessions()
              toast.success(`Service restarted · ${String(restartStatusQuery.data?.sessionCount ?? 0)} sessions back`, automatic ? { description: 'It restarted by itself because no agent was working or waiting.' } : undefined)
            })
            .catch((error: unknown) => { toast.failed('Could not restart the Maitty service', error) })
            .finally(() => { setRestartPending(false) })
        },
      }
    : null
  // The same button flow, run for you at a quiet moment. The window cannot read sessions from a service on another
  // protocol, so the service's own count of working and waiting agents is the guard here.
  const refetchRestartStatus = restartStatusQuery.refetch
  useIdleServiceRestart({
    step: serviceRestartStep({ enabled: restartServiceWhenIdle, restarting: restartPending, starting, service: restartStatusQuery.data, sessionStatuses: null }),
    key: restartOffer && restartOffer.canRestart ? `protocol-${String(restartOffer.from)}` : null,
    restart: () => { restartOffer?.onRestart(true) },
    recheck: () => { void refetchRestartStatus() },
  })
  const appBehindAction = appBehindStep(updater.state)
  const appBehindOffer: AppBehindOffer | null = mismatch && serviceNewer
    ? {
        label: appBehindAction.label,
        disabled: appBehindAction.action === null,
        onPress: () => {
          if (appBehindAction.action === 'download') updater.download()
          else if (appBehindAction.action === 'install') restartNow()
          else if (appBehindAction.action === 'check') updater.check()
        },
        serviceProtocol: mismatch.daemonProtocol,
        appProtocol: mismatch.guiProtocol,
      }
    : null
  const offlineDetail = mismatch && !serviceNewer ? `${daemonConnectionError(sessionsQuery.error)}${olderServiceNote(restartStatusQuery.data)}` : null
  return { offlineDetail, restartOffer, appBehindOffer }
}
