import { useEffect, useRef } from 'react'
import { APP_NAME } from '@/brand'
import { toast } from '@/lib/toast'

const UPDATE_READY_TOAST = 'update-ready'

/**
 * A downloaded app update waits for a restart: one toast that stays until Restart now or Later (the sidebar's update chip
 * still offers the restart afterwards). Each version is offered once; a newer download asks again.
 */
export function useUpdateReadyToast(readyVersion: string | null, restartNow: () => void): void {
  const restart = useRef(restartNow)
  useEffect(() => { restart.current = restartNow }, [restartNow])
  const offered = useRef<string | null>(null)
  useEffect(() => {
    if (readyVersion === null) {
      toast.dismiss(UPDATE_READY_TOAST)
      return
    }
    if (offered.current === readyVersion) return
    offered.current = readyVersion
    toast.info(`${APP_NAME} ${readyVersion} is ready`, {
      id: UPDATE_READY_TOAST,
      description: 'Restart to update. Running chats keep going in the service.',
      duration: Infinity,
      action: { label: 'Restart now', onClick: () => { restart.current() } },
      secondary: { label: 'Later', onClick: () => undefined },
    })
  }, [readyVersion])
}
