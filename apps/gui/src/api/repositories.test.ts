import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REPOSITORIES_ANSWER_MS, listRepositories, rescanRepositories } from './repositories'

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

const FOUND = {
  repos: [
    { path: '/home/me/app', branch: 'fix/one', last_used: 1_794_000_000 },
    { path: '/home/me/old', branch: null, last_used: 0 },
  ],
  indexed_at: 1_794_000_100,
  more: true,
}

/** Waits for the question to be sent, then answers it on the event with the tag it was given. */
async function answer(payload: Record<string, unknown>) {
  await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
  const tag = shell.invoke.mock.lastCall?.[1].tag
  shell.handlers.get('repositories')?.({ payload: { machine: 0, tag, ...payload } })
}

beforeEach(() => {
  shell.invoke.mockReset()
  shell.invoke.mockResolvedValue(undefined)
})

describe('the repositories a machine indexed', () => {
  it('asks this computer with no machine and reads the list in the window\'s words', async () => {
    const asked = listRepositories()
    await answer({ answer: FOUND })
    await expect(asked).resolves.toEqual({
      repos: [
        { path: '/home/me/app', branch: 'fix/one', lastUsed: 1_794_000_000 },
        { path: '/home/me/old', branch: null, lastUsed: 0 },
      ],
      indexedAt: 1_794_000_100,
      more: true,
    })
    expect(shell.invoke).toHaveBeenCalledExactlyOnceWith('repositories', { rescan: false, tag: expect.any(Number) as number })
  })

  it('asks another machine by name and can ask it to search again', async () => {
    const asked = rescanRepositories(3)
    await answer({ machine: 3, answer: FOUND })
    await asked
    expect(shell.invoke).toHaveBeenCalledExactlyOnceWith('repositories', { machine: 3, rescan: true, tag: expect.any(Number) as number })
  })

  it('ignores an answer that is not a list and gives up when no other comes', async () => {
    vi.useFakeTimers()
    try {
      const asked = listRepositories(3)
      const rejected = expect(asked).rejects.toThrow('did not list its repositories')
      await answer({ machine: 3, answer: { repos: 'none' } })
      await vi.advanceTimersByTimeAsync(REPOSITORIES_ANSWER_MS)
      await rejected
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects with the host\'s words when the machine is offline', async () => {
    shell.invoke.mockRejectedValue('kingdom is not connected')
    await expect(listRepositories(3)).rejects.toThrow('kingdom is not connected')
  })
})
