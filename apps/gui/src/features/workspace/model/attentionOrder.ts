import { markOf, type StatusMarkKind } from '@/lib/statusMark'
import type { SessionView } from './session'

/** What wants your attention is listed with what needs you first, then what finished, by the state each is shown as. */
const PRIORITY: Record<StatusMarkKind, number> = { needs: 0, done: 1, working: 2, idle: 3 }

/** When a session last changed, in ms; 0 when this window has not seen it change. */
export type Activity = (sessionId: string) => number

/** Most urgent first; sessions in the same state go most recently active first. */
export function byPriority(activity: Activity) {
  return (a: SessionView, b: SessionView): number => PRIORITY[markOf(a.status)] - PRIORITY[markOf(b.status)] || activity(b.id) - activity(a.id)
}
