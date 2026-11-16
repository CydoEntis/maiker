import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WorkflowRun } from '@/data/preview'
import { toWorkflowView } from '@/features/workspace/model/workflows'
import type { SubagentView } from '@/features/workspace/model/subagents'
import { WorkBoard } from './WorkBoard'

const report = (run: string, key: string | null, steps: WorkflowRun['steps']): WorkflowRun => ({
  workflow: 'factory', run, ticket: key === null ? null : { key, title: `Title of ${key}`, link: `https://plane.example/${key}` }, steps, reportedAt: 1,
})
const step = (name: string, state: WorkflowRun['steps'][number]['state'], helper: string | null = null, note: string | null = null, choices: string[] = []) => ({ name, state, note, helper, choices })

const runs = [
  report('001', 'MAITTY-42', [step('intake', 'passed'), step('build', 'working', 'MAITTY-42 builder', '3 of 5 files'), step('review', 'waiting')]),
  report('002', 'MAITTY-43', [step('intake', 'needs_you', null, 'approve the spec'), step('build', 'waiting'), step('review', 'waiting')]),
  report('003', 'MAITTY-40', [step('intake', 'passed'), step('build', 'passed'), step('review', 'passed')]),
  report('007', null, [step('intake', 'working')]),
].map(toWorkflowView)

const builder: SubagentView = { id: 'agent-1', name: 'Builder', kind: 'general-purpose', status: 'working', task: 'MAITTY-42 builder', latest: 'Editing src/export.ts', result: null, startedAt: null, updatedAt: 1 }

const where = { machine: 'This computer', remote: false, project: 'acme-store', branch: 'main' }

describe('WorkBoard', () => {
  it('puts each run in its column, with the ones needing you and the finished ones in their own', () => {
    render(<WorkBoard runs={runs} helpers={[]} onOpenHelper={vi.fn()} />)
    const column = (name: string) => within(screen.getByRole('region', { name }))
    expect(column('Needs human').getByRole('button', { name: /^MAITTY-43, Title of MAITTY-43: intake, Needs you/ })).toBeInTheDocument()
    expect(column('Build').getByRole('button', { name: /^MAITTY-42/ })).toBeInTheDocument()
    expect(column('Done').getByRole('button', { name: /^MAITTY-40/ })).toHaveTextContent('done')
    expect(column('Intake').getByText('No ticket')).toBeInTheDocument()
    expect(column('Review').getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('1 needs you · 2 working · 1 done')).toBeInTheDocument()
  })

  it('opens a run in a drawer with where it runs, its steps, and a helper label in a read-only card', async () => {
    const user = userEvent.setup()
    const onOpenHelper = vi.fn()
    render(<WorkBoard runs={runs} helpers={[builder]} onOpenHelper={onOpenHelper} where={where} />)
    await user.click(screen.getByRole('button', { name: /^MAITTY-42/ }))
    const drawer = within(screen.getByRole('dialog', { name: 'Run MAITTY-42' }))
    expect(drawer.getByRole('button', { name: 'Open ticket ↗' })).toBeInTheDocument()
    expect(drawer.getByText(/· This computer · acme-store · ⑂ main$/)).toBeInTheDocument()
    expect(drawer.getByRole('img', { name: 'Steps: intake passed, build working, review waiting' })).toBeInTheDocument()
    const steps = within(drawer.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
    expect(steps.map((row) => row.textContent)).toEqual([
      expect.stringContaining('intakepassed'),
      expect.stringContaining('buildworking3 of 5 files'),
      expect.stringContaining('reviewwaiting'),
    ])

    await user.click(drawer.getByRole('button', { name: 'Helper MAITTY-42 builder' }))
    expect(await screen.findByText('Editing src/export.ts')).toBeInTheDocument()
    expect(screen.getByText(/Read-only\. To change anything, ask in the main chat\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open its chat' }))
    expect(onOpenHelper).toHaveBeenCalledWith('agent-1')
  })

  it('answers a step that needs you with a click, sending the words to the chat that reported the run', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    const asking = [report('002', 'MAITTY-43', [step('spec', 'needs_you', null, 'approve the spec', ['Approve the spec', 'Send it back']), step('build', 'passed', null, null, ['Merge it'])])].map(toWorkflowView)
    render(<WorkBoard runs={asking} helpers={[]} onOpenHelper={vi.fn()} onAnswer={onAnswer} />)
    await user.click(screen.getByRole('button', { name: /^MAITTY-43/ }))
    const drawer = within(screen.getByRole('dialog', { name: 'Run MAITTY-43' }))
    expect(drawer.queryByRole('button', { name: 'Merge it' })).not.toBeInTheDocument()

    await user.click(within(drawer.getByRole('group', { name: 'Answer spec' })).getByRole('button', { name: 'Send it back' }))

    expect(onAnswer).toHaveBeenCalledWith('MAITTY-43 · spec: Send it back')
    expect(drawer.getByText('Sent “Send it back”')).toBeInTheDocument()
    expect(drawer.queryByRole('group', { name: 'Answer spec' })).not.toBeInTheDocument()
  })

  it('closes the drawer with Escape, the Work crumb and its close button', async () => {
    const user = userEvent.setup()
    render(<WorkBoard runs={runs} helpers={[]} onOpenHelper={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /^MAITTY-43/ }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: /^MAITTY-43/ }))
    await user.click(screen.getByRole('button', { name: 'Work' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: /^MAITTY-43/ }))
    await user.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
