import { beforeEach, describe, expect, it } from 'vitest'
import { isFirstRun, markWelcomed } from './welcomed'

beforeEach(() => { localStorage.clear() })

describe('the first-run flag', () => {
  it('greets a window that has saved nothing', () => {
    expect(isFirstRun()).toBe(true)
  })

  it('never greets a window that saw the earlier first run, whose flag this one keeps', () => {
    localStorage.setItem('maiker.gui.welcomed.v1', '1')
    expect(isFirstRun()).toBe(false)
  })

  it('never greets a window that already has settings', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ spinner: 'bars' }))
    expect(isFirstRun()).toBe(false)
  })

  it('is not a first run once the setup ended', () => {
    markWelcomed()
    expect(isFirstRun()).toBe(false)
  })
})
