import { toast } from '@/lib/toast'
import { cancelFileSend } from '@/api/fileSends'
import { SendProgress } from './SendProgress'

/** What a send's toast says about it. */
export type SendToastState = {
  machine: string
  count: number
  /** The file now going. */
  file: string
  /** A pasted image rather than files: the toasts call it the image. */
  image: boolean
}

/**
 * The progress toast of a send to another machine, with Cancel (ADR 0007). A pane's drop and a chat
 * attachment show the same toast; the toast is named by `transfer`, so each update replaces it.
 */
export function showSendProgress(transfer: string, send: SendToastState, index: number, percent: number | null): void {
  const where = send.count > 1 ? ` (${String(index + 1)} of ${String(send.count)})` : ''
  toast.progress(`Sending ${send.image ? 'the image' : send.file} to ${send.machine}${where}`, {
    id: transfer,
    duration: Infinity,
    // Hiding the toast would not stop the send; Cancel does.
    closeButton: false,
    description: <SendProgress file={send.file} percent={percent} />,
    action: {
      label: 'Cancel',
      onClick: (event) => {
        // The toast stays until the host says the send has stopped.
        event.preventDefault()
        cancelFileSend(transfer).catch((error: unknown) => { toast.failed('Could not stop the send', error) })
      },
    },
  })
}
