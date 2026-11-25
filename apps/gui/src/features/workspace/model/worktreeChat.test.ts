import { describe, expect, it } from 'vitest'
import { worktreeChatRequest } from './worktreeChat'

const from = (agent: string | null, machine = 0, machineName: string | null = null) => ({ cwd: '/code/shop', machine, machineName, conversation: { agent } })

describe('the chat a New worktree starts in the Chat view', () => {
  it('is the agent of the session it was made from, in its usual mode, in a new worktree of that session\'s folder', () => {
    expect(worktreeChatRequest(from('codex'), 'fix-login', null, 'claude')).toMatchObject({
      folder: '/code/shop', agent: 'codex', mode: 'codexAuto', message: '', resume: null, machine: 0,
      branch: { name: 'fix-login', create: true, worktree: true },
    })
  })

  it('is the default agent when the session runs no agent with a chat', () => {
    expect(worktreeChatRequest(from(null), 'fix-login', null, 'codex').agent).toBe('codex')
    expect(worktreeChatRequest(from('opencode'), 'fix-login', null, 'claude').agent).toBe('claude')
  })

  it('starts the branch from the base picked, and from the session\'s own commit when none was', () => {
    expect(worktreeChatRequest(from('claude'), 'fix-login', 'dev', 'claude').branch).toEqual({ name: 'fix-login', create: true, worktree: true, base: 'dev' })
    expect(worktreeChatRequest(from('claude'), 'fix-login', null, 'claude').branch).not.toHaveProperty('base')
  })

  it('starts on the machine the session is on', () => {
    expect(worktreeChatRequest(from('claude', 4, 'devbox'), 'fix-login', null, 'claude')).toMatchObject({ machine: 4, machineName: 'devbox' })
  })
})
