import { describe, expect, it, vi } from 'vitest'
import { newWorktreeSession, removeWorktrees } from './api'

const shell = vi.hoisted(() => ({ invoke: vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve(null)) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke, isTauri: () => true }))

describe('a new worktree made off a session', () => {
  it('goes to the daemon of the session\'s machine, and names none for this computer as before', async () => {
    await newWorktreeSession(7, 'feat/login', 'dev', 4)
    expect(shell.invoke).toHaveBeenLastCalledWith('new_worktree_session', { term: 7, branch: 'feat/login', base: 'dev', machine: 4 })
    await newWorktreeSession(2, 'fix', null)
    expect(shell.invoke).toHaveBeenLastCalledWith('new_worktree_session', { term: 2, branch: 'fix', base: null })
    await newWorktreeSession(2, 'fix', null, 0)
    expect(shell.invoke).toHaveBeenLastCalledWith('new_worktree_session', { term: 2, branch: 'fix', base: null })
  })
})

describe('removing worktrees', () => {
  it('sends each folder with whether to go on with its changes, and reads what went and what stayed', async () => {
    shell.invoke.mockResolvedValueOnce({ removed: ['/code/shop-old'], kept: [{ path: '/code/shop-busy', why: 'something is running in it' }] })
    await expect(removeWorktrees([{ path: '/code/shop-old', force: false }, { path: '/code/shop-busy', force: true }], 0)).resolves.toEqual({
      removed: ['/code/shop-old'],
      kept: [{ path: '/code/shop-busy', why: 'something is running in it' }],
    })
    expect(shell.invoke).toHaveBeenLastCalledWith('remove_worktrees', { machine: 0, items: [['/code/shop-old', false], ['/code/shop-busy', true]] })
  })

  it('reads nothing from a service too old to say, and refuses an answer of another shape', async () => {
    shell.invoke.mockResolvedValueOnce(null)
    await expect(removeWorktrees([{ path: '/code/shop-old', force: false }], 0)).resolves.toBeNull()
    shell.invoke.mockResolvedValueOnce({ removed: 'all' })
    await expect(removeWorktrees([{ path: '/code/shop-old', force: false }], 0)).rejects.toThrow()
  })
})
