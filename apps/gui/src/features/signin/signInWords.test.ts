import { describe, expect, it } from 'vitest'
import { failureWords, linkHost } from './signInWords'

describe('sign-in words', () => {
  it('names the agent and says why a sign-in did not end signed in', () => {
    expect(failureWords('codex', 'timed-out')).toBe('Nobody finished the Codex sign-in in time.')
    expect(failureWords('gemini', 'unsupported')).toContain('no sign-in to run from here')
    expect(failureWords('claude', 'not-installed')).toBe('Claude is not installed on this computer.')
  })

  it('shows the host of a link and nothing for text that is not one', () => {
    expect(linkHost('https://auth.openai.com/codex/device?x=1')).toBe('auth.openai.com')
    expect(linkHost('not a link')).toBe('')
  })
})
