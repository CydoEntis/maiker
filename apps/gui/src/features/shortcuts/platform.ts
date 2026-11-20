import { createContext, useContext } from 'react'
import { detectPlatform, NO_OVERRIDES, shortcutText, type KeyOverrides, type Platform, type ShortcutAction, type ShortcutView } from '@/features/workspace/model/shortcuts'

/** The platform the window runs on, read once from the user agent. */
const PlatformContext = createContext<Platform>(detectPlatform(typeof navigator === 'undefined' ? '' : navigator.userAgent))

export const usePlatform = (): Platform => useContext(PlatformContext)

/** The keys chosen in Settings › Hotkeys, so every tooltip and menu names the key that works. */
export const KeyOverridesContext = createContext<KeyOverrides>(NO_OVERRIDES)

export const useKeyOverrides = (): KeyOverrides => useContext(KeyOverridesContext)

/** The view the focused session shows, so every hint names the key that works in it. The terminal's until the window says otherwise. */
export const ShortcutViewContext = createContext<ShortcutView>('terminal')

export const useShortcutView = (): ShortcutView => useContext(ShortcutViewContext)

/** The platform's text for an action's key, such as `Ctrl+Shift+T` or `⌘T`; '' when the platform has none. */
export function useShortcutText(): (action: ShortcutAction) => string {
  const platform = usePlatform()
  const overrides = useKeyOverrides()
  const view = useShortcutView()
  return (action) => shortcutText(action, platform, overrides, view)
}

/** `Name (keys)` for a tooltip, or just the name when the platform has no key for the action. */
export function useTipWithKeys(): (name: string, action: ShortcutAction) => string {
  const text = useShortcutText()
  return (name, action) => {
    const keys = text(action)
    return keys === '' ? name : `${name} (${keys})`
  }
}
