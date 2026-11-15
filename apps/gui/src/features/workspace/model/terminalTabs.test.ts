import { describe, expect, it } from 'vitest'
import { liveTabs, MAX_SPLITS, splitCount, tabIndexOf, withSplit, type TerminalTab } from './terminalTabs'

describe("an agent's terminal tabs", () => {
  it('gives every terminal a tab of its own when nothing was saved', () => {
    expect(liveTabs(undefined, ['a', 'b'])).toEqual([[['a']], [['b']]])
  })

  it('keeps the saved splits, drops the shells that are gone, and never loses a live one', () => {
    const saved: TerminalTab[] = [[['a'], ['gone', 'b']], [['also-gone']]]
    expect(liveTabs(saved, ['a', 'b', 'c'])).toEqual([[['a'], ['b']], [['c']]])
  })

  it('splits right as a new column and down as a new row', () => {
    const right = withSplit([[['a']]], 'b', { beside: 'a', down: false })
    expect(right).toEqual([[['a'], ['b']]])
    expect(withSplit(right, 'c', { beside: 'a', down: true })).toEqual([[['a', 'c'], ['b']]])
  })

  it(`opens a tab of its own past ${String(MAX_SPLITS)} shells`, () => {
    let tabs: TerminalTab[] = [[['a']]]
    for (const id of ['b', 'c', 'd']) tabs = withSplit(tabs, id, { beside: 'a', down: false })
    expect(splitCount(tabs[0] ?? [])).toBe(MAX_SPLITS)
    const more = withSplit(tabs, 'e', { beside: 'a', down: true })
    expect(more).toHaveLength(2)
    expect(tabIndexOf(more, 'e')).toBe(1)
  })
})
