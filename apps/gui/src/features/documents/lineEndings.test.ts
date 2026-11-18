import { describe, expect, it } from 'vitest'
import { dominantEnding, toDisk, toEditable } from './lineEndings'

describe('line endings', () => {
  it('finds the ending most lines use', () => {
    expect(dominantEnding('a\r\nb\r\nc\n')).toBe('\r\n')
    expect(dominantEnding('a\nb\nc\r\n')).toBe('\n')
    expect(dominantEnding('no break')).toBe('\n')
    expect(dominantEnding('a\r\nb\n')).toBe('\n')
  })

  it('round-trips a CRLF file byte for byte, trailing newline included', () => {
    for (const text of ['# one\r\n\r\ntext\r\n', '# one\r\ntext', '\r\n', '']) {
      expect(toDisk(toEditable(text), dominantEnding(text))).toBe(text)
    }
  })

  it('keeps an LF file as it is and keeps a missing final newline missing', () => {
    expect(toDisk(toEditable('a\nb'), '\n')).toBe('a\nb')
    expect(toDisk('a\nb\n', '\r\n')).toBe('a\r\nb\r\n')
  })

  it('writes an edit that added lines with the file\'s own ending', () => {
    expect(toDisk('a\nnew\nb\n', '\r\n')).toBe('a\r\nnew\r\nb\r\n')
  })
})
