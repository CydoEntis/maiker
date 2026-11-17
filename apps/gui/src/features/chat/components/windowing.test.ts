import { describe, expect, it } from 'vitest'
import { buildLayout, glidePlan, glideTop, isAtBottom, SEND_TOP_GAP_PX, sendSpacer, sendTop, visibleRange } from './windowing'

const keys = (count: number) => Array.from({ length: count }, (_, index) => `row-${String(index)}`)

describe('the layout of a list with rows of different heights', () => {
  it('stacks measured rows and counts the rest at the estimate', () => {
    const layout = buildLayout(['a', 'b', 'c'], new Map([['b', 100]]), 40)

    expect(layout.offsets).toEqual([0, 40, 140])
    expect(layout.total).toBe(180)
  })
})

describe('the rows to draw', () => {
  const layout = buildLayout(keys(2000), new Map(), 50)

  it('draws a screenful plus the overscan, however long the list is', () => {
    const range = visibleRange(layout, 25_000, 600, 5)

    expect(range.end - range.start).toBeLessThanOrEqual(12 + 2 * 5 + 1)
    expect(range.start).toBeLessThanOrEqual(500)
    expect(range.end).toBeGreaterThan(512)
  })

  it('starts at the top and stops at the end', () => {
    expect(visibleRange(layout, 0, 600, 3).start).toBe(0)
    expect(visibleRange(layout, layout.total, 600, 3).end).toBe(2000)
  })

  it('draws nothing for an empty list', () => {
    expect(visibleRange(buildLayout([], new Map(), 50), 0, 600, 3)).toEqual({ start: 0, end: 0 })
  })

  it('follows rows whose heights were measured', () => {
    const measured = buildLayout(keys(100), new Map(keys(100).map((key) => [key, 200])), 50)

    const range = visibleRange(measured, 4_000, 600, 0)

    expect(range.start).toBe(20)
    expect(range.end).toBe(24)
  })
})

describe('the bottom of the list', () => {
  it('counts a list as at the bottom within a few pixels of it', () => {
    expect(isAtBottom(1_000, 600, 1_600)).toBe(true)
    expect(isAtBottom(980, 600, 1_600)).toBe(true)
    expect(isAtBottom(500, 600, 1_600)).toBe(false)
  })
})

describe('where a sent message stands', () => {
  it('puts the message at the top of the view, a few pixels under it', () => {
    expect(sendTop(1000)).toBe(1000 - SEND_TOP_GAP_PX)
    expect(sendTop(3)).toBe(0)
  })

  it('leaves room below a short reply so the message can stand at the top', () => {
    // 600px view, message at 1000, rows end at 1100: 100px of rows fill part of the view.
    expect(sendSpacer(600, 1000, 1100)).toBe(600 - SEND_TOP_GAP_PX - 100)
  })

  it('shrinks as the reply grows and is gone once the reply fills the view', () => {
    expect(sendSpacer(600, 1000, 1300)).toBeLessThan(sendSpacer(600, 1000, 1100))
    expect(sendSpacer(600, 1000, 1000 + 600)).toBe(0)
    expect(sendSpacer(600, 1000, 5000)).toBe(0)
  })
})

describe('gliding to the newest row', () => {
  it('has nothing to do when the view is already there', () => {
    expect(glidePlan(900, 900, 600)).toBeNull()
    expect(glidePlan(950, 900, 600)).toBeNull()
  })

  it('takes longer the further it goes, between a least and a most', () => {
    const near = glidePlan(880, 900, 600)
    const far = glidePlan(0, 900, 600)
    expect(near).toEqual({ from: 880, ms: 185 })
    expect(far).toEqual({ from: 0, ms: 405 })
    expect(glidePlan(0, 1200, 600)?.ms).toBe(420)
  })

  it('starts two screens above the bottom from further up, so a long chat is not drawn row by row on the way', () => {
    expect(glidePlan(0, 50_000, 600)).toEqual({ from: 48_800, ms: 420 })
  })

  it('moves quickly at first and eases into the newest row', () => {
    expect(glideTop(0, 1000, 0)).toBe(0)
    expect(glideTop(0, 1000, 0.5)).toBe(875)
    expect(glideTop(0, 1000, 1)).toBe(1000)
    expect(glideTop(0, 1000, 2)).toBe(1000)
  })
})
