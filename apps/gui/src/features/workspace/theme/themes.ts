import type { ITheme } from '@xterm/xterm'
import maittyTokens from '@tokens/maitty-tokens.json'
import themeManifest from '@tokens/themes.json'
import { atLightnessOf, channelsOf, chromaOf, composite, greyOf, contrastRatio, luminance, mixOklab, withAlpha } from './color'

/** The design's seven syntax colours, by what they colour: keyword, string, function or name, number, type, comment, property. */
export type SyntaxRoles = { kw: string; str: string; fn: string; num: string; ty: string; com: string; prop: string }

/**
 * The design's roles (docs/DESIGN.md, "Tokens, not colours"): the canonical token set. Every theme is drawn through
 * these, and `themeStyle` is the one function that turns them into CSS variables. `ink` is an `r,g,b` triple, so a
 * hairline or hover fill is `rgba(var(--ink), .08)`; `shadow` is the strength every floating shadow is scaled by.
 */
export type DesignRoles = {
  t0: string; t1: string; t2: string; t3: string; floatBg: string; well: string
  fg: string; fg2: string; muted: string; dim: string
  ink: string
  needs: string; working: string; ok: string; danger: string
  sy: SyntaxRoles
  shadow: string
}

/**
 * A theme as it is built: the roles under the names the app had before the design's (`bg` is `t0`, `main` and `pane`
 * are `t1`, `sel` is `t2`, `raise` is `t3`, `warn` is needs), plus the roles the design does not name (the accent, the
 * ANSI colours, the meters, the terminal ground). `designRoles` reads the design's roles off it.
 */
export type ThemeTokens = {
  bg: string
  main: string
  raise: string
  hover: string
  sel: string
  line: string
  line2: string
  well: string
  term: string
  fg: string
  fg2: string
  muted: string
  dim: string
  accent: string
  /** The accent as text on the card: the same brass, darkened where the ground is light. */
  accentText: string
  /** What "working" is drawn in; nothing else is this colour. */
  working: string
  accentSoft: string
  accentLine: string
  onAccent: string
  warn: string
  warnSoft: string
  warnLine: string
  onWarn: string
  danger: string
  dangerSoft: string
  dangerLine: string
  ok: string
  ansiBlue: string
  ansiMag: string
  ansiGreen: string
  pane: string
  paneLine: string
  /** The usage meters' four steps, from low to high use: comfortable, half, getting close, nearly out. */
  meterOk: string
  meterMid: string
  meterHigh: string
  meterMax: string
}

/**
 * A theme the desktop design draws exactly (`themes.json`'s `palette`): every colour role as written, plus the two
 * shading strengths (`hk` for highlights and hovers, `sk` for shadows and scrims).
 */
export type ThemePalette = {
  bg: string; main: string; raise: string; hover: string; sel: string; line: string; line2: string; well: string; term: string
  fg: string; fg2: string; muted: string; dim: string
  accent: string; accentText: string; onAccent: string; accentLine: string
  working: string; warn: string; onWarn: string; danger: string; ok: string; blue: string; mag: string
  paneLine: string; mOk: string; mMid: string; mOr: string; mHi: string; hk: string; sk: string
  /** The design's own themes also write the float ground and the syntax colours; another palette theme derives them. */
  float?: string; sy?: SyntaxRoles
}

/** The six colours (and a light flag) a theme is made from; a TUI theme imports as these. */
export type ThemeInputs = { bg: string; fg: string; accent: string; mag: string; blue: string; green: string; light: boolean }

/**
 * What the look (`look.ts`) adds to a theme besides colours: the fonts, the highlight strength (`hk`) and the
 * resting card sheen (`sh`). A field left out keeps the stylesheet's default.
 */
export type StyleLook = { ui: string; mono: string; hk?: string; sh?: string }

/**
 * `roles` is what the window draws; `tokens` is what they were read from and what the terminal palette is built from.
 * `cardRing` is the solid card colour that rings a status badge so it reads as cut out of the card. `look` is set by
 * `withLook` (`look.ts`); `highlight` is a palette theme's own highlight strength, which wins over the look's.
 */
export type ThemeEntry = { id: string; name: string; family: string; light: boolean; roles: DesignRoles; tokens: ThemeTokens; cardRing: string; look?: StyleLook; highlight?: string }

