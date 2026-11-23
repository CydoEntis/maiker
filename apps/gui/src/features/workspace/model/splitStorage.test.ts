import { beforeEach, describe, expect, it } from 'vitest'
import { readSessionSplits, writeSessionSplits } from './splitStorage'
import { AGENT_LEAF, splitLeaf, UNSPLIT } from './splitTree'

beforeEach(() => { localStorage.clear() })

describe('session splits between runs', () => {
  it('keeps each session’s tree under its id', () => {
    const tree = splitLeaf(UNSPLIT, AGENT_LEAF, 'down', 't7', 'mark t7')
    writeSessionSplits(new Map([['t2', tree]]))
    expect(readSessionSplits()).toEqual(new Map([['t2', tree]]))
  })

  it('reads nothing from a value it cannot use, and skips one bad session without losing the rest', () => {
    localStorage.setItem('maiker.gui.session-splits.v1', 'not json')
    expect(readSessionSplits().size).toBe(0)
    const tree = splitLeaf(UNSPLIT, AGENT_LEAF, 'right', 't7', 'mark t7')
    localStorage.setItem('maiker.gui.session-splits.v1', JSON.stringify({ t2: tree, t3: { tree: 42 } }))
    expect([...readSessionSplits().keys()]).toEqual(['t2'])
  })
})
