import { beforeEach, describe, expect, it, vi } from 'vitest'

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke, isTauri: () => true }))
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }))

import { agentInstallCommand, installAgent, listenInstallProgress } from './agentInstall'

describe('agent install calls', () => {
  beforeEach(() => { tauri.invoke.mockReset(); tauri.listen.mockReset() })

  it('sends the shell an agent’s name and nothing else', async () => {
    tauri.invoke.mockResolvedValue('npm install -g @google/gemini-cli')
    await expect(agentInstallCommand('gemini')).resolves.toBe('npm install -g @google/gemini-cli')
    expect(tauri.invoke).toHaveBeenCalledWith('agent_install_command', { agent: 'gemini' })
  })

  it('resolves with the installed version, or null when it could not be read', async () => {
    tauri.invoke.mockResolvedValueOnce({ version: '0.9.2' }).mockResolvedValueOnce({ version: null })
    await expect(installAgent('codex')).resolves.toEqual({ version: '0.9.2' })
    await expect(installAgent('codex')).resolves.toEqual({ version: null })
    expect(tauri.invoke).toHaveBeenCalledWith('install_agent', { agent: 'codex' })
  })

  it('hands on well-formed progress and drops anything else', async () => {
    let deliver: (event: { payload: unknown }) => void = () => undefined
    tauri.listen.mockImplementation((_name: string, handler: typeof deliver) => { deliver = handler; return Promise.resolve(() => undefined) })
    const seen: unknown[] = []
    await listenInstallProgress((progress) => { seen.push(progress) })
    deliver({ payload: { agent: 'codex', percent: 40, line: 'Downloading' } })
    deliver({ payload: { agent: 'codex', percent: null, line: 'Unpacking' } })
    deliver({ payload: { nonsense: true } })
    expect(seen).toEqual([{ agent: 'codex', percent: 40, line: 'Downloading' }, { agent: 'codex', percent: null, line: 'Unpacking' }])
  })
})
