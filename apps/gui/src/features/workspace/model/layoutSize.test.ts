import { describe, expect, it } from 'vitest'
import { sizeVariables } from './layoutSize'

describe('window size variables', () => {
  it('turns the sidebar width and the chat sizes into CSS variables', () => {
    expect(sizeVariables({ chatWidth: 'auto', chatTextSize: 125, chatFont: 'serif' }, 300)).toEqual({
      '--sidebar-w': '300px',
      // The chat grows with a large pane, and is drawn at the size picked.
      '--chat-width': 'max(760px, min(1100px, 62%))',
      '--chat-zoom': '1.25',
      '--chat-font': 'Charter, "Iowan Old Style", Georgia, Cambria, "Times New Roman", serif',
    })
    const sized = (chatWidth: 'narrow' | 'wide' | 'full') => sizeVariables({ chatWidth, chatTextSize: 100, chatFont: 'inter' }, 300)['--chat-width']
    expect([sized('narrow'), sized('wide'), sized('full')]).toEqual(['760px', '1100px', '100%'])
  })
})
