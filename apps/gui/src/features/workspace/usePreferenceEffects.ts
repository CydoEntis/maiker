import { useEffect } from 'react'
import { setInterfaceZoom } from '@/api/interfaceZoom'
import { toast } from '@/lib/toast'
import { type SettingsPreferences, writeSettingsPreferences } from '@/features/settings/preferences'
import { markGpu } from '@/lib/gpu'
import { isWindowShown, subscribeWindowActivity } from '@/lib/window-activity'

const PERCENT = 100

/** Saves the settings and marks them on the page, where the stylesheet reads them, and sizes the window. */
export function usePreferenceEffects({ preferences, reducedMotion }: {
  preferences: SettingsPreferences
  reducedMotion: boolean
}) {
  useEffect(() => {
    try {
      writeSettingsPreferences(preferences)
    } catch (error) {
      toast.failed('Could not save settings', error)
    }
  }, [preferences])

  useEffect(() => {
    setInterfaceZoom(preferences.interfaceSize / PERCENT).catch((error: unknown) => { toast.failed('Could not change the interface size', error) })
  }, [preferences.interfaceSize])

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion)
  }, [reducedMotion])

  useEffect(() => {
    document.documentElement.dataset.fileColours = preferences.colourFileNames ? 'on' : 'off'
  }, [preferences.colourFileNames])

  useEffect(() => { markGpu() }, [])

  // Looping effects pause in the stylesheet while the window is hidden or in the background. It is an
  // attribute on <html>, not React state, so a focus change repaints nothing and re-renders nothing.
  useEffect(() => {
    const mark = () => { document.documentElement.dataset.window = isWindowShown() ? 'active' : 'inactive' }
    mark()
    return subscribeWindowActivity(mark)
  }, [])
}
