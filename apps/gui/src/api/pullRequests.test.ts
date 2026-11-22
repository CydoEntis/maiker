import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPullRequests } from './pullRequests'

const shell = vi.hoisted(() => ({ invoke: vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }))

const SENT = {
  number: 139, url: 'https://github.com/o/r/pull/139', title: 'Add a dark mode toggle', author: 'someone', branch: 'feat/dark-mode', draft: false,
  checks: 'Running', review: 'ChangesRequested', conflicting: false, mine: false, review_requested: true, needs_you: true, updated_at: '2026-01-02T03:04:05Z',
}

beforeEach(() => { shell.invoke.mockReset() })

describe('a project\'s pull requests, asked of its machine', () => {
  it('asks this computer by folder and reads each pull request', async () => {
    shell.invoke.mockResolvedValue({ state: 'listed', why: null, listed: { login: 'me', items: [SENT], more: true } })

    const answer = await loadPullRequests(0, '/code/app', false)

    expect(shell.invoke).toHaveBeenCalledWith('pull_requests', { folder: '/code/app', fresh: false })
    expect(answer).toEqual({
      state: 'listed', login: 'me', more: true,
      items: [{ number: 139, url: SENT.url, title: SENT.title, author: 'someone', branch: 'feat/dark-mode', draft: false, checks: 'running', review: 'changes-requested', conflicting: false, mine: false, reviewRequested: true, needsYou: true, updatedAt: SENT.updated_at }],
    })
  })

  it('names another machine, and asks past the kept list when told to', async () => {
    shell.invoke.mockResolvedValue({ state: 'not-on-github', why: null, listed: null })

    expect(await loadPullRequests(4, '~/api', true)).toEqual({ state: 'not-on-github' })
    expect(shell.invoke).toHaveBeenCalledWith('pull_requests', { machine: 4, folder: '~/api', fresh: true })
  })

  it('passes on each answer that is not a list as its own state', async () => {
    for (const state of ['not-installed', 'not-signed-in'] as const) {
      shell.invoke.mockResolvedValueOnce({ state, why: null, listed: null })
      expect(await loadPullRequests(0, '/code/app', false)).toEqual({ state })
    }
    shell.invoke.mockResolvedValueOnce({ state: 'failed', why: 'no network', listed: null })
    expect(await loadPullRequests(0, '/code/app', false)).toEqual({ state: 'failed', why: 'no network' })
  })

  it('answers failed, with the reason, when the machine cannot be asked or says something unreadable', async () => {
    shell.invoke.mockRejectedValueOnce('devbox is not connected')
    expect(await loadPullRequests(4, '~/api', false)).toEqual({ state: 'failed', why: 'devbox is not connected' })

    shell.invoke.mockResolvedValueOnce({ state: 'listed', why: null, listed: { login: 'me', items: [{ ...SENT, checks: 'Exploded' }], more: false } })
    expect((await loadPullRequests(0, '/code/app', false)).state).toBe('failed')
  })
})
