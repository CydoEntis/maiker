import { describe, expect, it } from 'vitest'
import { DENSITY_SCALE, ICON_SCALE, sizeVariables } from './layoutSize'

describe('window size variables', () => {
  it('turns the density, text sizes and sidebar width into CSS variables', () => {
    expect(sizeVariables({ density: 'spacious', sidebarTextSize: 27, tabTextSize: 13.5, iconSize: 'small', chatWidth: 'auto', chatTextSize: 125 }, 300)).toEqual({
      '--pad': String(DENSITY_SCALE.spacious),
      '--sidebar-w': '300px',
      '--sidebar-text': '2',
      '--tab-text': '1',
      '--icon-scale': String(ICON_SCALE.small),
      // The chat grows with a large pane, and is drawn at the size picked.
      '--chat-width': 'max(760px, min(1100px, 62%))',
      '--chat-zoom': '1.25',
    })
    const sized = (chatWidth: 'narrow' | 'wide' | 'full') => sizeVariables({ density: 'spacious', sidebarTextSize: 27, tabTextSize: 13.5, iconSize: 'small', chatWidth, chatTextSize: 100 }, 300)['--chat-width']
    expect([sized('narrow'), sized('wide'), sized('full')]).toEqual(['760px', '1100px', '100%'])
  })
})
