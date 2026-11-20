import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadMachineFacts } from './machineFacts'

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args: { tag: number }) => Promise<unknown>>(),
  handler: null as null | ((event: { payload: unknown }) => void),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (_name: string, handler: (event: { payload: unknown }) => void) => {
    shell.handler = handler
    return Promise.resolve(() => undefined)
  },
}))

const FACTS = {
  host_name: 'build-box',
  os: 'linux',
  os_version: 'Ubuntu 24.04',
  arch: 'x86_64',
  cpu_cores: 8,
  agents: [{ name: 'claude', version: '2.1.0' }, { name: 'codex', version: null }],
}

function lastTag(): number {
  const tag = shell.invoke.mock.lastCall?.[1].tag
  if (tag === undefined) throw new Error('nothing was asked')
  return tag
}

beforeEach(() => {
  shell.invoke.mockReset()
  shell.invoke.mockResolvedValue(undefined)
})

describe('what a machine says it is', () => {
  it('asks this computer without naming a machine and gives its facts', async () => {
    const loaded = loadMachineFacts(0)
    await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
    expect(shell.invoke).toHaveBeenCalledWith('machine_facts', { tag: lastTag() })
    shell.handler?.({ payload: { machine: 0, tag: lastTag(), answer: FACTS } })
    await expect(loaded).resolves.toEqual(FACTS)
  })

  it('names another machine and takes only the answer to its own question', async () => {
    const loaded = loadMachineFacts(2)
    await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
    expect(shell.invoke).toHaveBeenCalledWith('machine_facts', { machine: 2, tag: lastTag() })
    shell.handler?.({ payload: { machine: 2, tag: lastTag() + 50, answer: { ...FACTS, host_name: 'other' } } })
    shell.handler?.({ payload: { machine: 2, tag: lastTag(), answer: { os: 'linux' } } })
    shell.handler?.({ payload: { machine: 2, tag: lastTag(), answer: FACTS } })
    await expect(loaded).resolves.toEqual(FACTS)
  })

  it('passes on the words the host refuses with', async () => {
    shell.invoke.mockRejectedValue('kingdom is not connected')
    await expect(loadMachineFacts(2)).rejects.toThrow('kingdom is not connected')
  })
})
