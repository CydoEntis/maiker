import { describe, expect, it, vi } from 'vitest'
import type { Conversation, TerminalDetails } from '@/data/preview'
import { asksOutside, asksToSay, askToastOf, outsideAsksOf, type AsksSaid, type OutsideAsk } from './outsideAsks'
import { toSessionView, type SessionView } from './session'

vi.mock('@/api/daemon', () => ({ terminalOf: (id: string) => Number(id.slice(1)) }))

const details = (extra: Partial<TerminalDetails> = {}): TerminalDetails => ({ asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, ...extra })

function session(pane: number, extra: Partial<Conversation> = {}): SessionView {
  const cwd = `/home/me/app${String(pane)}`
  return toSessionView({ id: `t${String(pane)}`, kind: 'terminal', title: '', project: '', folder: cwd, cwd, repo: 'api-server', branch: '', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: 'claude', ...extra }, '/home/me')
}
const wantsHelpers = (pane: number, tasks: string[]): SessionView => session(pane, { details: details({ helperAsk: tasks }) })
const wantsSecret = (pane: number, id: number): SessionView => session(pane, { details: details({ secretAsk: [{ id, label: 'NPM_TOKEN', reason: 'To publish' }] }) })
const ended = (from: SessionView): SessionView => ({ ...from, status: 'idle', ended: true })
const kinds = (asks: readonly OutsideAsk[]): string[] => asks.map((ask) => ask.kind)

/** Looks at one list after another, as the window does, and says what each look raised and took away. */
function looks(...lists: SessionView[][]): { raised: string[]; gone: string[] }[] {
  let said: AsksSaid = new Map()
  return lists.map((list) => {
    const result = asksToSay(said, list.flatMap(outsideAsksOf))
    said = result.said
    return { raised: result.raised.map((ask) => ask.key), gone: result.gone }
  })
}

describe('what a session says outside its pane', () => {
  it('says nothing for a session that asks for nothing', () => {
    expect(outsideAsksOf(session(1))).toEqual([])
    expect(asksOutside(session(1))).toBe(false)
  })

  it('says a helpers request with its tasks, and each secret request by itself', () => {
    const both = session(1, { details: details({ helperAsk: ['Search the docs', 'Run the tests'], secretAsk: [{ id: 4, label: 'A', reason: '' }, { id: 5, label: 'B', reason: '' }] }) })
    const asks = outsideAsksOf(both)
    expect(kinds(asks)).toEqual(['helpers', 'secret', 'secret'])
    expect(asks[0]).toMatchObject({ sessionId: 't1', tasks: ['Search the docs', 'Run the tests'] })
    expect(new Set(asks.map((ask) => ask.key)).size).toBe(3)
    expect(asksOutside(both)).toBe(true)
  })

  it('says an agent session that ended, and not what it had asked', () => {
    const gone = ended(wantsHelpers(1, ['Search the docs']))
    expect(kinds(outsideAsksOf(gone))).toEqual(['ended'])
    expect(asksOutside(gone)).toBe(false)
  })

  it('says nothing for a plain shell that ended', () => {
    expect(outsideAsksOf(ended(session(1, { agent: null })))).toEqual([])
  })
})

describe('which asks are said', () => {
  it('says a request once, however often the list is read, and takes it away when it is answered', () => {
    const asking = wantsHelpers(1, ['Search the docs'])
    expect(looks([asking], [asking], [session(1)])).toEqual([
      { raised: ['helpers:t1'], gone: [] },
      { raised: [], gone: [] },
      { raised: [], gone: ['helpers:t1'] },
    ])
  })

  it('says a request that was already waiting when the window opened', () => {
    expect(looks([wantsSecret(1, 7)])[0]?.raised).toEqual(['secret:t1:7'])
  })

  it('says a helpers request again when it asks for other tasks', () => {
    expect(looks([wantsHelpers(1, ['Search the docs'])], [wantsHelpers(1, ['Search the docs', 'Run the tests'])])[1]?.raised).toEqual(['helpers:t1'])
  })

  it('says a second secret request while the first still waits', () => {
    const two = session(1, { details: details({ secretAsk: [{ id: 7, label: 'NPM_TOKEN', reason: 'To publish' }, { id: 8, label: 'B', reason: '' }] }) })
    expect(looks([wantsSecret(1, 7)], [two])[1]).toEqual({ raised: ['secret:t1:8'], gone: [] })
  })
})

describe('what an ask\'s toast says', () => {
  const named = (from: SessionView): SessionView => ({ ...from, name: 'Fix the cart total' })

  it('names the session and its project, and waits for an answer', () => {
    const asking = named(wantsHelpers(1, ['Search the docs', 'Run the tests']))
    const [ask] = outsideAsksOf(asking)
    const toast = askToastOf(ask as OutsideAsk, asking)
    expect(toast.kind).toBe('needs')
    expect(toast.title).toContain('Fix the cart total')
    expect(toast.context).toBe('api-server')
    expect(toast.description).toContain('2 helpers')
  })

  it('names what the secret is for, never a value', () => {
    const asking = named(wantsSecret(1, 7))
    const [ask] = outsideAsksOf(asking)
    const toast = askToastOf(ask as OutsideAsk, asking)
    expect(toast.kind).toBe('needs')
    expect(toast.description).toContain('NPM_TOKEN')
  })

  it('is news, not a question, for a session that ended', () => {
    const gone = ended(named(session(1)))
    const [ask] = outsideAsksOf(gone)
    expect(askToastOf(ask as OutsideAsk, gone).kind).toBe('warning')
  })
})
