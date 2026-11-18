import { describe, expect, it } from 'vitest'
import { toSubagentView } from '@/features/workspace/model/subagents'
import type { ChatRow } from './chatRows'
import { subagentEvent } from './eventFixtures'
import { currentHelper, dockHelpers, helperCounts, liveAgentsRow, stripOrder } from './helpersDock'

const views = [toSubagentView({ id: 's1', name: 'Explore', state: 'Working', task: 'Find callers', startedAt: 0, updatedAt: 0, latest: 'Grep refundable', result: null })]

describe('the helpers the dock lists', () => {
  const helpers = dockHelpers([
    subagentEvent('a', { title: 'Find callers', status: 'running', prompt: 'Find callers\nand report' }),
    subagentEvent('b', { title: 'Check limits', report: 'Fine.' }),
    subagentEvent('c', { title: 'Update the spec', status: 'failed', report: 'Syntax error.' }),
    subagentEvent('d', { title: null, agentType: null, status: 'interrupted' }),
  ], views)

  it('reads each one’s state, and what a working one is doing from the runtime’s list', () => {
    expect(helpers.map((helper) => helper.status)).toEqual(['working', 'done', 'failed', 'failed'])
    expect(helpers[0]).toMatchObject({ label: 'Find callers', activity: 'Grep refundable', asked: 'Find callers\nand report' })
    expect(helpers[1]).toMatchObject({ activity: null, answer: 'Fine.' })
    expect(helpers[3]).toMatchObject({ label: 'A helper agent', stopped: true })
  })

  it('matches a helper that stopped, or needs you, to the runtime’s list too, so its detail has what it last ran', () => {
    const listed = [
      toSubagentView({ id: 's2', name: 'Explore', state: 'Cancelled', task: 'Update the spec', startedAt: 0, updatedAt: 0, latest: 'Edit spec.md', result: null }),
      toSubagentView({ id: 's3', name: 'Explore', state: 'WaitingForInput', task: 'Check limits', startedAt: 0, updatedAt: 0, latest: 'Asked a question', result: null }),
    ]
    const [stopped, waiting, finished] = dockHelpers([
      subagentEvent('c', { title: 'Update the spec', status: 'interrupted' }),
      subagentEvent('e', { title: 'Check limits', status: 'running' }),
      subagentEvent('f', { title: 'Check limits', status: 'completed' }),
    ], listed)
    expect(stopped).toMatchObject({ status: 'failed', stopped: true, ran: 'Edit spec.md', activity: null })
    expect(waiting).toMatchObject({ status: 'working', ran: 'Asked a question', activity: 'Asked a question' })
    expect(finished).toMatchObject({ status: 'done', ran: null })
  })

  it('counts them, and orders the strip finished first', () => {
    expect(helperCounts(helpers)).toEqual({ working: 1, done: 1, failed: 2 })
    expect(stripOrder(helpers).map((helper) => helper.id)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('names each working helper in turn', () => {
    const two = dockHelpers([subagentEvent('a', { status: 'running', title: 'One' }), subagentEvent('b', { status: 'running', title: 'Two' })], [])
    expect([0, 1, 2].map((tick) => currentHelper(two, tick)?.label)).toEqual(['One', 'Two', 'One'])
    expect(currentHelper(helpers.slice(1), 0)).toBeNull()
  })
})

describe('the agents row the dock follows', () => {
  const row = (key: string, ...statuses: ('running' | 'completed')[]): ChatRow => ({ kind: 'agents', key, events: statuses.map((status, index) => subagentEvent(`${key}${String(index)}`, { status })) })

  it('is the last one that still has a helper working', () => {
    expect(liveAgentsRow([row('a', 'running'), row('b', 'completed', 'running'), row('c', 'completed')])?.key).toBe('b')
  })

  it('is none once they have all finished', () => {
    expect(liveAgentsRow([row('a', 'completed')])).toBeNull()
    expect(liveAgentsRow([])).toBeNull()
  })
})
