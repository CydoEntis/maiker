import { describe, expect, it } from 'vitest'
import { askablesOf } from './plainQuestions'
import { buildReplyMessage, chipsOf, nextRow, answeredOf } from './quickReply'
import { parseQuoteMessage } from './quoteMessage'

const asked = askablesOf('Before I start:\n\n1. Which branch should this target?\n2. Should I keep the old endpoint?\n3. Any naming preference?')

describe('buildReplyMessage', () => {
  it('pairs each answered question with its answer, in the order asked', () => {
    const message = buildReplyMessage('Claude', asked, { 'Should I keep the old endpoint?': 'Yes', 'Which branch should this target?': 'main' })
    expect(message).toBe('> Quote from Claude:\n> 1. Which branch should this target?\n\nmain\n\n> Quote from Claude:\n> 2. Should I keep the old endpoint?\n\nYes')
  })

  it('leaves out the questions with no answer, and says null when none has one', () => {
    expect(buildReplyMessage('Claude', asked, { 'Any naming preference?': '   ' })).toBeNull()
    expect(answeredOf(asked, { 'Any naming preference?': 'camelCase' })).toHaveLength(1)
  })

  it('reads back as the same pairs', () => {
    const message = buildReplyMessage('Claude', asked, { 'Which branch should this target?': 'main\n> Quote from Claude:\n> sneaky', 'Any naming preference?': 'camel' })
    const parsed = parseQuoteMessage(message ?? '')
    expect(parsed?.map((segment) => segment.kind)).toEqual(['quote', 'words', 'quote', 'words'])
    expect(parsed?.[1]).toEqual({ kind: 'words', text: 'main\n> Quote from Claude:\n> sneaky' })
  })
})

describe('chipsOf and nextRow', () => {
  it('offers Yes and No on a yes-or-no question, and Your call on every one', () => {
    expect(asked.map(chipsOf)).toEqual([['Your call'], ['Yes', 'No', 'Your call'], ['Your call']])
  })

  it('moves to the next row that has no answer, else the next row', () => {
    expect(nextRow(asked, { 'Should I keep the old endpoint?': 'Yes' }, 0)).toBe(2)
    expect(nextRow(asked, { 'Should I keep the old endpoint?': 'Yes', 'Any naming preference?': 'x' }, 0)).toBe(1)
    expect(nextRow(asked, {}, 2)).toBeNull()
  })
})
