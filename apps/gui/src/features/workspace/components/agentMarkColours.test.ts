/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Vitest hands a stylesheet to a test as an empty string, so the glob only names the file and its text is read from disk.
const [path] = Object.keys(import.meta.glob('../workspace.css'))
const css = readFileSync(fileURLToPath(new URL(path ?? '', import.meta.url)), 'utf8')

describe('the agents\' mark colours', () => {
  it.each(['claude', 'codex', 'gemini', 'opencode', 'deepseek'])('gives %s a brand colour, defined once and read by the one mark rule', (agent) => {
    expect(css.match(new RegExp(`--agent-${agent}: #[0-9A-Fa-f]{6};`, 'g'))).toHaveLength(1)
    expect(css).toContain(`.mx-app-icon.is-${agent} { --mark: var(--agent-${agent}); }`)
  })
})
