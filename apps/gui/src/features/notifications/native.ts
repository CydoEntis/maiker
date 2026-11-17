import { isTauri } from '@tauri-apps/api/core'

let asked = false

/**
 * Whether the system lets the app notify. Asked of the person at most once per run, so a refusal does not nag; a
 * permission granted later in the system's settings counts from then on, without a restart.
 */
async function allowed(): Promise<boolean> {
  const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification')
  if (await isPermissionGranted()) return true
  if (asked) return false
  asked = true
  return (await requestPermission()) === 'granted'
}

/**
 * Asks for the system's permission now, while the person is looking (the Test button), rather than first when a
 * notice is due, which is when the window is in the background and the prompt goes unseen.
 */
export async function askNotificationPermission(): Promise<boolean> {
  if (!isTauri()) return false
  return allowed().catch((error: unknown) => {
    console.warn('Could not ask to send system notifications', error)
    return false
  })
}

/** A notification from the operating system, if the user lets the app send them. Does nothing outside the desktop app. */
export async function sendNativeNotice(title: string, body: string): Promise<void> {
  if (!(await askNotificationPermission())) return
  const { sendNotification } = await import('@tauri-apps/plugin-notification')
  sendNotification({ title, body })
}
