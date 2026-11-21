import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { installAcpAgent, loadAcpAgents, removeAcpAgent } from './acpAgents'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }))

describe('the agents that run over ACP', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockReset()
  })

  it('lists them as the host tells them', async () => {
    const row = { id: 'opencode', name: 'OpenCode', version: '2.3.2', description: 'An agent', source: 'registry', installed: null, unavailable: null }
    vi.mocked(invoke).mockResolvedValue([row])

    await expect(loadAcpAgents()).resolves.toEqual([row])
    expect(invoke).toHaveBeenCalledWith('acp_agents')
  })

  it('refuses a list that is not the shape it knows', async () => {
    vi.mocked(invoke).mockResolvedValue([{ id: 'opencode' }])

    await expect(loadAcpAgents()).rejects.toThrow()
  })

  it('installs and removes one by its id alone', async () => {
    vi.mocked(invoke).mockResolvedValue('Installed OpenCode 2.3.2')

    await installAcpAgent('opencode')
    await removeAcpAgent('opencode')

    expect(vi.mocked(invoke).mock.calls).toEqual([['install_acp_agent', { id: 'opencode' }], ['remove_acp_agent', { id: 'opencode' }]])
  })

  it('says it needs the desktop app in a browser', async () => {
    vi.mocked(isTauri).mockReturnValue(false)

    await expect(loadAcpAgents()).rejects.toThrow('desktop app')
    expect(invoke).not.toHaveBeenCalled()
  })
})
