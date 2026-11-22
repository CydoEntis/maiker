import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withSkipped, type DiscardingFile, type SkippedConfirms } from '@/features/confirm/confirm'
import { ConfirmHost } from '@/features/confirm/ConfirmDialog'
import { useConfirm } from '@/features/confirm/useConfirm'
import { DraftGuardHost } from '@/features/documents/DraftGuardHost'
import { registerDraft } from '@/features/documents/draftGuard'
import { toast } from '@/lib/toast'
import type { Arrangement } from './model/layout'
import type { SessionView } from './model/session'
import { useDiscardFile } from './useDiscardFile'
import { WorkspaceContext, type useWorkspace } from './workspaceContext'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), failed: vi.fn() } }))

const TERM = 5
const here = { id: 's1', machine: 0, machineName: null, cwd: '/code/shop/web', repoRoot: '/code/shop' } as SessionView
const onBuild = { id: 's1', machine: 2, machineName: 'build', cwd: '/srv/shop', repoRoot: '/srv/shop' } as SessionView
/** The session beside a file pane that shows `src/new.ts`. */
const shown = { panes: [{ id: 'p1', sessionId: 's1', col: 0 }, { id: 'p2', sessionId: 's1', col: 1, doc: { path: 'src/new.ts' } }] } as unknown as Arrangement

/** The window's confirm and the parts of its state a discard uses, around one button that discards `file`. */
function Window({ session, file, closePaneById, flash }: { session: SessionView; file: DiscardingFile; closePaneById: (id: string) => void; flash: (text: string) => void }) {
  const [skipped, setSkipped] = useState<SkippedConfirms>([])
  const { confirm, pending } = useConfirm(skipped, (kind) => { setSkipped((current) => withSkipped(current, kind)) })
  const workspace = { confirm, tab: shown, closePaneById, flash } as unknown as ReturnType<typeof useWorkspace>
  return (
    <WorkspaceContext.Provider value={workspace}>
      <DiscardButton session={session} file={file} />
      <ConfirmHost pending={pending} />
      <DraftGuardHost />
    </WorkspaceContext.Provider>
  )
}

function DiscardButton({ session, file }: { session: SessionView; file: DiscardingFile }) {
  const discard = useDiscardFile()
  return <button type="button" onClick={() => { discard(session, TERM, file) }}>Discard file</button>
}

function open(file: DiscardingFile, session: SessionView = here) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const readChanges = vi.fn(() => Promise.resolve('changes'))
  // What the Changes surface keeps for this pane, so a re-read after the discard can be seen.
  void client.query({ queryKey: ['repo', TERM, 'diff'], queryFn: readChanges })
  const closePaneById = vi.fn()
  const flash = vi.fn()
  render(<QueryClientProvider client={client}><Window session={session} file={file} closePaneById={closePaneById} flash={flash} /></QueryClientProvider>)
  return { closePaneById, flash, readChanges, client }
}

const discards = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === 'git_discard_file')

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockReset().mockResolvedValue('done')
  vi.mocked(toast.failed).mockReset()
})

describe('discarding a file’s changes', () => {
  it('asks first, and does nothing when the question is cancelled', async () => {
    const user = userEvent.setup()
    open({ path: 'src/a.ts', change: 'edited' })
    await user.click(screen.getByRole('button', { name: 'Discard file' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(discards()).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(discards()).toHaveLength(0)
  })

  it('discards in the checkout on this computer once confirmed, reads the changes again and says so', async () => {
    const user = userEvent.setup()
    const { readChanges, flash, closePaneById, client } = open({ path: 'src/a.ts', change: 'edited' })
    await waitFor(() => { expect(client.getQueryData(['repo', TERM, 'diff'])).toBe('changes') })
    await user.click(screen.getByRole('button', { name: 'Discard file' }))
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await waitFor(() => { expect(flash).toHaveBeenCalledTimes(1) })
    expect(discards()).toEqual([['git_discard_file', { machine: 0, folder: '/code/shop', path: 'src/a.ts' }]])
    expect(readChanges).toHaveBeenCalledTimes(1)
    expect(client.getQueryState(['repo', TERM, 'diff'])?.isInvalidated).toBe(true)
    expect(closePaneById).not.toHaveBeenCalled()
  })

  it('asks the session’s own machine through its pane when the session is on another machine', async () => {
    const user = userEvent.setup()
    open({ path: 'src/a.ts', change: 'deleted' }, onBuild)
    await user.click(screen.getByRole('button', { name: 'Discard file' }))
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await waitFor(() => { expect(discards()).toEqual([['git_discard_file', { machine: 2, folder: '/srv/shop', path: 'src/a.ts', term: TERM }]]) })
  })

  it('asks about a new file every time, with nothing to tick, and closes the file pane that showed it', async () => {
    const user = userEvent.setup()
    const { closePaneById } = open({ path: 'src/new.ts', change: 'new' })
    for (const round of [1, 2]) {
      await user.click(screen.getByRole('button', { name: 'Discard file' }))
      await screen.findByRole('alertdialog')
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Delete file' }))
      await waitFor(() => { expect(closePaneById).toHaveBeenCalledTimes(round) })
    }
    expect(closePaneById).toHaveBeenLastCalledWith('p2')
    expect(discards()).toHaveLength(2)
  })

  it('stops asking about edited files once that was ticked', async () => {
    const user = userEvent.setup()
    const { flash } = open({ path: 'src/a.ts', change: 'edited' })
    await user.click(screen.getByRole('button', { name: 'Discard file' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Don’t ask again' }))
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => { expect(flash).toHaveBeenCalledTimes(1) })
    await user.click(screen.getByRole('button', { name: 'Discard file' }))
    await waitFor(() => { expect(discards()).toHaveLength(2) })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('says why in a toast when the discard is refused, and leaves the pane open', async () => {
    const user = userEvent.setup()
    vi.mocked(invoke).mockRejectedValue('`src/new.ts` has a merge conflict: resolve it or stop the merge first')
    const { closePaneById, flash } = open({ path: 'src/new.ts', change: 'new' })
    await user.click(screen.getByRole('button', { name: 'Discard file' }))
    await user.click(await screen.findByRole('button', { name: 'Delete file' }))
    await waitFor(() => { expect(toast.failed).toHaveBeenCalledTimes(1) })
    expect(vi.mocked(toast.failed).mock.calls[0]?.[1]).toBe('`src/new.ts` has a merge conflict: resolve it or stop the merge first')
    expect(closePaneById).not.toHaveBeenCalled()
    expect(flash).not.toHaveBeenCalled()
  })

  it('asks about an unsaved draft of that file first, and keeping it calls the discard off', async () => {
    const user = userEvent.setup()
    const draft = { path: 'src/a.ts', owner: { paneId: 'p2', sessionId: 's1' }, save: vi.fn(() => Promise.resolve(true)), discard: vi.fn() }
    const forget = registerDraft('draft-a', draft)
    open({ path: 'src/a.ts', change: 'edited' })
    await user.click(screen.getByRole('button', { name: 'Discard file' }))
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }))
    expect(discards()).toHaveLength(0)
    expect(draft.discard).not.toHaveBeenCalled()
    // Asked again, the draft is thrown away with the file's changes.
    await user.click(screen.getByRole('button', { name: 'Discard file' }))
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await user.click(await screen.findByRole('button', { name: 'Discard' }))
    await waitFor(() => { expect(discards()).toHaveLength(1) })
    expect(draft.discard).toHaveBeenCalledTimes(1)
    forget()
  })
})
