import { describe, expect, it } from 'vitest'
import { branchNameError } from './branchName'

describe('branchNameError', () => {
  it('says nothing for an empty or a good name', () => {
    expect(branchNameError('')).toBeNull()
    expect(branchNameError('   ')).toBeNull()
    expect(branchNameError('feat/session-auth')).toBeNull()
  })

  it('offers the name back with dashes when it has spaces', () => {
    expect(branchNameError('fix the  login')).toBe("Branch names can't have spaces. Try fix-the-login.")
  })

  it.each(['a..b', 'a~b', 'a:b', 'what?', 'a*', 'a[b', 'a\\b', 'trailing/', '/leading', 'x.lock', '-dash', '.dot'])('refuses %s', (name) => {
    expect(branchNameError(name)).toBe("That isn't a valid branch name.")
  })
})
