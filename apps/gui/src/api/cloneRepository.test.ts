import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CLONE_ANSWER_MS, cloneRepository, type CloneProgress } from './cloneRepository'

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args: { tag: number }) => Promise<unknown>>(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    shell.handlers.set(name, handler)
    return Promise.resolve(() => { shell.handlers.delete(name) })
  },
}))

const ADDRESS = 'https://example.com/o/widgets.git'

/** The tag the window gave its latest question. */
function lastTag(): number {
  const tag = shell.invoke.mock.lastCall?.[1].tag
  if (tag === undefined) throw new Error('nothing was asked')
  return tag
}

function answer(payload: unknown) {
  shell.handlers.get('repository-cloned')?.({ payload })
}

function progress(payload: unknown) {
  shell.handlers.get('clone-progress')?.({ payload })
}

beforeEach(() => {
  shell.invoke.mockReset()
  shell.invoke.mockResolvedValue(undefined)
})

describe('cloning a repository on a machine', () => {
  it('asks this computer without naming a machine and gives the new folder', async () => {
    const cloned = cloneRepository(0, ADDRESS, '~/code')
    await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
    expect(shell.invoke).toHaveBeenCalledWith('clone_repository', { address: ADDRESS, parent: '~/code', tag: lastTag() })
    answer({ machine: 0, tag: lastTag(), folder: '/home/me/code/widgets', refused: null })
    await expect(cloned).resolves.toBe('/home/me/code/widgets')
  })

  it('names another machine and rejects with that machine\'s own reason', async () => {
    const cloned = cloneRepository(3, ADDRESS, '~')
    await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
    expect(shell.invoke).toHaveBeenCalledWith('clone_repository', { machine: 3, address: ADDRESS, parent: '~', tag: lastTag() })
    answer({ machine: 3, tag: lastTag(), folder: null, refused: '/home/dev/widgets is already there' })
    await expect(cloned).rejects.toThrow('/home/dev/widgets is already there')
  })

  it('takes only the answer to its own question', async () => {
    const cloned = cloneRepository(0, ADDRESS, '~')
    await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
    const tag = lastTag()
    answer({ machine: 0, tag: tag + 100, folder: '/elsewhere', refused: null })
    answer({ nonsense: true })
    answer({ machine: 0, tag, folder: '/home/me/widgets', refused: null })
    await expect(cloned).resolves.toBe('/home/me/widgets')
  })

  it('passes on the words the host refuses with', async () => {
    shell.invoke.mockRejectedValue('kingdom is not connected')
    await expect(cloneRepository(3, ADDRESS, '~')).rejects.toThrow('kingdom is not connected')
  })

  it('tells the steps git reports to the clone that asked and to no other', async () => {
    const heard: CloneProgress[] = []
    const cloned = cloneRepository(3, ADDRESS, '~', (step) => { heard.push(step) })
    await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
    const tag = lastTag()
    progress({ machine: 3, tag, phase: 'receiving', percent: 40 })
    progress({ machine: 3, tag: tag + 1, phase: 'receiving', percent: 99 })
    progress({ machine: 0, tag, phase: 'receiving', percent: 98 })
    progress({ machine: 3, tag, phase: 'receiving', percent: 400 })
    progress({ machine: 3, tag, phase: 'nonsense', percent: 5 })
    progress({ machine: 3, tag, phase: 'checking-out', percent: 100 })
    answer({ machine: 3, tag, folder: '/home/dev/widgets', refused: null })
    await expect(cloned).resolves.toBe('/home/dev/widgets')
    expect(heard).toEqual([{ phase: 'receiving', percent: 40 }, { phase: 'checking-out', percent: 100 }])
    expect(shell.handlers.has('clone-progress')).toBe(false)
  })

  it('listens for no progress when nobody asked for it', async () => {
    const cloned = cloneRepository(0, ADDRESS, '~')
    await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
    expect(shell.handlers.has('clone-progress')).toBe(false)
    answer({ machine: 0, tag: lastTag(), folder: '/x', refused: null })
    await cloned
  })

  it('gives up when the machine never says how it ended', async () => {
    vi.useFakeTimers()
    try {
      const cloned = cloneRepository(0, ADDRESS, '~')
      const failed = expect(cloned).rejects.toThrow('did not say how the clone ended')
      await vi.advanceTimersByTimeAsync(CLONE_ANSWER_MS)
      await failed
    } finally {
      vi.useRealTimers()
    }
  })
})
