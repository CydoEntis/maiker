import { describe, expect, it } from 'vitest'
import { retryDelayAfter, RETRY_DELAYS_MS, serviceStageOf } from './serviceState'

describe('the service stage', () => {
  it('is a blip for the first three seconds of a lost line, then offline', () => {
    expect(serviceStageOf({ down: false, late: false, found: false })).toBe('ok')
    expect(serviceStageOf({ down: true, late: false, found: false })).toBe('blip')
    expect(serviceStageOf({ down: true, late: true, found: false })).toBe('offline')
  })

  it('says it found the service once a long outage ends, and only then', () => {
    expect(serviceStageOf({ down: false, late: false, found: true })).toBe('found')
    expect(serviceStageOf({ down: true, late: true, found: true })).toBe('offline')
  })
})

describe('the retry wait', () => {
  it('tries again after 2, 4, 8, then every 15 seconds', () => {
    expect(RETRY_DELAYS_MS).toEqual([2000, 4000, 8000, 15_000])
    expect([0, 1, 2, 3, 4, 9].map(retryDelayAfter)).toEqual([2000, 2000, 4000, 8000, 15_000, 15_000])
  })
})
