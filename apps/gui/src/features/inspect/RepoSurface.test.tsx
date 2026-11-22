import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileMenu, type FileActions } from './fileMenu'
import type { RepoSurfaceKind } from './panelTabs'
import { RepoSurface } from './RepoSurface'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }))

const NOW = 1_800_000_000

type Question = string | Record<string, unknown>

/** Answers each question the panel asks, the way the daemon would. */
function daemonAnswers(replies: Record<string, unknown>) {
  vi.mocked(invoke).mockReset().mockImplementation((_command, args) => {
    const question = (args as { question: Question }).question
    const kind = typeof question === 'string' ? question : (Object.keys(question)[0] ?? '')
    if (kind in replies) return Promise.resolve({ [kind === 'DiffRange' ? 'Diff' : kind === 'Locate' ? 'Located' : kind]: replies[kind] })
    return Promise.reject(new Error(`unexpected ${kind}`))
  })
}

/** What the window does with a file, as spies; `onReveal` is left out for a file of another machine. */
function fileActions(over: Partial<FileActions> = {}): FileActions {
  return { openPath: null, onOpen: vi.fn(), onCopyPath: vi.fn(), onCopyRelativePath: vi.fn(), onReveal: vi.fn(), menuRoot: null, ...over }
}

function renderPanel(view: RepoSurfaceKind, files: FileActions = fileActions()) {
  const onNotice = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RepoSurface term={5} kind={view} files={files} onNotice={onNotice} />
    </QueryClientProvider>,
  )
  return { onNotice, files }
}

/** The panel for pane 5 of the machine build. */
function renderOnBuild(view: RepoSurfaceKind, files: FileActions = fileActions({ onReveal: undefined })) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RepoSurface term={5} machine={1} kind={view} files={files} onNotice={vi.fn()} />
    </QueryClientProvider>,
  )
  return { files }
}

beforeEach(() => { vi.mocked(isTauri).mockReturnValue(true) })

