import { describe, expect, it } from 'vitest'
import { clampWidth, MAX_WIDTH_PX, MIN_WIDTH_PX, storedWidth } from './panelWidth'

describe('the side panel’s width', () => {
  it('keeps a dragged width inside its bounds', () => {
    expect(clampWidth(MIN_WIDTH_PX - 100)).toBe(MIN_WIDTH_PX)
    expect(clampWidth(MAX_WIDTH_PX + 100)).toBe(MAX_WIDTH_PX)
    expect(clampWidth(400.4)).toBe(400)
  })

  it('opens at the default when nothing usable is stored', () => {
    expect(storedWidth(null, null)).toBeNull()
    expect(storedWidth('', 'wide')).toBeNull()
    expect(storedWidth('12', null)).toBeNull()
  })

  it('takes the width stored under the current key, clamped', () => {
    expect(storedWidth('420', '900')).toBe(420)
    expect(storedWidth(String(MAX_WIDTH_PX + 300), null)).toBe(MAX_WIDTH_PX)
  })

  it('carries over an earlier width that still fits a list, and drops one that was sized for the viewer it held', () => {
    expect(storedWidth(null, '400')).toBe(400)
    expect(storedWidth(null, String(MAX_WIDTH_PX))).toBe(MAX_WIDTH_PX)
    expect(storedWidth(null, '680')).toBeNull()
    expect(storedWidth(null, '1100')).toBeNull()
  })
})
