import { describe, expect, it } from 'vitest'
import type { Conversation } from '@/data/preview'
import { helperDiff, helperLinks, helperSummary, waitingOnHelpers } from './helpers'
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
    expect([...links.helpersOf]).toEqual([['t1', { total: 2, needs: 1, working: 1, names: ['Review', 'Tests'] }]])
  })

  it('counts a helper waiting for a free slot as working, since that is what the daemon reports', () => {
    const waiting = session(3, 'Tests', { details: { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, startedBy: 't1', waitingForSlot: true } })
    expect(waiting.waitingForSlot).toBe(true)
    const links = helperLinks([session(1, 'Growth'), session(2, 'Review', { status: 'done' }, 't1'), waiting])
    expect(links.helpersOf.get('t1')).toMatchObject({ total: 2, working: 1 })
    expect(helperSummary([session(2, 'Review', { status: 'done' }, 't1'), waiting])).toMatchObject({ count: 2, state: 'working' })
  })

  it('says a lead waits on its helpers only while it works and some of them do', () => {
    expect(waitingOnHelpers({ status: 'working' }, { working: 3 })).toBe('Waiting on 3 helpers')
    expect(waitingOnHelpers({ status: 'working' }, { working: 1 })).toBe('Waiting on 1 helper')
    expect(waitingOnHelpers({ status: 'working' }, { working: 0 })).toBeNull()
    expect(waitingOnHelpers({ status: 'working' }, null)).toBeNull()
    expect(waitingOnHelpers({ status: 'done' }, { working: 2 })).toBeNull()
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

describe('the summary of a lead\'s helpers', () => {
  const helper = (pane: number, status: Conversation['status']) => session(pane, 'Helper', { status }, 't1')

  it('counts them and how many need you, and takes the most urgent state: needs you, then working, then done', () => {
    expect(helperSummary([helper(2, 'done'), helper(3, 'working'), helper(4, 'needs-you'), helper(5, 'needs-you')])).toEqual({ count: 4, state: 'needs', needs: 2 })
    expect(helperSummary([helper(2, 'done'), helper(3, 'working')])).toEqual({ count: 2, state: 'working', needs: 0 })
    expect(helperSummary([helper(2, 'done'), helper(3, 'idle')])).toEqual({ count: 2, state: 'done', needs: 0 })
  })

  it('is idle when no helper needs you, works or has finished', () => {
    expect(helperSummary([helper(2, 'idle'), helper(3, 'unknown')])).toEqual({ count: 2, state: 'idle', needs: 0 })
  })
})

describe('what a helper changed', () => {
  it('is said once it is done', () => {
    expect(helperDiff(session(2, 'Helper', { status: 'done', diffAdded: 86, diffRemoved: 12 }, 't1'))).toEqual({ added: 86, removed: 12 })
  })

  it('is not said while it still works, nor when it changed nothing', () => {
    expect(helperDiff(session(2, 'Helper', { status: 'working', diffAdded: 86, diffRemoved: 12 }, 't1'))).toBeNull()
    expect(helperDiff(session(2, 'Helper', { status: 'done' }, 't1'))).toBeNull()
  })
})
