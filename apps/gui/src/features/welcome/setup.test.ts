import { describe, expect, it } from 'vitest'
import { allAnswered, nextLabel, recommendView, STEP_STYLE, viewNote } from './setup'

describe('recommendView', () => {
  it('points to Terminal when two answers do', () => {
    expect(recommendView({ where: 'terminal', run: 'raw' })).toBe('terminal')
    expect(recommendView({ run: 'raw', diff: 'shell' })).toBe('terminal')
  })
  it('points to Chat when two answers do', () => {
    expect(recommendView({ where: 'editor', run: 'summary', diff: 'shell' })).toBe('chat')
  })
  it('is Chat when no view has two answers', () => {
    expect(recommendView({})).toBe('chat')
    expect(recommendView({ where: 'terminal' })).toBe('chat')
    expect(recommendView({ where: 'terminal', run: 'summary' })).toBe('chat')
  })
})

describe('viewNote', () => {
  it('says Gemini opens in Terminal only for Chat with Gemini installed', () => {
    expect(viewNote('chat', 'chat', true)).toContain('Gemini sessions open in Terminal')
    expect(viewNote('chat', 'chat', false)).not.toContain('Gemini')
    expect(viewNote('terminal', 'terminal', true)).not.toContain('Gemini')
  })
})

describe('nextLabel', () => {
  it('asks to skip until every question is answered', () => {
    expect(nextLabel(STEP_STYLE, {})).toBe('Skip questions')
    expect(nextLabel(STEP_STYLE, { where: 'all', run: 'raw' })).toBe('Skip questions')
    expect(allAnswered({ where: 'all', run: 'raw', diff: 'shell' })).toBe(true)
    expect(nextLabel(STEP_STYLE, { where: 'all', run: 'raw', diff: 'shell' })).toBe('See my recommendation')
  })
})
