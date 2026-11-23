import { describe, expect, it } from 'vitest'
import { contrastRatio, mixOklab, parseColor } from './color'
import themeManifest from '@tokens/themes.json'
import type { ThemeEntry } from './themes'
import { findTheme, MIN_TEXT_CONTRAST, onDanger, terminalMinimumContrast, themeStyle, THEMES, xtermTheme } from './themes'

const PALETTES = new Map(themeManifest.themes.flatMap((theme) => ('palette' in theme ? [[theme.name, theme.palette] as const] : [])))
/** The design's ten themes (handoff section 2), by the side each is drawn on. */
const DESIGN_THEMES = { dark: ['Maiker Dark', 'Graphite', 'Midnight', 'Ember', 'Forest'], light: ['Maiker Light', 'Paper', 'Mist', 'Sage', 'Rose'] }
const ROLE_NAMES = ['--t0', '--t1', '--t2', '--t3', '--float-bg', '--well', '--fg', '--fg2', '--muted', '--dim', '--needs', '--working', '--ok', '--danger', '--sy-kw', '--sy-str', '--sy-fn', '--sy-num', '--sy-ty', '--sy-com', '--sy-prop']

describe('themes', () => {
  it('draws every theme through the same roles: solid colours, an ink triple and a shadow strength', () => {
    for (const theme of THEMES) {
      const style = themeStyle(theme)
      for (const role of ROLE_NAMES) expect(parseColor(style[role] ?? '').a, `${theme.name} ${role}`).toBe(1)
      expect(style['--ink'], theme.name).toBe(theme.light ? '0,0,0' : '255,255,255')
      expect(Number(style['--shk']), theme.name).toBeGreaterThan(0)
    }
  })

  // One source of truth: a name from before the roles is only ever a reference to its role, so the two cannot disagree.
  it('defines each older name it keeps from a role, never with a colour of its own', () => {
    for (const theme of THEMES) {
      const style = themeStyle(theme)
      for (const name of ['--bg', '--main', '--pane', '--sel', '--raise', '--warn', '--hl', '--sk']) {
        const role = /^var\((--[a-z0-9-]+)\)$/.exec(style[name] ?? '')?.[1]
        expect(role, `${theme.name} ${name}`).toBeDefined()
        expect(style[role ?? ''], `${theme.name} ${name}`).toBeDefined()
      }
    }
  })

  it("ships the design's ten themes beside the others, each on its own side", () => {
    for (const name of DESIGN_THEMES.dark) expect(THEMES.find((theme) => theme.name === name)?.light, name).toBe(false)
    for (const name of DESIGN_THEMES.light) expect(THEMES.find((theme) => theme.name === name)?.light, name).toBe(true)
    expect(new Set(THEMES.map((theme) => theme.name)).size).toBe(THEMES.length)
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length)
  })

  it('gives every theme an opaque pane that is its main surface', () => {
    for (const theme of THEMES) {
      expect(theme.tokens.pane, theme.name).toBe(theme.tokens.main)
      expect(parseColor(theme.tokens.pane).a, theme.name).toBe(1)
    }
  })

  it('never changes what amber and red mean within a kind of theme', () => {
    // The design's themes set their own amber and red; every theme built from six inputs shares one of each.
    const generated = THEMES.filter((candidate) => !PALETTES.has(candidate.name))
    for (const theme of generated) {
      expect(theme.tokens.warn).toBe(theme.light ? '#8F5400' : '#F2B65A')
      const danger = theme.light ? '#B8362C' : '#F07F78'
      if (contrastRatio(danger, theme.tokens.term) >= MIN_TEXT_CONTRAST && contrastRatio(danger, theme.tokens.bg) >= MIN_TEXT_CONTRAST) {
        expect(theme.tokens.danger, theme.name).toBe(danger)
      } else {
        // A ground the red falls short on (Tokyo Night Day's window) moves it toward white until it reads, and it stays red.
        const { r, g, b } = parseColor(theme.tokens.danger)
        expect(r, theme.name).toBeGreaterThan(g)
        expect(r, theme.name).toBeGreaterThan(b)
      }
    }
  })

  it('mixes halfway between black and white to a mid grey in oklab', () => {
    const grey = parseColor(mixOklab('#000000', '#FFFFFF', 50))
    expect(grey.r).toBeCloseTo(grey.g, 3)
    expect(grey.r).toBeGreaterThan(0.3)
    expect(grey.r).toBeLessThan(0.5)
  })
})

