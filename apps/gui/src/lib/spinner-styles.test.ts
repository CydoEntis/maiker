import { describe, expect, it } from 'vitest'
import { isSpinnerStyle, isWebSpinner } from './spinner-styles'

describe('spinner choice', () => {
  it('tells TUI spinners from web ones and rejects unknown names', () => {
    expect(isWebSpinner('circle')).toBe(true)
    expect(isWebSpinner('braille')).toBe(false)
    expect(isSpinnerStyle('ping')).toBe(true)
    expect(isSpinnerStyle('moon')).toBe(false)
  })
})
