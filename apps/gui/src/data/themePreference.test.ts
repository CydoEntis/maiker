import { beforeEach, describe, expect, it } from 'vitest'
import { readThemePreference, writeThemePreference } from './themePreference'

describe('theme preference', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('restores the saved Paper theme', () => {
    writeThemePreference('day')

    expect(readThemePreference()).toBe('day')
  })

  it('ignores unsupported saved themes', () => {
    localStorage.setItem('maiker.gui.theme.v1', 'neon')

    expect(readThemePreference()).toBe('night')
  })
})