describe('terminal palette', () => {
  it('selects with an opaque tint of the accent and keeps the text readable', () => {
    for (const theme of THEMES) {
      const palette = xtermTheme(theme.tokens)
      const selection = parseColor(palette.selectionBackground ?? '')
      expect(selection.a).toBe(1)
      expect(contrastRatio(palette.selectionForeground ?? '', palette.selectionBackground ?? ''), theme.name).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
  })
})

/** What the design's contrast table (GLASS_AND_TILED.md §3) measures: text on the terminal ground and on the window ground. */
const TEXT_GROUNDS = (tokens: ThemeEntry['tokens']) => [['--term', tokens.term], ['--bg', tokens.bg]] as const
const TERMINAL_TEXT_SLOTS = ['fg', 'fg2', 'muted', 'dim'] as const
const STATUS_TEXT_SLOTS = ['accentText', 'working', 'warn', 'danger', 'ok'] as const
const ANSI_TEXT_SLOTS = ['ansiBlue', 'ansiMag', 'ansiGreen'] as const
// Black is left out: it is the ground on purpose, so programs that paint with it vanish into the background.
const ANSI_TEXT_COLOURS = [
  'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const

/**
 * The design's own themes are drawn with its exact values, and these roles of theirs fall short of 4.5:1 on the pane or
 * the window ground. Each is held to the ratio it reaches (rounded down), so one that gets worse, and any other role or
 * theme under 4.5:1, still fails. An entry leaves this table when the design's value is corrected.
 */
type ShortRole = 'dim' | 'needs' | 'working' | 'ok' | 'danger'
const DESIGN_SHORTFALLS: Record<string, Partial<Record<ShortRole, number>>> = {
  'Maiker Light': { dim: 3.3, needs: 3.5, working: 3.6, ok: 3.9, danger: 4.2 },
  Paper: { dim: 2.9, needs: 3.2, working: 3.3, ok: 3.6, danger: 3.8 },
  Mist: { dim: 2.9, needs: 3.5, working: 3.6, ok: 3.8, danger: 4.1 },
  Sage: { dim: 2.9, needs: 3.4, working: 3.5, ok: 3.8, danger: 4.0 },
  Rose: { dim: 3.0, needs: 3.4, working: 3.5, ok: 3.8, danger: 4.0 },
  Graphite: { dim: 4.4 },
  Midnight: { dim: 4.3 },
}

/** The ratio a colour of this theme must reach as text: 4.5:1, or its recorded shortfall when it is one of the design's roles above. */
function floorOf(theme: ThemeEntry, colour: string | undefined): number {
  const short = Object.entries(DESIGN_SHORTFALLS[theme.name] ?? {}).find(([role]) => theme.roles[role as ShortRole] === colour)
  return short?.[1] ?? MIN_TEXT_CONTRAST
}

describe('contrast audit', () => {
  it('records a shortfall only for a role that really falls short', () => {
    for (const [name, roles] of Object.entries(DESIGN_SHORTFALLS)) {
      const theme = findTheme(name)
      expect(theme.name).toBe(name)
      for (const role of Object.keys(roles) as ShortRole[]) {
        const reached = Math.min(contrastRatio(theme.roles[role], theme.roles.t0), contrastRatio(theme.roles[role], theme.roles.t1))
        expect(reached, `${name} ${role}`).toBeLessThan(MIN_TEXT_CONTRAST)
      }
    }
  })


  it.each(THEMES.map((theme) => [theme.name, theme] as const))('%s keeps a filled button readable: accent, warn and danger', (_name, theme) => {
    const { tokens } = theme
    expect(contrastRatio(tokens.onAccent, tokens.accent), 'label on accent').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    expect(contrastRatio(tokens.onWarn, tokens.warn), 'label on warn').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    expect(contrastRatio(onDanger(tokens), tokens.danger), 'label on danger').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    expect(themeStyle(theme)['--on-danger']).toBe(onDanger(tokens))
  })

  it.each(THEMES.map((theme) => [theme.name, theme] as const))('%s keeps text, terminal text and dim text readable on --term and --bg', (_name, theme) => {
    for (const [ground, colour] of TEXT_GROUNDS(theme.tokens)) {
      for (const slot of TERMINAL_TEXT_SLOTS) {
        expect(contrastRatio(theme.tokens[slot], colour), `${slot} on ${ground}`).toBeGreaterThanOrEqual(floorOf(theme, theme.tokens[slot]))
      }
      const palette = xtermTheme(theme.tokens)
      expect(contrastRatio(palette.foreground ?? '', colour), `terminal foreground on ${ground}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
      expect(contrastRatio(palette.brightBlack ?? '', colour), `terminal dim text on ${ground}`).toBeGreaterThanOrEqual(floorOf(theme, palette.brightBlack))
    }
  })

  it('keeps accent, status and ANSI text readable on --term and --bg in every light theme', () => {
    for (const theme of THEMES.filter((candidate) => candidate.light)) {
      for (const [ground, colour] of TEXT_GROUNDS(theme.tokens)) {
        for (const slot of [...STATUS_TEXT_SLOTS, ...ANSI_TEXT_SLOTS]) {
          expect(contrastRatio(theme.tokens[slot], colour), `${theme.name} ${slot} on ${ground}`).toBeGreaterThanOrEqual(floorOf(theme, theme.tokens[slot]))
        }
      }
    }
  })

  it('keeps every ANSI colour but black readable on --term and --bg in every light theme', () => {
    for (const theme of THEMES.filter((candidate) => candidate.light)) {
      const palette = xtermTheme(theme.tokens)
      for (const slot of ANSI_TEXT_COLOURS) {
        for (const [ground, colour] of TEXT_GROUNDS(theme.tokens)) {
          expect(contrastRatio(palette[slot] ?? '', colour), `${theme.name} ${slot} on ${ground}`).toBeGreaterThanOrEqual(floorOf(theme, palette[slot]))
        }
      }
    }
  })

  it('keeps accent, status, ANSI slots and every ANSI colour but black readable on --term and --bg in every dark theme', () => {
    for (const theme of THEMES.filter((candidate) => !candidate.light)) {
      const palette = xtermTheme(theme.tokens)
      for (const [ground, colour] of TEXT_GROUNDS(theme.tokens)) {
        for (const slot of [...STATUS_TEXT_SLOTS, ...ANSI_TEXT_SLOTS]) {
          expect(contrastRatio(theme.tokens[slot], colour), `${theme.name} ${slot} on ${ground}`).toBeGreaterThanOrEqual(floorOf(theme, theme.tokens[slot]))
        }
        for (const slot of ANSI_TEXT_COLOURS) {
          expect(contrastRatio(palette[slot] ?? '', colour), `${theme.name} ${slot} on ${ground}`).toBeGreaterThanOrEqual(floorOf(theme, palette[slot]))
        }
      }
    }
  })

  it('darkens a pastel light hue without leaving its family (Solarized Light cyan stays teal)', () => {
    const { tokens } = findTheme('Solarized Light')
    const { r, g, b } = parseColor(tokens.accent)
    expect(g).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(r)
  })

  it('asks xterm to lift the colours a program picks itself on light themes only', () => {
    expect(terminalMinimumContrast(findTheme('Maiker Day'))).toBe(MIN_TEXT_CONTRAST)
    expect(terminalMinimumContrast(findTheme('Maiker Dark'))).toBe(1)
  })
})
