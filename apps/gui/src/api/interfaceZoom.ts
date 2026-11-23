import { isTauri } from '@tauri-apps/api/core'

/**
 * Draws the whole window at `scale` (1 is the design size) with the webview's own zoom, so the terminal's measuring,
 * the drags and every portal scale together, as no CSS zoom on one element could. Outside the desktop app it does nothing.
 */
export async function setInterfaceZoom(scale: number): Promise<void> {
  if (!isTauri()) return
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  await getCurrentWebview().setZoom(scale)
}
