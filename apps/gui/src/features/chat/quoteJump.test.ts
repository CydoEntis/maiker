import { describe, expect, it } from 'vitest'
import type { ChatRow } from './chatRows'
import { quoteSourceRow } from './quoteJump'
import { buildQuoteMessage } from './quoteMessage'

const agent = (key: string, ...paragraphs: string[]): ChatRow => ({ kind: 'agent', key, turnId: 't', paragraphs, status: 'completed' })
const echo = (key: string, text: string): ChatRow => ({ kind: 'echo', key, text })

describe('quoteSourceRow', () => {
  const asked = agent('a1', 'Before I start:\n\n1. **Which** branch should this target?\n2. Should I keep the old endpoint?')

  it('finds the message the words came from, through the marks a selection does not carry', () => {
    const rows = [echo('u0', 'hi'), asked, echo('u1', 'x')]
    expect(quoteSourceRow(rows, '1. Which branch should this target?', 'u1')).toBe('a1')
  })

  it('looks only above the row that quotes, and not into the quotes it carries', () => {
    const reply = buildQuoteMessage([{ kind: 'quote', who: 'Claude', text: '2. Should I keep the old endpoint?' }, { kind: 'words', text: 'Yes' }])
    const rows = [asked, echo('u1', reply), echo('u2', buildQuoteMessage([{ kind: 'quote', who: 'Claude', text: '2. Should I keep the old endpoint?' }, { kind: 'words', text: 'Yes, again' }]))]
    expect(quoteSourceRow(rows, '2. Should I keep the old endpoint?', 'u2')).toBe('a1')
  })

  it('falls back to the first line, and says null when nothing above holds it', () => {
    const rows = [agent('a1', 'First line here.\nSecond line there.'), echo('u1', 'x')]
    expect(quoteSourceRow(rows, 'First line here.\nA line that was edited away', 'u1')).toBe('a1')
    expect(quoteSourceRow(rows, 'nothing like it', 'u1')).toBeNull()
  })
})
