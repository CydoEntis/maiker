import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { readSettingsPreferences } from '@/features/settings/preferences'
import { usePreferenceEffects } from './usePreferenceEffects'

describe('the settings marked on the page', () => {
  beforeEach(() => { localStorage.clear() })

  it('turns the file-name colours on and off with Colour file names', () => {
    const preferences = readSettingsPreferences()
    const { rerender } = renderHook((props: { colourFileNames: boolean }) => {
      usePreferenceEffects({ preferences: { ...preferences, ...props }, reducedMotion: false })
    }, { initialProps: { colourFileNames: true } })
    expect(document.documentElement.dataset.fileColours).toBe('on')
    rerender({ colourFileNames: false })
    expect(document.documentElement.dataset.fileColours).toBe('off')
  })
})
