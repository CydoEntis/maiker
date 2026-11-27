import { describe, expect, it } from 'vitest'
import type { ChatEvent } from './chatEvents'
import { withBackgroundHelpers } from './backgroundHelpers'
import { messageEvent, subagentEvent } from './eventFixtures'

const launched = (agentId: string) => `Async agent launched successfully. (This tool result is internal metadata.)\nagentId: ${agentId} (internal ID)\nThe agent is working in the background.`
const turnEnd = (turnId: string): ChatEvent => ({ kind: 'turn', id: `turn:${turnId}`, turnId, outcome: 'completed', startedAtMs: 1_000, endedAtMs: 9_000, timed: true })
const notification = (ids: readonly string[], status: string, result = '') =>
  `<task-notification>\n${ids.map((id) => `<task-id>${id}</task-id>`).join('\n')}\n<status>${status}</status>\n<summary>Agent done</summary>\n<result>${result}</result>\n</task-notification>`

const helpers = (events: readonly ChatEvent[]) => withBackgroundHelpers(events).filter((event) => event.kind === 'subagent').map((event) => [event.status, event.report])

describe('a helper started in the background', () => {
  it('is working while its turn runs, and never shows the launch note as its answer', () => {
    expect(helpers([subagentEvent('h1', { report: launched('a1') })])).toEqual([['running', '']])
  })

  it('is still working after its turn ended, until word of it comes', () => {
    expect(helpers([subagentEvent('h1', { report: launched('a1') }), turnEnd('t1')])).toEqual([['running', '']])
  })

  it('takes the status and report of the notification that names it', () => {
    const events = [
      subagentEvent('h1', { report: launched('a1') }),
      subagentEvent('h2', { report: launched('a2') }),
      subagentEvent('h3', { report: launched('a3') }),
      turnEnd('t1'),
      messageEvent('n1', 'user', notification(['a1'], 'completed', 'Found 3 call sites'), 't2'),
      messageEvent('n2', 'user', notification(['a2', 'a3'], 'stopped'), 't3'),
    ]
    expect(helpers(events)).toEqual([['completed', 'Found 3 call sites'], ['interrupted', ''], ['interrupted', '']])
  })

  it('leaves a helper that reported in the same call as it was', () => {
    expect(helpers([subagentEvent('h1', { report: 'Found 3 call sites' })])).toEqual([['completed', 'Found 3 call sites']])
  })
})
