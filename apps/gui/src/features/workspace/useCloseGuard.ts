import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { askAboutDrafts, draftsMatching, hasDrafts } from '@/features/documents/draftGuard'
import { hasAppWindow } from '@/lib/windowMetadata'

/**
 * What closing the window does: with no unsaved document draft it closes; with one it asks first (Save, Discard or keep
 * editing) and closes only when told to. Quitting goes through here too: the host turns a quit into closing the window.
 */
export function onCloseAsked(event: { preventDefault: () => void }, close: () => Promise<void>): void {
  if (!hasDrafts()) return
  event.preventDefault()
  void askAboutDrafts(draftsMatching(() => true)).then((goOn) => (goOn ? close() : undefined))
}

/** Asks about unsaved document drafts before the desktop window closes, on every platform. */
export function useCloseGuard(): void {
  useEffect(() => {
    if (!hasAppWindow()) return undefined
    const appWindow = getCurrentWindow()
    let active = true
    let stop: (() => void) | undefined
    appWindow.onCloseRequested((event) => { onCloseAsked(event, () => appWindow.destroy()) })
      .then((unlisten) => { if (active) stop = unlisten; else unlisten() })
      .catch((error: unknown) => { console.error('Could not watch the window closing', error) })
    return () => {
      active = false
      stop?.()
    }
  }, [])
}
