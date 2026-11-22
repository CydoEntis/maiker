import { describe, expect, it } from 'vitest'
import type { Conversation } from '@/data/preview'
import { helperLinks } from './helpers'
import { toSessionView, type SessionView } from './session'

function session(pane: number, title: string, extra: Partial<Conversation> = {}, startedBy: string | null = null): SessionView {
  return toSessionView(
    { id: `t${String(pane)}`, generation: 0, kind: 'terminal', title, named: true, project: '', folder: '/home/me/app', cwd: '/home/me/app', repo: 'app', branch: 'main', provider: 'Claude', status: 'working', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: 'claude', details: { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, startedBy }, ...extra },
    '/home/me',
  )
}

describe('who started whom', () => {
  it('names a helper\'s starter and counts a starter\'s helpers, in list order', () => {
    const links = helperLinks([session(1, 'Growth'), session(2, 'Review', {}, 't1'), session(3, 'Tests', { status: 'needs-you' }, 't1'), session(4, 'Billing')])
    expect([...links.starterOf]).toEqual([['t2', 'Growth'], ['t3', 'Growth']])
    expect([...links.helpersOf]).toEqual([['t1', { total: 2, needs: 1, names: ['Review', 'Tests'] }]])
  })

  it('treats a session whose starter is no longer listed as nobody\'s helper', () => {
    const links = helperLinks([session(2, 'Review', {}, 't1')])
    expect(links.starterOf.size).toBe(0)
    expect(links.helpersOf.size).toBe(0)
  })

  it('keeps a helper of a helper under the one that started it, not the first starter', () => {
    const links = helperLinks([session(1, 'Growth'), session(2, 'Review', {}, 't1'), session(3, 'Lint', {}, 't2')])
    expect(links.starterOf.get('t3')).toBe('Review')
    expect(links.helpersOf.get('t1')?.total).toBe(1)
  })

  it('never joins two machines\' panes of the same number', () => {
    const links = helperLinks([session(1, 'Growth'), { ...session(2, 'Review', {}, 'build/t1'), id: 'build/t2' }])
    expect(links.starterOf.size).toBe(0)
  })
})
