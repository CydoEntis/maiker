import { describe, expect, it } from 'vitest'
import { advanceKeyWaits, KEY_WAIT_MS } from './keyWait'

describe('waiting for a machine whose key was set up in a terminal', () => {
  const waits = [{ name: 'box', since: 1000 }, { name: 'lab', since: 1000 }]

  it('reports the machine that connected and keeps waiting for the other', () => {
    const step = advanceKeyWaits(waits, new Set(['box']), 2000)
    expect(step.connected).toEqual(['box'])
    expect(step.still).toEqual([{ name: 'lab', since: 1000 }])
    expect(step.gaveUp).toEqual([])
  })

  it('gives up on a machine that never connects', () => {
    const step = advanceKeyWaits(waits, new Set(), 1000 + KEY_WAIT_MS)
    expect(step.still).toEqual([])
    expect(step.gaveUp).toEqual(['box', 'lab'])
  })
})