/** Which theme is in use: the dark theme, the light theme, or whichever one the system's own setting asks for. */
export type ThemeMode = 'system' | 'dark' | 'light'

export const DEFAULT_THEME = 'Maiker Dark'
export const DEFAULT_LIGHT_THEME = 'Maiker Day'
export const MIN_TEXT_CONTRAST = 4.5

/** The design's roles as CSS variables: the canonical names, the only ones a new component reads. */
const ROLE_VARIABLES: Record<Exclude<keyof DesignRoles, 'sy'>, string> = {
  t0: '--t0', t1: '--t1', t2: '--t2', t3: '--t3', floatBg: '--float-bg', well: '--well',
  fg: '--fg', fg2: '--fg2', muted: '--muted', dim: '--dim', ink: '--ink',
  needs: '--needs', working: '--working', ok: '--ok', danger: '--danger', shadow: '--shk',
}
const SYNTAX_VARIABLES: Record<keyof SyntaxRoles, string> = {
  kw: '--sy-kw', str: '--sy-str', fn: '--sy-fn', num: '--sy-num', ty: '--sy-ty', com: '--sy-com', prop: '--sy-prop',
}

/**
 * COMPATIBILITY: the names screens read from before the design's roles. Each is defined from its role here and nowhere
 * else, so the roles stay the one source of truth while those screens are rebuilt; a rebuilt screen reads the role, and
 * a name leaves this block when nothing reads it. `--hl` is the highlight colour (now the ink), `--sk` the shadow strength.
 */
const COMPATIBILITY: Record<string, string> = {
  '--bg': 'var(--t0)', '--main': 'var(--t1)', '--pane': 'var(--t1)', '--sel': 'var(--t2)', '--raise': 'var(--t3)',
  '--warn': 'var(--needs)', '--hl': 'var(--ink)', '--sk': 'var(--shk)',
}

/** The roles the design does not name, which a theme still sets itself: borders and hover as solid colours, the accent, the status inks and tints, the ANSI colours, the meters and the terminal ground. */
const OWN_VARIABLES = {
  hover: '--hover', line: '--line', line2: '--line2', term: '--term',
  accent: '--accent', accentText: '--accent-text', accentSoft: '--accent-soft', accentLine: '--accent-line', onAccent: '--on-accent',
  warnSoft: '--warn-soft', warnLine: '--warn-line', onWarn: '--on-warn', dangerSoft: '--danger-soft', dangerLine: '--danger-line',
  ansiBlue: '--ansi-blue', ansiMag: '--ansi-mag', ansiGreen: '--ansi-green', paneLine: '--pane-line',
  meterOk: '--m-ok', meterMid: '--m-mid', meterHigh: '--m-or', meterMax: '--m-hi',
} as const satisfies Partial<Record<keyof ThemeTokens, string>>

const DARK_STATUS = { warn: '#F2B65A', warnSoft: 'rgba(242,182,90,.07)', warnLine: 'rgba(242,182,90,.28)', onWarn: '#151007', danger: '#F07F78', dangerSoft: 'rgba(240,127,120,.07)', dangerLine: 'rgba(240,127,120,.3)' }
// Dark enough for AA on the grounds of every generated light theme (Gruvbox Light's cream is the tightest).
const LIGHT_STATUS = { warn: '#8F5400', warnSoft: 'rgba(143,84,0,.07)', warnLine: 'rgba(143,84,0,.3)', onWarn: '#FFFFFF', danger: '#B8362C', dangerSoft: 'rgba(184,54,44,.06)', dangerLine: 'rgba(184,54,44,.3)' }
/** The usage meters' steps for a theme without a palette of its own, as the desktop design draws them on dark and light grounds. */
const DARK_METERS = { meterOk: '#7fd99a', meterMid: '#e8c25a', meterHigh: '#f0964a', meterMax: '#ef5350' }
const LIGHT_METERS = { meterOk: '#2e7d32', meterMid: '#9a6b00', meterHigh: '#c25e00', meterMax: '#c62828' }





