import { sectionOf } from '@/features/workspace/model/sidebar'
import type { SessionView } from '@/features/workspace/model/session'

const APP_NAME = 'Maiker'

/** How many sessions wait on the person: those the sidebar lists under Needs you (asking, stopped, held by a limit). */
export function needingYou(sessions: readonly SessionView[]): number {
  return sessions.filter((session) => sectionOf(session) === 'needs').length
}

/** The window's title for that count: it is what the taskbar, the window switcher and the dock's window list show. */
export function windowTitle(count: number): string {
  return count === 0 ? APP_NAME : `${APP_NAME} · ${String(count)} need${count === 1 ? 's' : ''} you`
}
