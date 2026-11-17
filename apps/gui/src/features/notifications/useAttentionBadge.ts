import { useEffect, useRef } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { hasAppWindow } from '@/lib/windowMetadata'
import type { SessionView } from '@/features/workspace/model/session'
import { needingYou, windowTitle } from './attentionBadge'

/**
 * Shows from outside the window how many sessions need you: a count on the app's icon where the system has one (macOS,
 * and Linux desktops with a launcher count) and in the window's title everywhere, which the taskbar and window switcher
 * show. Only when the count changes.
 */
export function useAttentionBadge(sessions: readonly SessionView[], listed: boolean): void {
  const count = listed ? needingYou(sessions) : 0
  // Windows has no icon count; it says so once, not on every change.
  const badgeRefused = useRef(false)
  useEffect(() => {
    if (!hasAppWindow()) return
    const appWindow = getCurrentWindow()
    appWindow.setTitle(windowTitle(count)).catch((error: unknown) => { console.warn('Could not set the window title', error) })
    if (badgeRefused.current) return
    appWindow.setBadgeCount(count === 0 ? undefined : count).catch((error: unknown) => {
      badgeRefused.current = true
      console.warn('This system shows no count on the app icon', error)
    })
  }, [count])
}
