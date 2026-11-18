import { describe, expect, it } from 'vitest'
import { ATTACHMENT_HEADER } from './attachmentMessage'
import { messagePreview, withoutPasteTags } from './messagePreview'

const WORDS = 'heres the adjustment and fixees for the datatable screens'

describe('messagePreview', () => {
  it('drops the paste tags and keeps the words', () => {
    expect(messagePreview(`<pasted_content id="3bc2">\n${WORDS}\n</pasted_content id="3bc2">`)).toBe(WORDS)
  })

  it('turns the attachment block into a short note', () => {
    const message = `${WORDS}\n\n${ATTACHMENT_HEADER}\n- /home/a/.cache/pastes/paste-1794945833545-ac4e9b57-image.png`
    expect(messagePreview(message)).toBe(`${WORDS} [1 image]`)
  })

  it('drops a block the daemon clipped inside its own header', () => {
    const clipped = `<pasted_content id="3bc2">\n${WORDS}\n</pasted_content id="3bc2">\n\nAttached files (kept by Maitty; read them with your fi`
    expect(messagePreview(clipped)).toBe(WORDS)
  })

  it('counts a path the clip cut short as a file too', () => {
    const clipped = `${WORDS}\n\n${ATTACHMENT_HEADER}\n- /tmp/a.png\n- /tmp/b.png\n- /tm`
    expect(messagePreview(clipped)).toBe(`${WORDS} [3 files]`)
  })

  it('leaves a message with nothing to strip as it was, on one line', () => {
    expect(messagePreview('fix\nthe   bug')).toBe('fix the bug')
    expect(messagePreview('Att me later')).toBe('Att me later')
  })

  it('has a name for a message that is only a picture', () => {
    expect(messagePreview(`${ATTACHMENT_HEADER}\n- /tmp/paste-1794945833545-ac4e9b57-image.png`)).toBe('[1 image]')
  })
})

describe('messagePreview of a message with quotes', () => {
  it('shows each quote as its first words, then what was said', () => {
    expect(messagePreview('> Quote from Claude:\n> 1. Which branch should this target?\n\nmain')).toBe('“1. Which branch should this target?” main')
  })
})

describe('withoutPasteTags', () => {
  it('removes opening and closing tags, with or without an id', () => {
    expect(withoutPasteTags('<pasted_content id="1">a</pasted_content id="1"> <pasted_content>b</pasted_content>')).toBe('a b')
  })
})
