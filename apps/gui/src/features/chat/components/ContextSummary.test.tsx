import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRows } from '../chatRows'
import { projectConversation } from '../projection'

afterEach(cleanup)

const NOW = 1_000
const SUMMARY = 'This session is being continued.\n\n## What changed\n\n1. The restart fix\n\n2. The folder browser'

// Recorded: crates/maitty-core/src/daemon/conversation/follow_transcript/tests.rs,
// `claudes_summary_of_a_full_conversation_is_a_step_and_not_something_the_person_said`.
const entry = (id: string, content: unknown) => ({ source: { conversation: 1, turn: 't1', item: id }, content, state: 'Completed' })
const command = (id: string) => entry(id, { Tool: { kind: 'commandExecution', label: 'cargo build', output: '' } })
const summary = entry('s1', { Tool: { kind: 'contextSummary', label: '', output: SUMMARY } })

describe("the agent's summary of the earlier conversation", () => {
  it('is a row of its own, never something the person said and never folded into the steps around it', () => {
    const rows = buildRows(projectConversation('claude', [command('c1'), command('c2'), summary, command('c3')], [], NOW), false)

    expect(rows.map((row) => row.kind)).toEqual(['work', 'summary', 'step'])
  })
})
