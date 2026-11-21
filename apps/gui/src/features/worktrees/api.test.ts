import { describe, expect, it, vi } from 'vitest'
import { newWorktreeSession } from './api'

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
