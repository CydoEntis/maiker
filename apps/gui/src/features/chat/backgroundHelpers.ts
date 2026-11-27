import type { ChatEvent, ItemStatus, SubagentEvent } from './chatEvents'
import { taskOutcomes, type TaskOutcome } from './taskNotification'

/**
 * What Claude Code answers at once to a helper started in the background: a note for the agent, not the helper's report.
 * The helper runs on after it, and only a later `<task-notification>` says how it ended.
 */
const LAUNCHED = /^Async agent launched successfully/
const AGENT_ID = /agentId:\s*([A-Za-z0-9_-]+)/

const OUTCOME_STATUS: Readonly<Record<string, Exclude<ItemStatus, 'running'>>> = { completed: 'completed', failed: 'failed' }

function settled(event: SubagentEvent, outcome: TaskOutcome): SubagentEvent {
  return { ...event, status: OUTCOME_STATUS[outcome.status] ?? 'interrupted', report: outcome.result }
}

/**
 * Helpers started in the background read as what they are doing, not as the launch note. The note's tool call ends at
 * once, so it would call the helper done and show the note as its answer. A helper a notification names takes that
 * notification's status and report. One with no word back is still working, whether or not its turn has ended: the
 * daemon keeps Claude Code's process while a helper runs, and when it has to close it first it says so with a
 * notification of its own that names each helper as stopped.
 */
export function withBackgroundHelpers(events: readonly ChatEvent[]): readonly ChatEvent[] {
  const outcomes = new Map<string, TaskOutcome>()
  let launched = false
  for (const event of events) {
    if (event.kind === 'message' && event.role === 'user') for (const [id, outcome] of taskOutcomes(event.text)) outcomes.set(id, outcome)
    else if (event.kind === 'subagent' && LAUNCHED.test(event.report)) launched = true
  }
  if (!launched) return events
  return events.map((event) => {
    if (event.kind !== 'subagent' || !LAUNCHED.test(event.report)) return event
    const outcome = outcomes.get(AGENT_ID.exec(event.report)?.[1] ?? '')
    if (outcome !== undefined) return settled(event, outcome)
    return { ...event, status: 'running', report: '' }
  })
}
