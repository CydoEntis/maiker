import { describe, expect, it } from 'vitest'
import type { Conversation } from '@/data/preview'
import { offersOpenWorktree, worktreeChoices, type ListedWorktree } from './projectWorktrees'
import { toSessionView, type SessionView } from './session'

/** An agent session named `title` in `cwd`, as the daemon reports it; `extra` sets what else the daemon says of it. */
function session(pane: number, title: string, cwd: string, extra: Partial<Conversation> = {}): SessionView {
  return toSessionView(
    { id: `t${String(pane)}`, generation: 0, kind: 'terminal', title, named: true, project: '', folder: cwd, cwd, repo: 'shop', branch: 'main', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: 'claude', ...extra },
    '/home/me',
  )
}

const FEAT: ListedWorktree = { path: '/home/me/.maiker/shop/feat-x', branch: 'feat/x', present: true }
const GONE: ListedWorktree = { path: '/home/me/.maiker/shop/old', branch: 'old', present: false }
const SHOP = { machineName: null, folder: '/home/me/shop' }

describe('which worktrees Open worktree can open', () => {
  it('names each by its folder and opens one nothing runs in', () => {
    expect(worktreeChoices([FEAT], [], 0)).toEqual([{ kind: 'open', worktree: FEAT, name: 'feat-x' }])
  })

  it('shows the first session started in a worktree, by its checkout, and counts the rest', () => {
    const second = session(5, 'Second', '/home/me/.maiker/shop/feat-x/src', { checkout: '/home/me/.maiker/shop/feat-x', linked: true })
    const first = session(2, 'First', '/home/me/.maiker/shop/feat-x', { checkout: '/home/me/.maiker/shop/feat-x', linked: true })
    const [choice] = worktreeChoices([FEAT], [second, first], 0)
    expect(choice).toMatchObject({ kind: 'running', session: { id: 't2' }, others: 1 })
  })

  it('matches a Windows worktree however its path is spelled', () => {
    const windows: ListedWorktree = { path: 'C:/dev/shop-feat', branch: 'feat', present: true }
    const there = session(1, 'There', 'C:\\Dev\\Shop-Feat\\src', { checkout: 'C:\\Dev\\Shop-Feat\\' })
    expect(worktreeChoices([windows], [there], 0)[0]?.kind).toBe('running')
  })

  it('goes by the folder when the daemon did not say the checkout, but not into a worktree beside it', () => {
    const inside = session(1, 'Inside', '/home/me/.maiker/shop/feat-x/src')
    const beside = session(2, 'Beside', '/home/me/.maiker/shop/feat-xy')
    expect(worktreeChoices([FEAT], [beside], 0)[0]?.kind).toBe('open')
    expect(worktreeChoices([FEAT], [inside, beside], 0)[0]).toMatchObject({ kind: 'running', session: { id: 't1' }, others: 0 })
  })

  it('leaves out ended sessions and sessions of another machine, and keeps put-away ones', () => {
    const ended = { ...session(1, 'Ended', FEAT.path, { checkout: FEAT.path }), ended: true }
    const elsewhere = session(2, 'Elsewhere', FEAT.path, { checkout: FEAT.path, machine: 4, machineName: 'devbox' })
    expect(worktreeChoices([FEAT], [ended, elsewhere], 0)[0]?.kind).toBe('open')
    const away = session(3, 'Away', FEAT.path, { checkout: FEAT.path, archived: true })
    expect(worktreeChoices([FEAT], [away], 0)[0]?.kind).toBe('running')
  })

  it('marks a worktree whose folder is gone as missing', () => {
    expect(worktreeChoices([GONE], [], 0)).toEqual([{ kind: 'missing', worktree: GONE, name: 'old' }])
  })
})

describe('where Open worktree is offered', () => {
  it('is on a git project of this computer, and on one with no session yet, whose folder the dialog reads', () => {
    expect(offersOpenWorktree(SHOP, [session(1, 'Main', '/home/me/shop', { folder: '/home/me/shop' })])).toBe(true)
    expect(offersOpenWorktree(SHOP, [])).toBe(true)
  })

  it('is not on a plain folder or on another machine', () => {
    expect(offersOpenWorktree({ machineName: null, folder: '/home/me/notes' }, [session(1, 'Notes', '/home/me/notes', { repo: null })])).toBe(false)
    expect(offersOpenWorktree({ machineName: 'devbox', folder: '/srv/api' }, [])).toBe(false)
  })
})