// Mix percentages from the design; `fg2`, `muted` and `dim` are raised when a theme would fall below
// MIN_TEXT_CONTRAST against the terminal ground or the window ground.
const MIX = {
  raiseDark: 7, raiseLight: 5, hover: 5, sel: 10, line: 9, line2: 15, bgDark: 21, bgLight: 4, wellDark: 25, wellLight: 3,
  fg2: 80, muted: 62, dim: 52, accentSoft: 13, accentLine: 50, paneLine: 10, contrastStep: 2, full: 100,
}

/**
 * Maiker's own themes, built from `maitty-tokens.json` (the TUI reads the same file, and also builds Night from it): Day
 * (sea-glass green) and Dark and Light (a standard black and white ground with the same accents), in sea-glass and brass. Teal means
 * only "working" (`working`), coral only "needs you" (`warn`), brass is the accent. Text uses the file's *Text colours
 * so every pair meets AA; fills (a button's brass) use the fill colours with their *On ink.
 */
/** How far the tokens file's colours are mixed to make the roles it does not name (percent). */
const MAIKER_MIX = { hover: 50, line2: 40, muted: 50, warnSoft: 7, warnLine: 30, paneLine: 8 }
type MaittySide = typeof maittyTokens.night
function maittyTheme(side: MaittySide, light: boolean): ThemeTokens {
  const { bg, line, text, accent, state } = side
  const status = light ? LIGHT_STATUS : DARK_STATUS
  return {
    bg: bg.page, main: bg.card, pane: bg.card, term: bg.terminal,
    raise: bg.surface, hover: mixOklab(bg.card, bg.selected, MAIKER_MIX.hover), sel: bg.selected,
    line: line.default, line2: mixOklab(line.default, text.dim, MAIKER_MIX.line2), well: bg.depth3,
    fg: text.strong, fg2: text.body, muted: mixOklab(text.body, text.dim, MAIKER_MIX.muted), dim: text.dim,
    accent: accent.brass, accentText: accent.brassText, onAccent: accent.brassOn,
    accentSoft: withAlpha(accent.brass, MIX.accentSoft), accentLine: withAlpha(accent.brass, MIX.accentLine),
    working: state.workingText,
    warn: state.needsText, warnSoft: withAlpha(state.needs, MAIKER_MIX.warnSoft), warnLine: withAlpha(state.needs, MAIKER_MIX.warnLine), onWarn: state.needsOn,
    danger: status.danger, dangerSoft: status.dangerSoft, dangerLine: status.dangerLine,
    ok: state.doneText,
    ansiBlue: light ? '#2F5FD0' : '#82AAFF', ansiMag: light ? '#8146C9' : '#C3A6F2', ansiGreen: state.doneText,
    paneLine: withAlpha(text.strong, MAIKER_MIX.paneLine),
    ...(light ? LIGHT_METERS : DARK_METERS),
  }
}

/** How strong a palette theme's soft fills are (percent of the colour), as the design tints them. */
const PALETTE_MIX = { accentSoft: 13, warnSoft: 7, warnLine: 30, dangerSoft: 7, dangerLine: 30 }

/**
 * A theme from the desktop design's palette, drawn exactly as written: no role is mixed or shifted. Only the soft fills
 * and lines the palette does not name are made from its own colours. The card and the pane are the palette's `main`.
 */
export function paletteTheme(palette: ThemePalette): ThemeTokens {
  return {
    bg: palette.bg, main: palette.main, raise: palette.raise, hover: palette.hover, sel: palette.sel,
    line: palette.line, line2: palette.line2, well: palette.well, term: palette.term,
    fg: palette.fg, fg2: palette.fg2, muted: palette.muted, dim: palette.dim,
    accent: palette.accent, accentText: palette.accentText, onAccent: palette.onAccent, accentLine: palette.accentLine,
    accentSoft: withAlpha(palette.accent, PALETTE_MIX.accentSoft),
    working: palette.working,
    warn: palette.warn, onWarn: palette.onWarn,
    warnSoft: withAlpha(palette.warn, PALETTE_MIX.warnSoft), warnLine: withAlpha(palette.warn, PALETTE_MIX.warnLine),
    danger: palette.danger,
    dangerSoft: withAlpha(palette.danger, PALETTE_MIX.dangerSoft), dangerLine: withAlpha(palette.danger, PALETTE_MIX.dangerLine),
    ok: palette.ok,
    ansiBlue: palette.blue, ansiMag: palette.mag, ansiGreen: palette.ok,
    pane: palette.main, paneLine: palette.paneLine,
    meterOk: palette.mOk, meterMid: palette.mMid, meterHigh: palette.mOr, meterMax: palette.mHi,
  }
}
const MAIKER_DAY = maittyTheme(maittyTokens.day, true)
const MAIKER_DARK = maittyTheme(maittyTokens.dark, false)
const MAIKER_LIGHT = maittyTheme(maittyTokens.light, true)

