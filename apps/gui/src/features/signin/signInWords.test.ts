import { describe, expect, it } from 'vitest'
import { linkHost } from './signInWords'

describe('sign-in words', () => {

  it('shows the host of a link and nothing for text that is not one', () => {
    expect(linkHost('https://auth.openai.com/codex/device?x=1')).toBe('auth.openai.com')
    expect(linkHost('not a link')).toBe('')
  })
})
