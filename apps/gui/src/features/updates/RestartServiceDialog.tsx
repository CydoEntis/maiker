import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { toast } from '@/lib/toast'
import { copyText } from '@/lib/clipboard'
import { explainError, type ExplainedError } from '@/lib/error-message'
import { Button } from '@/components/ui/button'
import { CopyDetails, InlineNote } from '@/components/ui/feedback'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { repairLocalService, type LocalServiceReport } from '@/api/daemon'
import { failureDetails, LOCAL_SERVICE_KEY, restartCopy } from './serviceRepair'
import { useLocalServiceReport } from './useLocalServiceReport'
import './updates.css'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Force update: goes ahead even when the service's chats cannot be confirmed saved, and ends a service that will not stop. */
  force?: boolean
  /** The report the page already holds; without it the dialog reads one when it opens. */
  report?: LocalServiceReport | undefined
}

/**
 * The one confirm in front of every restart of the local service: it says what will happen (chats saved, a turn stops,
 * chats come back asleep) before anything runs, and after a failure shows the real error with Copy details. The
 * restart is the host's repair, which does not depend on the service speaking this app's protocol.
 */
export function RestartServiceDialog({ open, onOpenChange, force = false, report: given }: Props) {
  const queryClient = useQueryClient()
  const read = useLocalServiceReport({ enabled: open && given === undefined })
  const report = given ?? read.data
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<ExplainedError | null>(null)
  const copy = restartCopy(report, force)
  const blocked = !force && report !== undefined && !report.canRestart
  const waiting = given === undefined && read.isPending

  const run = () => {
    setPending(true)
    setFailure(null)
    repairLocalService(force).then(
      async (after) => {
        onOpenChange(false)
        toast.success('Service restarted', { description: after.sessionCount === 0 ? 'The service is up to date.' : `The service is up to date. Your ${String(after.sessionCount)} chat${after.sessionCount === 1 ? '' : 's'} came back asleep.` })
        await queryClient.invalidateQueries()
      },
      (error: unknown) => {
        const explained = explainError(error, 'Could not restart the service')
        setFailure({ ...explained, details: failureDetails(report, explained.details ?? explained.reason) })
        void queryClient.invalidateQueries({ queryKey: LOCAL_SERVICE_KEY })
      },
    ).finally(() => { setPending(false) })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) { onOpenChange(next); setFailure(null) } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{waiting ? 'Checking what is open…' : 'Here is what happens.'}</DialogDescription>
        </DialogHeader>
        {!waiting && <ul className="mx-restart-lines">{copy.lines.map((line) => <li key={line}>{line}</li>)}</ul>}
        {failure !== null && (
          <InlineNote
            title={failure.title}
            reason={failure.reason}
            actions={failure.details !== null ? <CopyDetails text={failure.details} copy={copyText} /> : undefined}
          />
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={() => { onOpenChange(false); setFailure(null) }}>Not now</Button>
          <Button disabled={pending || waiting || blocked} onClick={run}>
            {pending ? <><LoaderCircle size={14} />Restarting…</> : failure === null ? copy.confirm : 'Try again'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
