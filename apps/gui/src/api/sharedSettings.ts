import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { z } from 'zod'

/**
 * The settings the terminal app and this app share, as the daemon serves them (the host's
 * `get_shared_settings` and `set_shared_setting`). The daemon owns them: this window asks, shows
 * what it is told, and asks for a change; it never writes config.toml itself.
 */
/** The config default for helpers working at once, which a daemon that does not say one reads as (`HELPERS_AT_ONCE_UNSAID` in maitty-shared). */
export const HELPERS_AT_ONCE_DEFAULT = 4

export const SharedSettingsSchema = z.object({
  default_agent: z.string(),
  new_session_view: z.enum(['chat', 'terminal']),
  sidebar_side: z.enum(['left', 'right']),
  theme_dark: z.string(),
  theme_light: z.string(),
  appearance: z.enum(['dark', 'light']),
  spinner: z.array(z.string()),
  start_dir: z.string(),
  reduce_motion: z.boolean(),
  /** The agents switched off in `[permissions.bypass]`; absent from a daemon older than the switches, which reads as none. */
  bypass_off: z.array(z.string()).default([]),
  /** `[updates] machines`: remote machines update themselves after this computer does; absent from an older daemon, which reads as on. */
  update_machines: z.boolean().default(true),
  /** `[sessions] helpers`: what happens when an agent wants helpers; absent from a daemon older than the setting, which reads as asking. */
  helpers: z.enum(['ask', 'always', 'never']).default('ask'),
  /** `[sessions] helpers_at_once`: how many helpers one session has working at once; absent from an older daemon, which reads as the default. */
  helpers_at_once: z.number().int().positive().default(HELPERS_AT_ONCE_DEFAULT),
})
export type SharedSettings = z.infer<typeof SharedSettingsSchema>

/** The names a setting is changed by. */
export type SharedSettingKey = keyof SharedSettings

/** Asks for the settings; they arrive through `listenSharedSettings`. Does nothing outside the desktop app. */
export async function requestSharedSettings(): Promise<void> {
  if (!isTauri()) return
  await invoke('get_shared_settings')
}

/** Asks the daemon to change one setting. The new value arrives through `listenSharedSettings` like any change. */
export async function setSharedSetting(key: SharedSettingKey, value: SharedSettings[SharedSettingKey]): Promise<void> {
  if (!isTauri()) return
  await invoke('set_shared_setting', { key, value })
}

/** The helper settings: newer than the oldest daemon this app talks to, so they are changed on their own path. */
export type HelperSettingKey = 'helpers' | 'helpers_at_once'

/**
 * Asks the daemon to change a helper setting, and waits for its answer. It rejects with the daemon's own words when it
 * refuses the value, and when the daemon running is older than the setting. The new value arrives through
 * `listenSharedSettings` like any change.
 */
export async function setHelperSetting<K extends HelperSettingKey>(key: K, value: Pick<SharedSettings, HelperSettingKey>[K]): Promise<void> {
  if (!isTauri()) throw new Error('Helper settings are kept by the Maiker service, which only the desktop app reaches')
  await invoke('set_newer_shared_setting', { key, value })
}

/** Calls back with the settings each time the daemon says them: the answer to a question, or a change from either app. */
export function listenSharedSettings(onSettings: (settings: SharedSettings) => void): Promise<() => void> {
  return listen<unknown>('shared-settings', (event) => {
    const settings = SharedSettingsSchema.safeParse(event.payload)
    if (!settings.success) {
      console.warn('The host sent settings this window cannot read', settings.error.issues)
      return
    }
    onSettings(settings.data)
  })
}
