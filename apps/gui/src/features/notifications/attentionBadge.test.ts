import { describe, expect, it } from 'vitest'
import type { SessionView } from '@/features/workspace/model/session'
import { needingYou, windowTitle } from './attentionBadge'

describe('the window title', () => {
  it('says how many sessions need you, and nothing when none do', () => {
    expect(windowTitle(0)).toBe('Maiker')
    expect(windowTitle(1)).toBe('Maiker · 1 needs you')
    expect(windowTitle(3)).toBe('Maiker · 3 need you')
  })

  it('counts only the sessions that ask something, never one that stopped or is held by its plan limit', () => {
    const sessions = (['needs', 'error', 'limited', 'unknown', 'done', 'needs'] as const).map((status) => ({ status }) as SessionView)
    expect(needingYou(sessions)).toBe(2)
  })
})
