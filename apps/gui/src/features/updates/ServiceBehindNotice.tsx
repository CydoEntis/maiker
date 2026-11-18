import { useEffect, useState } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { toast } from '@/lib/toast'
import { errorMessage } from '@/lib/error-message'
import { APP_NAME } from '@/brand'
import { InlineNote } from '@/components/ui/feedback'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { loadDaemonUpdateStatus, restartStaleDaemon } from '@/api/daemon'
import type { Conversation } from '@/data/preview'
import { serviceRestartStep } from './serviceRestart'
import { useIdleServiceRestart } from './useIdleServiceRestart'
import { serviceStep } from './finishUpdate'
import { SERVICE_STATUS_KEY } from './serviceUpdateStatus'

const TOAST_ID = 'service-behind'
const STATUS_KEY = SERVICE_STATUS_KEY

type ServiceBehindNoticeProps = {
  sessionsQuery: UseQueryResult<Conversation[]>
  /**
   * Restart the older service without asking, at a quiet moment (`serviceRestartStep`): its sessions are saved and no
   * agent is working, waiting on the user or starting, so each one comes back as it was
   * (Settings › General › Restart the service when idle).
   */
  restartServiceWhenIdle?: boolean
  /** A session is being started from this window. */
  starting?: boolean
  /**
   * This launch is the app restarted into an update: the service's restart is part of that update, never a second
   * question. It still waits for the same quiet moment as Restart the service when idle.
   */
  afterAppUpdate?: boolean
}

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`

/**
 * A new release leaves a running service alone, because it may hold sessions. Without this the app says it is up to
 * date while the service still runs the old code, and none of the release's fixes to the service apply. This says
 * so and offers the restart, which asks first. With Settings › Restart the service when idle on, it restarts by
 * itself at the first quiet moment (idle agents come back resumed) and keeps the notice until then.
 */
export function ServiceBehindNotice({ sessionsQuery, restartServiceWhenIdle = false, starting = false, afterAppUpdate = false }: ServiceBehindNoticeProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [autoFailed, setAutoFailed] = useState(false)
  // A restart asked for in the dialog that failed: said in the dialog, which stays open so you can try again.
  const [failure, setFailure] = useState<string | null>(null)
  const statusQuery = useQuery({
    queryKey: STATUS_KEY,
    queryFn: loadDaemonUpdateStatus,
    enabled: sessionsQuery.isSuccess,
    retry: false,
    staleTime: Infinity,
  })
  const refetchStatus = statusQuery.refetch
  const status = statusQuery.data
  const version = status?.behind ? status.daemonVersion : null
  const canRestart = Boolean(status?.canRestart)
  const [restartingNow, setRestartingNow] = useState(false)
  const step = serviceRestartStep({
    enabled: (restartServiceWhenIdle || afterAppUpdate) && Boolean(status?.behind),
    restarting: restartingNow || pending,
    starting,
    service: status,
    sessionStatuses: sessionsQuery.data?.map((conversation) => conversation.status) ?? null,
  })
  // Right after an app update the service's restart is part of it: nothing is asked while it waits for the agents to
  // finish, unless it cannot be restarted with nothing lost or cannot say who is working.
  const finishingUpdate = afterAppUpdate && status?.behind === true
    && serviceStep({ afterAppUpdate, restartWhenIdle: false, canRestart: status.canRestart, activeTurnCount: status.activeTurnCount }) !== 'ask'
  // Otherwise only while the restart is actually under way is there nothing to ask; while it waits for a quiet moment the notice stays.
  const unasked = step === 'restart' || restartingNow || finishingUpdate
  const sessionCount = status?.sessionCount ?? 0
  const refetchSessions = sessionsQuery.refetch

  // Tried once for each version found behind: a restart that failed leaves the notice and its button.
  useIdleServiceRestart({
    step,
    key: version,
    restart: () => {
      if (!version) return
      setRestartingNow(true)
      restartStaleDaemon(version).then(
        async () => {
          await refetchSessions()
          await queryClient.invalidateQueries({ queryKey: STATUS_KEY })
          // Part of an app update, the app's own notice already says it was updated.
          if (afterAppUpdate) return
          toast.success('Service restarted', { description: sessionCount === 0 ? 'It restarted by itself to finish the update.' : `It restarted by itself to finish the update. ${plural(sessionCount, 'session')} came back.` })
        },
        (error: unknown) => {
          console.warn(`Could not restart the older ${APP_NAME} service`, error)
          setAutoFailed(true)
        },
      ).finally(() => { setRestartingNow(false) })
    },
    recheck: () => { void refetchStatus() },
  })

  useEffect(() => {
    if (!version || (unasked && !autoFailed)) return
    toast.warning(`The ${APP_NAME} service is still on ${version}`, {
      id: TOAST_ID,
      duration: Infinity,
      description: canRestart
        ? 'This app is newer. Restart the service to finish updating.'
        : `This app is newer, but its sessions are not saved, so ${APP_NAME} is leaving it running.`,
      action: canRestart ? { label: 'Restart…', onClick: () => { setDialogOpen(true) } } : undefined,
    })
    return () => {
      toast.dismiss(TOAST_ID)
    }
  }, [version, canRestart, unasked, autoFailed])

  if (!status || !version) return null

  const description =
    status.activeTurnCount === null
      ? `The service cannot say which agents are working. Restarting may interrupt active work, and output since the last save may be lost.`
      : status.activeTurnCount > 0
        ? `${plural(status.sessionCount, 'session')} are saved and come back. ${plural(status.activeTurnCount, 'agent turn')} in progress will stop, and you can resume them from their rows.`
        : `${plural(status.sessionCount, 'session')} are saved and come back. No agent is working right now.`

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        if (pending) return
        setDialogOpen(open)
        setFailure(null)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Restart the ${APP_NAME} service?`}</DialogTitle>
          <DialogDescription>{`It is on ${version}, and this app is newer. ${description}`}</DialogDescription>
        </DialogHeader>
        {failure !== null && <InlineNote title="Could not restart the service" reason={failure} />}
        <DialogFooter>
          <Button
            variant="soft"
            disabled={pending}
            onClick={() => {
              setDialogOpen(false)
            }}
          >
            Not now
          </Button>
          <Button
            disabled={!canRestart || pending}
            onClick={() => {
              setPending(true)
              setFailure(null)
              void restartStaleDaemon(version)
                .then(async () => {
                  setDialogOpen(false)
                  toast.dismiss(TOAST_ID)
                  await sessionsQuery.refetch()
                  await queryClient.invalidateQueries({ queryKey: STATUS_KEY })
                })
                .catch((error: unknown) => {
                  setFailure(errorMessage(error, 'The service did not say why.'))
                  void queryClient.invalidateQueries({ queryKey: STATUS_KEY })
                })
                .finally(() => {
                  setPending(false)
                })
            }}
          >
            {pending ? (
              <>
                <LoaderCircle size={14} />
                Restarting…
              </>
            ) : (
              'Restart service'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
