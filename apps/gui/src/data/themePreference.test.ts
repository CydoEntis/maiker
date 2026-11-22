import { beforeEach, describe, expect, it } from 'vitest'
import { readThemePreference } from './themePreference'

describe('theme preference', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('restores the saved Paper theme', () => {
    localStorage.setItem('maiker.gui.theme.v1', 'day')

    expect(readThemePreference()).toBe('day')
  })

  it('ignores unsupported saved themes', () => {
    localStorage.setItem('maiker.gui.theme.v1', 'neon')

    expect(readThemePreference()).toBe('night')
  })
})
