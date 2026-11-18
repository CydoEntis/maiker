import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubagentView } from '@/features/workspace/model/subagents'
import { AgentsCard } from './components/AgentsCard'
import { subagentEvent } from './eventFixtures'
import { OpenSubagentContext, subagentNamed } from './openSubagent'

afterEach(cleanup)

const running = (id: string, name: string, task: string | null): SubagentView => ({ id, name, kind: 'web-fetch', status: 'working', task, latest: null, result: null, startedAt: 1, updatedAt: 1 })

describe('the running subagent an agents card names', () => {
  const subagents = [running('a', 'Google scopes', 'Google scopes\nRead the docs'), running('b', 'web-fetch', 'Slack facts')]

  it('is found by the title or the first line of what it was asked', () => {
    expect(subagentNamed(subagents, 'Google scopes', null)?.id).toBe('a')
    expect(subagentNamed(subagents, null, 'Slack facts')?.id).toBe('b')
    expect(subagentNamed(subagents, 'Discord', 'Discord facts')).toBeNull()
    expect(subagentNamed(subagents, null, null)).toBeNull()
  })

  it('offers Open its chat in the record while it runs, and opens it', async () => {
    const open = vi.fn()
    render(
      <OpenSubagentContext.Provider value={(title) => (title === 'Google scopes' ? open : null)}>
        <AgentsCard agents={[subagentEvent('s1', { title: 'Google scopes', prompt: null, report: '', status: 'running' })]} />
      </OpenSubagentContext.Provider>,
    )

    await userEvent.click(screen.getByRole('button', { name: /Google scopes/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Open its chat' }))
    expect(open).toHaveBeenCalledOnce()
  })
})
