import { beforeEach, describe, expect, it, vi } from 'vitest'

const plugin = vi.hoisted(() => ({ granted: false, answer: 'denied', asks: 0, sent: 0 }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: () => Promise.resolve(plugin.granted),
  requestPermission: () => { plugin.asks += 1; return Promise.resolve(plugin.answer) },
  sendNotification: () => { plugin.sent += 1 },
}))

beforeEach(() => { vi.resetModules(); Object.assign(plugin, { granted: false, answer: 'denied', asks: 0, sent: 0 }) })

describe('system notifications', () => {
  it('asks once, and a permission granted later in the system settings counts without a restart', async () => {
    const { askNotificationPermission, sendNativeNotice } = await import('./native')
    expect(await askNotificationPermission()).toBe(false)
    await sendNativeNotice('done', '')
    expect(plugin.asks).toBe(1)
    expect(plugin.sent).toBe(0)
    plugin.granted = true
    await sendNativeNotice('done', '')
    expect(plugin.sent).toBe(1)
  })
})
