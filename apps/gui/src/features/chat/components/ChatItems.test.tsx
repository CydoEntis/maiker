import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatRow } from '../chatRows'
import { KnownRowsContext } from '../knownRows'
import { ChatItem } from './ChatItems'

const context = { agent: 'claude' as const, workingSince: null, root: null, openDiff: null, goToStep: null, waitingStep: null }

/** A reply's lead is a paragraph of its own, so only its words are compared, not the space between them. */
const noSpace = (text: string) => text.replace(/\s+/g, '')

function reply(status: 'running' | 'completed', text: string) {
  const row: ChatRow = { kind: 'agent', key: 'm1', turnId: 't1', paragraphs: [text], status }
  return <ChatItem row={row} {...context} />
}

describe('a reply from the agent', () => {
  it('is read in its finished form while it is still arriving', () => {
    render(reply('running', 'Done. Now the **bol'))

    expect(screen.getByText('bol').tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  describe('typed in', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('types in a reply that came while it was watched, and shows one it already knew whole', () => {
      const text = 'The endpoint is in and it has tests. '.repeat(6)
      const fresh = render(<KnownRowsContext.Provider value={new Set()}>{reply('completed', text)}</KnownRowsContext.Provider>)
      expect(fresh.container.textContent.length).toBeLessThan(text.length)
      act(() => { vi.advanceTimersByTime(5_000) })
      expect(noSpace(fresh.container.textContent)).toBe(noSpace(text))
      fresh.unmount()

      const known = render(<KnownRowsContext.Provider value={new Set(['m1'])}>{reply('completed', text)}</KnownRowsContext.Provider>)
      expect(noSpace(known.container.textContent)).toBe(noSpace(text))
    })
  })
})

describe('a thought', () => {
  const thought = (texts: string[]) => {
    const row: ChatRow = { kind: 'thought', key: 'r1', turnId: 't1', texts }
    return <ChatItem row={row} {...context} />
  }

  it('is one folded row labelled Thought until it is clicked', async () => {
    render(thought(['Weighing two fixes']))

    const head = screen.getByRole('button', { name: /Thought/ })
    expect(head).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Weighing two fixes')).toBeNull()
    await userEvent.click(head)
    expect(head).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Weighing two fixes')).toBeInTheDocument()
  })

  it('shows the text as plain text, never as Markdown or HTML', async () => {
    const { container } = render(thought(['**bold** <b>tag</b>', 'Second paragraph']))

    await userEvent.click(screen.getByRole('button', { name: /Thought/ }))
    expect(screen.getByText('**bold** <b>tag</b>')).toBeInTheDocument()
    expect(container.querySelector('strong, b')).toBeNull()
    expect(screen.getByText('Second paragraph')).toBeInTheDocument()
  })
})

describe('the changed-files bar of a turn', () => {
  const bar = (files: readonly string[], lines: { added: number; removed: number } | null, openDiff: ((file: string) => void) | null) => {
    const row: ChatRow = { kind: 'changes', key: 'changes:t1', files, lines, turn: null }
    return <ChatItem row={row} {...context} openDiff={openDiff} />
  }

  it('says how many files and lines changed, and Review opens the first file', async () => {
    const open = vi.fn()
    render(bar(['src/a.ts', 'src/b.ts'], { added: 186, removed: 41 }, open))

    expect(screen.getByText('2 changed files')).toBeInTheDocument()
    expect(screen.getByText('+186')).toBeInTheDocument()
    expect(screen.getByText('−41')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Review' }))
    expect(open).toHaveBeenCalledExactlyOnceWith('src/a.ts', null)
  })
})
