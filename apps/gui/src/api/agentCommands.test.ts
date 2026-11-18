import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAgentCommands } from './agentCommands'

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args: { tag?: number }) => Promise<unknown>>(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    shell.handlers.set(name, handler)
    return Promise.resolve(() => undefined)
  },
}))

const PDF = { name: 'pdf', description: 'Reads PDFs', hint: '<file>', aliases: [] as string[] }

/** Waits for the question to be sent, then answers it on the event with the tag it was given. */
async function answer(payload: Record<string, unknown>) {
  await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
  const tag = shell.invoke.mock.lastCall?.[1].tag
  shell.handlers.get('agent-commands')?.({ payload: { machine: 3, tag, ...payload } })
}

beforeEach(() => {
  shell.invoke.mockReset()
  shell.invoke.mockResolvedValue(undefined)
})

describe('an agent\'s commands on a machine', () => {
  it('asks this computer in place, with no machine and no tag', async () => {
    shell.invoke.mockResolvedValue([PDF])
    await expect(loadAgentCommands('claude', '/home/me/app')).resolves.toEqual([PDF])
    expect(shell.invoke).toHaveBeenCalledExactlyOnceWith('agent_commands', { agent: 'claude', folder: '/home/me/app' })
  })

  it('asks another machine\'s daemon, and reads that machine\'s list', async () => {
    const asked = loadAgentCommands('codex', '/srv/app', 3)
    await answer({ answer: { Ok: [PDF] } })
    await expect(asked).resolves.toEqual([PDF])
    expect(shell.invoke).toHaveBeenCalledExactlyOnceWith('agent_commands_on', { machine: 3, agent: 'codex', folder: '/srv/app', tag: expect.any(Number) as number })
  })

  it('says why a machine could not list, and never answers with this computer\'s list', async () => {
    const asked = loadAgentCommands('claude', '/srv/app', 3)
    await answer({ answer: { Err: 'Claude is not installed on this machine' } })
    await expect(asked).rejects.toThrow('Claude is not installed on this machine')
    expect(shell.invoke).not.toHaveBeenCalledWith('agent_commands', expect.anything())
  })

  it('rejects with the host\'s words when the machine is offline', async () => {
    shell.invoke.mockRejectedValue('kingdom is not connected')
    await expect(loadAgentCommands('claude', '/srv/app', 3)).rejects.toThrow('kingdom is not connected')
    expect(shell.invoke).not.toHaveBeenCalledWith('agent_commands', expect.anything())
  })
})
