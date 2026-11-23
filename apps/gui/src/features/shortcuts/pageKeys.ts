import type { KeyInput, Platform } from '@/features/workspace/model/shortcuts'

/**
 * The keys the web view answers itself as if the window were a web page: reload, print, its own find bar, caret
 * browsing and history. Maiker takes no plain Ctrl+letter, so nothing else stops them, and a reload would drop the
 * window's state. Only the page's default is cancelled: the key still reaches the terminal or the field with the
 * focus, where F5, F3, Ctrl+R and the rest are a program's own keys.
 */
const PLAIN_KEYS: ReadonlySet<string> = new Set(['f5', 'f3', 'f7', 'browserback', 'browserforward', 'browserrefresh'])
const PRIMARY_LETTERS: ReadonlySet<string> = new Set(['r', 'p', 'f', 'g', 'j'])
const HISTORY_ARROWS: ReadonlySet<string> = new Set(['arrowleft', 'arrowright'])

/** Whether the web view would act on this key press as a browser does. */
export function isPageKey(event: KeyInput, platform: Platform): boolean {
  const key = event.key.toLowerCase()
  if (PLAIN_KEYS.has(key)) return true
  const primary = platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (primary && !event.altKey && PRIMARY_LETTERS.has(key)) return true
  // Alt with ← or → on Windows and Linux, ⌘ with [ or ] on macOS: back and forward.
  if (platform === 'mac') return event.metaKey && !event.altKey && !event.ctrlKey && (event.code === 'BracketLeft' || event.code === 'BracketRight')
  return event.altKey && !event.ctrlKey && !event.metaKey && HISTORY_ARROWS.has(key)
}
