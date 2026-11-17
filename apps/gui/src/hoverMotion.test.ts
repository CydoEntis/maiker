/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Vitest hands every stylesheet to a test as an empty string, so the glob only names the files and their text is read from disk.
const SHEETS: Record<string, string> = Object.fromEntries(
  Object.keys(import.meta.glob('./**/*.css')).map((path) => [path, readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')]),
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

/** A state that decides what a control shows: pointer, focus, press, or being the picked one. */
const STATE = /:hover|:focus|:active|:checked|\.is-(on|selected|active|picked|current|open)\b|\[aria-(selected|checked|expanded|current|pressed)|\[data-state/

const offenders = (matches: (rule: Rule) => boolean, allowed: readonly RegExp[] = []): string[] =>
  RULES.filter((rule) => matches(rule) && !allowed.some((pattern) => pattern.test(rule.selector))).map((rule) => `${rule.where} ${rule.selector}`)

const DURATION = /(?<![\w-])\d*\.?\d+m?s(?![\w-])/g

describe('hover, focus and press motion', () => {
  // A hover affordance (a close ×, a row action, a copy button) appears the moment the pointer arrives: only tooltips and
  // the sidebar's hover card wait, and those are timers in code (`HoverTips`, `HoverController`), never a CSS delay.
  it('never delays a transition', () => {
    const delayed = offenders(({ body }) => /transition-delay/.test(body) || body.split(/transition:/).slice(1).some((value) => (value.split(';')[0] ?? '').split(',').some((part) => (part.match(DURATION) ?? []).length > 1)))
    expect(delayed).toEqual([])
  })

  it('delays an animation only on a looping mark, never on a state', () => {
    expect(offenders(({ selector, body }) => STATE.test(selector) && /animation-delay/.test(body))).toEqual([])
  })

  // One fast fade for every state change, from the token, so Reduce motion zeroes them all and no neighbour is slower.
  it('times every transition from the motion tokens', () => {
    expect(offenders(({ body }) => !body.includes('!important') && (/transition:[^;}]*\d+(\.\d+)?m?s/.test(body.replace(/var\([^)]*\)/g, '')) || /transition-duration:\s*\d/.test(body)))).toEqual([])
  })

  // Bold on pick re-sets the text and, in a control that sizes to its label, widens it. A picked item says so with colour,
  // a fill or a mark. Allowed: a plan step that is bold for where
  // the agent is, not for where the pointer is.
  it('never changes the weight of a control for hover, focus or selection', () => {
    expect(offenders(({ selector, body }) => STATE.test(selector) && /font-weight/.test(body), [/mx-plan-item\.is-current/])).toEqual([])
  })

  // A control does not lift, shrink or slide when it is hovered or pressed; press is a deeper fill. Allowed: a switch's knob,
  // which is what the switch moves, and the skip link, which is off screen until it has focus.
  it('never moves or scales a control for hover, focus or press', () => {
    expect(
      offenders(({ selector, body }) => STATE.test(selector) && /(translate|scale)/.test(body), [/mx-switch\[aria-checked="true"\] \.mx-switch-knob/, /settings-row input\[type="checkbox"\]:checked::before/, /skip-link:focus-visible/]),
    ).toEqual([])
  })

  // `filter` repaints the control and everything in it on a software painter; a hover is a flat tint instead.
  it('never uses a filter or a lasting will-change for a state', () => {
    expect(offenders(({ selector, body }) => STATE.test(selector) && /(?<![-\w])(backdrop-)?filter:|will-change/.test(body))).toEqual([])
  })

  // A part that shows for a state starts at opacity 0 and must say how it fades. The one fade comes from `workspace.css`
  // for a button or a role, or from its own rule.
  it('fades every part that a state reveals', () => {
    const faded = new Set(RULES.filter(({ body }) => /transition:[^;}]*opacity/.test(body)).flatMap(({ selector }) => selector.match(/\.[\w-]+/g) ?? []))
    const baseline = RULES.find(({ selector }) => selector.includes(':where(.mx-app) :where('))?.selector ?? ''
    const missing = RULES.filter(({ selector, body }) => /(?<![-\w])opacity:\s*0\s*;/.test(body) && !/::|data-open|\.is-|\[aria-hidden/.test(selector)).filter(({ selector }) => {
      const subject = (selector.split(/[\s>+~]+/).pop() ?? '').match(/\.[\w-]+/g) ?? []
      return !subject.some((name) => faded.has(name) || baseline.includes(name))
    })
    // The legacy preview's buttons are covered by the baseline's `button`.
    expect(missing.filter(({ where }) => !where.startsWith('./App.css')).map(({ where, selector }) => `${where} ${selector}`)).toEqual([])
  })
})
