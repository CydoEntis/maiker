import type { SettingsPreferences } from '@/features/settings/preferences'

/**
 * The widest the chat's column runs, for each choice. `auto` is the design's column on a small pane and grows with a
 * large one (to 62% of the pane, 1100px at most), so the chat is not a narrow strip on a big screen.
 */
const CHAT_WIDTH: Readonly<Record<SettingsPreferences['chatWidth'], string>> = {
  auto: 'max(760px, min(1100px, 62%))',
  narrow: '760px',
  wide: '1100px',
  full: '100%',
}
const PERCENT = 100

/** The CSS variables the window's size rules read, so one setting resizes every rule that uses it. */
export function sizeVariables(preferences: Pick<SettingsPreferences, 'chatWidth' | 'chatTextSize'>, sidebarWidth: number): Record<string, string> {
  return {
    '--sidebar-w': `${String(sidebarWidth)}px`,
    '--chat-width': CHAT_WIDTH[preferences.chatWidth],
    '--chat-zoom': String(preferences.chatTextSize / PERCENT),
  }
}
