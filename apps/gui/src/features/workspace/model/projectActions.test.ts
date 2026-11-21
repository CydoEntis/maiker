import { describe, expect, it } from 'vitest'
import type { Conversation } from '@/data/preview'
import { closeRefusalWords, worktreeSourceOf } from './projectActions'
import { toSessionView, type SessionView } from './session'

/** An agent session named `title`, as the daemon reports it; `extra` sets what the daemon says of it. */
function session(pane: number, title: string, extra: Partial<Conversation> = {}): SessionView {
  const cwd = extra.cwd ?? '/home/me/shop'
  return toSessionView(
    { id: `t${String(pane)}`, generation: 0, kind: 'terminal', title, named: true, project: '', folder: cwd, cwd, repo: null, branch: 'working tree', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: 'claude', ...extra },
    '/home/me',
  )
}

const IN_REPO = { repo: 'shop', branch: 'main', folder: '/home/me/shop' } satisfies Partial<Conversation>

describe('the session a project\'s New worktree is made from', () => {
  it('is one in the main checkout before one in a linked worktree', () => {
    const linked = session(1, 'Linked', { ...IN_REPO, cwd: '/home/me/.maiker/shop/x', linked: true })
    const main = session(2, 'Main', IN_REPO)
    expect(worktreeSourceOf([linked, main])).toBe(main)
    expect(worktreeSourceOf([linked])).toBe(linked)
  })

  it('is none outside git or for an ended session', () => {
    expect(worktreeSourceOf([session(1, 'Plain')])).toBeNull()
    expect(worktreeSourceOf([{ ...session(3, 'Gone', IN_REPO), ended: true }])).toBeNull()
    expect(worktreeSourceOf([])).toBeNull()
  })

  it('is a session of another machine in its repository, whose own daemon makes the worktree', () => {
    const there = session(2, 'There', { ...IN_REPO, machine: 4, machineName: 'devbox' })
    expect(worktreeSourceOf([there])).toBe(there)
  })
})

describe('what a refused Close project says', () => {
  const refusal = (...titles: string[]) => ({ code: 'sessions-running' as const, running: titles.map((title, index) => session(index + 1, title)) })

  it('names one session, two, and counts past three', () => {
    expect(closeRefusalWords('shop', refusal('Fix tests'))).toEqual({ title: 'Could not close shop', description: 'Still running in it: Fix tests. Close it first.' })
    expect(closeRefusalWords('shop', refusal('A', 'B')).description).toBe('Still running in it: A and B. Close them first.')
    expect(closeRefusalWords('shop', refusal('A', 'B', 'C', 'D', 'E')).description).toBe('Still running in it: A, B, C and 2 more. Close them first.')
  })
})
