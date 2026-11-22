import { describe, expect, it } from 'vitest'
import type { SubagentActivity } from '@/data/preview'
import { listedSubagents, toSubagentView } from './subagents'

const activity = (extra: Partial<SubagentActivity> = {}): SubagentActivity => ({ id: 'a', name: 'Explore', state: 'Working', task: null, startedAt: 1000, updatedAt: 1100, latest: null, result: null, ...extra })

describe('a subagent as the window shows it', () => {
  it('is named by the first line of its task, else by its kind', () => {
    expect(toSubagentView(activity({ task: '\nCheck migration order\nthen report' })).name).toBe('Check migration order')
    expect(toSubagentView(activity()).name).toBe('Explore')
    expect(toSubagentView(activity({ task: 'x'.repeat(80) })).name).toHaveLength(48)
  })

  it('reads the runtime’s states as working, needs you, done or stopped', () => {
    expect(toSubagentView(activity({ state: 'Starting' })).status).toBe('working')
    expect(toSubagentView(activity({ state: 'AwaitingApproval' })).status).toBe('needs')
    expect(toSubagentView(activity({ state: 'WaitingForInput' })).status).toBe('needs')
    expect(toSubagentView(activity({ state: 'Completed' })).status).toBe('done')
    expect(toSubagentView(activity({ state: 'ConnectionLost' })).status).toBe('stopped')
  })

  it('is listed while it works or waits for you, and when it stopped only until the agent\'s turn is over', () => {
    const all = [
      toSubagentView(activity({ id: 'working', state: 'Working' })),
      toSubagentView(activity({ id: 'asking', state: 'AwaitingApproval' })),
      toSubagentView(activity({ id: 'finished', state: 'Completed' })),
      toSubagentView(activity({ id: 'lost', state: 'ConnectionLost' })),
      toSubagentView(activity({ id: 'failed', state: 'Failed' })),
    ]
    expect(listedSubagents(all, true, 1150).map((subagent) => subagent.id)).toEqual(['working', 'asking', 'lost', 'failed'])
    expect(listedSubagents(all, false, 1150).map((subagent) => subagent.id)).toEqual(['working', 'asking'])
  })

  it('drops a stopped helper two minutes after its last report even while the agent works', () => {
    const all = [toSubagentView(activity({ id: 'lost', state: 'ConnectionLost', updatedAt: 1100 })), toSubagentView(activity({ id: 'working', state: 'Working', updatedAt: 1100 }))]
    expect(listedSubagents(all, true, 1220).map((subagent) => subagent.id)).toEqual(['lost', 'working'])
    expect(listedSubagents(all, true, 1221).map((subagent) => subagent.id)).toEqual(['working'])
  })
})
