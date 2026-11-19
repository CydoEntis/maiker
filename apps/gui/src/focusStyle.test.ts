/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from './features/workspace/theme/color'
import { THEMES } from './features/workspace/theme/themes'

// docs/UI.md, *Focus is one style*: a 1px accent underline drawn inside the control, never a box, ring, glow or outline.
// Vitest hands every stylesheet to a test as an empty string, so the globs only name the files and their text is read from disk.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const SHEETS: Record<string, string> = Object.fromEntries(Object.keys(import.meta.glob('./**/*.css')).map((path) => [path, read(path)]))
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.keys(import.meta.glob(['./**/*.ts', './**/*.tsx'])).filter((path) => !/\.test\.tsx?$/.test(path)).map((path) => [path, read(path)]),
)

interface Rule {
  where: string
  selector: string
  body: string
}

/** Every one-line rule outside a keyframe block; the stylesheets are written one rule to a line. */
const RULES: Rule[] = Object.entries(SHEETS).flatMap(([path, css]) =>
  css.split('\n').flatMap((line, index) => {
    const rule = /^(?!\s*(?:from|to|\d+%)\s*\{)\s*([^{@]+)\{([^}]*)\}/.exec(line)
    return rule === null ? [] : [{ where: `${path}:${String(index + 1)}`, selector: (rule[1] ?? '').trim(), body: rule[2] ?? '' }]
  }),
)

const FOCUS = /:focus(-visible|-within)?\b/
const focusRules = RULES.filter((rule) => FOCUS.test(rule.selector))

/** An `outline` or `outline-offset` that is not a drag or a pick, each with its reason. A focus rule has no entry here. */
const OUTLINE_ALLOWED: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.terminal-pane\.is-drop-target/, 'where a dragged pane lands (App.css), not focus'],
  [/\.toast-position-option\.is-selected/, 'the picked corner in Settings (App.css), not focus'],
]
/** The needs card's own answer field takes its underline in the needs colour, as the prototype's Needs Card draws it (`style-focus`). */
const NEEDS_UNDERLINE = /^inset 0 -1px 0 var\(--needs\)$/
/** The comma-separated layers of a box-shadow value, ignoring the commas inside `rgba(...)`, `var(...)` and `calc(...)`. */
const splitLayers = (value: string): string[] => {
  const layers: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ',' && depth === 0) {
      layers.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  layers.push(value.slice(start).trim())
  return layers
}
const allowed = (rule: Rule, list: ReadonlyArray<readonly [RegExp, string]>): boolean => list.some(([pattern]) => pattern.test(rule.selector))

describe('focus is one underline', () => {
  it('reads the stylesheets it checks', () => {
    expect(focusRules.length).toBeGreaterThan(40)
  })

  it('defines the one token', () => {
    expect(SHEETS['./tokens.css']).toMatch(/--focus-underline:\s*inset 0 -1px 0 var\(--focus-line\)/)
  })

  it('never sets an outline in a focus rule, only removes it', () => {
    const offenders = focusRules.filter(({ body }) => {
      const value = /(?:^|[;\s])outline(?:-color|-width|-style)?\s*:\s*([^;]*)/.exec(body)?.[1]?.trim()
      return value !== undefined && !/^(none|0|transparent)\b/.test(value)
    }).map(({ where, selector }) => `${where} ${selector}`)
    expect(offenders).toEqual([])
  })

  it('uses no outline-offset outside the allowlist', () => {
    const offenders = RULES.filter((rule) => /outline-offset/.test(rule.body) && !allowed(rule, OUTLINE_ALLOWED)).map(({ where, selector }) => `${where} ${selector}`)
    expect(offenders).toEqual([])
  })

  it('draws no ring or glow in a focus rule: a box-shadow there is the underline, a hairline edge, or none', () => {
    const offenders = focusRules.filter(({ body }) => {
      const shadow = /(?:^|[;\s])box-shadow\s*:\s*([^;]*)/.exec(body)?.[1]
      if (shadow === undefined || /^none\b/.test(shadow.trim())) return false
      const layers = splitLayers(shadow)
      return layers.some((layer) => !/--focus-underline|--focus-line|--pop-sh|--c-field-sh/.test(layer) && !/^inset 0 0 0 1px /.test(layer) && !NEEDS_UNDERLINE.test(layer))
    }).map(({ where, selector }) => `${where} ${selector}`)
    expect(offenders).toEqual([])
  })

  it('keeps a Tailwind class from drawing a focus ring or outline', () => {
    const offenders = Object.entries(SOURCES).filter(([, code]) => /focus(-visible|-within)?:(ring|outline|shadow-\[)/.test(code)).map(([path]) => path)
    expect(offenders).toEqual([])
  })

  // The underline is 2px of `--focus-line` (the theme's `accentText`) on the ground, so it must be seen: at least the 3:1 WCAG
  // asks of a non-text mark. A theme that fails points `--focus-line` at `--fg` (tokens.css) rather than getting a rule of its own.
  it.each(THEMES.map((theme) => [theme.name, theme] as const))('%s: the focus underline is at least 3:1 on its grounds', (_name, theme) => {
    for (const ground of [theme.tokens.bg, theme.tokens.main, theme.tokens.raise, theme.tokens.term]) {
      expect(contrastRatio(theme.tokens.accentText, ground), `accentText on ${ground}`).toBeGreaterThanOrEqual(3)
    }
  })
})
