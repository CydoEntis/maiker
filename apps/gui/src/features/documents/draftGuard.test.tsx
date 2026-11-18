import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentView } from './DocumentView'
import { DraftGuardHost } from './DraftGuardHost'
import { fakeDisk } from './documentTestIO'
import { askAboutDrafts, draftsMatching, guardDrafts, hasDrafts, inPane, ofSessions, registerDraft, type DraftHandle } from './draftGuard'

const handle = (over: Partial<DraftHandle> = {}): DraftHandle => ({
  path: 'README.md',
  owner: { paneId: 'pane1', sessionId: 'chat' },
  save: vi.fn(() => Promise.resolve(true)),
  discard: vi.fn(),
  ...over,
})

const cleanups: (() => void)[] = []
const registered = (id: string, one: DraftHandle) => { cleanups.push(registerDraft(id, one)); return one }
afterEach(() => { for (const clean of cleanups.splice(0)) clean() })

describe('the draft guard', () => {
  it('runs at once when no draft is in the way, and for drafts of other panes and sessions', () => {
    registered('a', handle())
    const go = vi.fn()
    guardDrafts(inPane('other'), go)
    guardDrafts(ofSessions(new Set(['elsewhere'])), go)
    expect(go).toHaveBeenCalledTimes(2)
  })

  it('finds a draft by its pane or its session', () => {
    registered('a', handle())
    expect(draftsMatching(inPane('pane1'))).toHaveLength(1)
    expect(draftsMatching(ofSessions(new Set(['chat'])))).toHaveLength(1)
    expect(draftsMatching(inPane('pane2'))).toHaveLength(0)
    expect(hasDrafts()).toBe(true)
  })

  it('asks Discard changes to README.md? and goes on only when Discard is chosen', async () => {
    const user = userEvent.setup()
    render(<DraftGuardHost />)
    const draft = registered('a', handle())
    const go = vi.fn()
    act(() => { guardDrafts(inPane('pane1'), go) })
    expect(await screen.findByRole('heading', { name: 'Discard changes to README.md?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(draft.discard).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(go).toHaveBeenCalledTimes(1) })
    expect(hasDrafts()).toBe(false)
  })

  it('does nothing when the person keeps editing, and Escape is the same answer', async () => {
    const user = userEvent.setup()
    render(<DraftGuardHost />)
    const draft = registered('a', handle())
    const go = vi.fn()
    act(() => { guardDrafts(inPane('pane1'), go) })
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }))
    act(() => { guardDrafts(inPane('pane1'), go) })
    await screen.findByRole('button', { name: 'Keep editing' })
    await user.keyboard('{Escape}')
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Keep editing' })).toBeNull() })
    expect(go).not.toHaveBeenCalled()
    expect(draft.discard).not.toHaveBeenCalled()
    expect(hasDrafts()).toBe(true)
  })

  it('saves first on Save, and goes on only when every save landed', async () => {
    const user = userEvent.setup()
    render(<DraftGuardHost />)
    const draft = registered('a', handle())
    const go = vi.fn()
    act(() => { guardDrafts(inPane('pane1'), go) })
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(go).toHaveBeenCalledTimes(1) })
    expect(draft.save).toHaveBeenCalledTimes(1)
    expect(draft.discard).not.toHaveBeenCalled()
  })

  it('stays when a save did not land (a conflict, an error), leaving the draft where it is', async () => {
    const user = userEvent.setup()
    render(<DraftGuardHost />)
    registered('a', handle({ save: vi.fn(() => Promise.resolve(false)) }))
    const go = vi.fn()
    act(() => { guardDrafts(inPane('pane1'), go) })
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Save' })).toBeNull() })
    expect(go).not.toHaveBeenCalled()
    expect(hasDrafts()).toBe(true)
  })

  it('names several documents in one question', async () => {
    render(<DraftGuardHost />)
    registered('a', handle())
    registered('b', handle({ path: 'docs/guide.md', owner: { paneId: 'pane2', sessionId: 'chat' } }))
    act(() => { guardDrafts(ofSessions(new Set(['chat'])), vi.fn()) })
    expect(await screen.findByRole('heading', { name: 'Discard changes to 2 documents?' })).toBeInTheDocument()
  })

  it('answers a second question while one is open with keep editing, never two dialogs', async () => {
    render(<DraftGuardHost />)
    const draft = registered('a', handle())
    const first = askAboutDrafts([draft])
    await screen.findByRole('button', { name: 'Keep editing' })
    await expect(askAboutDrafts([draft])).resolves.toBe(false)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Keep editing' }))
    await expect(first).resolves.toBe(false)
  })
})

describe('a document viewer with a draft', () => {
  const open = (extra: Partial<React.ComponentProps<typeof DocumentView>> = {}) => {
    const disk = fakeDisk('a\n')
    render(
      <>
        <DocumentView term={3} machine={0} path="README.md" root="/p" owner={{ paneId: 'pane9', sessionId: 'chat' }} onOpenPath={() => undefined} io={disk.io} startMode="edit" {...extra} />
        <DraftGuardHost />
      </>,
    )
    return disk
  }

  it('is known to the guard while it holds unsaved edits, and not otherwise', async () => {
    const user = userEvent.setup()
    open()
    const box = await screen.findByRole('textbox', { name: 'Edit README.md' })
    expect(hasDrafts()).toBe(false)
    await user.type(box, 'b')
    await waitFor(() => { expect(draftsMatching(inPane('pane9'))).toHaveLength(1) })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(hasDrafts()).toBe(false) })
  })

  it('asks the same question when the mode is switched away from a draft, and keeps the draft on Keep editing', async () => {
    const user = userEvent.setup()
    open()
    const box = await screen.findByRole('textbox', { name: 'Edit README.md' })
    await user.type(box, 'b')
    await user.click(screen.getByRole('radio', { name: 'Drawn' }))
    expect(await screen.findByRole('heading', { name: 'Discard changes to README.md?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('textbox', { name: 'Edit README.md' })).toHaveValue('a\nb')
    await user.click(screen.getByRole('radio', { name: 'Drawn' }))
    await user.click(await screen.findByRole('button', { name: 'Discard' }))
    await waitFor(() => { expect(screen.queryByRole('textbox', { name: 'Edit README.md' })).toBeNull() })
    expect(hasDrafts()).toBe(false)
  })

  it('saves from the question and goes on to the other mode', async () => {
    const user = userEvent.setup()
    const disk = open()
    await user.type(await screen.findByRole('textbox', { name: 'Edit README.md' }), 'b')
    await user.click(screen.getByRole('radio', { name: 'Source' }))
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(screen.queryByRole('textbox', { name: 'Edit README.md' })).toBeNull() })
    expect(disk.disk.text).toBe('a\nb')
  })

  it('stays in the editor when the file changed on disk and the save is turned away', async () => {
    const user = userEvent.setup()
    const disk = open()
    await user.type(await screen.findByRole('textbox', { name: 'Edit README.md' }), 'b')
    disk.agentEdits('the agent wrote this\n')
    const go = vi.fn()
    act(() => { guardDrafts(inPane('pane9'), go) })
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/changed on disk/)).toBeInTheDocument()
    expect(go).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Edit README.md' })).toHaveValue('a\nb')
  })
})