const SHIFT_STEP = 2
// The design's panel. Every generated dark theme sits its panel at this depth and keeps its own hue, so the surface steps
// above and below it (window ground, card, hairline, selected row) land where the design's do in any theme.
const DESIGN_PANEL = '#151517'

/** Mixes a colour toward black (light themes) or white (dark themes) a step at a time until it reads as text on every ground. */
function shiftUntilReadable(colour: string, grounds: readonly string[], toward: string): string {
  let percent = 0
  const passes = (candidate: string) => grounds.every((ground) => contrastRatio(candidate, ground) >= MIN_TEXT_CONTRAST)
  while (percent < MIX.full && !passes(mixOklab(colour, toward, percent))) percent += SHIFT_STEP
  return mixOklab(colour, toward, percent)
}

/** Builds every token from a theme's six inputs, as the TUI themes import. */
export function generateTheme(inputs: ThemeInputs): ThemeTokens {
  const { accent, mag, blue, green, light } = inputs
  const bg = light ? inputs.bg : atLightnessOf(inputs.bg, DESIGN_PANEL)
  const towardFg = (percent: number) => mixOklab(bg, inputs.fg, percent)
  const windowBg = light ? towardFg(MIX.bgLight) : mixOklab(bg, '#000000', MIX.bgDark)
  // The foreground is lifted (or darkened) in place if a theme's own would fall short on the window ground (Tokyo Night Day).
  const fg = shiftUntilReadable(inputs.fg, [bg, windowBg], light ? '#000000' : '#FFFFFF')
  // Text sits on the card and terminal ground (`bg`) and, in the sidebar's gaps and the status bar, on the window ground.
  const readable = (start: number) => {
    let percent = start
    const passes = (candidate: string) => contrastRatio(candidate, bg) >= MIN_TEXT_CONTRAST && contrastRatio(candidate, windowBg) >= MIN_TEXT_CONTRAST
    while (percent < MIX.full && !passes(mixOklab(bg, fg, percent))) percent += MIX.contrastStep
    return mixOklab(bg, fg, Math.min(percent, MIX.full))
  }
  // A light theme's published hues (Solarized cyan, Latte green) are pastel against its own ground, so
  // they are darkened in place (same hue, less lightness) until they read as text on both grounds.
  // A dark theme's mid-tone hues (Solarized blue, Zenburn red) fall short the other way, so they are
  // lightened in place instead.
  const hue = (colour: string) => shiftUntilReadable(colour, [bg, windowBg], light ? '#000000' : '#FFFFFF')
  const baseStatus = light ? LIGHT_STATUS : DARK_STATUS
  // Only the text colours move; the soft and line tints keep the published hue.
  const status = { ...baseStatus, warn: hue(baseStatus.warn), danger: hue(baseStatus.danger) }
  const [accentText, magText, blueText, greenText] = [hue(accent), hue(mag), hue(blue), hue(green)]
  return {
    bg: windowBg,
    main: bg,
    raise: towardFg(light ? MIX.raiseLight : MIX.raiseDark),
    hover: towardFg(MIX.hover),
    sel: towardFg(MIX.sel),
    line: towardFg(MIX.line),
    line2: towardFg(MIX.line2),
    well: light ? towardFg(MIX.wellLight) : mixOklab(bg, '#000000', MIX.wellDark),
    term: bg,
    fg,
    fg2: readable(MIX.fg2),
    muted: readable(MIX.muted),
    dim: readable(MIX.dim),
    accent: accentText,
    accentText,
    working: accentText,
    accentSoft: withAlpha(accentText, MIX.accentSoft),
    accentLine: withAlpha(accentText, MIX.accentLine),
    onAccent: light ? '#FFFFFF' : bg,
    ...status,
    ok: greenText,
    ansiBlue: blueText,
    ansiMag: magText,
    ansiGreen: greenText,
    pane: bg,
    paneLine: withAlpha(fg, MIX.paneLine),
    ...(light ? LIGHT_METERS : DARK_METERS),
  }
}

