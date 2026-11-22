/**
 * The working spinner styles the shared settings store. The desktop draws its own working mark (`StatusIcon`); the
 * choice is kept so the TUI's setting survives the desktop saving the shared settings.
 */

/** The Maiker TUI's spinners: a few Braille characters stepped in turn. */
export type TuiSpinner = 'braille' | 'snake' | 'bars' | 'blocks' | 'line'
/** Styles an older desktop drew as inline SVG; the TUI has no frames for them. */
export type WebSpinner = 'circle' | 'dots' | 'equalizer' | 'spokes' | 'ping'
export type SpinnerStyle = TuiSpinner | WebSpinner

export const TUI_SPINNERS: ReadonlyArray<readonly [TuiSpinner, string]> = [['blocks', 'Blocks'], ['braille', 'Braille'], ['snake', 'Snake'], ['bars', 'Bars'], ['line', 'Line']]
export const WEB_SPINNERS: ReadonlyArray<readonly [WebSpinner, string]> = [['circle', 'Circle'], ['dots', 'Dots'], ['equalizer', 'Equalizer'], ['spokes', 'Spokes'], ['ping', 'Ping']]

export function isSpinnerStyle(value: unknown): value is SpinnerStyle {
  return [...TUI_SPINNERS, ...WEB_SPINNERS].some(([id]) => id === value)
}

export function isWebSpinner(style: SpinnerStyle): style is WebSpinner {
  return WEB_SPINNERS.some(([id]) => id === style)
}

// Frames mirror the TUI spinners in crates/maitty-settings/src/config.rs.
const SPINNERS: Record<TuiSpinner, readonly string[]> = {
  braille: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  snake: ['⠇', '⠋', '⠙', '⠸', '⢰', '⣠', '⣄', '⡆'],
  bars: ['⣰⡄', '⣼⡀', '⣶⡆', '⣧⡇', '⣆⡆', '⣤⡄', '⣸⡆', '⣴⡇', '⣇⡄', '⣦⡀'],
  blocks: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃', '▂'],
  line: ['|', '/', '-', '\\'],
}

/** The frames of a TUI spinner: what the shared config stores for it. */
export function framesOfTuiSpinner(spinner: TuiSpinner): readonly string[] {
  return SPINNERS[spinner]
}

/** The TUI spinner whose frames these are, or null when they are a custom set. */
export function tuiSpinnerOfFrames(frames: readonly string[]): TuiSpinner | null {
  const found = TUI_SPINNERS.find(([id]) => SPINNERS[id].length === frames.length && SPINNERS[id].every((frame, index) => frame === frames[index]))
  return found?.[0] ?? null
}
