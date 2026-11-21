import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcpAgent } from '@/api/acpAgents'
import { AcpAgentsDialog } from './AcpAgentsDialog'

const api = vi.hoisted(() => ({
  loadAcpAgents: vi.fn<() => Promise<AcpAgent[]>>(),
  installAcpAgent: vi.fn<(id: string) => Promise<void>>(),
  removeAcpAgent: vi.fn<(id: string) => Promise<void>>(),
}))
vi.mock('@/api/acpAgents', () => api)

const agent = (patch: Partial<AcpAgent>): AcpAgent => ({ id: 'opencode', name: 'OpenCode', version: '2.3.2', description: 'An open agent', source: 'registry', installed: null, unavailable: null, ...patch })

describe('the Other agents dialog', () => {
  beforeEach(() => {
    for (const call of Object.values(api)) call.mockReset()
    api.installAcpAgent.mockResolvedValue()
    api.removeAcpAgent.mockResolvedValue()
  })

  it('installs an agent on request, then offers to use it', async () => {
    api.loadAcpAgents.mockResolvedValueOnce([agent({})]).mockResolvedValue([agent({ installed: '2.3.2' })])
    const onPick = vi.fn()
    render(<AcpAgentsDialog onPick={onPick} onCancel={() => undefined} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Install OpenCode' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Use OpenCode' }))

    expect(api.installAcpAgent).toHaveBeenCalledWith('opencode')
    expect(onPick).toHaveBeenCalledWith({ id: 'opencode', name: 'OpenCode' })
  })

  it('says why an agent cannot be installed and offers no install for it', async () => {
    api.loadAcpAgents.mockResolvedValue([agent({ unavailable: 'publishes no checksum for its download' })])
    render(<AcpAgentsDialog onPick={() => undefined} onCancel={() => undefined} />)

    expect(await screen.findByText('Cannot be installed: it publishes no checksum for its download')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install OpenCode' })).not.toBeInTheDocument()
  })

  it('says the real reason on the row when an install fails', async () => {
    api.loadAcpAgents.mockResolvedValue([agent({})])
    api.installAcpAgent.mockRejectedValue(new Error('the download\'s checksum is wrong; nothing was installed'))
    render(<AcpAgentsDialog onPick={() => undefined} onCancel={() => undefined} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Install OpenCode' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('nothing was installed')
  })

  it('offers a config agent for use with nothing to install or remove, and removes an installed one', async () => {
    api.loadAcpAgents.mockResolvedValue([agent({ id: 'mine', name: 'mine', version: '', source: 'config', installed: '' }), agent({ installed: '2.3.2' })])
    render(<AcpAgentsDialog onPick={() => undefined} onCancel={() => undefined} />)

    expect(await screen.findByRole('button', { name: 'Use mine' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove mine' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove OpenCode' }))

    expect(api.removeAcpAgent).toHaveBeenCalledWith('opencode')
  })

  it('says so when the registry cannot be read', async () => {
    api.loadAcpAgents.mockRejectedValue(new Error('The ACP registry could not be reached'))
    render(<AcpAgentsDialog onPick={() => undefined} onCancel={() => undefined} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be reached')
  })
})