// A card on a panel and its selected row, as steps from the panel toward the text colour, measured from the design
// (#1b1b1b and #2a2a2a on #151517). On a panel that is all but grey the design's cards are pure grey, so the panel's
// faint tint is dropped there; a theme with a real hue keeps it.
const CARD_STEP = 3.5
const CARD_SEL_STEP = 12
const NEAR_GREY_CHROMA = 0.01

/** White on a dark theme, black on a light one: the one colour every hairline and hover fill is a low-opacity wash of. */
const INK = { dark: '255,255,255', light: '0,0,0' }
/** The shadow strength of a theme that does not write its own: a light ground needs far less shadow to lift a float. */
const SHADOW = { dark: '.6', light: '.35' }

/** What a theme may write of the design's roles itself, where reading them off its tokens would not be exact. */
type OwnRoles = { float?: string | undefined; sy?: SyntaxRoles | undefined; shadow?: string | undefined }

/**
 * The design's roles for a theme. A theme that is not one of the design's own derives the three it has no colour for:
 * the float ground is the card step on a dark theme (a float is lifted by tone as well as shadow) and the pane itself
 * on a light one, and the syntax colours are its own ANSI and status colours.
 */
export function designRoles(tokens: ThemeTokens, light: boolean, own: OwnRoles = {}): DesignRoles {
  return {
    t0: tokens.bg, t1: tokens.main, t2: tokens.sel, t3: tokens.raise,
    floatBg: own.float ?? (light ? tokens.main : mixOklab(tokens.main, tokens.fg, CARD_STEP)),
    well: tokens.well,
    fg: tokens.fg, fg2: tokens.fg2, muted: tokens.muted, dim: tokens.dim,
    ink: light ? INK.light : INK.dark,
    needs: tokens.warn, working: tokens.working, ok: tokens.ok, danger: tokens.danger,
    sy: own.sy ?? { kw: tokens.ansiMag, str: tokens.ok, fn: tokens.ansiBlue, num: tokens.working, ty: tokens.meterMid, com: tokens.dim, prop: tokens.accentText },
    shadow: own.shadow ?? (light ? SHADOW.light : SHADOW.dark),
  }
}

const entry = (id: string, name: string, family: string, light: boolean, tokens: ThemeTokens, own: OwnRoles = {}, highlight?: string): ThemeEntry => ({
  id,
  name,
  family,
  light,
  roles: designRoles(tokens, light, own),
  tokens,
  cardRing: composite(tokens.pane, tokens.bg),
  ...(highlight === undefined ? {} : { highlight }),
})

const MAIKER_TOKENS = { day: MAIKER_DAY, dark: MAIKER_DARK, light: MAIKER_LIGHT } as const

/**
 * The themes both apps ship, in display order, from `themes.json` (the TUI reads the same list): Maiker's own, drawn
 * exactly from their palettes (the design's ten themes among them), the Retro pair, and families with a dark and a light
 * each, generated from six colours.
 */
/**
 * Themes the manifest ships for the terminal app that the desktop app does not offer. The terminal app still starts on
 * Night (`theme.rs` DEFAULT), so the shared file keeps it; here a saved "Maiker Night" falls back to the default theme.
 */
const TERMINAL_ONLY_THEME_IDS: readonly string[] = ['night']

export const THEMES: readonly ThemeEntry[] = themeManifest.themes.filter((theme) => !TERMINAL_ONLY_THEME_IDS.includes(theme.id)).map((theme) => {
  const kind = theme.light ? 'light' : 'dark'
  if ('palette' in theme) {
    const palette: ThemePalette = theme.palette
    return entry(theme.id, theme.name, `${theme.family} · ${kind}`, theme.light, paletteTheme(palette), { float: palette.float, sy: palette.sy, shadow: palette.sk }, palette.hk)
  }
  if ('tokens' in theme) return entry(theme.id, theme.name, `${theme.family} · ${kind}`, theme.light, MAIKER_TOKENS[theme.tokens as keyof typeof MAIKER_TOKENS])
  const { bg, fg, accent, mag, blue, green, light } = theme
  return entry(theme.id, theme.name, `${theme.family} · ${kind}`, light, generateTheme({ bg, fg, accent, mag, blue, green, light }))
})

