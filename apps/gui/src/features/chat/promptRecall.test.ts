import { describe, expect, it } from 'vitest'
import { recallStep } from './promptRecall'

const SENT = ['first', 'second', 'third']

describe('recalling sent messages', () => {
  it('brings back the last message into an empty box, then older ones, and stops at the oldest', () => {
    const one = recallStep(SENT, '', null, 0, 'older')
    expect(one).toEqual({ draft: 'third', recalled: { index: 2, text: 'third' } })
    const two = recallStep(SENT, 'third', one?.recalled ?? null, 0, 'older')
    expect(two?.draft).toBe('second')
    const oldest = recallStep(SENT, 'first', { index: 0, text: 'first' }, 0, 'older')
    expect(oldest).toBeNull()
  })

  it('goes forward with ↓ and past the newest back to an empty box', () => {
    expect(recallStep(SENT, 'second', { index: 1, text: 'second' }, 6, 'newer')?.draft).toBe('third')
    expect(recallStep(SENT, 'third', { index: 2, text: 'third' }, 5, 'newer')).toEqual({ draft: '', recalled: null })
  })

  it('leaves the arrows to the caret once the person writes their own text or edits the recalled one', () => {
    expect(recallStep(SENT, 'my own words', null, 0, 'older')).toBeNull()
    expect(recallStep(SENT, 'third, edited', { index: 2, text: 'third' }, 0, 'older')).toBeNull()
    expect(recallStep(SENT, '', null, 0, 'newer')).toBeNull()
  })

  it('moves the caret between lines of a recalled message before stepping', () => {
    const multi = ['line one\nline two']
    const recalled = { index: 0, text: multi[0] ?? '' }
    expect(recallStep(multi, recalled.text, recalled, recalled.text.length, 'older')).toBeNull()
    expect(recallStep(multi, recalled.text, recalled, 0, 'newer')).toBeNull()
  })

  it('does nothing in a chat with no messages sent', () => {
    expect(recallStep([], '', null, 0, 'older')).toBeNull()
  })
})
