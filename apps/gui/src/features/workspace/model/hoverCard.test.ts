import { describe, expect, it } from 'vitest'
import { HOVER_CARD_WIDTH_PX, placeHoverCard } from './hoverCard'
import { agentLabel, askWords } from './session'

describe('where the hover card goes', () => {
  it('sits to the right of the row, level with it', () => {
    expect(placeHoverCard({ left: 20, right: 280, top: 200 }, 180, 1400, 900)).toEqual({ left: 288, top: 200 })
  })

  it('moves up so it never runs past the bottom of the window', () => {
    expect(placeHoverCard({ left: 20, right: 280, top: 800 }, 180, 1400, 900).top).toBe(712)
  })

  it('goes to the left of a sidebar that is on the right', () => {
    expect(placeHoverCard({ left: 1120, right: 1380, top: 200 }, 180, 1400, 900).left).toBe(1120 - 8 - HOVER_CARD_WIDTH_PX)
  })
})

describe('what a session asks, in plain words', () => {
  it('says what a known tool wants to do with its target', () => {
    expect(askWords({ tool: 'Bash', detail: 'npm test' })).toBe('Wants to run npm test')
    expect(askWords({ tool: 'Edit', detail: 'src/a.ts' })).toBe('Wants to edit src/a.ts')
  })

  it('names a tool it has no plain verb for, so nothing is hidden', () => {
    expect(askWords({ tool: 'mcp__github__merge', detail: '#12' })).toBe('Wants to use mcp__github__merge: #12')
    expect(askWords({ tool: 'Task', detail: '' })).toBe('Wants to use Task')
  })

  it('writes an agent the way a person does, and keeps another program as it is', () => {
    expect(agentLabel('claude')).toBe('Claude')
    expect(agentLabel('opencode')).toBe('OpenCode')
    expect(agentLabel('aider')).toBe('aider')
  })
})
