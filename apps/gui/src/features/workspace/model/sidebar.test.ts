import { describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/data/preview'
import { toSessionView, type SessionView } from './session'
import { byLatestChange, byUrgency, inProject, isFreshSession, leftOutOfChatView, projectChoices, projectColor, placeLine, rowTitle, rowWord, splitPutAway, statusSections } from './sidebar'

vi.mock('@/api/daemon', () => ({ terminalOf: (id: string) => Number(id.slice(1)) }))

function session(pane: number, extra: Partial<Conversation> = {}): SessionView {
  const cwd = extra.cwd ?? `/home/me/app${String(pane)}`
  return toSessionView({ id: `t${String(pane)}`, kind: 'terminal', title: '', project: '', folder: cwd, cwd, repo: null, branch: '', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: null, ...extra }, '/home/me')
}
const exited = { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, exit: { code: 1, at: 1 } }

const NOW = new Date(2026, 0, 5, 9, 30).getTime()
const RESUME = new Date(2026, 0, 5, 14, 5).getTime()
/** An agent the daemon says continues at 14:05, seen at 9:30. */
function limited(pane: number): SessionView {
  return toSessionView({ ...session(pane, { agent: 'claude', details: { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, resumeAt: RESUME / 1000 } }).conversation }, '/home/me', NOW)
}

describe('the sidebar’s order', () => {
  it('puts what asks first, then work in progress, then what finished, and an agent that stopped or is limited with the idle', () => {
    const order = byUrgency([session(1, { agent: 'claude', details: exited }), limited(2), session(3, { agent: 'claude', status: 'done' }), session(4, { agent: 'claude', status: 'working' }), session(5, { agent: 'claude', status: 'needs-you' }), session(6)])
    expect(order.map((item) => item.id)).toEqual(['t5', 't4', 't3', 't1', 't2', 't6'])
  })

  it('keeps creation order within a rank', () => {
    expect(byUrgency([session(3), session(1), session(2)]).map((item) => item.id)).toEqual(['t1', 't2', 't3'])
  })
})

describe('a row', () => {
  it('says where a session works for a toast: project, branch and a worktree', () => {
    const plain = session(1, { repo: 'maiker', branch: 'gui-revive' })
    expect(placeLine(plain)).toBe('maiker / gui-revive')
    expect(placeLine({ ...plain, worktree: true })).toBe('maiker / gui-revive · worktree')
    expect(placeLine({ ...plain, branch: null })).toBe('maiker')
  })

  it('names a session by its name, else by the folder it was made in, a program included', () => {
    expect(rowTitle(session(1, { named: true, title: 'Growth' }))).toBe('Growth')
    expect(rowTitle(session(2, { cwd: '/home/me/dev', folder: '/home/me/dev' }))).toBe('dev')
    expect(rowTitle(session(3, { agent: 'codex', status: 'working' }))).toBe('app3')
    expect(rowTitle(session(4, { cwd: '/home/me/dev', folder: '/home/me/dev', process: 'node-mainthread' }))).toBe('dev')
  })

  it('names an agent that has been asked something by that, and one that has done nothing "New session"', () => {
    expect(rowTitle(session(1, { agent: 'claude', summary: 'Fix the cart total\nthen run the tests' }))).toBe('Fix the cart total')
    const fresh = session(2, { agent: 'claude' })
    expect(rowTitle(fresh)).toBe('New session')
    expect(isFreshSession(fresh)).toBe(true)
    expect(isFreshSession(session(3, { agent: 'claude', status: 'working' }))).toBe(false)
    expect(isFreshSession(session(4))).toBe(false)
    expect(isFreshSession(session(5, { agent: 'claude', named: true, title: 'Growth' }))).toBe(false)
  })

  it('says stopped for an agent and exited for a shell, and nothing otherwise', () => {
    expect(rowWord(session(1, { agent: 'claude', details: exited }))).toBe('stopped')
    expect(rowWord(session(2, { details: exited }))).toBe('exited')
    expect(rowWord(session(3, { status: 'working' }))).toBe('')
  })

  it('says until when a session stopped by its plan limit is limited', () => {
    expect(rowWord(limited(1), NOW)).toBe('limited until 14:05')
  })

  it('gives a project the same one of five colours every time', () => {
    expect(projectColor('maiker')).toBe(projectColor('maiker'))
    expect(projectColor('maiker')).toMatch(/^var\(--proj-[1-5]\)$/)
  })
})

describe('a snoozed session', () => {
  const UNTIL = new Date(2026, 0, 5, 14, 5).getTime()
  const details = { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, snoozedUntil: UNTIL / 1000 }
  const snoozed = (pane: number, extra: Partial<Conversation> = {}) => toSessionView({ ...session(pane, { agent: 'claude', status: 'done', details, ...extra }).conversation }, '/home/me', NOW)

  it('is listed under Put away, with when it comes back, and not in a section', () => {
    const away = snoozed(1)
    expect(away.snoozedUntil).toBe(UNTIL)
    expect(splitPutAway([away, session(2)]).putAway.map((item) => item.id)).toEqual(['t1'])
    expect(rowWord(away, NOW)).toBe('until 14:05')
  })

  it('names the day when it comes back on another one', () => {
    const tomorrow = toSessionView({ ...session(1, { agent: 'claude', status: 'done', details: { ...details, snoozedUntil: new Date(2026, 0, 6, 9, 0).getTime() / 1000 } }).conversation }, '/home/me', NOW)
    expect(rowWord(tomorrow, NOW)).toBe('until Tue 09:00')
  })

  it('is listed again once its time has passed', () => {
    const over = toSessionView({ ...snoozed(1).conversation }, '/home/me', UNTIL + 1000)
    expect(over.snoozedUntil).toBeNull()
    expect(splitPutAway([over]).putAway).toEqual([])
  })

  it('is listed under Needs you, not Put away, while it asks', () => {
    expect(splitPutAway([snoozed(1, { status: 'needs-you' })]).putAway).toEqual([])
  })

})

describe('status sections', () => {
  it('lists needs you, working, finished and idle in that order, and leaves out a status nothing has', () => {
    const sections = statusSections([session(1, { agent: 'codex' }), session(2, { agent: 'claude', status: 'done' }), session(3, { agent: 'claude', status: 'needs-you' })])
    expect(sections.map((section) => [section.name, section.sessions.map((item) => item.id)])).toEqual([['Needs you', ['t3']], ['Done', ['t2']], ['Idle', ['t1']]])
  })

  it('puts an agent that stopped with the idle: a stop is not a question', () => {
    const sections = statusSections([session(2, { agent: 'claude', details: exited })])
    expect(sections.map((section) => [section.key, section.sessions.map((item) => item.id)])).toEqual([['idle', ['t2']]])
  })

  it('puts a session held by its plan limit with the idle', () => {
    const sections = statusSections([session(1, { agent: 'claude', status: 'working' }), limited(2)])
    expect(sections.map((section) => [section.key, section.sessions.map((item) => item.id)])).toEqual([['working', ['t1']], ['idle', ['t2']]])
  })

  it('lists a held row that starts working under Working, not where it was picked', () => {
    const sessions = [session(1, { agent: 'claude', status: 'working' }), session(2, { agent: 'claude', status: 'idle' })]
    const sections = statusSections(sessions, { id: 't1', section: 'idle' })
    expect(sections.map((section) => [section.key, section.sessions.map((item) => item.id)])).toEqual([['working', ['t1']], ['idle', ['t2']]])
  })

  it('keeps the held row in the section it was picked in, and moves the others', () => {
    const sessions = [session(1, { agent: 'claude', status: 'idle' }), session(2, { agent: 'claude', status: 'idle' })]
    const sections = statusSections(sessions, { id: 't1', section: 'done' })
    expect(sections.map((section) => [section.key, section.sessions.map((item) => item.id)])).toEqual([['done', ['t1']], ['idle', ['t2']]])
  })
})

describe('shells', () => {
  it('are ordinary rows: listed by status with the agents', () => {
    const all = [session(3, { process: 'pnpm' }), session(1), session(2, { agent: 'claude' }), session(4, { details: exited })]
    expect(statusSections(all).map((section) => [section.key, section.sessions.map((item) => item.id)])).toEqual([['idle', ['t4', 't3', 't2', 't1']]])
  })

  it('sit with what needs you while they ask', () => {
    const all = [session(1, { status: 'needs-you' }), session(2)]
    expect(statusSections(all).map((section) => [section.key, section.sessions.map((item) => item.id)])).toEqual([['needs', ['t1']], ['idle', ['t2']]])
  })
})

describe('the Chat view', () => {
  const details = { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null } }

  it('leaves out a plain shell and lists an agent', () => {
    expect(leftOutOfChatView(session(1))).toBe(true)
    expect(leftOutOfChatView(session(2, { agent: 'claude' }))).toBe(false)
  })

  it('lists a helper even while it reads as a shell', () => {
    expect(leftOutOfChatView(session(1, { details: { ...details, startedBy: '7' } }))).toBe(false)
  })
})

