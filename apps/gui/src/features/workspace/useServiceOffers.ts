import { useEffect, useRef, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { restartMismatchedDaemon } from '@/api/daemon'
import type { Conversation } from '@/data/preview'
import { serviceStateOf } from './model/serviceState'
import { daemonConnectionError } from '@/lib/daemon-connection'
import { appBehindStep } from '@/features/updates/appBehind'
import { useUpdater } from '@/features/updates/useUpdater'
import type { AppBehindOffer, RestartOffer } from './components/states'
import { serviceStep } from '@/features/updates/finishUpdate'

/**
 * The desktop app: a terminal multiplexer window over sessions maikerd owns. Tabs and
 * splits are this window's arrangement; closing them only detaches.
 */
/** What restarting an older service does to the sessions it owns, in words. */
function olderServiceNote(status: { canRestart: boolean; sessionCount: number; activeTurnCount: number | null } | undefined): string {
  if (!status || status.sessionCount === 0) return ''
  const sessions = `${String(status.sessionCount)} session${status.sessionCount === 1 ? '' : 's'}`
  if (!status.canRestart) return ` The older service owns ${sessions} but is not saving them, so Maiker leaves it running.`
  const midTurn = status.activeTurnCount ? ` ${String(status.activeTurnCount)} working or waiting agent${status.activeTurnCount === 1 ? '' : 's'} will offer a Resume.` : ''
  return ` Restarting it stops what is running in its ${sessions}. They reopen in the same folders.${midTurn}`
}

/** What the window offers when it and the service speak different protocols: restart the older service, or update the older app. */
export function useServiceOffers({ mismatch, serviceNewer, restartStatusQuery, refetchSessions, updater, restartNow, online, failures, sessionsQuery, afterAppUpdate = false }: {
  mismatch: { daemonProtocol: number; guiProtocol: number } | null
  serviceNewer: boolean
  restartStatusQuery: UseQueryResult<{ daemonProtocol: number; guiProtocol: number; canRestart: boolean; sessionCount: number; activeTurnCount: number | null }>
  refetchSessions: () => Promise<unknown>
  updater: ReturnType<typeof useUpdater>
  restartNow: () => void
  online: boolean
  failures: number
  sessionsQuery: UseQueryResult<Conversation[]>
  /** This launch is the app restarted into an update: an older service is restarted as part of it, once no agent works. */
  afterAppUpdate?: boolean
}) {
  const [restartPending, setRestartPending] = useState(false)
  const status = restartStatusQuery.data
  const unasked = mismatch !== null && !serviceNewer && afterAppUpdate && status !== undefined
    && serviceStep({ afterAppUpdate, restartWhenIdle: false, canRestart: status.canRestart, activeTurnCount: status.activeTurnCount }) === 'restart'
  // Tried once for each older service: a restart that failed leaves the card and its button.
  const tried = useRef<number | null>(null)
  useEffect(() => {
    if (!unasked || tried.current === mismatch.daemonProtocol) return
    tried.current = mismatch.daemonProtocol
    void restartMismatchedDaemon(mismatch.daemonProtocol)
      .then(() => refetchSessions())
      .catch((error: unknown) => { toast.failure(error, 'Could not finish updating the Maiker service') })
  }, [unasked, mismatch, refetchSessions])
  const restartOffer: RestartOffer | null = mismatch && !serviceNewer
    ? {
        label: restartStatusQuery.isPending ? 'Checking service…' : restartStatusQuery.isError ? 'Restart check failed' : restartStatusQuery.data.canRestart ? (restartStatusQuery.data.sessionCount > 0 ? `Restart and restore ${String(restartStatusQuery.data.sessionCount)} session${restartStatusQuery.data.sessionCount === 1 ? '' : 's'}` : 'Restart service') : 'Service in use',
        canRestart: Boolean(restartStatusQuery.data?.canRestart),
        pending: restartPending,
        from: mismatch.daemonProtocol,
        to: mismatch.guiProtocol,
        sessions: restartStatusQuery.data?.sessionCount ?? 0,
        working: restartStatusQuery.data?.activeTurnCount ?? 0,
        onRestart: () => {
          setRestartPending(true)
          void restartMismatchedDaemon(mismatch.daemonProtocol)
            .then(async () => {
              await refetchSessions()
              toast.success(`Service restarted · ${String(restartStatusQuery.data?.sessionCount ?? 0)} sessions back`)
            })
            .catch((error: unknown) => { toast.failure(error, 'Could not restart the Maiker service') })
            .finally(() => { setRestartPending(false) })
        },
      }
    : null
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
  const serviceState = serviceStateOf({ online, failures, mismatch: Boolean(mismatch) })
  const serviceFooterText = serviceState === 'down' ? 'Service stopped' : serviceState === 'update' ? 'Restart needed' : undefined
  const offlineDetail = mismatch && !serviceNewer ? `${daemonConnectionError(sessionsQuery.error)}${olderServiceNote(restartStatusQuery.data)}` : null
  return { serviceFooterText, offlineDetail, restartOffer, appBehindOffer }
}
