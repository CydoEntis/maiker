import { describe, expect, it } from 'vitest'
import { downloadRate, keepSamples, timeLeftWords } from './downloadEta'

const MB = 1024 * 1024

describe('a download\'s speed and time left', () => {
  it('says nothing about the speed until two seconds of it were seen', () => {
    expect(downloadRate([])).toBeNull()
    expect(downloadRate([{ at: 0, received: 0 }, { at: 1000, received: MB }])).toBeNull()
  })

  it('averages the speed over the readings it kept, and drops the ones older than ten seconds', () => {
    const kept = keepSamples([{ at: 0, received: 0 }, { at: 4000, received: 4 * MB }], { at: 12_000, received: 8 * MB })
    expect(kept).toEqual([{ at: 4000, received: 4 * MB }, { at: 12_000, received: 8 * MB }])
    expect(downloadRate(kept)).toBe(MB / 2)
  })

  it('has no speed for a download that has stalled', () => {
    expect(downloadRate([{ at: 0, received: MB }, { at: 5000, received: MB }])).toBeNull()
  })

  it('gives the time left in minutes, then hours, and nothing while it cannot be told', () => {
    const at = (bytesPerSecond: number | null, total: number | null = 100 * MB) => timeLeftWords({ received: 40 * MB, total, bytesPerSecond })
    expect(at(4 * MB)).toBe('less than a minute left')
    expect(at(MB / 12)).toBe('about 12 min left')
    expect(at(MB / 125)).toBe('about 2 h 5 min left')
    expect(at(MB / 120)).toBe('about 2 h left')
    expect(at(null)).toBeNull()
    expect(at(MB, null)).toBeNull()
  })
})
