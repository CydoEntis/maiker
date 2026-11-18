/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Vitest hands every stylesheet to a test as an empty string, so the glob only names the files and their text is read from disk.
const SHEETS: Record<string, string> = Object.fromEntries(
  Object.keys(import.meta.glob('./**/*.css')).map((path) => [path, readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')]),
)

/** A state that decides what a control shows: pointer, focus, or being the picked one. */
const STATE = /:hover|:focus|\.is-(on|selected|active|picked|current|open)\b|\[aria-(selected|checked|expanded|current)|\[data-state/
/** Taking a control out of the flow, or giving it no width, is how a control grows to show something. */
const COLLAPSES = /display:\s*none|(?<![-\w])(max-)?width:\s*0(px)?\s*[;}]/

/** Rules that change what is drawn on purpose; each says why. */
const ALLOWED: readonly RegExp[] = [
  // The design's compact segmented control shows a word only on the picked choice.
  /data-compact/,
  // A keyboard-only link that appears on focus, over the layout, not in it.
  /mx-upd-keyonly:focus-visible/,
  // The terminal's search-hit filter hides what does not match; it is a filter, not a reveal.
  /is-filtered/,
]

describe('revealing a part of a control', () => {
  // Reserve the space; reveal with opacity, never by growing (docs/UI.md). A tab, row, chip or button keeps its size
  // whatever the pointer, the focus or the selection does to it.
  it('never makes a control grow or shrink for hover, focus or selection', () => {
    const offenders: string[] = []
    for (const [path, css] of Object.entries(SHEETS)) {
      for (const [index, line] of css.split('\n').entries()) {
        const rule = /^\s*([^{@]+)\{([^}]*)\}/.exec(line)
        if (rule === null) continue
        const [, selector = '', body = ''] = rule
        if (STATE.test(selector) && COLLAPSES.test(body) && !ALLOWED.some((allowed) => allowed.test(selector))) offenders.push(`${path}:${String(index + 1)} ${selector.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('gives a close button its slot at all times, so only its opacity changes', () => {
    const offenders = Object.entries(SHEETS).flatMap(([path, css]) => css.split('\n').flatMap((line, index) => {
      const rule = /^\s*([^{@]*-close[^{]*)\{([^}]*)\}/.exec(line)
      return rule !== null && /(?<![-\w])(max-)?width:\s*0(px)?\s*[;}]/.test(rule[2] ?? '') ? [`${path}:${String(index + 1)}`] : []
    }))
    expect(offenders).toEqual([])
  })
})
