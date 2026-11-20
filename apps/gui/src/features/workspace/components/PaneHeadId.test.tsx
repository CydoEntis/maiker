import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PaneHeadId } from './PaneHeadId'
import { PaneFooter } from './PaneFooter'

const here = { status: 'working', process: 'claude', machineName: null, cwd: 'C:\\Users\\me\\projects\\maiker\\apps\\gui' } as const

describe('PaneHeadId', () => {
  it('says the status and the whole path, kept in a bdi so the end stays in view', () => {
    const { container } = render(<PaneHeadId session={here} />)
    expect(screen.getByRole('img', { name: 'Claude · working' })).toBeInTheDocument()
    expect(container.querySelector('bdi')).toHaveTextContent(here.cwd)
  })

  it('has no machine tag for a session on this computer', () => {
    const { container } = render(<PaneHeadId session={here} />)
    expect(container.querySelector('.mx-pane-machine')).toBeNull()
  })

  it('tags a remote session with its machine', () => {
    const { container } = render(<PaneHeadId session={{ ...here, machineName: 'devbox' }} />)
    expect(container.querySelector('.mx-pane-machine')).toHaveTextContent('devbox')
  })
})

describe('PaneFooter', () => {
  it('names the agent and shows how full its context is', () => {
    render(<PaneFooter session={{ process: 'claude', agentModel: '', usage: { context: 41.6, cost: null, tokens: null } }} />)
    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Context' })).toHaveAttribute('aria-valuenow', '42')
  })

  it('names the model beside the agent when the agent said it', () => {
    render(<PaneFooter session={{ process: 'claude', agentModel: 'claude-sonnet-5-5', usage: { context: 62, cost: null, tokens: null } }} />)
    expect(screen.getByText('Claude · Sonnet 5.5')).toBeInTheDocument()
  })

  it('shows no meter while the agent has not said', () => {
    render(<PaneFooter session={{ process: 'claude', agentModel: '', usage: { context: null, cost: null, tokens: null } }} />)
    expect(screen.queryByRole('meter')).toBeNull()
  })
})
