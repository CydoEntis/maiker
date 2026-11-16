import { describe, expect, it } from 'vitest'
import type { WorkflowRun, WorkflowStepState } from '@/data/preview'
import { toWorkflowView } from '@/features/workspace/model/workflows'
import { boardSummary, cardNote, columnNames, reviewShort, reviewTrack, runState, sittingStep, workBoard } from './board'

const run = (id: string, steps: Array<[string, WorkflowStepState]>, key: string | null = null) => toWorkflowView({
  workflow: 'factory',
  run: id,
  ticket: key === null ? null : { key, title: null, link: null },
  steps: steps.map(([name, state]) => ({ name, state, note: null, helper: null, choices: [] })),
  reportedAt: 1,
} satisfies WorkflowRun)

const names = (board: ReturnType<typeof workBoard>) => board.columns.map((column) => [column.name, column.tickets.map((ticket) => ticket.run.label)])

describe('the Work board', () => {
  it('has one column per reported step name, in the order the runs give them', () => {
    const a = run('1', [['intake', 'passed'], ['build', 'working'], ['review', 'waiting']])
    const b = run('2', [['intake', 'passed'], ['spec', 'working'], ['build', 'waiting'], ['ship', 'waiting']])
    expect(columnNames([a, b])).toEqual(['intake', 'spec', 'build', 'ship', 'review'])
  })

  it('places a ticket in its first step that has not passed, skipped steps included as passed', () => {
    expect(sittingStep(run('1', [['intake', 'passed'], ['spec', 'skipped'], ['build', 'sent_back'], ['review', 'failed']]))?.name).toBe('build')
    expect(sittingStep(run('2', [['intake', 'needs_you'], ['build', 'waiting']]))?.name).toBe('intake')
    expect(sittingStep(run('3', [['intake', 'passed'], ['build', 'failed']]))?.name).toBe('build')
    expect(sittingStep(run('4', []))).toBeNull()
  })

  it('puts runs going in their step, runs needing you in Needs human, and finished runs in Done', () => {
    const going = run('1', [['intake', 'passed'], ['build', 'working'], ['review', 'waiting']], 'MAITTY-42')
    const asking = run('2', [['intake', 'needs_you'], ['build', 'waiting']], 'MAITTY-43')
    const finished = run('3', [['intake', 'passed'], ['build', 'passed'], ['review', 'passed']], 'MAITTY-40')
    const failed = run('4', [['intake', 'passed'], ['build', 'failed']], 'MAITTY-41')
    const board = workBoard([going, asking, finished, failed])
    expect(names(board)).toEqual([['Intake', []], ['Build', ['MAITTY-42']], ['Review', []], ['Needs human', ['MAITTY-43']], ['Done', ['MAITTY-40', 'MAITTY-41']]])
    expect(boardSummary(board)).toBe('1 needs you · 1 working · 2 done')
  })

  it('says nothing runs when there are no runs, and names a run with no ticket by its workflow', () => {
    expect(boardSummary(workBoard([]))).toBe('Nothing running')
    expect(names(workBoard([run('007', [['spec', 'working']])]))[0]).toEqual(['Spec', ['factory 007']])
  })

  it('reads a run as a whole: needing you first, then working, then how it ended', () => {
    expect(runState(run('1', [['build', 'working'], ['review', 'needs_you']]))).toBe('needs')
    expect(runState(run('2', [['build', 'sent_back'], ['review', 'failed']]))).toBe('working')
    expect(runState(run('3', [['build', 'waiting']]))).toBe('waiting')
    expect(runState(run('4', [['build', 'passed'], ['review', 'skipped']]))).toBe('done')
    expect(runState(run('5', [['build', 'passed'], ['review', 'failed']]))).toBe('failed')
  })

  it("shows a run's review steps as chips once its first step passed", () => {
    const early = run('1', [['spec', 'working'], ['build', 'waiting'], ['review code', 'waiting']])
    const later = run('2', [['spec', 'passed'], ['build', 'passed'], ['review code', 'passed'], ['review security', 'working']])
    expect(reviewTrack(early)).toEqual([])
    expect(reviewTrack(later).map((step) => reviewShort(step.name))).toEqual(['code', 'security'])
  })

  it('names the steps in hand when several are and the step it sits in has no note', () => {
    const both = run('1', [['build', 'passed'], ['review code', 'working'], ['review security', 'working']])
    const step = sittingStep(both)
    expect(step === null ? null : cardNote({ run: both, step })).toBe('review code and review security are working.')
  })
})
