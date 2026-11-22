import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PaneHeadId } from './PaneHeadId'

const here = { status: 'working', process: 'claude', machineName: null, cwd: 'C:\\Users\\me\\projects\\maiker\\apps\\gui' } as const

describe('PaneHeadId', () => {
  it('says the status and the whole path, kept in a bdi so the end stays in view', () => {
    const { container } = render(<PaneHeadId session={here} />)
    expect(screen.getByRole('img', { name: 'Claude · working' })).toBeInTheDocument()
    expect(container.querySelector('bdi')).toHaveTextContent(here.cwd)
  })

  it('tags a remote session with its machine', () => {
    const { container } = render(<PaneHeadId session={{ ...here, machineName: 'devbox' }} />)
    expect(container.querySelector('.mx-pane-machine')).toHaveTextContent('devbox')
  })
})
