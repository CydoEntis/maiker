import { beforeEach, describe, expect, it, vi } from 'vitest'

const shell = vi.hoisted(() => ({ invoke: vi.fn<(command: string, args: unknown) => Promise<unknown>>() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke, isTauri: () => true }))

import { addMachine } from './machines'

beforeEach(() => { shell.invoke.mockReset() })

describe('adding a machine', () => {
  it('reads a machine the host did not add as its sentence, which failure it is and the command to copy', async () => {
    const failed = { outcome: 'failed', message: "build's host key has changed, so Maiker won't connect: …", failure: 'host-key-changed', fix_command: "ssh-keygen -R 'build.example'" }
    shell.invoke.mockResolvedValue(failed)
    await expect(addMachine('build.example')).resolves.toEqual(failed)
    expect(shell.invoke).toHaveBeenCalledWith('add_machine', { target: 'build.example', name: null, port: null, keyFile: null, installHelper: false })
  })

  it('refuses a failure kind it does not know rather than guess its buttons', async () => {
    shell.invoke.mockResolvedValue({ outcome: 'failed', message: 'x', failure: 'something-new', fix_command: null })
    await expect(addMachine('build.example')).rejects.toThrow()
  })
})
