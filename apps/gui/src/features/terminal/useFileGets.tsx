import { useCallback, useEffect, useRef } from 'react'
import { toast } from '@/lib/toast'
import { cancelFileSend } from '@/api/fileSends'
import { getFileFromMachine, listenFileGets, newGetId, openPulledFolder, type GetEvent } from '@/api/fileGets'
import { SendProgress } from './SendProgress'

/** What the window knows of a pull it started. */
type Pull = {
  machine: string
  /** The file now coming, as the host names it. Until the host says, what the person typed. */
  file: string
}

/** The progress toast of a pull, with Cancel. The toast is named by `transfer`, so each update replaces it. */
function showGetProgress(transfer: string, pull: Pull, percent: number | null): void {
  toast.progress(`Getting ${pull.file} from ${pull.machine}`, {
    id: transfer,
    duration: Infinity,
    // Hiding the toast would not stop the pull; Cancel does.
    closeButton: false,
    description: <SendProgress file={pull.file} percent={percent} verb="Getting" />,
    action: {
      label: 'Cancel',
      onClick: (event) => {
        // The toast stays until the host says the pull has stopped.
        event.preventDefault()
        cancelFileSend(transfer).catch((error: unknown) => { toast.failed('Could not stop the pull', error) })
      },
    },
  })
}

/** The last part of a path, for the toast before the host has named the file. */
function lastPart(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

/**
 * Pulling a file from a session's machine: starts the pull, shows a progress toast with Cancel,
 * and says where the file was saved, with a button that opens that folder (ADR 0007). The host
 * does the work off the UI thread and only reports back.
 */
export function useFileGets() {
  const pulls = useRef(new Map<string, Pull>())

  useEffect(() => {
    let gone = false
    let stop: (() => void) | undefined
    const onEvent = (event: GetEvent) => {
      const pull = pulls.current.get(event.transfer)
      if (pull === undefined) return
      switch (event.kind) {
        case 'progress':
          pull.file = event.file
          showGetProgress(event.transfer, pull, event.percent)
          return
        case 'done':
          pulls.current.delete(event.transfer)
          toast.success(`Saved ${event.file} from ${pull.machine}`, {
            id: event.transfer,
            description: event.folder,
            action: {
              label: 'Open folder',
              onClick: () => { openPulledFolder(event.folder).catch((error: unknown) => { toast.failed('Could not open the folder', error) }) },
            },
          })
          return
        case 'failed':
          pulls.current.delete(event.transfer)
          toast.error(event.message, { id: event.transfer })
          return
        case 'cancelled':
          pulls.current.delete(event.transfer)
          toast.info(`Stopped getting ${event.file} from ${pull.machine}`, { id: event.transfer })
          return
      }
    }
    listenFileGets(onEvent).then((unlisten) => {
      if (gone) unlisten()
      else stop = unlisten
    }, (error: unknown) => { toast.failed('Could not follow file pulls', error) })
    return () => {
      gone = true
      stop?.()
    }
  }, [])

  /** Pull `path` from `machine`. The host's refusals (a bad path, another transfer running) show as an error toast. */
  const getFile = useCallback((machine: string, path: string) => {
    const transfer = newGetId()
    const pull: Pull = { machine, file: lastPart(path) }
    pulls.current.set(transfer, pull)
    showGetProgress(transfer, pull, null)
    getFileFromMachine(machine, path, transfer).catch((error: unknown) => {
      pulls.current.delete(transfer)
      toast.failed(`Could not get the file from ${machine}`, error, { id: transfer })
    })
  }, [])

  return { getFile }
}