describe('the side panel’s Files and Changes', () => {

  it('lists the changed files, and opens the one picked in the file pane as its diff, never inside the panel', async () => {
    daemonAnswers({
      Diff: {
        files: [
          { path: 'a.txt', additions: 1, deletions: 1, binary: false, patch: 'diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-old\n+new\n' },
          { path: 'b.txt', additions: 3, deletions: 0, binary: false, patch: '@@ -0,0 +1,3 @@\n+x\n+y\n+z\n' },
        ],
        additions: 4, deletions: 1, total_files: 2, truncated: false,
      },
    })
    const { files } = renderPanel('changes')

    const list = await screen.findByRole('list', { name: 'Changed files' })
    expect(within(list).getByText('a.txt')).toBeTruthy()
    expect(screen.queryByLabelText('Diff')).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: /b\.txt/ }))
    expect(files.onOpen).toHaveBeenCalledWith('b.txt', 'changes', {})
  })

  it('marks the row of the file the file pane shows', async () => {
    daemonAnswers({ Diff: { files: [{ path: 'a.txt', additions: 1, deletions: 0, binary: false, patch: '@@ -0,0 +1 @@\n+new\n' }, { path: 'b.txt', additions: 1, deletions: 0, binary: false, patch: '@@ -0,0 +1 @@\n+new\n' }], additions: 2, deletions: 0, total_files: 2, truncated: false } })
    renderPanel('changes', fileActions({ openPath: 'b.txt' }))
    const list = await screen.findByRole('list', { name: 'Changed files' })
    expect(within(list).getByRole('button', { current: true })).toHaveAccessibleName(/b\.txt/)
  })

  it('offers a changed file’s menu on a right-click: open it, its changes, its paths, and where it is', async () => {
    daemonAnswers({ Diff: { files: [{ path: 'src/a.ts', additions: 1, deletions: 0, binary: false, patch: '@@ -1 +1 @@\n-old\n+new\n' }], additions: 1, deletions: 1, total_files: 1, truncated: false } })
    const { files } = renderPanel('changes')
    const row = within(await screen.findByRole('list', { name: 'Changed files' })).getByRole('button', { name: /a\.ts/ })
    const choose = async (name: string) => {
      fireEvent.contextMenu(row)
      fireEvent.click(await screen.findByRole('menuitem', { name }))
    }
    fireEvent.contextMenu(row)
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Open', 'Open changes', 'Copy path', 'Copy relative path', 'Reveal in file manager'])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await choose('Open changes')
    expect(files.onOpen).toHaveBeenCalledWith('src/a.ts', 'changes', { asChanges: true })
    await choose('Copy path')
    expect(files.onCopyPath).toHaveBeenCalledWith('src/a.ts')
    await choose('Copy relative path')
    expect(files.onCopyRelativePath).toHaveBeenCalledWith('src/a.ts')
    await choose('Reveal in file manager')
    expect(files.onReveal).toHaveBeenCalledWith('src/a.ts')
  })

  it('leaves out of a file’s menu what does not apply: no changes for an unchanged file, nothing to open or reveal for a deleted one, no reveal on another machine', async () => {
    const names = async (row: HTMLElement) => {
      fireEvent.contextMenu(row)
      const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
      return items
    }
    daemonAnswers({
      Tree: [{ name: 'plain.ts', is_directory: false }],
      Diff: { files: [{ path: 'gone.ts', additions: 0, deletions: 1, binary: false, patch: 'deleted file mode 100644\n@@ -1 +0,0 @@\n-old\n' }], additions: 0, deletions: 1, total_files: 1, truncated: false },
    })
    renderPanel('files')
    expect(await names(await screen.findByRole('button', { name: 'plain.ts' }))).toEqual(['Open', 'Copy path', 'Copy relative path', 'Reveal in file manager'])
    expect(await names(within(screen.getByRole('list', { name: 'Changed files' })).getByRole('button', { name: /gone\.ts/ }))).toEqual(['Open changes', 'Copy path', 'Copy relative path'])
    cleanup()
    renderOnBuild('files')
    expect(await names(await screen.findByRole('button', { name: 'plain.ts' }))).toEqual(['Open', 'Copy path', 'Copy relative path'])
    cleanup()
  })

  it('offers to discard a changed file’s changes, saying how it changed, and not for an unchanged file or one turn’s changes', async () => {
    const patchOf = (header: string) => `diff --git a/x b/x\n${header}@@ -1 +1 @@\n-old\n+new\n`
    const diff = {
      files: [
        { path: 'src/edited.ts', additions: 1, deletions: 1, binary: false, patch: patchOf('') },
        { path: 'src/gone.ts', additions: 0, deletions: 1, binary: false, patch: patchOf('deleted file mode 100644\n') },
        { path: 'src/new.ts', additions: 1, deletions: 0, binary: false, patch: patchOf('new file mode 100644\n') },
      ],
      additions: 2, deletions: 2, total_files: 3, truncated: false,
    }
    daemonAnswers({ Diff: diff, Status: { branch: 'main', ahead: 0, behind: 0, files: [] }, Tree: [{ name: 'plain.ts', is_directory: false }] })
    const onDiscard = vi.fn()
    renderPanel('changes', fileActions({ onDiscard }))
    const list = await screen.findByRole('list', { name: 'Changed files' })
    for (const name of ['edited.ts', 'gone.ts', 'new.ts']) {
      fireEvent.contextMenu(within(list).getByRole('button', { name: new RegExp(name.replace('.', '\\.')) }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Discard changes…' }))
      await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
    }
    expect(onDiscard.mock.calls.map(([file]) => file as unknown)).toEqual([
      { path: 'src/edited.ts', change: 'edited' },
      { path: 'src/gone.ts', change: 'deleted' },
      { path: 'src/new.ts', change: 'new' },
    ])
    cleanup()
    renderPanel('files', fileActions({ onDiscard }))
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'plain.ts' }))
    await screen.findByRole('menuitem', { name: 'Open' })
    expect(screen.queryByRole('menuitem', { name: 'Discard changes…' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
    fireEvent.contextMenu(within(screen.getByRole('list', { name: 'Changed files' })).getByRole('button', { name: /new\.ts/ }))
    expect(await screen.findByRole('menuitem', { name: 'Discard changes…' })).toBeInTheDocument()
    cleanup()
    // One turn's changes are a diff between two snapshots; a discard would act on the working tree instead.
    const ofTurn = fileMenu({ path: 'src/edited.ts', changed: true, deleted: false, range: { from: 'before', to: 'after' } }, 'changes', fileActions({ onDiscard }))
    expect(ofTurn.some((entry) => typeof entry === 'object' && 'label' in entry && entry.label === 'Discard changes…')).toBe(false)
  })

  it('reads the changes of a session on another machine from that machine', async () => {
    daemonAnswers({
      Status: { branch: 'main', ahead: 0, behind: 0, files: [{ path: 'a.txt', kind: 'Modified' }] },
      Diff: { files: [{ path: 'a.txt', additions: 1, deletions: 1, binary: false, patch: '@@ -1 +1 @@\n-old\n+new\n' }], additions: 1, deletions: 1, total_files: 1, truncated: false },
    })
    renderOnBuild('changes')

    const files = await screen.findByRole('list', { name: 'Changed files' })
    expect(within(files).getByText('a.txt')).toBeTruthy()
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('repo_query', { machine: 1, term: 5, question: { Diff: { path: null } } })
    expect(vi.mocked(invoke).mock.calls.every(([, args]) => (args as { machine?: number }).machine === 1), 'nothing is asked of this computer').toBe(true)
    cleanup()
  })

  it('commits the ticked files of a checkout on another machine there, then opens a pull request and shows where it is', async () => {
    const asked: Array<[string, unknown]> = []
    const file = (path: string) => ({ path, additions: 1, deletions: 0, binary: false, patch: '@@ -0,0 +1 @@\n+new\n' })
    vi.mocked(invoke).mockReset().mockImplementation((command, args) => {
      asked.push([command, args])
      if (command === 'git_commit_all') return Promise.resolve('1a2b3c4')
      if (command === 'git_create_pull_request') return Promise.resolve('https://github.com/o/r/pull/12')
      const question = (args as { question: Question }).question
      if (question === 'Status') return Promise.resolve({ Status: { branch: 'main', ahead: 0, behind: 0, files: [] } })
      return Promise.resolve({ Diff: { files: [file('a.txt'), file('b.txt')], additions: 2, deletions: 0, total_files: 2, truncated: false } })
    })
    const onNotice = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <RepoSurface term={5} machine={1} kind="changes" files={fileActions()} changeActions={{ folder: '', machine: 1, term: 5, suggested: 'Add refunds' }} onNotice={onNotice} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Commit b.txt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit 1 of 2 files' }))
    await waitFor(() => { expect(onNotice).toHaveBeenCalledWith('Committed 1 file as 1a2b3c4') })
    expect(asked).toContainEqual(['git_commit_all', { machine: 1, folder: '', message: 'Add refunds', paths: ['a.txt'], term: 5 }])
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))
    expect(await screen.findByText('https://github.com/o/r/pull/12')).toBeTruthy()
    expect(asked).toContainEqual(['git_create_pull_request', { machine: 1, folder: '', term: 5 }])
    cleanup()
  })

  it('pulls a checkout on another machine with the same button, on that machine', async () => {
    const asked: Array<[string, unknown]> = []
    vi.mocked(invoke).mockReset().mockImplementation((command, args) => {
      asked.push([command, args])
      if (command === 'git_sync') return Promise.resolve('Pulled')
      const question = (args as { question: Question }).question
      if (question === 'Status') return Promise.resolve({ Status: { branch: 'main', ahead: 0, behind: 2, files: [] } })
      return Promise.resolve({ Diff: { files: [{ path: 'a.txt', additions: 1, deletions: 0, binary: false, patch: '@@ -0,0 +1 @@\n+new\n' }], additions: 1, deletions: 0, total_files: 1, truncated: false } })
    })
    const onNotice = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <RepoSurface term={5} machine={1} kind="changes" files={fileActions()} changeActions={{ folder: '', machine: 1, term: 5, suggested: '' }} onNotice={onNotice} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Pull 2' }))
    await waitFor(() => { expect(onNotice).toHaveBeenCalledWith('Pulled') })
    expect(asked).toContainEqual(['git_sync', { machine: 1, folder: '', action: 'pull', term: 5 }])
    cleanup()
  })

  it('says why a push on another machine failed, in the machine\'s words', async () => {
    vi.mocked(invoke).mockReset().mockImplementation((command, args) => {
      if (command === 'git_sync') return Promise.reject(new Error('main has no upstream, and there is no remote named origin to push it to'))
      const question = (args as { question: Question }).question
      if (question === 'Status') return Promise.resolve({ Status: { branch: 'main', ahead: 1, behind: 0, files: [] } })
      return Promise.resolve({ Diff: { files: [], additions: 0, deletions: 0, total_files: 0, truncated: false } })
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <RepoSurface term={5} machine={1} kind="changes" files={fileActions()} changeActions={{ folder: '', machine: 1, term: 5, suggested: '' }} onNotice={vi.fn()} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Push 1' }))
    expect((await screen.findByRole('alert')).textContent).toBe('main has no upstream, and there is no remote named origin to push it to')
    cleanup()
  })

  it('lists the files of a session on another machine through that machine, and reads none of them itself', async () => {
    vi.mocked(invoke).mockReset().mockImplementation((command, args) => {
      const { question, machine } = args as { question: Question; machine?: number }
      const kind = typeof question === 'string' ? question : (Object.keys(question)[0] ?? '')
      expect(command).toBe('repo_query')
      expect(machine, `${kind} is asked of the machine`).toBe(1)
      if (kind === 'Tree') return Promise.resolve({ Tree: [{ name: 'README.md', is_directory: false }, { name: 'main.rs', is_directory: false }] })
      if (kind === 'Diff') return Promise.resolve({ Diff: { files: [], additions: 0, deletions: 0, total_files: 0, truncated: false } })
      return Promise.reject(new Error(`unexpected ${kind}`))
    })
    const { files } = renderOnBuild('files')
    fireEvent.click(await screen.findByRole('button', { name: 'main.rs' }))
    expect(files.onOpen).toHaveBeenCalledWith('main.rs', 'files')
    cleanup()
  })

  it('commits the changed files with the suggested message, then opens a pull request and shows where it is', async () => {
    const asked: Array<[string, unknown]> = []
    vi.mocked(invoke).mockReset().mockImplementation((command, args) => {
      asked.push([command, args])
      if (command === 'git_commit_all') return Promise.resolve('abc1234')
      if (command === 'git_create_pull_request') return Promise.resolve('https://github.com/o/r/pull/7')
      return Promise.resolve({ Diff: { files: [{ path: 'a.txt', additions: 1, deletions: 0, binary: false, patch: '@@ -0,0 +1 @@\n+new\n' }], additions: 1, deletions: 0, total_files: 1, truncated: false } })
    })
    const onNotice = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <RepoSurface term={5} kind="changes" files={fileActions()} changeActions={{ folder: '/home/me/app', machine: 0, suggested: 'Add refunds' }} onNotice={onNotice} />
      </QueryClientProvider>,
    )
    expect(await screen.findByLabelText('Commit message')).toHaveValue('Add refunds')
    fireEvent.click(screen.getByRole('button', { name: 'Commit 1 file' }))
    await waitFor(() => { expect(onNotice).toHaveBeenCalledWith('Committed 1 file as abc1234') })
    expect(asked).toContainEqual(['git_commit_all', { machine: 0, folder: '/home/me/app', message: 'Add refunds', paths: null }])
    fireEvent.click(screen.getByLabelText('Commit a.txt'))
    expect(screen.getByRole('button', { name: 'Tick files to commit' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))
    expect(await screen.findByText('https://github.com/o/r/pull/7')).toBeTruthy()
    expect(asked).toContainEqual(['git_create_pull_request', { machine: 0, folder: '/home/me/app' }])
    cleanup()
  })

  it('says what git said when a commit fails, and offers neither button without a checkout on this computer', async () => {
    vi.mocked(invoke).mockReset().mockImplementation((command) => {
      if (command === 'git_commit_all') return Promise.reject(new Error('nothing to commit'))
      return Promise.resolve({ Diff: { files: [{ path: 'a.txt', additions: 1, deletions: 0, binary: false, patch: '@@ -0,0 +1 @@\n+new\n' }], additions: 1, deletions: 0, total_files: 1, truncated: false } })
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <RepoSurface term={5} kind="changes" files={fileActions()} changeActions={{ folder: '/home/me/app', machine: 0, suggested: 'x' }} onNotice={vi.fn()} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Commit 1 file' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('nothing to commit')
    cleanup()
    renderPanel('changes')
    await screen.findByRole('list', { name: 'Changed files' })
    expect(screen.queryByRole('button', { name: /^Commit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create PR' })).toBeNull()
  })

  it('shows what the daemon said when it fails with a plain string, not a generic message', async () => {
    vi.mocked(invoke).mockReset().mockRejectedValue('git diff: fatal: bad object HEAD')
    renderPanel('changes')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Maiker couldn’t load your changes')
    // The daemon's own words are kept for support, behind one link, and not in the headline.
    expect(alert).not.toHaveTextContent('bad object HEAD')
    fireEvent.click(screen.getByRole('button', { name: 'Show details for support' }))
    expect(screen.getByRole('alert')).toHaveTextContent('git diff: fatal: bad object HEAD')
  })

  it('says a busy git is not an error and tries again by itself', async () => {
    vi.mocked(invoke).mockReset().mockRejectedValue("fatal: Unable to create '/code/app/.git/index.lock': File exists. Another git process seems to be running")
    renderPanel('changes')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Git is finishing something')
    expect(alert).toHaveTextContent('Nothing in your project was changed')
    expect(alert).toHaveTextContent('Trying again automatically in 3s')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('asks for permission rather than retrying when a folder cannot be read', async () => {
    vi.mocked(invoke).mockReset().mockRejectedValue('read /code/app: Permission denied (os error 13)')
    renderPanel('files')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Maiker can’t read this folder')
    expect(alert).not.toHaveTextContent('Trying again automatically')
  })

  it.each(['files', 'changes'] as const)(
    'explains a plain folder on the %s view instead of calling it an error, and says what to do',
    async (view) => {
      vi.mocked(invoke).mockReset().mockRejectedValue('git rev-parse --show-toplevel: fatal: not a git repository (or any of the parent directories): .git')
      renderPanel(view)
      // The placeholder bars are a status too while the folder is read, so the note is found by its words.
      const note = (await screen.findByText(/This folder isn’t a git project yet/)).closest('[role="status"]')
      expect(note).not.toBeNull()
      expect(note).toHaveTextContent('git init')
      expect(screen.queryByRole('alert')).toBeNull()
    },
  )

  it('shows the file tree, opens folders in place, and opens a picked file in the file pane', async () => {
    daemonAnswers({
      Tree: [{ name: 'src', is_directory: true }, { name: 'notes.txt', is_directory: false }],
      Diff: { files: [], additions: 0, deletions: 0, total_files: 0, truncated: false },
    })
    const { files } = renderPanel('files')

    const folder = await screen.findByRole('button', { name: 'src' })
    expect(folder).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(folder)
    expect(folder).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(await screen.findByRole('button', { name: 'notes.txt' }))
    expect(files.onOpen).toHaveBeenCalledWith('notes.txt', 'files')
    // The panel is the tree alone: the file is drawn in its own pane.
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(vi.mocked(invoke).mock.calls.some(([, args]) => JSON.stringify((args as { question: unknown }).question).includes('File'))).toBe(false)
  })
})

describe('the Changes surface', () => {
  describe('a turn’s changes', () => {
    const diffOf = (path: string) => ({ files: [{ path, additions: 1, deletions: 0, binary: false, patch: '@@ -0,0 +1 @@\n+new\n' }], additions: 1, deletions: 0, total_files: 1, truncated: false })
    type Turn = { startedAtMs: number; endedAtMs: number } | null
    const turnPanel = (turn: Turn, onAllChanges = vi.fn()) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const files = fileActions()
      const panel = (shown: Turn) => (
        <QueryClientProvider client={client}>
          <RepoSurface term={5} kind="changes" files={files} changeActions={{ folder: '/home/me/app', machine: 0, suggested: 'x' }} turnScope={{ turn: shown, onAllChanges }} onNotice={vi.fn()} />
        </QueryClientProvider>
      )
      const { rerender } = render(panel(turn))
      return { onAllChanges, files, showTurn: (next: Turn) => { rerender(panel(next)) } }
    }

    it('shows what the turn changed between its snapshots, with no commit, and goes back to all changes', async () => {
      daemonAnswers({
        Snapshots: [{ commit: 'after', at: NOW + 60, why: 'after claude’s turn' }, { commit: 'before', at: NOW, why: 'before claude’s turn' }],
        DiffRange: diffOf('turn.ts'),
        Diff: diffOf('everything.ts'),
      })
      const { onAllChanges, files } = turnPanel({ startedAtMs: NOW * 1000, endedAtMs: (NOW + 59) * 1000 })
      expect(within(await screen.findByRole('list', { name: 'Changed files' })).getByText('turn.ts')).toBeTruthy()
      // The file opens as the turn's own diff, which is what its row counted.
      fireEvent.click(within(screen.getByRole('list', { name: 'Changed files' })).getByRole('button', { name: /turn\.ts/ }))
      expect(files.onOpen).toHaveBeenCalledWith('turn.ts', 'changes', { range: { from: 'before', to: 'after' } })
      expect(screen.getByText("This turn's changes")).toBeTruthy()
      expect(vi.mocked(invoke)).toHaveBeenCalledWith('repo_query', { term: 5, question: { DiffRange: { from: 'before', to: 'after', path: null } } })
      expect(screen.queryByRole('button', { name: /^Commit/ })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'All changes' }))
      expect(onAllChanges).toHaveBeenCalled()
    })

    it('shows the whole working tree and says so when the turn has no snapshot before it', async () => {
      daemonAnswers({ Snapshots: [], Diff: diffOf('everything.ts') })
      turnPanel({ startedAtMs: NOW * 1000, endedAtMs: (NOW + 59) * 1000 })
      expect(within(await screen.findByRole('list', { name: 'Changed files' })).getByText('everything.ts')).toBeTruthy()
      expect(screen.getByText(/^Whole working tree/)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Commit 1 file' })).toBeTruthy()
    })

    it('reads the snapshots again for a later turn, so its own end snapshot is found', async () => {
      const first = [{ commit: 'after1', at: NOW + 60, why: 'after' }, { commit: 'before1', at: NOW, why: 'before' }]
      daemonAnswers({ Snapshots: first, DiffRange: diffOf('one.ts') })
      const { showTurn } = turnPanel({ startedAtMs: NOW * 1000, endedAtMs: (NOW + 59) * 1000 })
      expect(within(await screen.findByRole('list', { name: 'Changed files' })).getByText('one.ts')).toBeTruthy()
      daemonAnswers({ Snapshots: [{ commit: 'after2', at: NOW + 200, why: 'after' }, ...first], DiffRange: diffOf('two.ts') })
      showTurn({ startedAtMs: (NOW + 100) * 1000, endedAtMs: (NOW + 199) * 1000 })
      await waitFor(() => { expect(within(screen.getByRole('list', { name: 'Changed files' })).getByText('two.ts')).toBeTruthy() })
      await waitFor(() => { expect(vi.mocked(invoke)).toHaveBeenCalledWith('repo_query', { term: 5, question: { DiffRange: { from: 'after1', to: 'after2', path: null } } }) })
    })
  })
})
