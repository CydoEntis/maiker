import { toast } from '@/lib/toast'

/**
 * The toast once the service answers after an outage. When the restart cut any replies (`cutOff`, on every machine),
 * nothing shows here: the cut-off dialog asks which to continue, and a second word about the same thing would only
 * repeat it.
 */
export function sayBackOnline(cutOff: number): void {
  if (cutOff > 0) return
  toast.success('Back online', { id: 'service-back', description: 'All chats reconnected. Nothing was lost.' })
}
