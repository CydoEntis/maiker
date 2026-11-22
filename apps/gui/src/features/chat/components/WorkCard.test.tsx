import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DiffLine } from '../chatEvents'
import { commandEvent, editEvent, toolEvent } from '../eventFixtures'
import { documentOf } from '../writtenDocument'
import { WorkCard } from './WorkCard'

afterEach(cleanup)

const card = (steps: Parameters<typeof WorkCard>[0]['steps'], waitingStep: string | null = null) => <WorkCard steps={steps} root={null} openDiff={null} waitingStep={waitingStep} />

describe('a run of steps', () => {

  it('opens by itself when a request waits on one of its steps', () => {
    render(card([commandEvent('1', { command: 'rm -rf build', status: 'running' }), toolEvent('2'), toolEvent('3'), toolEvent('4')], '1'))

    expect(screen.getByText('waiting for you ↓')).toBeInTheDocument()
  })

  it('stays folded when a step failed, and its head says so', () => {
    render(card([commandEvent('1', { command: 'pnpm test', exitCode: 1, status: 'failed', output: 'boom' })]))

    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /a step failed/ })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Command pnpm test' })).toBeNull()
  })
})

describe('a Markdown document the agent wrote', () => {
  const added = (...texts: string[]): DiffLine[] => texts.map((text) => ({ kind: 'add', text }))
  const written = (file: string, lines: DiffLine[]) => editEvent('e', { tool: 'Write', file, change: 'add', diff: { status: 'available', hunks: [{ header: '', lines }], added: lines.length, removed: 0, truncated: false } })

  it('is read as a title and its first lines', () => {
    expect(documentOf(written('docs/plan.md', added('# Refunds plan', '', 'First we add the endpoint.', '## Steps', 'Then the tests.')))).toEqual({
      title: 'Refunds plan',
      excerpt: 'First we add the endpoint.\nThen the tests.',
      lineCount: 5,
      text: '# Refunds plan\n\nFirst we add the endpoint.\n## Steps\nThen the tests.',
    })
  })

  it.each([
    ['a file that is not Markdown', written('src/a.ts', added('# not a title'))],
    ['an edit of a Markdown file', { ...written('a.md', added('# T')), tool: 'Edit' }],
    ['a write still running', { ...written('a.md', added('# T')), status: 'running' as const }],
    ['a write whose text the history did not keep', editEvent('e', { tool: 'Write', file: 'a.md', diff: { status: 'unavailable' } })],
  ])('is not made of %s', (_name, event) => {
    expect(documentOf(event)).toBeNull()
  })
})
