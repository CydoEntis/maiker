import { describe, expect, it } from 'vitest'
import { SharedSettingsSchema } from '@/api/sharedSettings'
import { changeFailed, daemonSaid, HELPER_SETTINGS_UNKNOWN, HELPERS_AT_ONCE_CHOICES, isChange } from './helperSettings'

const BASE = { default_agent: 'claude', new_session_view: 'chat', sidebar_side: 'left', theme_dark: 'night', theme_light: 'day', appearance: 'dark', spinner: ['a'], start_dir: '', reduce_motion: false }

describe('the helper settings as the daemon says them', () => {
  it('reads a daemon from before the settings as asking, at the default limit', () => {
    const old = SharedSettingsSchema.parse(BASE)
    expect(daemonSaid(old).said).toEqual({ helpers: 'ask', helpers_at_once: 4 })
    expect(HELPERS_AT_ONCE_CHOICES).toContain(old.helpers_at_once)
  })

  it('shows what the daemon said, and drops an earlier failure when it speaks again', () => {
    const shared = SharedSettingsSchema.parse({ ...BASE, helpers: 'never', helpers_at_once: 8 })
    const failed = changeFailed(daemonSaid(shared), 'the service is older than this app')
    expect(failed).toEqual({ said: { helpers: 'never', helpers_at_once: 8 }, failure: 'the service is older than this app' })
    expect(daemonSaid(shared).failure).toBeNull()
  })

  it('sends only a real change, and nothing before the daemon has said its settings', () => {
    const said = daemonSaid(SharedSettingsSchema.parse({ ...BASE, helpers: 'ask', helpers_at_once: 4 }))
    expect(isChange(said, 'helpers', 'always')).toBe(true)
    expect(isChange(said, 'helpers', 'ask')).toBe(false)
    expect(isChange(said, 'helpers_at_once', 4)).toBe(false)
    expect(isChange(HELPER_SETTINGS_UNKNOWN, 'helpers_at_once', 8)).toBe(false)
  })

  it('refuses a value the daemon could not have sent', () => {
    expect(SharedSettingsSchema.safeParse({ ...BASE, helpers: 'sometimes' }).success).toBe(false)
  })
})
