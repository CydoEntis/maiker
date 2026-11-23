import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { approvalEvent, commandEvent, editEvent, subagentEvent } from '../eventFixtures'
import { AgentsCard } from './AgentsCard'
import { HelpersLiveContext } from '../helpersDock'
import { ApprovalCard } from './ApprovalCard'
import { Markdown } from './Markdown'
import { CommandStep, EditStep } from './StepCards'

afterEach(cleanup)

/** Steps start folded; this opens the one on screen as the person would. */
const openStep = async () => {
  const [head] = screen.getAllByRole('button', { expanded: false })
  if (head === undefined) throw new Error('no folded step on screen')
  await userEvent.click(head)
}

describe('command step', () => {
  const finished = (over = {}) => commandEvent('c', { command: 'pnpm test', output: 'one\ntwo\nthree\nfour\nfive', ...over })

  it('says a command reported no exit code, without claiming it passed', () => {
    render(<CommandStep event={{ ...finished(), timing: { startedAtMs: 1_000, completedAtMs: 4_000 } }} />)

    expect(screen.getByText('3s')).toBeInTheDocument()
    expect(screen.getByText('exit code not reported')).toHaveClass('sr-only')
    expect(screen.queryByText(/^exit [0-9]/)).toBeNull()
  })

  it('shows a masked token as it is and says the daemon hid it', async () => {
    render(<CommandStep event={commandEvent('c', { command: 'echo $T', output: 'token is [redacted]', exitCode: 0 })} />)

    await userEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('token is [redacted]')).toBeInTheDocument()
    expect(screen.getByText(/looked like a secret/)).toBeInTheDocument()
    expect(screen.getByText('exit 0')).toBeInTheDocument()
  })

  it('says a secret file was read instead of showing the marker as output', async () => {
    render(<CommandStep event={commandEvent('c', { command: 'cat .env', output: '[content of a secret file omitted]', exitCode: 0 })} />)

    await userEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(/shows a secret file/)).toBeInTheDocument()
    expect(screen.queryByText('[content of a secret file omitted]')).toBeNull()
  })
})

describe('edit step', () => {
  it('names a secret file and says its content is not kept, not that the diff failed or is empty', async () => {
    render(<EditStep event={editEvent('e', { file: 'app/.env', change: 'add', diff: { status: 'omitted' } })} root={null} onOpen={null} />)
    await openStep()

    expect(screen.getByRole('group', { name: 'Edit app/.env' })).toBeInTheDocument()
    expect(screen.getByText(/Secret file: Maiker doesn.t show its contents/)).toBeInTheDocument()
    expect(screen.queryByText(/unavailable/)).toBeNull()
    expect(screen.queryByText(/^[+−]\d+$/)).toBeNull()
  })

  it('says the history kept no diff instead of inventing one', async () => {
    render(<EditStep event={editEvent('e', { file: null, diff: { status: 'unavailable' } })} root={null} onOpen={null} />)
    await openStep()

    expect(screen.getByText(/didn.t keep this diff/)).toBeInTheDocument()
  })

  it('opens the file in the side panel from its diff', async () => {
    const onOpen = vi.fn()
    render(<EditStep event={editEvent('e', { file: '/repo/src/a.ts' })} root="/repo" onOpen={onOpen} />)
    await openStep()

    await userEvent.click(screen.getByRole('button', { name: 'Open in side panel' }))
    expect(onOpen).toHaveBeenCalledWith('/repo/src/a.ts')
  })
})

describe('helper agents record', () => {
  it('is one block with the count, how each ended and a row each, open when one failed or still works', async () => {
    const done = subagentEvent('a', { title: 'Audit', prompt: 'Read parser.rs', report: 'Found 3 issues.' })
    render(<AgentsCard agents={[done, subagentEvent('b', { title: 'Search', status: 'failed', prompt: 'Find it', report: 'No index.' })]} />)

    const block = screen.getByRole('group', { name: '2 agents, all done' })
    expect(within(block).getByText('2 helpers')).toBeInTheDocument()
    expect(within(block).getByText('1 done')).toBeInTheDocument()
    expect(within(block).getByText('1 failed')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Audit/ }))
    expect(screen.getByText('Asked to')).toBeInTheDocument()
    expect(screen.getByText('Read parser.rs')).toBeInTheDocument()
    expect(screen.getByText('Answer')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Search/ }))
    expect(screen.getByText('What went wrong')).toBeInTheDocument()
  })

  it('is one quiet line while the dock follows its helpers, and the line opens the dock', async () => {
    const open = vi.fn()
    render(
      <HelpersLiveContext.Provider value={{ key: 'a', open }}>
        <AgentsCard rowKey="a" agents={[subagentEvent('a', { title: 'Audit', status: 'running' }), subagentEvent('b', { title: 'Search', status: 'running' })]} />
      </HelpersLiveContext.Provider>,
    )

    await userEvent.click(screen.getByRole('button', { name: /Started 2 helpers/ }))
    expect(screen.getByText('· running below')).toBeInTheDocument()
    expect(open).toHaveBeenCalledOnce()
  })
})

describe('a request as a line of the conversation', () => {
  it('says what was chosen, with no buttons, once answered', () => {
    render(<ApprovalCard event={approvalEvent(1, { resolution: { status: 'answered', answer: 'AcceptForSession', answeredAtMs: 1_000 } })} step={null} onGoToStep={null} />)

    expect(screen.getByRole('group', { name: /Approval/ })).toHaveTextContent('Allowed for this session')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('never asks: a pending request shown as a row has no answer to press', () => {
    render(<ApprovalCard event={approvalEvent(1)} step={null} onGoToStep={null} />)

    expect(screen.getByRole('group', { name: /Approval/ })).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('links to its tool step', async () => {
    const onGoToStep = vi.fn()
    render(<ApprovalCard event={approvalEvent(1)} step={{ key: 't1:c', label: 'pnpm test' }} onGoToStep={onGoToStep} />)

    await userEvent.click(screen.getByRole('button', { name: 'Go to the step this is about: pnpm test' }))
    expect(onGoToStep).toHaveBeenCalledWith('t1:c')
  })
})

describe('markdown view of untrusted agent text', () => {

  it('turns no markup into elements, whatever the agent writes', () => {
    const hostile = [
      '<script>window.__pwned = 1</script>',
      '<img src=x onerror="window.__pwned = 2">',
      '<a href="javascript:window.__pwned = 3">raw anchor</a>',
      '[js](javascript:window.__pwned=4)',
      '[data](data:text/html,<script>1</script>)',
      '![tracker](https://tracker.example/p.png)',
      '<iframe src="https://evil.example"></iframe>',
    ].join('\n\n')
    const { container } = render(<Markdown text={hostile} />)

    expect(container.querySelector('script, img, iframe, a')).toBeNull()
    expect(container.querySelector('[onerror], [href], [src]')).toBeNull()
    expect(container).toHaveTextContent('<script>window.__pwned = 1</script>')
    expect(container).toHaveTextContent('tracker')
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })
})

describe('saving a block of a reply', () => {

  it('copies a table as the Markdown it came from', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<Markdown text={'| A | B |\n| --- | ---: |\n| 1 | 2 |'} />)

    await userEvent.click(within(screen.getByRole('group', { name: 'Copy or save this table' })).getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith('| A | B |\n| --- | ---: |\n| 1 | 2 |\n')
  })
})
