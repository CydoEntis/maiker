import { describe, expect, it } from 'vitest'
import { formatElapsed } from './working-since'

describe('formatElapsed', () => {

  it('never shows a negative time if the clock moved backwards', () => {
    expect(formatElapsed(-5_000)).toBe('0:00')
  })
})
