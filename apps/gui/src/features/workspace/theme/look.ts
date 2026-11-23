import type { StyleLook, ThemeEntry } from './themes'

/** The desktop has one look: the design's flat, rounded panels, Inter with JetBrains Mono. Its corners are the `--r-*` tokens in `tokens.css`. */
const INTER = "'Inter Variable','Inter',system-ui,sans-serif"
const JETBRAINS_MONO = "'JetBrains Mono Variable','JetBrains Mono',monospace"

/**
 * The one look's fonts and highlight strength, for a theme that does not set its own (`ThemeEntry.highlight`, the
 * palette themes do). No sheen: the design's panels are flat.
 */
const LOOK: { dark: StyleLook; light: StyleLook } = {
  dark: { ui: INTER, mono: JETBRAINS_MONO, hk: '.7', sh: 'none' },
  light: { ui: INTER, mono: JETBRAINS_MONO, hk: '1', sh: 'none' },
}

/** The theme as the window draws it: its own colours, with the look's fonts and shading laid over them. */
export function withLook(theme: ThemeEntry): ThemeEntry {
  return { ...theme, look: theme.light ? LOOK.light : LOOK.dark }
}
