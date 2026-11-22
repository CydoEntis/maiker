import { describe, expect, it } from 'vitest'
import type { SharedSettings } from '@/api/sharedSettings'
import { framesOfTuiSpinner } from '@/lib/spinner-clock'
import { readSettingsPreferences } from './preferences'
import { applyShared, changesToSend, sharedFrom } from './sharedSettings'

const SHARED: SharedSettings = {
  default_agent: 'codex',
  new_session_view: 'terminal',
  sidebar_side: 'right',
  theme_dark: 'tokyo-night',
  theme_light: 'day',
  appearance: 'light',
  spinner: [...framesOfTuiSpinner('snake')],
  start_dir: '/srv',
  reduce_motion: true,
  bypass_off: ['gemini'],
  update_machines: false,
}

describe('the settings shared with the terminal app', () => {
  it('reads a daemon from before the Bypass Permissions switches as every agent on', async () => {
    const { SharedSettingsSchema } = await import('@/api/sharedSettings')
    const older: Partial<SharedSettings> = { ...SHARED }
    delete older.bypass_off
    expect(SharedSettingsSchema.parse(older).bypass_off).toEqual([])
  })

  it('reads a daemon from before the remote update switch as updating machines, and sends the switch turned off', async () => {
    const { SharedSettingsSchema } = await import('@/api/sharedSettings')
    const older: Partial<SharedSettings> = { ...SHARED }
    delete older.update_machines
    expect(SharedSettingsSchema.parse(older).update_machines).toBe(true)
    const before = readSettingsPreferences()
    expect(changesToSend(before, { ...before, updateMachines: false }, { ...SHARED, update_machines: true })).toEqual([['update_machines', false]])
  })

  it('sends a Bypass Permissions switch turned off here, and nothing else', () => {
    const before = readSettingsPreferences()
    const after = { ...before, bypassOff: ['codex' as const] }
    expect(changesToSend(before, after, { ...SHARED, bypass_off: [] })).toEqual([['bypass_off', ['codex']]])
  })

  it('lays what the daemon says over the preferences', () => {
    const next = applyShared({ ...readSettingsPreferences(), themeMode: 'dark' }, SHARED)
    expect(next).toMatchObject({
      defaultAgent: 'codex', sidebarSide: 'right', darkTheme: 'Tokyo Night', lightTheme: 'Maiker Day',
      themeMode: 'light', spinner: 'snake', startFolder: '/srv', reduceMotion: true, bypassOff: ['gemini'],
      updateMachines: false,
    })
  })

  it('keeps what this window can hold and the shared config cannot', () => {
    const own = { ...readSettingsPreferences(), themeMode: 'system' as const, spinner: 'circle' as const, defaultAgent: 'claude' as const }
    const next = applyShared(own, { ...SHARED, default_agent: 'last used', theme_dark: 'No such theme', spinner: ['x', 'y'] })
    expect(next).toMatchObject({ themeMode: 'system', spinner: 'circle', defaultAgent: 'claude', darkTheme: own.darkTheme })
  })

  it('does not name a key it cannot write: System mode and a web spinner stay home', () => {
    const shared = sharedFrom({ ...readSettingsPreferences(), themeMode: 'system', spinner: 'ping' })
    expect(shared).not.toHaveProperty('appearance')
    expect(shared).not.toHaveProperty('spinner')
    expect(sharedFrom({ ...readSettingsPreferences(), themeMode: 'dark', spinner: 'bars' })).toMatchObject({ appearance: 'dark', spinner: [...framesOfTuiSpinner('bars')] })
  })

  it('sends only what the user changed and the daemon does not already have', () => {
    const before = applyShared(readSettingsPreferences(), SHARED)
    expect(changesToSend(before, before, SHARED)).toEqual([])
    expect(changesToSend(before, { ...before, sidebarSide: 'left', reduceMotion: false }, SHARED)).toEqual([['sidebar_side', 'left'], ['reduce_motion', false]])
    // A change the daemon already reported (it came from the other app) is not sent back.
    expect(changesToSend(before, { ...before, sidebarSide: 'right' }, SHARED)).toEqual([])
    // A stand-in for the shared "last used" is not an edit, so it never overwrites it.
    expect(changesToSend(before, { ...before }, { ...SHARED, default_agent: 'last used' })).toEqual([])
  })
})
