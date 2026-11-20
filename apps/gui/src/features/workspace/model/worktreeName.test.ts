import { describe, expect, it } from 'vitest'
import { nameForTask, slugFromTask, suggestBranchName } from './worktreeName'

describe('a name from what a session works on', () => {
  it('is the first few words of the task, lowercase and hyphenated', () => {
    expect(slugFromTask('Fix the login redirect bug on Safari')).toBe('fix-login-redirect-bug')
    expect(slugFromTask('Please add dark mode to settings')).toBe('add-dark-mode-settings')
  })

  it('reads only the first line, and strips accents and symbols', () => {
    expect(slugFromTask('\n\nRefactor café_menu!!\nthen more detail')).toBe('refactor-cafe-menu')
  })

  it('is empty when nothing usable is there', () => {
    expect(slugFromTask('')).toBe('')
    expect(slugFromTask('   \n  ')).toBe('')
    expect(slugFromTask('修复登录问题')).toBe('')
    expect(slugFromTask('?!?')).toBe('')
  })

  it('keeps the filler words when they are all there is', () => {
    expect(slugFromTask('help me')).toBe('help-me')
  })

  it('is cut at 32 characters without breaking a word, and one huge word is cut', () => {
    const slug = slugFromTask('internationalization infrastructure modernization')
    expect(slug.length).toBeLessThanOrEqual(32)
    expect(slug).toBe('internationalization')
    expect(slugFromTask('x'.repeat(100))).toBe('x'.repeat(32))
  })

  it('takes -2, -3 when the name is in use', () => {
    expect(nameForTask('Fix login redirect', new Set())).toBe('fix-login-redirect')
    expect(nameForTask('Fix login redirect', new Set(['fix-login-redirect']))).toBe('fix-login-redirect-2')
    expect(nameForTask('Fix login redirect', new Set(['fix-login-redirect', 'fix-login-redirect-2']))).toBe('fix-login-redirect-3')
  })

  it('falls back to a made-up two-word name when the task gives none', () => {
    expect(nameForTask('', new Set(), () => 0)).toBe('bold-badger')
    expect(nameForTask('修复', new Set(), () => 0)).toBe('bold-badger')
  })
})

describe('a suggested branch name', () => {
  it('is two short words', () => {
    expect(suggestBranchName(new Set(), () => 0)).toBe('bold-badger')
    expect(suggestBranchName(new Set(), () => 0.999)).toBe('young-yak')
  })

  it('is never a name already in use', () => {
    const rolls = [0, 0, 0.5, 0.5]
    let at = 0
    const random = () => rolls[at++] ?? 0.5
    expect(suggestBranchName(new Set(['bold-badger']), random)).toBe('quiet-marten')
  })

  it('takes a number when it keeps landing on names in use', () => {
    expect(suggestBranchName(new Set(['bold-badger', 'bold-badger-2']), () => 0)).toBe('bold-badger-3')
  })
})