/** The id both apps store a theme under (the TUI's config name) for a theme's display name; the name itself when it is unknown. */
export const themeIdOf = (name: string): string => THEMES.find((theme) => theme.name === name)?.id ?? name

/** The display name of the theme stored under `id`, or null when no shipped theme has it. */
export const themeNameOf = (id: string): string | null => THEMES.find((theme) => theme.id === id)?.name ?? null

/** The theme in use for a mode. `systemDark` only matters in System mode. */
export function activeThemeName(choice: { themeMode: ThemeMode; darkTheme: string; lightTheme: string }, systemDark: boolean): string {
  const dark = choice.themeMode === 'dark' || (choice.themeMode === 'system' && systemDark)
  return dark ? choice.darkTheme : choice.lightTheme
}

export function findTheme(name: string): ThemeEntry {
  const found = THEMES.find((theme) => theme.name === name) ?? THEMES.find((theme) => theme.name === DEFAULT_THEME) ?? THEMES[0]
  if (!found) throw new Error('No themes are defined')
  return found
}

/**
 * The light and shade the older screens still read beside the ink: the highlight's strength (`--hk`), the colour of a
 * top edge (`--hs`, white in both kinds of theme) and the shadow colour (`--sd`): black under a dark theme, a warm
 * brown under a light one.
 */
const DARK_GLASS = { '--hs': '255,255,255', '--hk': '1', '--sd': '0,0,0' }
/** The colour of every branch name and icon, one violet per ground (the design's `--branch`); the light one is deep enough to read on cream. */
const BRANCH_DARK = '#A78BFA'
const BRANCH_LIGHT = '#6B46C1'
const LIGHT_GLASS = { '--hs': '255,255,255', '--hk': '.85', '--sd': '70,52,24' }

/** A dark ground at or above this luminance (One Dark's grey) is as light as the glass's sheen can sit on without turning grey. */
const SOFT_GROUND_LUMINANCE = 0.03
/**
 * The frost's sheen and edge on a dark ground, in strength: full on a deep ground (Maiker Dark), a third of it on a light grey one
 * (One Dark), where the same white would wash the panel out.
 */
const FROST_DEEP = { hi: 0.06, lo: 0.02, edge: 0.12 }
const FROST_SOFT = { hi: 0.02, lo: 0.007, edge: 0.05 }
const FROST_DIGITS = 3
function frostOf(main: string): Record<string, string> {
  const soft = Math.min(luminance(main) / SOFT_GROUND_LUMINANCE, 1)
  const strength = (key: keyof typeof FROST_DEEP) => (FROST_DEEP[key] - (FROST_DEEP[key] - FROST_SOFT[key]) * soft).toFixed(FROST_DIGITS)
  return { '--g-hi': strength('hi'), '--g-lo': strength('lo'), '--g-edge': strength('edge') }
}

/** The two inks a filled danger button's label may take: whichever reads better on the theme's danger colour. */
const DANGER_INKS = ['#FFFFFF', '#14110F'] as const

/**
 * The label colour for a button filled with the danger colour. Dark themes use a light coral that white text
 * fails on (about 2.6:1), so the ink is chosen per theme rather than fixed.
 */
export function onDanger(tokens: Pick<ThemeTokens, 'danger'>): string {
  const [light, dark] = DANGER_INKS
  return contrastRatio(light, tokens.danger) >= contrastRatio(dark, tokens.danger) ? light : dark
}

function cardSteps(tokens: ThemeTokens): Record<string, string> {
  const tone = chromaOf(tokens.main) < NEAR_GREY_CHROMA ? greyOf : (colour: string) => colour
  return { '--card-step': tone(mixOklab(tokens.main, tokens.fg, CARD_STEP)), '--card-sel-step': tone(mixOklab(tokens.main, tokens.fg, CARD_SEL_STEP)) }
}

