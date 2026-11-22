import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusMark } from '../StatusMark'
import { StatusIcon, type StatusIconKind } from './status-icon'

const drawn = (status: StatusIconKind) => render(<StatusIcon status={status} />).container.firstElementChild

describe('StatusIcon', () => {

  it('has no failed mark: a stopped agent and one held by its plan limit read as needs you, an unknown one as idle', () => {
    expect(drawn('error')).toHaveAttribute('data-status', 'needs')
    expect(drawn('limited')).toHaveAttribute('data-status', 'needs')
    expect(drawn('unknown')).toHaveAttribute('data-status', 'idle')
  })
})

describe('the preview StatusMark', () => {
  it('is the same mark: a stopped conversation needs you and an unknown one is idle', () => {
    const marks = (['working', 'needs-you', 'done', 'idle', 'recovery', 'unknown'] as const).map((status) => render(<StatusMark status={status} />).container.firstElementChild?.getAttribute('data-status'))
    expect(marks).toEqual(['working', 'needs', 'done', 'idle', 'needs', 'idle'])
  })
})
