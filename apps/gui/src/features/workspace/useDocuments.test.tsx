import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DraftGuardHost } from '@/features/documents/DraftGuardHost'
import { registerDraft } from '@/features/documents/draftGuard'
import { activeArrangement, documentPaneReplaced, openArrangement, openDocumentBeside, type Layout } from './model/layout'
import { useDocuments } from './useDocuments'

vi.mock('@/lib/toast', () => ({ toast: { failed: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('@/features/inspect/api', () => ({ repoTree: vi.fn(), repoLocate: vi.fn() }))

const ids = () => { let next = 0; return (prefix: string) => `${prefix}${String(next++)}` }
const forgotten: (() => void)[] = []
afterEach(() => { for (const forget of forgotten.splice(0)) forget() })

function setup() {
  const makeId = ids()
  const opened = openArrangement({ arrangements: [], activeId: null }, 'chat', makeId)
  const layout = openDocumentBeside(opened, 'chat', 'README.md', makeId) ?? opened
  let current: Layout = layout
  const setLayout = vi.fn((change: Layout | ((was: Layout) => Layout)) => { current = typeof change === 'function' ? change(current) : change })
  const hook = renderHook(() => useDocuments({ layout, setLayout, focusedSession: undefined, repoPaneOf: () => 1, showSessionById: vi.fn(), setLookAt: vi.fn(), openSurface: vi.fn() }))
  const doc = activeArrangement(layout)?.panes.find((pane) => pane.doc)
  return { ...hook, setLayout, layout, doc, now: () => current }
}

describe('opening another document over one with a draft', () => {
  it('says which pane another file would take the place of, and none for the same file', () => {
    const { layout } = setup()
    expect(documentPaneReplaced(layout, 'chat', 'docs/other.md')?.doc?.path).toBe('README.md')
    expect(documentPaneReplaced(layout, 'chat', 'README.md')).toBeNull()
    expect(documentPaneReplaced(layout, 'nobody', 'x.md')).toBeNull()
  })

  it('asks first, and points the pane at the other file only after Discard', async () => {
    const { result, setLayout, doc, now } = setup()
    forgotten.push(registerDraft('d', { path: 'README.md', owner: { paneId: doc?.id ?? '', sessionId: 'chat' }, save: vi.fn(() => Promise.resolve(true)), discard: vi.fn() }))
    render(<DraftGuardHost />)
    act(() => { result.current.openDocument('chat', 'docs/other.md') })
    expect(setLayout).not.toHaveBeenCalled()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }))
    expect(setLayout).not.toHaveBeenCalled()
    act(() => { result.current.openDocument('chat', 'docs/other.md') })
    await user.click(await screen.findByRole('button', { name: 'Discard' }))
    await waitFor(() => { expect(setLayout).toHaveBeenCalled() })
    expect(activeArrangement(now())?.panes.find((pane) => pane.doc)?.doc?.path).toBe('docs/other.md')
  })

  it('opens at once with no draft, and takes no layout change for a session that has no pane', () => {
    const { result, setLayout } = setup()
    act(() => { result.current.openDocument('build/chat', 'docs/other.md') })
    act(() => { result.current.openDocument('chat', 'docs/other.md') })
    expect(setLayout).toHaveBeenCalledTimes(1)
  })
})
