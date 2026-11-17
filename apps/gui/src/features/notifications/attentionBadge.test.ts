import { describe, expect, it } from 'vitest'
import { windowTitle } from './attentionBadge'

describe('the window title', () => {
  it('says how many sessions need you, and nothing when none do', () => {
    expect(windowTitle(0)).toBe('Maiker')
    expect(windowTitle(1)).toBe('Maiker · 1 needs you')
    expect(windowTitle(3)).toBe('Maiker · 3 need you')
  })
})
