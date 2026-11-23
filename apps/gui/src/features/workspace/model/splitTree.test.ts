import { describe, expect, it } from 'vitest'
import { AGENT_LEAF, closeLeaf, focusLeaf, layoutOf, leavesOf, type ListedPane, liveSplits, MAX_SESSION_PANES, parseSplits, provenShells, type SessionSplits, setRatio, splitLeaf, stepFocus, swapLeaves, UNSPLIT } from './splitTree'

const split = (splits: SessionSplits, leaf: string, dir: 'right' | 'down', id: string) => splitLeaf(splits, leaf, dir, id, `mark ${id}`)
const rectOf = (splits: SessionSplits, id: string) => {
  const rect = layoutOf(splits.tree).panes.find((pane) => pane.id === id)
  if (rect === undefined) throw new Error(`no pane ${id}`)
  return rect
}

describe('splitting a pane', () => {
  it('halves the pane that was split and leaves the others as they were', () => {
    const one = split(UNSPLIT, AGENT_LEAF, 'right', 's1')
    expect(rectOf(one, AGENT_LEAF)).toEqual({ id: AGENT_LEAF, x: 0, y: 0, w: 0.5, h: 1 })
    expect(rectOf(one, 's1')).toEqual({ id: 's1', x: 0.5, y: 0, w: 0.5, h: 1 })

    const two = split(one, 's1', 'down', 's2')
    expect(rectOf(two, AGENT_LEAF)).toEqual(rectOf(one, AGENT_LEAF))
    expect(rectOf(two, 's1')).toEqual({ id: 's1', x: 0.5, y: 0, w: 0.5, h: 0.5 })
    expect(rectOf(two, 's2')).toEqual({ id: 's2', x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
  })

  it('gives the new pane the focus', () => {
    expect(split(UNSPLIT, AGENT_LEAF, 'down', 's1').focus).toBe('s1')
  })

  it('numbers a split with the lowest number no living split has', () => {
    const two = split(split(UNSPLIT, AGENT_LEAF, 'right', 's1'), AGENT_LEAF, 'down', 's2')
    expect(two.numbers).toEqual({ s1: 1, s2: 2 })
    const again = split(closeLeaf(two, 's1'), 's2', 'right', 's3')
    expect(again.numbers).toEqual({ s2: 2, s3: 1 })
  })

  it('holds six panes at most, the agent’s among them', () => {
    let splits = UNSPLIT
    for (let n = 1; n < MAX_SESSION_PANES; n += 1) splits = split(splits, AGENT_LEAF, 'right', `s${String(n)}`)
    expect(leavesOf(splits.tree)).toHaveLength(MAX_SESSION_PANES)
    expect(split(splits, AGENT_LEAF, 'right', 'one-more')).toBe(splits)
  })

  it('changes nothing for a pane the session does not have, or a shell it already shows', () => {
    const one = split(UNSPLIT, AGENT_LEAF, 'right', 's1')
    expect(split(one, 'gone', 'right', 's2')).toBe(one)
    expect(split(one, AGENT_LEAF, 'right', 's1')).toBe(one)
  })
})

describe('dragging a pane onto another of the session', () => {
  it('trades their places and gives the moved one the keys', () => {
    const two = split(split(UNSPLIT, AGENT_LEAF, 'right', 's1'), 's1', 'down', 's2')
    const swapped = swapLeaves(two, AGENT_LEAF, 's2')
    expect(rectOf(swapped, AGENT_LEAF)).toEqual({ ...rectOf(two, 's2'), id: AGENT_LEAF })
    expect(rectOf(swapped, 's2')).toEqual({ ...rectOf(two, AGENT_LEAF), id: 's2' })
    expect(swapped.focus).toBe(AGENT_LEAF)
  })

  it('changes nothing for a pane that is not one of it, or the pane itself', () => {
    const one = split(UNSPLIT, AGENT_LEAF, 'right', 's1')
    expect(swapLeaves(one, 's1', 's9')).toBe(one)
    expect(swapLeaves(one, 's1', 's1')).toBe(one)
  })
})

describe('closing a split', () => {
  it('gives its room to the other side of its branch', () => {
    const two = split(split(UNSPLIT, AGENT_LEAF, 'right', 's1'), 's1', 'down', 's2')
    const closed = closeLeaf(two, 's1')
    expect(leavesOf(closed.tree)).toEqual([AGENT_LEAF, 's2'])
    expect(rectOf(closed, 's2')).toEqual({ id: 's2', x: 0.5, y: 0, w: 0.5, h: 1 })
    expect(closeLeaf(closed, 's2')).toEqual(UNSPLIT)
  })

  it('moves the focus to the pane that grew into the closed one, and leaves it alone otherwise', () => {
    const two = split(split(UNSPLIT, AGENT_LEAF, 'right', 's1'), 's1', 'down', 's2')
    expect(closeLeaf(two, 's2').focus).toBe('s1')
    expect(closeLeaf(focusLeaf(two, AGENT_LEAF), 's2').focus).toBe(AGENT_LEAF)
    expect(closeLeaf(split(UNSPLIT, AGENT_LEAF, 'down', 's1'), 's1').focus).toBe(AGENT_LEAF)
  })

  it('never closes the agent’s pane: that is closing the session', () => {
    const one = split(UNSPLIT, AGENT_LEAF, 'right', 's1')
    expect(closeLeaf(one, AGENT_LEAF)).toBe(one)
  })
})

describe('what is left after a restart', () => {
  it('drops the splits whose shells are gone, as if each had been closed', () => {
    const three = split(split(split(UNSPLIT, AGENT_LEAF, 'right', 's1'), 's1', 'down', 's2'), AGENT_LEAF, 'down', 's3')
    const live = liveSplits(three, new Set(['s2']))
    expect(leavesOf(live.tree)).toEqual([AGENT_LEAF, 's2'])
    expect(live.numbers).toEqual({ s2: 2 })
    expect(liveSplits(three, new Set())).toEqual(UNSPLIT)
    expect(liveSplits(three, new Set(['s1', 's2', 's3']))).toBe(three)
  })

  it('reads back what it stored, and nothing from a value that is not a tree with the agent’s pane in it', () => {
    const two = setRatio(split(split(UNSPLIT, AGENT_LEAF, 'right', 's1'), 's1', 'down', 's2'), '', 0.3)
    expect(parseSplits(JSON.parse(JSON.stringify(two)))).toEqual(two)
    expect(parseSplits(null)).toBeNull()
    expect(parseSplits({ tree: { dir: 'sideways', a: AGENT_LEAF, b: 's1' } })).toBeNull()
    expect(parseSplits({ tree: { dir: 'right', a: 's1', b: 's2', ratio: 0.5 } })).toBeNull()
    expect(parseSplits({ tree: { dir: 'right', a: AGENT_LEAF, b: AGENT_LEAF, ratio: 0.5 } })).toBeNull()
  })

  it('puts the focus on the agent’s pane and numbers the splits when what was stored does not say', () => {
    const read = parseSplits({ tree: { dir: 'right', a: AGENT_LEAF, b: { dir: 'down', a: 's1', b: 's2' } }, focus: 'gone' })
    expect(read?.focus).toBe(AGENT_LEAF)
    expect(read?.numbers).toEqual({ s1: 1, s2: 2 })
    expect(layoutOf(read?.tree ?? AGENT_LEAF).panes.find((pane) => pane.id === 's2')).toEqual({ id: 's2', x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
  })
})

describe('resizing', () => {
  it('gives the first side of the dragged branch its share and the second the rest', () => {
    const two = split(split(UNSPLIT, AGENT_LEAF, 'right', 's1'), 's1', 'down', 's2')
    const wide = setRatio(two, '', 0.75)
    expect(rectOf(wide, AGENT_LEAF).w).toBeCloseTo(0.75)
    expect(rectOf(wide, 's1').x).toBeCloseTo(0.75)
    const tall = setRatio(wide, 'b', 0.25)
    expect(rectOf(tall, 's1').h).toBeCloseTo(0.25)
    expect(rectOf(tall, 's2').h).toBeCloseTo(0.75)
    expect(rectOf(tall, AGENT_LEAF)).toEqual(rectOf(wide, AGENT_LEAF))
  })

  it('never lets a pane be dragged shut, and goes back to halves when asked', () => {
    const one = split(UNSPLIT, AGENT_LEAF, 'right', 's1')
    expect(rectOf(setRatio(one, '', 0), AGENT_LEAF).w).toBeGreaterThan(0.1)
    expect(rectOf(setRatio(one, '', 1), 's1').w).toBeGreaterThan(0.1)
    expect(rectOf(setRatio(setRatio(one, '', 0.8), '', null), AGENT_LEAF).w).toBe(0.5)
  })

  it('names each branch’s line by its path, with the room the branch has', () => {
    const two = split(split(UNSPLIT, AGENT_LEAF, 'right', 's1'), 's1', 'down', 's2')
    expect(layoutOf(two.tree).dividers).toEqual([
      { path: '', dir: 'right', ratio: 0.5, x: 0, y: 0, w: 1, h: 1 },
      { path: 'b', dir: 'down', ratio: 0.5, x: 0.5, y: 0, w: 0.5, h: 1 },
    ])
  })

  it('fills the session’s room exactly, whatever the shares', () => {
    const three = setRatio(setRatio(split(split(split(UNSPLIT, AGENT_LEAF, 'right', 's1'), 's1', 'down', 's2'), AGENT_LEAF, 'down', 's3'), '', 0.3), 'a', 0.7)
    const area = layoutOf(three.tree).panes.reduce((sum, pane) => sum + pane.w * pane.h, 0)
    expect(area).toBeCloseTo(1)
  })
})

describe('moving the focus with the keys', () => {
  it('goes through the panes in reading order and stops at either end', () => {
    const two = split(split(UNSPLIT, AGENT_LEAF, 'right', 's1'), 's1', 'down', 's2')
    expect(stepFocus(focusLeaf(two, AGENT_LEAF), 1)).toBe('s1')
    expect(stepFocus(focusLeaf(two, 's1'), 1)).toBe('s2')
    expect(stepFocus(focusLeaf(two, 's2'), 1)).toBeNull()
    expect(stepFocus(focusLeaf(two, 's1'), -1)).toBe(AGENT_LEAF)
    expect(stepFocus(focusLeaf(two, AGENT_LEAF), -1)).toBeNull()
  })
})

describe('which listed panes are a session’s splits', () => {
  const two = split(split(UNSPLIT, AGENT_LEAF, 'right', 's1'), 's1', 'down', 's2')
  const listed = (panes: Record<string, ListedPane>) => (id: string) => panes[id]
  const none = new Set<string>()

  it('takes a pane that carries the split’s own mark', () => {
    const proven = provenShells(two, listed({ s1: { name: 'mark s1', agent: false }, s2: { name: 'mark s2', agent: false } }), none)
    expect([...proven]).toEqual(['s1', 's2'])
  })

  it('takes none of the panes a restarted daemon lists at the same numbers', () => {
    const proven = provenShells(two, listed({ s1: { name: null, agent: false }, s2: { name: 'Login fix', agent: false } }), none)
    expect(proven.size).toBe(0)
  })

  it('never takes a pane an agent runs in, whatever it is called', () => {
    const proven = provenShells(two, listed({ s1: { name: 'mark s1', agent: true }, s2: { name: null, agent: true } }), new Set(['s2']))
    expect(proven.size).toBe(0)
  })

  it('takes a shell this window just started while it has no name yet, and no longer once it has another', () => {
    const fresh = new Set(['s1'])
    expect([...provenShells(two, listed({ s1: { name: null, agent: false } }), fresh)]).toEqual(['s1'])
    expect(provenShells(two, listed({ s1: { name: 'Login fix', agent: false } }), fresh).size).toBe(0)
  })

  it('never proves a split that was stored without a mark', () => {
    const read = parseSplits({ tree: two.tree, focus: 's1', numbers: two.numbers })
    expect(read).not.toBeNull()
    expect(provenShells(read ?? UNSPLIT, listed({ s1: { name: 'mark s1', agent: false }, s2: { name: null, agent: false } }), none).size).toBe(0)
  })
})
