import { describe, expect, it } from 'vitest'
import { askablesOf, askedText, MAX_ASKABLES } from './plainQuestions'

const texts = (markdown: string) => askablesOf(markdown).map(askedText)

describe('askablesOf', () => {
  it('finds the numbered questions of a list, keeping their numbers', () => {
    const found = askablesOf('Before I start:\n\n1. Which branch should this target?\n2. Should I keep the old endpoint?\n3. Any naming preference?')
    expect(found.map(askedText)).toEqual(['1. Which branch should this target?', '2. Should I keep the old endpoint?', '3. Any naming preference?'])
    expect(found.map((asked) => asked.yesNo)).toEqual([false, true, false])
    expect(found.map((asked) => asked.key)).toEqual(['1.0', '1.1', '1.2'])
  })

  it('counts a list from the number it starts at', () => {
    expect(texts('3. Which database do you use?\n4. Is it hosted?')).toEqual(['3. Which database do you use?', '4. Is it hosted?'])
  })

  it('reads the questions of a bulleted list without inventing numbers', () => {
    const found = askablesOf('- Which port does it run on?\n- Do you want logs kept?\n- plain note')
    expect(found.map((asked) => asked.label)).toEqual(['', ''])
    expect(found.map((asked) => asked.text)).toEqual(['Which port does it run on?', 'Do you want logs kept?'])
  })

  it('keeps a label the agent wrote', () => {
    expect(askablesOf('- Q3: Which region do we deploy to?\n- b) Should it retry on failure?').map((asked) => asked.label)).toEqual(['Q3:', 'b)'])
    expect(askablesOf('- Q3: Which region do we deploy to?')[0]?.text).toBe('Which region do we deploy to?')
  })

  it('finds a paragraph that ends with a question', () => {
    expect(texts('I looked at the module.\n\nWhich of these two layouts do you prefer?\n\nThanks.')).toEqual(['Which of these two layouts do you prefer?'])
  })

  it('takes a question that is followed by a closing note', () => {
    expect(texts('- Which branch? (default: main)\n- Keep the flag? - it is cheap to remove')).toHaveLength(2)
    expect(texts('- Which branch? it is only a guess')).toEqual([])
  })

  it('reads inline numbered questions in one paragraph as separate ones', () => {
    const found = askablesOf('Before I start: 1. Which branch should this target? 2. Should I keep the old endpoint? 3. Any naming preference?')
    expect(found.map(askedText)).toEqual(['1. Which branch should this target?', '2. Should I keep the old endpoint?', '3. Any naming preference?'])
  })

  it('flags yes or no questions, but not a choice between things', () => {
    const [a, b, c, d] = askablesOf('- Should I rename it?\n- Should I use Redis or Postgres?\n- Do you want it now or not?\n- Which one?')
    expect([a?.yesNo, b?.yesNo, c?.yesNo, d?.yesNo]).toEqual([true, false, true, false])
  })

  it('ignores headings, code, tables, quotes and diffs', () => {
    const message = [
      '## Why this matters?',
      '',
      '```',
      'What does this print?',
      '```',
      '',
      '| Question | Answer |',
      '| --- | --- |',
      '| Why? | Because it is so? |',
      '',
      '> Did the agent say this?',
      '',
      '```diff',
      '- const a = b?.c',
      '```',
    ].join('\n')
    expect(askablesOf(message)).toEqual([])
  })

  it('ignores a rhetorical headline, a bold line alone, and a question mark in code or a link', () => {
    expect(texts('Why this matters?')).toEqual([])
    expect(texts('**Why does this matter?**')).toEqual([])
    expect(texts('Use `foo?.bar` here and read https://example.com/a?b=c')).toEqual([])
    expect(texts('Is `a?.b` the one you meant?')).toEqual(['Is a?.b the one you meant?'])
  })

  it('ignores one-word questions and statements', () => {
    expect(texts('Why?\n\nAll done.\n\n- Ready!')).toEqual([])
  })

  it('ignores a long paragraph of prose', () => {
    expect(texts(`${'This is a long explanation. '.repeat(30)}Does that make sense?`)).toEqual([])
  })

  it('reads a message with nothing to ask as empty', () => {
    expect(askablesOf('Done. I changed three files and the tests pass.')).toEqual([])
    expect(askablesOf('')).toEqual([])
  })

  it('stops at a limit', () => {
    const list = Array.from({ length: MAX_ASKABLES + 10 }, (_, index) => `${String(index + 1)}. Which option number ${String(index)}?`).join('\n')
    expect(askablesOf(list)).toHaveLength(MAX_ASKABLES)
  })

  it('reads the same message the same way', () => {
    const message = 'Hi.\n\n1. Which one do you want?\n2. And the other one?'
    expect(askablesOf(message)).toEqual(askablesOf(message))
  })
})