/**
 * The one function that turns a theme into CSS variables, for the app root's style: the design's roles, the names kept
 * for the screens not yet rebuilt (`COMPATIBILITY`), and the roles the design does not name.
 */
export function themeStyle(theme: ThemeEntry): Record<string, string> {
  const { roles, tokens, look, highlight } = theme
  const style: Record<string, string> = { colorScheme: theme.light ? 'light' : 'dark' }
  for (const [key, variable] of Object.entries(ROLE_VARIABLES)) style[variable] = roles[key as keyof typeof ROLE_VARIABLES]
  for (const [key, variable] of Object.entries(SYNTAX_VARIABLES)) style[variable] = roles.sy[key as keyof SyntaxRoles]
  Object.assign(style, COMPATIBILITY)
  for (const [key, variable] of Object.entries(OWN_VARIABLES)) style[variable] = tokens[key as keyof typeof OWN_VARIABLES]
  Object.assign(style, { '--card-ring': theme.cardRing, '--branch': theme.light ? BRANCH_LIGHT : BRANCH_DARK, '--on-danger': onDanger(tokens) }, theme.light ? LIGHT_GLASS : DARK_GLASS)
  if (!theme.light) Object.assign(style, frostOf(tokens.main), cardSteps(tokens))
  if (look !== undefined) {
    style['--ui'] = look.ui
    style['--mono'] = look.mono
    if (look.hk !== undefined) style['--hk'] = look.hk
    if (look.sh !== undefined) style['--sh'] = look.sh
  }
  // A palette theme's own highlight strength wins over the look's, as the design sets it per theme.
  if (highlight !== undefined) style['--hk'] = highlight
  return style
}

/**
 * The selection is the accent itself, opaque (xterm's WebGL renderer draws it without alpha), with the accent's own ink for
 * the text. A faint tint of the accent over the card was nearly invisible on a dark ground. The accent already passes as
 * text on the card, so its ink passes on it.
 */
function selectionColors(tokens: ThemeTokens): { background: string; foreground: string } {
  return { background: tokens.accent, foreground: tokens.onAccent }
}

/**
 * What a program's "bright black" background is drawn as: the hovered row's ground, a faint slab on the card.
 * The palette's bright black is dim text, which as a background is a glaring bar (`brightBlackGround.ts`).
 */
export function terminalSlab(tokens: ThemeTokens): readonly [number, number, number] {
  return channelsOf(composite(tokens.hover, tokens.main))
}

/**
 * What xterm should enforce for colours a program picks itself. The 16 ANSI slots are audited, but
 * a program also paints with the 256-colour cube and truecolour (Claude Code's pale blue 153 is
 * unreadable on white), which no palette can fix; xterm nudges those until they reach the ratio.
 * Dark themes keep every colour as the program asked.
 */
export function terminalMinimumContrast(theme: ThemeEntry): number {
  return theme.light ? MIN_TEXT_CONTRAST : 1
}

/**
 * xterm's palette from the same tokens, so a pane's ANSI colours follow the theme. The background is
 * the workspace card's own ground, so a terminal sits on the card with no box of its own; the pane makes
 * it see-through when its renderer can afford that.
 */
export function xtermTheme(tokens: ThemeTokens): ITheme {
  const selection = selectionColors(tokens)
  return {
    background: tokens.main,
    foreground: tokens.fg2,
    cursor: tokens.accentText,
    cursorAccent: tokens.main,
    selectionBackground: selection.background,
    selectionForeground: selection.foreground,
    // The ground, not the well: programs paint with ANSI black expecting it to vanish into the
    // background, as Claude Code does under its prompt and status line.
    black: tokens.main,
    brightBlack: tokens.dim,
    red: tokens.danger,
    brightRed: tokens.danger,
    green: tokens.ansiGreen,
    brightGreen: tokens.ok,
    yellow: tokens.warn,
    brightYellow: tokens.warn,
    blue: tokens.ansiBlue,
    brightBlue: tokens.ansiBlue,
    magenta: tokens.ansiMag,
    brightMagenta: tokens.ansiMag,
    cyan: tokens.accentText,
    brightCyan: tokens.accentText,
    white: tokens.fg2,
    brightWhite: tokens.fg,
  }
}
