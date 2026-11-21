/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Vitest hands a stylesheet to a test as an empty string, so the glob only names the file and its text is read from disk.
const [path] = Object.keys(import.meta.glob('./frame.css'))
const css = readFileSync(fileURLToPath(new URL(path ?? '', import.meta.url)), 'utf8')

describe('the counts on a folded heading', () => {
  it('draws the needs badge in the needs colour and the finished badge in the done colour', () => {
    expect(css).toMatch(/\.mx-fold-badge\.is-needs \{[^}]*\bcolor: var\(--needs\);/)
    expect(css).toMatch(/\.mx-fold-badge\.is-done \{[^}]*\bcolor: var\(--done\);/)
  })
})
