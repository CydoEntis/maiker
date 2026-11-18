import { toast } from '@/lib/toast'
import { displayName, type SessionView } from './model/session'

/** Two chats are "both". */
const BOTH = 2

const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`

/** "A", "A and B", "A, B and C". */
function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`
}

/**
 * The toast once the service answers after an outage: green Back online, or yellow when some chats were cut mid-turn by
 * a service restart (the daemon marks them `interrupted`), with one button that restarts them all. Each of those chats
 * also asks about itself over its own pane.
 */
export function sayBackOnline(interrupted: readonly SessionView[], restart: (session: SessionView) => void): void {
  if (interrupted.length === 0) {
    toast.success('Back online', { id: 'service-back', description: 'All chats reconnected. Nothing was lost.' })
    return
  }
  const count = interrupted.length
  toast.warning(`Back online, but ${plural(count, 'chat was', 'chats were')} interrupted`, {
    id: 'service-back',
    description: `${listWords(interrupted.map(displayName))} ${count === 1 ? 'was' : 'were'} mid-step when the service stopped. Restart ${count === 1 ? 'it' : 'them'} to carry on.`,
    action: { label: count === 1 ? 'Restart it' : count === BOTH ? 'Restart both' : 'Restart all', onClick: () => { for (const session of interrupted) restart(session) } },
  })
}
