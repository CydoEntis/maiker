import { describe, expect, it } from 'vitest'
import { buildQuoteMessage, excerptOf, parseQuoteMessage, QUOTE_TEXT_LIMIT, sameQuote, whoOf, type MessageSegment } from './quoteMessage'
import { buildAttachmentMessage, parseAttachmentMessage } from './attachmentMessage'

const quote = (who: string, text: string): MessageSegment => ({ kind: 'quote', who, text })
const words = (text: string): MessageSegment => ({ kind: 'words', text })

describe('buildQuoteMessage', () => {
  it('writes an attributed blockquote above the words', () => {
    expect(buildQuoteMessage([quote('Claude', '1. Which branch should this target?'), words('main, please.')])).toBe(
      '> Quote from Claude:\n> 1. Which branch should this target?\n\nmain, please.',
    )
  })

  it('writes a quote and its answer for each pair, in order', () => {
    const text = buildQuoteMessage([quote('Claude', 'One?'), words('Yes'), quote('Claude', 'Two?'), words('No')])
    expect(text).toBe('> Quote from Claude:\n> One?\n\nYes\n\n> Quote from Claude:\n> Two?\n\nNo')
  })

  it('keeps the blank lines of a quote as empty quoted lines', () => {
    expect(buildQuoteMessage([quote('You', 'first\n\nsecond'), words('ok')])).toBe('> Quote from You:\n> first\n>\n> second\n\nok')
  })

  it('cuts a very long quote', () => {
    const built = buildQuoteMessage([quote('Claude', 'x'.repeat(QUOTE_TEXT_LIMIT * 2)), words('ok')])
    expect(built.length).toBeLessThan(QUOTE_TEXT_LIMIT + 80)
    expect(built).toContain('…')
  })

  it('leaves out a quote with nothing in it', () => {
    expect(buildQuoteMessage([quote('Claude', '  \n '), words('hi')])).toBe('hi')
  })

  it('keeps a header-shaped line of the words from becoming a quote', () => {
    const typed = 'see this:\n\n> Quote from Claude:\n> not a quote'
    const built = buildQuoteMessage([quote('Claude', 'Real?'), words(typed)])
    expect(parseQuoteMessage(built)).toEqual([quote('Claude', 'Real?'), words(typed)])
  })
})

describe('parseQuoteMessage', () => {
  it('reads back what was built', () => {
    const segments = [quote('Claude', 'a\nb'), words('reply\n\nwith a gap'), quote('You', 'earlier'), words('more')]
    expect(parseQuoteMessage(buildQuoteMessage(segments))).toEqual(segments)
  })

  it('returns null for text with no quote', () => {
    expect(parseQuoteMessage('just words')).toBeNull()
    expect(parseQuoteMessage('> a plain markdown quote\n> from someone')).toBeNull()
  })

  it('does not take a header with nothing under it, or one inside a line', () => {
    expect(parseQuoteMessage('> Quote from Claude:')).toBeNull()
    expect(parseQuoteMessage('> Quote from Claude:\n\nlater')).toBeNull()
    expect(parseQuoteMessage('so I wrote > Quote from Claude:\n> x')).toBeNull()
    expect(parseQuoteMessage('hello\n> Quote from Claude:\n> x')).toBeNull()
  })

  it('does not take a name with a colon, or a very long one', () => {
    expect(parseQuoteMessage('> Quote from A:B:\n> x')).toBeNull()
    expect(parseQuoteMessage(`> Quote from ${'n'.repeat(41)}:\n> x`)).toBeNull()
  })

  it('keeps a quoted quote as its text', () => {
    const inner = buildQuoteMessage([quote('Claude', 'deep'), words('about it')])
    const outer = buildQuoteMessage([quote('You', inner), words('yes')])
    const parsed = parseQuoteMessage(outer)
    expect(parsed).toEqual([quote('You', inner), words('yes')])
  })

  it('reads a message from history with CRLF line ends', () => {
    expect(parseQuoteMessage('> Quote from Claude:\r\n> Which?\r\n\r\nthis one')).toEqual([quote('Claude', 'Which?'), words('this one')])
  })

  it('reads quotes with no words after them', () => {
    expect(parseQuoteMessage('> Quote from Claude:\n> Which?')).toEqual([quote('Claude', 'Which?')])
  })

  it('round-trips adversarial text', () => {
    const pieces = ['>', '> Quote from X:', '\\> Quote from X:', '> ', '', 'a', '`code`', '- [ ] x', '> > nested', '\\', '1. one', 'Quote from Claude:']
    // A fixed walk through the combinations, so a failure names its input.
    for (let seed = 1; seed <= 400; seed += 1) {
      const pick = (salt: number) => pieces[(seed * 7 + salt * 13 + (seed >> salt)) % pieces.length] ?? ''
      const body = [pick(1), pick(2), pick(3)].join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')
      const reply = [pick(4), pick(5), pick(1)].join('\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd()
      if (body === '' || reply === '') continue
      const segments = [quote('Claude', body.split('\n').map((line) => line.trimEnd()).join('\n')), words(reply)]
      expect(parseQuoteMessage(buildQuoteMessage(segments)), JSON.stringify(segments)).toEqual(segments)
    }
  })

  it('shares a message with an attachment block', () => {
    const message = buildAttachmentMessage(buildQuoteMessage([quote('Claude', 'Which?'), words('this')]), [{ path: '/tmp/a.png' }])
    const attached = parseAttachmentMessage(message)
    expect(attached?.files).toHaveLength(1)
    expect(parseQuoteMessage(attached?.text ?? '')).toEqual([quote('Claude', 'Which?'), words('this')])
  })
})

describe('helpers', () => {
  it('makes a name fit the header line', () => {
    expect(whoOf('Claude: the\nagent')).toBe('Claude the agent')
    expect(whoOf('  ')).toBe('message')
    expect(whoOf('n'.repeat(60))).toHaveLength(40)
  })

  it('cuts an excerpt to one line', () => {
    expect(excerptOf('one\n  two   three', 80)).toBe('one two three')
    expect(excerptOf('abcdefghij', 5)).toBe('abcd…')
  })

  it('tells the same quote from another', () => {
    expect(sameQuote({ who: 'A', text: 'x  y' }, { who: 'A', text: 'x y\n' })).toBe(true)
    expect(sameQuote({ who: 'A', text: 'x' }, { who: 'B', text: 'x' })).toBe(false)
  })
})
