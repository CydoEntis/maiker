import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

function renderPanel(view: RepoSurfaceKind) {
  const onNotice = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RepoSurface term={5} kind={view} lookAt={null} onNotice={onNotice} />
    </QueryClientProvider>,
  )
  return { onNotice }
}

/** The panel for pane 5 of the machine build. */
function renderOnBuild(view: RepoSurfaceKind) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RepoSurface term={5} machine={1} machineName="build" kind={view} lookAt={null} onNotice={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => { vi.mocked(isTauri).mockReturnValue(true) })

describe('the side panel’s Files and Changes', () => {

  it('lists the changed files and shows the picked file’s diff', async () => {
    daemonAnswers({
      Diff: {
        files: [
          { path: 'a.txt', additions: 1, deletions: 1, binary: false, patch: 'diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-old\n+new\n' },
          { path: 'b.txt', additions: 3, deletions: 0, binary: false, patch: '@@ -0,0 +1,3 @@\n+x\n+y\n+z\n' },
        ],
        additions: 4, deletions: 1, total_files: 2, truncated: false,
      },
    })
    renderPanel('changes')

    const files = await screen.findByRole('list', { name: 'Changed files' })
    expect(within(files).getByText('a.txt')).toBeTruthy()
    expect(screen.getByLabelText('Diff').textContent).toContain('+new')
    expect(screen.getByLabelText('Diff').textContent).not.toContain('diff --git')
    fireEvent.click(within(files).getByRole('button', { name: /b\.txt/ }))
    expect(screen.getByLabelText('Diff').textContent).toContain('+z')
  })

  it('reads the changes of a session on another machine from that machine', async () => {
    daemonAnswers({
      Status: { branch: 'main', ahead: 0, behind: 0, files: [{ path: 'a.txt', kind: 'Modified' }] },
      Diff: { files: [{ path: 'a.txt', additions: 1, deletions: 1, binary: false, patch: '@@ -1 +1 @@\n-old\n+new\n' }], additions: 1, deletions: 1, total_files: 1, truncated: false },
    })
    renderOnBuild('changes')

    const files = await screen.findByRole('list', { name: 'Changed files' })
    expect(within(files).getByText('a.txt')).toBeTruthy()
    expect(screen.getByLabelText('Diff').textContent).toContain('+new')
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
        <RepoSurface term={5} machine={1} machineName="build" kind="changes" lookAt={null} changeActions={{ folder: '', machine: 1, term: 5, suggested: 'Add refunds' }} onNotice={onNotice} />
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
        <RepoSurface term={5} machine={1} machineName="build" kind="changes" lookAt={null} changeActions={{ folder: '', machine: 1, term: 5, suggested: '' }} onNotice={onNotice} />
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
        <RepoSurface term={5} machine={1} machineName="build" kind="changes" lookAt={null} changeActions={{ folder: '', machine: 1, term: 5, suggested: '' }} onNotice={vi.fn()} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Push 1' }))
    expect((await screen.findByRole('alert')).textContent).toBe('main has no upstream, and there is no remote named origin to push it to')
    cleanup()
  })

  it('lists the files of a session on another machine through that machine, and opens only its markdown documents', async () => {
    vi.mocked(invoke).mockReset().mockImplementation((command, args) => {
      const { question, machine } = args as { question: Question; machine?: number }
      const kind = typeof question === 'string' ? question : (Object.keys(question)[0] ?? '')
      expect(command).toBe('repo_query')
      expect(machine, `${kind} is asked of the machine`).toBe(1)
      if (kind === 'Tree') return Promise.resolve({ Tree: [{ name: 'README.md', is_directory: false }, { name: 'main.rs', is_directory: false }] })
      if (kind === 'Diff') return Promise.resolve({ Diff: { files: [], additions: 0, deletions: 0, total_files: 0, truncated: false } })
      if (kind === 'FileStamped') return Promise.resolve({ FileStamped: { text: '# Remote title\n', version: '9-ab' } })
      return Promise.reject(new Error(`unexpected ${kind}`))
    })
    renderOnBuild('files')
    expect(await screen.findByRole('heading', { name: 'Remote title' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'main.rs' }))
    expect(await screen.findByText(/Only Markdown documents open from build/)).toBeTruthy()
    expect(vi.mocked(invoke).mock.calls.some(([, args]) => JSON.stringify((args as { question: unknown }).question).includes('"File"'))).toBe(false)
    cleanup()
  })

  it('opens a comment box on a clicked diff line, sends the comment to the agent and keeps it under the line', async () => {
    daemonAnswers({
      Diff: { files: [{ path: 'src/a.ts', additions: 1, deletions: 1, binary: false, patch: '@@ -3 +3 @@\n-old\n+new\n' }], additions: 1, deletions: 1, total_files: 1, truncated: false },
    })
    const onSend = vi.fn(() => Promise.resolve())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <RepoSurface term={5} kind="changes" lookAt={null} comments={{ agent: 'Claude', onSend }} onNotice={vi.fn()} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByText(/\+new/))
    const send = screen.getByRole('button', { name: 'Send to Claude' })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Comment on line 3'), { target: { value: 'call it fresh' } })
    fireEvent.click(send)
    await waitFor(() => { expect(onSend).toHaveBeenCalledWith('About src/a.ts, line 3:\n> new\n\ncall it fresh') })
    expect(await screen.findByText(/sent to Claude/)).toBeTruthy()
    expect(screen.getByText('1 comment')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send to Claude' })).toBeNull()
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
        <RepoSurface term={5} kind="changes" lookAt={null} changeActions={{ folder: '/home/me/app', machine: 0, suggested: 'Add refunds' }} onNotice={onNotice} />
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
        <RepoSurface term={5} kind="changes" lookAt={null} changeActions={{ folder: '/home/me/app', machine: 0, suggested: 'x' }} onNotice={vi.fn()} />
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

  it('shows the file tree with a file beside it, opens folders in place and highlights the file', async () => {
    daemonAnswers({
      Tree: [{ name: 'src', is_directory: true }, { name: 'README.md', is_directory: false }],
      FileStamped: { text: 'The answer is 42\n', version: 'v1' },
    })
    renderPanel('files')

    const folder = await screen.findByRole('button', { name: 'src' })
    expect(folder).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(folder)
    expect(folder).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(await screen.findByRole('button', { name: 'README.md' }))
    // A markdown file opens as a document, drawn; its editor is a mode of its own, not on screen until asked for.
    expect(await screen.findByLabelText('Document README.md')).toBeTruthy()
    await waitFor(() => { expect(screen.getByLabelText('Document README.md').textContent).toContain('The answer is 42') })
    // The tree stays on screen beside the file.
    expect(screen.getByRole('navigation', { name: 'Files' })).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('the Changes surface', () => {
  describe('a turn’s changes', () => {
    const diffOf = (path: string) => ({ files: [{ path, additions: 1, deletions: 0, binary: false, patch: '@@ -0,0 +1 @@\n+new\n' }], additions: 1, deletions: 0, total_files: 1, truncated: false })
    type Turn = { startedAtMs: number; endedAtMs: number } | null
    const turnPanel = (turn: Turn, onAllChanges = vi.fn()) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const panel = (shown: Turn) => (
        <QueryClientProvider client={client}>
          <RepoSurface term={5} kind="changes" lookAt={null} changeActions={{ folder: '/home/me/app', machine: 0, suggested: 'x' }} turnScope={{ turn: shown, onAllChanges }} onNotice={vi.fn()} />
        </QueryClientProvider>
      )
      const { rerender } = render(panel(turn))
      return { onAllChanges, showTurn: (next: Turn) => { rerender(panel(next)) } }
    }

    it('shows what the turn changed between its snapshots, with no commit, and goes back to all changes', async () => {
      daemonAnswers({
        Snapshots: [{ commit: 'after', at: NOW + 60, why: 'after claude’s turn' }, { commit: 'before', at: NOW, why: 'before claude’s turn' }],
        DiffRange: diffOf('turn.ts'),
        Diff: diffOf('everything.ts'),
      })
      const { onAllChanges } = turnPanel({ startedAtMs: NOW * 1000, endedAtMs: (NOW + 59) * 1000 })
      expect(within(await screen.findByRole('list', { name: 'Changed files' })).getByText('turn.ts')).toBeTruthy()
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
