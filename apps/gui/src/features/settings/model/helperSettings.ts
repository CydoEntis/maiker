import { HELPERS_AT_ONCE_DEFAULT, type HelperSettingKey, type SharedSettings } from '@/api/sharedSettings'

/** What happens when an agent wants helpers, as config.toml words it. */
export type HelpersMay = SharedSettings['helpers']

/** The choices Settings offers, in the order it shows them. The daemon refuses any other value. */
export const HELPERS_MAY_CHOICES: ReadonlyArray<readonly [HelpersMay, string]> = [['ask', 'Ask'], ['always', 'Always allow'], ['never', 'Never']]
const FEWEST_HELPERS_AT_ONCE = 2
const MOST_HELPERS_AT_ONCE = 8
/** `HELPERS_AT_ONCE` in crates/maitty-settings: the daemon refuses any other limit. */
export const HELPERS_AT_ONCE_CHOICES: readonly number[] = [FEWEST_HELPERS_AT_ONCE, HELPERS_AT_ONCE_DEFAULT, MOST_HELPERS_AT_ONCE]

/** The two helper settings as the daemon last said them. */
export type HelperSettings = Pick<SharedSettings, HelperSettingKey>

/** What the page knows of them: nothing yet, what the daemon said, and why the last change did not happen. */
export type HelperSettingsState = {
  readonly said: HelperSettings | null
  readonly failure: string | null
}

export const HELPER_SETTINGS_UNKNOWN: HelperSettingsState = { said: null, failure: null }

/** The daemon said its settings: they are what shows, and an earlier failure is out of date. */
export function daemonSaid(shared: SharedSettings): HelperSettingsState {
  return { said: { helpers: shared.helpers, helpers_at_once: shared.helpers_at_once }, failure: null }
}

/** A change was refused or never reached the daemon: what it last said still shows, with why. */
export function changeFailed(state: HelperSettingsState, why: string): HelperSettingsState {
  return { ...state, failure: why }
}

/** Whether `picked` is worth sending: the daemon has said its settings, and this is not already one of them. */
export function isChange<K extends keyof HelperSettings>(state: HelperSettingsState, key: K, picked: HelperSettings[K]): boolean {
  return state.said !== null && state.said[key] !== picked
}
