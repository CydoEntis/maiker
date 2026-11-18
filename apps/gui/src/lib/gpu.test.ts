import { describe, expect, it } from 'vitest'
import { framesAreSlow, isLinuxWebView } from './gpu'

const WEBKITGTK = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15'
const WEBKITGTK_BUNDLED = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15'
const MACOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

describe('telling the Linux web view from the others', () => {
  it('knows WebKitGTK, with or without the distribution in its user agent', () => {
    expect(isLinuxWebView(WEBKITGTK)).toBe(true)
    expect(isLinuxWebView(WEBKITGTK_BUNDLED)).toBe(true)
  })

  it('is not macOS, Windows or the test environment', () => {
    expect(isLinuxWebView(MACOS)).toBe(false)
    expect(isLinuxWebView(WINDOWS)).toBe(false)
    expect(isLinuxWebView()).toBe(false)
  })
})

describe('telling a software painter by its frames', () => {
  it('is slow when half the frames or more took longer than 24ms', () => {
    expect(framesAreSlow([40, 38, 42, 17, 17, 17])).toBe(true)
    expect(framesAreSlow([17, 40, 17, 16, 17, 17])).toBe(false)
  })

  it('is not slow without frames, or at 60 Hz', () => {
    expect(framesAreSlow([])).toBe(false)
    expect(framesAreSlow([16.7, 16.7, 16.6, 16.7, 16.8, 16.7])).toBe(false)
  })
})
