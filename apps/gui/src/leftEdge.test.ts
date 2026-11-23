/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Vitest hands every stylesheet to a test as an empty string, so the glob only names the files and their text is read from disk.
const SHEETS: Record<string, string> = Object.fromEntries(
  Object.keys(import.meta.glob('./**/*.css')).map((path) => [path, readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')]),
)

// A coloured bar down the left of a selected row, a quote or a notice is the one look the design refuses (docs/DESIGN.md,
// *No edge bars*): selection is a fill, tone is the icon's colour. A 1px rule between two columns is a divider, not a bar.
describe('edge bars', () => {
  it('reads the stylesheets it checks', () => {
    expect(Object.values(SHEETS).every((css) => css.length > 0)).toBe(true)
  })

  it('draws no bar down the left of anything', () => {
    const offenders = Object.entries(SHEETS).flatMap(([path, css]) =>
      [...css.matchAll(/[^{}]+\{[^}]*(?:inset\s+[1-9]\d*px\s+0\s+0|border-left(?:-width)?\s*:\s*[2-9]px)[^}]*\}/g)].map((rule) => `${path} ${rule[0].split('{')[0]?.trim() ?? ''}`),
    )
    expect(offenders).toEqual([])
  })
})
