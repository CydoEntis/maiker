import { afterEach, describe, expect, it } from 'vitest'
import { clampDockSize, DOCK_MAX_PX, DOCK_MIN_PX, readDockSize, writeDockSize } from './terminalDock'

afterEach(() => { localStorage.clear() })

describe('the terminal dock size', () => {
  it('is never smaller than its least size nor larger than its most', () => {
    expect(clampDockSize('height', 10, 2000)).toBe(DOCK_MIN_PX.height)
    expect(clampDockSize('width', 5000, 4000)).toBe(DOCK_MAX_PX.width)
  })

  it('leaves the chat the larger part of a small window', () => {
    expect(clampDockSize('height', 500, 500)).toBe(300)
  })

  it("follows the design's size until it is dragged, and goes back to it when reset", () => {
    expect(readDockSize('height')).toBeNull()
    writeDockSize('height', 300)
    expect(readDockSize('height')).toBe(300)
    writeDockSize('height', null)
    expect(readDockSize('height')).toBeNull()
  })
})
