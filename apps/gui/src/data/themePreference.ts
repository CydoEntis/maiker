// Written by an older build only: the settings carry the theme now, and this is read so an old choice carries over.
const STORAGE_KEY = 'maiker.gui.theme.v1'

export type ThemePreference = 'night' | 'abyss' | 'day'

const DEFAULT_THEME: ThemePreference = 'night'

export function readThemePreference(): ThemePreference {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Blocked storage reads as nothing saved.
  }
  if (stored === null) return DEFAULT_THEME
  if (stored === 'night' || stored === 'abyss' || stored === 'day') return stored

  console.warn('Ignoring unsupported Maiker theme preference')
  return DEFAULT_THEME
}
