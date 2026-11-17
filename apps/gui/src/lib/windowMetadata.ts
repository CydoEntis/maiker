import { isTauri } from '@tauri-apps/api/core'

/**
 * Whether this page is in the desktop app's own window, where `getCurrentWindow()` works: it needs the host's window
 * metadata, which a real Tauri webview always has and a test or the browser preview does not.
 */
export function hasAppWindow(): boolean {
  if (!isTauri()) return false
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: unknown } }).__TAURI_INTERNALS__
  return internals?.metadata !== undefined
}
