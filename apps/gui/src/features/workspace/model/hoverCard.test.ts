import { describe, expect, it } from 'vitest'
import type { Conversation } from '@/data/preview'
import { HOVER_CARD_WIDTH_PX, hoverCardText, lastActiveWords, placeHoverCard } from './hoverCard'
import { LOCAL_HEAD, type MachineHead } from './machines'
import { toSessionView } from './session'

describe('where the hover card goes', () => {
  it('sits to the right of the row, 8px above it, for a row in the upper half', () => {
    expect(placeHoverCard({ left: 20, right: 280, top: 200, bottom: 240 }, 1400, 900)).toEqual({ left: 288, top: 192 })
  })

  it('stands on the row, growing up, for a row in the lower half, so it never runs past the window', () => {
    expect(placeHoverCard({ left: 20, right: 280, top: 800, bottom: 840 }, 1400, 900)).toEqual({ left: 288, bottom: 52 })
  })

  it('keeps 8px from the window edge', () => {
    expect(placeHoverCard({ left: 20, right: 280, top: 2, bottom: 40 }, 1400, 900)).toEqual({ left: 288, top: 8 })
    expect(placeHoverCard({ left: 20, right: 280, top: 860, bottom: 899 }, 1400, 900)).toEqual({ left: 288, bottom: 8 })
  })

  it('goes to the left of a sidebar that is on the right', () => {
    expect(placeHoverCard({ left: 1120, right: 1380, top: 200, bottom: 240 }, 1400, 900).left).toBe(1120 - 8 - HOVER_CARD_WIDTH_PX)
  })
})

const DETAILS = { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null } }

function view(extra: Partial<Conversation> = {}) {
  return toSessionView(
    { id: 't1', generation: 0, kind: 'terminal', title: '', project: '', folder: '/home/me/app', cwd: '/home/me/app', repo: 'app', branch: 'feat/x', provider: 'Claude', status: 'working', updated: null, model: '', permission: '', context: null, nativePane: 1, hasDiff: false, agent: 'claude', summary: 'Upgrade React', ...extra },
    '/home/me',
  )
}

const DEVBOX: MachineHead = { ...LOCAL_HEAD, key: 'machine-4', machine: 4, name: 'devbox', label: 'devbox', target: 'me@10.0.4.7' }
const FACTS = { title: 'x', namesMachine: true }
const kinds = (text: ReturnType<typeof hoverCardText>) => text.rows.map((row) => row.kind)
const rowOf = (text: ReturnType<typeof hoverCardText>, kind: string) => text.rows.find((row) => row.kind === kind)

