import { daemonConnectionError } from '@/lib/daemon-connection'
import { useWorkspace } from '../workspaceContext'
import { ServiceChip, ServiceStatus } from './ServiceStatus'

/** The service's dialog over the window, fed from the workspace's connection. */
export function WindowServiceStatus() {
  const { service, mismatch, retryAt, offlineDetail, sessionsQuery, restartOffer, appBehindOffer, sessions, refetchSessions } = useWorkspace()
  const detail = offlineDetail ?? (sessionsQuery.isError ? daemonConnectionError(sessionsQuery.error) : 'The service did not answer.')
  return (
    <ServiceStatus
      stage={service.stage}
      putOff={service.putOff}
      onPutOff={() => { service.setPutOff(true) }}
      mismatch={Boolean(mismatch)}
      retryAt={retryAt}
      detail={detail}
      restart={restartOffer}
      appBehind={appBehindOffer}
      sessions={sessions.length}
      onStart={refetchSessions}
    />
  )
}

/** The title bar's service chip, fed from the workspace's connection. */
export function WindowServiceChip() {
  const { service, mismatch, appBehindOffer } = useWorkspace()
  return <ServiceChip stage={service.stage} putOff={service.putOff} mismatch={Boolean(mismatch)} appBehind={appBehindOffer !== null} onReopen={() => { service.setPutOff(false) }} />
}