describe('projects', () => {
  const sessions = () => [session(1, { agent: 'claude', cwd: '/x/b', folder: '/x/b' }), session(2, { agent: 'claude', cwd: '/x/a', folder: '/x/a' }), session(3, { agent: 'claude', machine: 2, machineName: 'devbox', cwd: '/x/a', folder: '/x/a' })]

  it('lists every project by name with how many sessions it has', () => {
    expect(projectChoices(sessions()).map((choice) => [choice.name, choice.count])).toEqual([['a', 2], ['b', 1]])
  })

  it('narrows to one project, or to none when no project is picked', () => {
    expect(inProject(sessions(), 'a').map((item) => item.id)).toEqual(['t2', 't3'])
    expect(inProject(sessions(), null)).toHaveLength(3)
  })
})

describe('putting a session away', () => {
  const away = (pane: number, extra: Partial<Conversation> = {}) => session(pane, { archived: true, ...extra })

  it('lists put-away agents and terminals only under Put away, as created', () => {
    const { listed, putAway } = splitPutAway([away(3, { agent: 'claude' }), session(1, { agent: 'claude' }), away(2), session(4)])
    expect(putAway.map((item) => item.id)).toEqual(['t2', 't3'])
    expect(listed.map((item) => item.id)).toEqual(['t1', 't4'])
    expect(statusSections(listed).flatMap((section) => section.sessions.map((item) => item.id))).toEqual(['t4', 't1'])
  })

  it('lists a put-away session that needs you under Needs you, still put away on the daemon', () => {
    const asking = away(1, { agent: 'claude', status: 'needs-you' })
    const { listed, putAway } = splitPutAway([asking])
    expect(putAway).toEqual([])
    expect(statusSections(listed).map((section) => [section.key, section.sessions.map((item) => item.id)])).toEqual([['needs', ['t1']]])
    expect(listed[0]?.archived).toBe(true)
  })

  it('keeps a put-away agent that stopped, and an exited shell, put away: neither asks anything', () => {
    const { listed, putAway } = splitPutAway([away(1, { agent: 'claude', details: exited }), away(2, { details: exited })])
    expect(listed).toEqual([])
    expect(putAway.map((item) => item.id)).toEqual(['t1', 't2'])
  })

})

