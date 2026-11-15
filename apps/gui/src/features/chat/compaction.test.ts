import { describe, expect, it } from 'vitest'
import { compactionOf } from './compaction'

describe('compactionOf', () => {
  it('reads a plain /compact', () => {
    expect(compactionOf('Compacted (ctrl+o to see full summary)')).toEqual({ hooks: [] })
  })

  it('names the hooks that ran with it, once each, and not their command lines', () => {
    const text = 'Compacted (ctrl+o to see full summary)\nPreCompact ["C:/tools/gk.exe" ai hook run] completed\nPreCompact [other] completed'
    expect(compactionOf(text)).toEqual({ hooks: ['PreCompact'] })
  })

  it('leaves any other output alone', () => {
    expect(compactionOf('Set model to `Opus 5.5`')).toBeNull()
    expect(compactionOf('Nothing compacted yet')).toBeNull()
  })
})
