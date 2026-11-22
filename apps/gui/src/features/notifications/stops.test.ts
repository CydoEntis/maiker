import { describe, expect, it, vi } from 'vitest'
import type { Conversation, TerminalDetails } from '@/data/preview'
import { toSessionView, type SessionView } from '@/features/workspace/model/session'
import { missingAgent, stopsFor, stopToastOf, type StopsSeen } from './stops'

vi.mock('@/api/daemon', () => ({ terminalOf: (id: string) => Number(id.slice(1)) }))

const NOW = new Date(2026, 0, 5, 9, 30).getTime()
const RESUME = new Date(2026, 0, 5, 14, 5).getTime()
const MS_PER_SECOND = 1000
const details = (extra: Partial<TerminalDetails> = {}): TerminalDetails => ({ asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, ...extra })

function session(pane: number, extra: Partial<Conversation> = {}): SessionView {
  const cwd = `/home/me/app${String(pane)}`
  return toSessionView({ id: `t${String(pane)}`, kind: 'terminal', title: '', project: '', folder: cwd, cwd, repo: 'api-server', branch: '', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: 'gemini', ...extra }, '/home/me', NOW)
}
const stoppedAt = (pane: number, at: number, extra: Partial<Conversation> = {}): SessionView => session(pane, { details: details({ exit: { code: 1, at } }), ...extra })
const limited = (pane: number, resumeAt = RESUME): SessionView => session(pane, { details: details({ resumeAt: resumeAt / MS_PER_SECOND }) })
const offline = (from: SessionView): SessionView => ({ ...from, status: 'unknown' })

/** Looks at one list after another, as the window does, and says which sessions each look told of. */
function looks(...lists: SessionView[][]): string[][] {
  let seen: StopsSeen | null = null
  return lists.map((list) => {
    const result = stopsFor(seen, list)
    seen = result.seen
    return result.stopped.map((item) => item.id)
  })
}

describe('which stops are told', () => {
  it('tells of an agent that stops, once, however often the list is read again', () => {
    expect(looks([session(1)], [stoppedAt(1, 5)], [stoppedAt(1, 5)], [stoppedAt(1, 5)])).toEqual([[], ['t1'], [], []])
  })

  it('tells of nothing that had already happened when the sessions are first listed', () => {
    expect(looks([stoppedAt(1, 5), limited(2)], [stoppedAt(1, 5), limited(2)])).toEqual([[], []])
  })

  it('tells of a session that is first listed already stopped, once the list has been read', () => {
    expect(looks([], [stoppedAt(1, 5)])).toEqual([[], ['t1']])
  })

  it('says nothing again after a lost connection', () => {
    const stopped = stoppedAt(1, 5)
    expect(looks([session(1)], [stopped], [offline(stopped)], [stopped])).toEqual([[], ['t1'], [], []])
  })

  it('tells of a second stop of the same session', () => {
    expect(looks([session(1)], [stoppedAt(1, 5)], [session(1, { status: 'working' })], [stoppedAt(1, 9)])).toEqual([[], ['t1'], [], ['t1']])
  })

  it('tells once of a session held by its plan limit', () => {
    expect(looks([session(1)], [limited(1)], [limited(1)])).toEqual([[], ['t1'], []])
  })

  it('leaves a shell alone: a command that failed in the person’s own terminal is no stop', () => {
    expect(looks([session(1, { agent: null })], [stoppedAt(1, 5, { agent: null })])).toEqual([[], []])
  })

  it('keeps the stop of a start that never became its agent, and ends it when the session runs again or goes', () => {
    const first = stopsFor(new Map(), [stoppedAt(1, 5)])
    const asShell = stopsFor(first.seen, [stoppedAt(1, 5, { agent: null })])
    expect(asShell.stopped).toEqual([])
    expect(asShell.ended).toEqual([])
    expect(stopsFor(asShell.seen, [session(1, { status: 'working' })]).ended).toEqual(['t1'])
    expect(stopsFor(asShell.seen, []).ended).toEqual(['t1'])
  })

  it('ends a limit’s stop when the limit does', () => {
    const held = stopsFor(new Map(), [limited(1)])
    expect(stopsFor(held.seen, [session(1)]).ended).toEqual(['t1'])
  })
})

describe('what a stop’s toast says', () => {
  const actionOf = (item: SessionView, installed: readonly string[] | null) => stopToastOf(item, installed, NOW)?.fix

  it('offers to install an agent this computer does not have, and names the session’s project', () => {
    const toast = stopToastOf(stoppedAt(1, 5), ['claude', 'codex'], NOW)
    expect(toast?.kind).toBe('error')
    expect(toast?.context).toBe('api-server')
    expect(toast?.fix).toMatchObject({ kind: 'install', agent: 'gemini' })
  })

  it('offers only to open the session when the agent is installed, or when nobody can say', () => {
    expect(actionOf(stoppedAt(1, 5), ['gemini'])).toEqual({ kind: 'open' })
    expect(actionOf(stoppedAt(1, 5), null)).toEqual({ kind: 'open' })
  })

  it('never offers an install for a session on another machine, or for a program the app cannot install', () => {
    expect(missingAgent({ ...stoppedAt(1, 5), machine: 3 }, [])).toBeNull()
    expect(missingAgent(stoppedAt(1, 5, { agent: 'aider' }), [])).toBeNull()
  })

  it('says when a limited session carries on, as a warning', () => {
    const toast = stopToastOf(limited(1), [], NOW)
    expect(toast?.kind).toBe('warning')
    expect(toast?.description).toContain('14:05')
    expect(toast?.fix).toEqual({ kind: 'open' })
  })

  it('has nothing to say about a session in one of the four states', () => {
    expect(stopToastOf(session(1), [], NOW)).toBeNull()
  })
})