describe('sorting a heading’s rows', () => {
  const at = (pane: number, name: string, since: number | null) => session(pane, { agent: 'claude', named: true, title: name, ...(since === null ? {} : { details: { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, since } }) })
  const rows = () => [at(1, 'Mid', 100), at(2, 'Zed', 300), at(3, 'Amy', 200)]

  it('puts the session whose state changed last first', () => {
    expect(byLatestChange(rows()).map((item) => item.id)).toEqual(['t2', 't3', 't1'])
  })

  it('puts a session that never reported a change after the others, newest first', () => {
    expect(byLatestChange([at(1, 'A', null), at(2, 'B', 50), at(3, 'C', null)]).map((item) => item.id)).toEqual(['t2', 't3', 't1'])
  })

  it('applies inside every status section', () => {
    const sections = statusSections([at(1, 'A', 10), at(2, 'B', 20)])
    expect(sections.map((section) => section.sessions.map((item) => item.id))).toEqual([['t2', 't1']])
  })

  it('lists projects busiest first', () => {
    const sessions = [session(1, { cwd: '/x/a', folder: '/x/a' }), session(2, { cwd: '/x/b', folder: '/x/b' }), session(3, { cwd: '/x/b', folder: '/x/b' })]
    expect(projectChoices(sessions).map((choice) => choice.name)).toEqual(['b', 'a'])
  })
})
