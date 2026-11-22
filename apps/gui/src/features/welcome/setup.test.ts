import { describe, expect, it } from 'vitest'
import { allAnswered, nextLabel, recommendationReason, recommendView, STEP_REVIEW, STEP_STYLE, STEP_WELCOME, viewNote } from './setup'

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

describe('recommendationReason', () => {
  it('quotes the answers that led to the view', () => {
    expect(recommendationReason({ where: 'terminal', run: 'raw', diff: 'shell' })).toBe('You said you work in a terminal, see the raw output and review changes with git diff in the shell, so sessions open as each agent’s own CLI, exactly as it ships.')
    expect(recommendationReason({ run: 'summary', diff: 'readable' })).toBe('You said you get a clear summary and see readable diffs, so sessions open as a clean conversation with approvals you click.')
  })
  it('does not quote answers that point the other way', () => {
    expect(recommendationReason({ where: 'terminal', run: 'summary', diff: 'readable' })).not.toContain('terminal,')
  })
  it('says what each view is when nothing was answered', () => {
    expect(recommendationReason({})).toContain('Chat is a clean conversation')
  })
})

describe('viewNote', () => {
  it('names a pick that differs from the suggestion', () => {
    expect(viewNote('chat', 'terminal', false)).toContain('You picked Chat over our suggestion. That works too.')
    expect(viewNote('terminal', 'terminal', false)).not.toContain('You picked')
  })
  it('always says where to change it', () => {
    expect(viewNote('chat', 'chat', false)).toContain('Settings')
    // No session has a switch of its own (ADR 0020), so the note names none.
    expect(viewNote('chat', 'chat', false)).not.toContain('menu')
  })
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
  it('says Continue on the other steps and Get started on the last', () => {
    expect(nextLabel(STEP_WELCOME, {})).toBe('Continue')
    expect(nextLabel(STEP_REVIEW, {})).toBe('Get started')
  })
})