describe('what the hover card says', () => {
  it('says what happened to an agent that stopped, with idle as its state', () => {
    const stopped = view({ status: 'idle', details: { ...DETAILS, exit: { code: 1, at: 1 } } })
    const text = hoverCardText(stopped, FACTS)
    expect(text.activity).toContain('exit code 1')
    expect(text).toMatchObject({ state: 'idle', word: 'Idle' })
  })

  it('says when an agent held by its plan limit carries on', () => {
    const now = new Date(2026, 0, 5, 9, 30).getTime()
    const resumeAt = new Date(2026, 0, 5, 14, 5).getTime() / 1000
    const base = view({ status: 'idle', details: { ...DETAILS, resumeAt } }).conversation
    const text = hoverCardText(toSessionView(base, '/home/me', now), { ...FACTS, now })
    expect(text.activity).toBe('Limited until 14:05')
    expect(text.word).toBe('Idle')
  })

  it('names the session, its state and what it works on, and falls back to the state alone when it said nothing', () => {
    expect(hoverCardText(view(), { ...FACTS, title: 'Upgrade to React 19' })).toMatchObject({ title: 'Upgrade to React 19', state: 'working', word: 'Working', activity: 'Upgrade React' })
    expect(hoverCardText(view({ summary: '' }), FACTS).activity).toBeNull()
  })

  it('says a helper the daemon holds waits for a free slot, and that a working lead waits on its working helpers', () => {
    const held = view({ details: { ...DETAILS, waitingForSlot: true } })
    expect(hoverCardText(held, FACTS)).toMatchObject({ state: 'working', activity: 'Waiting for a free slot' })
    const helpers = { total: 3, needs: 0, working: 2, names: ['a', 'b', 'c'] }
    expect(hoverCardText(view(), { ...FACTS, helpers }).activity).toBe('Waiting on 2 helpers')
    expect(hoverCardText(view(), { ...FACTS, helpers: { ...helpers, working: 0 } }).activity).toBe('Upgrade React')
    expect(hoverCardText(view({ status: 'done' }), { ...FACTS, helpers }).activity).not.toBe('Waiting on 2 helpers')
  })

  it('lists who started it, where it works, its branch, machine, agent and model, when it last changed and its helpers, in that order', () => {
    const helper = view({ machine: 4, machineName: 'devbox', details: { ...DETAILS, agentModel: 'Sonnet 5', since: 1_700_000_000 } })
    const text = hoverCardText(helper, { ...FACTS, starter: 'Add a toggle', helpers: { total: 2, needs: 1, working: 0, names: ['a', 'b'] }, machine: DEVBOX })
    expect(kinds(text)).toEqual(['starter', 'place', 'branch', 'machine', 'agent', 'active', 'helpers'])
    expect(rowOf(text, 'starter')).toMatchObject({ text: 'Started by “Add a toggle”' })
    expect(rowOf(text, 'place')).toMatchObject({ text: 'app' })
    expect(rowOf(text, 'branch')).toMatchObject({ text: 'feat/x', mono: true })
    expect(rowOf(text, 'machine')).toMatchObject({ text: 'devbox', detail: 'me@10.0.4.7', tone: 'remote' })
    expect(rowOf(text, 'agent')).toMatchObject({ text: 'Claude · Sonnet 5' })
    expect(rowOf(text, 'active')).toEqual({ kind: 'active', at: 1_700_000_000_000 })
    expect(rowOf(text, 'helpers')).toMatchObject({ text: '2 helpers', detail: '1 needs you' })
  })

  it('leaves out every row the session has nothing to say for', () => {
    const text = hoverCardText({ ...view(), branch: null }, { title: 'x', namesMachine: false })
    expect(kinds(text)).toEqual(['place', 'agent'])
    expect(rowOf(text, 'agent')).toMatchObject({ text: 'Claude' })
    expect(text.context).toBeNull()
  })

  it('names the worktree a session has to itself after its project', () => {
    const text = hoverCardText({ ...view(), worktree: true, checkout: 'C:\\dev\\app-worktrees\\swift-heron' }, FACTS)
    expect(rowOf(text, 'place')).toMatchObject({ text: 'app / swift-heron' })
  })

  it('says this computer for a local session, and that a machine is offline without how it is reached', () => {
    expect(rowOf(hoverCardText(view(), FACTS), 'machine')).toEqual({ kind: 'machine', text: 'This computer' })
    const away = hoverCardText(view({ machine: 4, machineName: 'devbox' }), { ...FACTS, machine: { ...DEVBOX, down: true } })
    expect(rowOf(away, 'machine')).toMatchObject({ tone: 'needs' })
    expect(rowOf(away, 'machine')).not.toHaveProperty('detail')
  })

  it('shows a shell by its working directory, with no branch and no activity', () => {
    const text = hoverCardText(view({ agent: null, process: 'zsh' }), FACTS)
    expect(rowOf(text, 'place')).toMatchObject({ text: '~/app', mono: true })
    expect(kinds(text)).not.toContain('branch')
    expect(text.activity).toBeNull()
  })

  it('gives the context as a whole percent within 0 to 100, hot from 80', () => {
    const at = (context: number) => hoverCardText(view({ details: { ...DETAILS, usage: { ...DETAILS.usage, context } } }), FACTS).context
    expect(at(29.6)).toEqual({ percent: 30, hot: false })
    expect(at(80)).toEqual({ percent: 80, hot: true })
    expect(at(140)).toEqual({ percent: 100, hot: true })
  })

  it('writes how long ago the session last changed', () => {
    expect(lastActiveWords(20_000)).toBe('Last active just now')
    expect(lastActiveWords(3 * 60_000)).toBe('Last active 3m ago')
  })
})
