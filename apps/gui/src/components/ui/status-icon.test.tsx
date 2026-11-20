import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusMark } from '../StatusMark'
import { StatusIcon, type StatusIconKind } from './status-icon'

const drawn = (status: StatusIconKind) => render(<StatusIcon status={status} />).container.firstElementChild

describe('StatusIcon', () => {
  it('draws idle, done and needs you as a dot and working as the one ring, all in the same 16px box', () => {
    for (const status of ['idle', 'done', 'needs', 'working'] as const) {
      const mark = drawn(status)
      expect(mark).toHaveStyle({ width: '16px', height: '16px' })
      expect(mark?.querySelector('.mx-status-light') !== null).toBe(status === 'working')
    }
  })

  it('has no failed mark: a stopped agent and one held by its plan limit read as needs you, an unknown one as idle', () => {
    expect(drawn('error')).toHaveAttribute('data-status', 'needs')
    expect(drawn('limited')).toHaveAttribute('data-status', 'needs')
    expect(drawn('unknown')).toHaveAttribute('data-status', 'idle')
  })

  it('draws the working ring 11px with a 2px stroke, with the lit arc over a track', () => {
    const ring = drawn('working')?.querySelector('svg')
    expect(ring?.getAttribute('viewBox')).toBe('0 0 11 11')
    const strokes = Array.from(ring?.querySelectorAll('circle, rect') ?? [], (shape) => shape.getAttribute('stroke-width'))
    expect(new Set(strokes)).toEqual(new Set(['2']))
    expect(ring?.querySelectorAll('.mx-arc')).toHaveLength(2)
    expect(ring?.querySelectorAll('.mx-track')).toHaveLength(2)
  })

  it('is hidden from a screen reader, since the row beside it says the status', () => {
    expect(drawn('needs')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('the preview StatusMark', () => {
  it('is the same mark: a stopped conversation needs you and an unknown one is idle', () => {
    const marks = (['working', 'needs-you', 'done', 'idle', 'recovery', 'unknown'] as const).map((status) => render(<StatusMark status={status} />).container.firstElementChild?.getAttribute('data-status'))
    expect(marks).toEqual(['working', 'needs', 'done', 'idle', 'needs', 'idle'])
  })
})
