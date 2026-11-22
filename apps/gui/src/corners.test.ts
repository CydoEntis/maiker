/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const SHEETS = Object.keys(import.meta.glob('./**/*.css'))
const COMPONENTS = Object.keys(import.meta.glob(['./**/*.tsx', '!./**/*.test.tsx']))

// A full pill (`999px`) and a circle (`50%`) are shapes of their own, not corners.
const FIXED_RADIUS = /border[a-z-]*-radius:\s*(?!0(?:px)?\s*[;}])(?!999px)[\d.]+(?:px|rem|em)/
const FIXED_CLASS = /\brounded(?:-[trbl]{1,2})?-\[\d/
const INLINE_RADIUS = /borderRadius:\s*['"]?\d/

const offendersOf = (paths: readonly string[], pattern: RegExp) =>
  paths.flatMap((path) => read(path).split('\n').flatMap((line, index) => (pattern.test(line) ? [`${path}:${String(index + 1)}`] : [])))

describe('corners', () => {
  it('reads the stylesheets and components it checks', () => {
    expect(SHEETS).toContain('./material.css')
    expect(COMPONENTS.length).toBeGreaterThan(0)
  })

  // The look's corners are set in one place only if every corner reads `--r-control`, `--r-panel`, `--r-badge` or `--r-dialog`.
  it('are never a fixed size in a stylesheet', () => {
    expect(offendersOf(SHEETS, FIXED_RADIUS)).toEqual([])
  })

  it('are never a fixed size in a component', () => {
    expect(offendersOf(COMPONENTS, FIXED_CLASS)).toEqual([])
    expect(offendersOf(COMPONENTS, INLINE_RADIUS)).toEqual([])
  })

  it('give Tailwind’s rounded classes the same tokens', () => {
    const css = read('./index.css')
    for (const [size, token] of [['sm', 'badge'], ['md', 'control'], ['lg', 'control'], ['xl', 'panel'], ['2xl', 'dialog']]) {
      expect(css).toContain(`--radius-${size ?? ''}: var(--r-${token ?? ''},`)
    }
  })
})
