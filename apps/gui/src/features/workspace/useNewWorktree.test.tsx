import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The daemon: what it lists, the worktree it makes for a folder, and the chat it starts there.
const listed = vi.hoisted(() => ({ sessions: [] as { id: string; kind: 'terminal'; nativePane: number }[] }))
const daemon = vi.hoisted(() => ({
  addWorktree: vi.fn<(folder: string, branch: string, machine: number, base?: string) => Promise<string>>((_folder, branch) => Promise.resolve(`/home/me/.maiker/worktrees/shop/${branch}`)),
  startChatSession: vi.fn<(folder: string, agent: string, branch: string | null, permissions: string, machine?: number) => Promise<{ id: number; generation: number }>>(() => Promise.resolve({ id: 44, generation: 1 })),
  startAcpChat: vi.fn<(folder: string, agent: string, machine?: number) => Promise<{ id: number; generation: number }>>(() => Promise.resolve({ id: 45, generation: 1 })),
  renameConversationOnDaemon: vi.fn(() => Promise.resolve()),
  submitMessage: vi.fn(() => Promise.resolve(null)),
}))
// The pane's daemon makes the worktree and opens its `[worktree] command`, or a plain shell, in it.
const newWorktreeSession = vi.hoisted(() => vi.fn<(term: number, branch: string, base: string | null, machine?: number) => Promise<void>>(() => {
  listed.sessions.push({ id: '9', kind: 'terminal', nativePane: 9 })
  return Promise.resolve()
}))
vi.mock('@/api/daemon', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/daemon')>()), ...daemon, loadConversations: () => Promise.resolve([...listed.sessions]) }))
vi.mock('@/features/worktrees/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/features/worktrees/api')>()), newWorktreeSession }))
vi.mock('@/features/inspect/api', () => ({
  repoBranches: vi.fn(() => Promise.resolve([{ name: 'main' }, { name: 'dev' }])),
  repoWorktrees: vi.fn(() => Promise.resolve([{ path: '/code/shop', branch: 'main', main: true, repo: 'shop' }])),
}))
vi.mock('@/lib/toast', () => ({ toast: { failed: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('./model/agentHooks', () => ({ connectAgentOnce: () => Promise.resolve() }))

import { NewWorktreeDialog } from '@/features/worktrees/NewWorktreeDialog'
import type { ChatAgent } from './model/chatView'
import type { SessionView } from './model/session'
import { useNewWorktree } from './useNewWorktree'
import { useSessionStarts } from './useSessionStarts'

type View = 'chat' | 'terminal'

/** A session of the shop project on this computer, in its main checkout, running `agent` (null: a plain shell). */
const sessionOf = (agent: string | null): SessionView => ({ id: '3', pane: 3, machine: 0, machineName: null, cwd: '/code/shop', branch: 'main', repoName: 'shop', conversation: { agent } }) as unknown as SessionView

const setter = vi.fn()

/** The window's New worktree dialog wired to the window's own starts, as the workspace wires it. */
function Window({ view, from, defaultAgent }: { view: View; from: SessionView; defaultAgent: ChatAgent }) {
  const starts = useSessionStarts({
    queryClient: new QueryClient(), sessions: [], setWorktreeFrom: setter, setLayout: setter, flash: setter, focusedSession: undefined,
    setNewChatOpen: setter, online: true, starting: false, setStarting: setter, setStartedFrom: setter, sessionMap: new Map(),
    preferences: { bypassOff: ['claude', 'codex', 'gemini'], openSessionsIn: view, startFolder: '' }, setExpectedAgents: setter,
    setSettingsSection: setter, setNewChatMachine: setter, setNewChatSeed: setter, home: '/home/me', machinesRef: { current: new Map() },
  } as unknown as Parameters<typeof useSessionStarts>[0])
  const createWorktree = useNewWorktree({ chatView: view === 'chat', inTerminal: starts.createWorktree, startNewChat: starts.startNewChat, defaultAgent, setWorktreeFrom: setter, flash: setter })
  return <NewWorktreeDialog term={from.pane} repoName="shop" machine={from.machine} fromBranch="main" onCreate={(branch, base) => createWorktree(from, branch, base)} onCancel={setter} />
}

async function createFrom(view: View, from: SessionView, defaultAgent: ChatAgent = 'claude') {
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Window view={view} from={from} defaultAgent={defaultAgent} />
    </QueryClientProvider>,
  )
  const field = screen.getByRole('textbox', { name: 'Branch name' })
  await waitFor(() => { expect(field).not.toHaveValue('') })
  await user.clear(field)
  await user.type(field, 'testicles')
  await user.click(screen.getByRole('button', { name: 'Create worktree' }))
}

beforeEach(() => {
  listed.sessions = []
  newWorktreeSession.mockClear()
  for (const call of Object.values(daemon)) call.mockClear()
})

describe('New worktree in the Chat view', () => {
  it('starts a chat with the same agent in the new worktree, not a shell the Chat view does not list', async () => {
    await createFrom('chat', sessionOf('codex'))
    await waitFor(() => { expect(daemon.startChatSession).toHaveBeenCalled() })
    expect(daemon.addWorktree).toHaveBeenCalledWith('/code/shop', 'testicles', 0, undefined)
    expect(daemon.startChatSession).toHaveBeenCalledWith('/home/me/.maiker/worktrees/shop/testicles', 'codex', null, expect.any(String), 0)
    expect(newWorktreeSession).not.toHaveBeenCalled()
  })

  it('starts the default agent when it was made from a plain shell', async () => {
    await createFrom('chat', sessionOf(null), 'codex')
    await waitFor(() => { expect(daemon.startChatSession).toHaveBeenCalled() })
    expect(daemon.startChatSession).toHaveBeenCalledWith('/home/me/.maiker/worktrees/shop/testicles', 'codex', null, expect.any(String), 0)
  })

  it('keeps the dialog open with the reason when the worktree folder is already there', async () => {
    daemon.addWorktree.mockRejectedValueOnce(new Error('Could not make a worktree for branch `testicles`: its folder /home/me/.maiker/worktrees/shop/testicles is already there. Remove that folder, or pick another branch name.'))
    await createFrom('chat', sessionOf('claude'))
    expect(await screen.findByText(/is already there\. Remove that folder, or pick another branch name\./)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Branch name' })).toHaveValue('testicles')
    expect(daemon.startChatSession).not.toHaveBeenCalled()
  })
})

describe('New worktree in the Terminal view', () => {
  it('has the pane\'s daemon make the worktree and open its session, as before', async () => {
    await createFrom('terminal', sessionOf('claude'))
    await waitFor(() => { expect(newWorktreeSession).toHaveBeenCalledWith(3, 'testicles', null, 0) })
    expect(daemon.addWorktree).not.toHaveBeenCalled()
    expect(daemon.startChatSession).not.toHaveBeenCalled()
  })
})
