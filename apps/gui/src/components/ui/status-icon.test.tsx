import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusIcon, markName, markOf, type StatusIconKind } from './status-icon'

describe('the status-to-mark model', () => {
  it('draws only four states: a stopped agent, one held by its plan limit and an unknown one are idle', () => {
    const statuses: readonly StatusIconKind[] = ['needs', 'working', 'done', 'idle', 'error', 'limited', 'unknown']
    expect(statuses.map(markOf)).toEqual(['needs', 'working', 'done', 'idle', 'idle', 'idle', 'idle'])
  })

  it('names every mark but idle, which has none', () => {
    expect(markName('needs')).not.toBeNull()
    expect(markName('working')).not.toBeNull()
    expect(markName('done')).not.toBeNull()
    expect(new Set([markName('needs'), markName('working'), markName('done')]).size).toBe(3)
    expect(markName('idle')).toBeNull()
    expect(markName('unknown')).toBeNull()
  })
})

describe('StatusIcon', () => {
  it.each(['needs', 'working', 'done'] as const)('draws %s as one image named for the state', (status) => {
    render(<StatusIcon status={status} named />)
    expect(screen.getByRole('img', { name: markName(status) ?? '' })).toBeInTheDocument()
  })

  it.each(['idle', 'unknown', 'error', 'limited'] as const)('draws nothing at all for %s', (status) => {
    const { container } = render(<StatusIcon status={status} named />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is decoration unless asked for a name, so it adds nothing to the name of a row that already says its status', () => {
    render(<button type="button" aria-label="Fix the cart total, needs you"><StatusIcon status="needs" /></button>)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
