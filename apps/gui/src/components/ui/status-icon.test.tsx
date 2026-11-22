import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusMark, type StatusMarkState } from '../StatusMark'
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

describe('the preview StatusMark', () => {
  const nameOf = (status: StatusMarkState): string | null => {
    const { unmount } = render(<StatusMark status={status} named />)
    const name = screen.queryByRole('img')?.getAttribute('aria-label') ?? null
    unmount()
    return name
  }

  it('is the same mark: a stopped conversation and an unknown one are idle', () => {
    expect(nameOf('recovery')).toBeNull()
    expect(nameOf('needs-you')).toBe(markName('needs'))
    expect(nameOf('working')).toBe(markName('working'))
    expect(nameOf('done')).toBe(markName('done'))
    expect(nameOf('idle')).toBeNull()
    expect(nameOf('unknown')).toBeNull()
  })
})
