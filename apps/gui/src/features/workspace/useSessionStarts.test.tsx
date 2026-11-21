import { renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The daemon's list: each agent started is a new terminal session in it, numbered in the order it was made.
const listed = vi.hoisted(() => ({ sessions: [] as { id: string; kind: 'terminal'; nativePane: number }[] }))
const daemon = vi.hoisted(() => ({
  startAgentSession: vi.fn<(folder: string, agent: string, words: readonly string[]) => Promise<void>>(() => {
    const pane = listed.sessions.length + 1
    listed.sessions.push({ id: String(pane), kind: 'terminal', nativePane: pane })
    return Promise.resolve()
  }),
  startShellSession: vi.fn<(folder: string) => Promise<void>>(() => {
    const pane = listed.sessions.length + 1
    listed.sessions.push({ id: String(pane), kind: 'terminal', nativePane: pane })
    return Promise.resolve()
  }),
  addWorktree: vi.fn<(folder: string, branch: string) => Promise<string>>((folder: string, branch: string) => Promise.resolve(`${folder}-${branch}`)),
  switchBranch: vi.fn(() => Promise.resolve()),
  renameConversationOnDaemon: vi.fn<(session: { id: string }, name: string) => Promise<void>>(() => Promise.resolve()),
  sendWhenAgentReady: vi.fn(() => Promise.resolve()),
  sendTerminalInput: vi.fn(() => Promise.resolve()),
  archiveConversationOnDaemon: vi.fn<(session: { id: string }, archived: boolean) => Promise<void>>(() => Promise.resolve()),
  startAcpChat: vi.fn<(folder: string, agent: string) => Promise<{ id: number; generation: number }>>(() => Promise.resolve({ id: 44, generation: 1 })),
  submitMessage: vi.fn<(conversation: { id: string; generation: number }, operation: number, text: string, choice?: { model?: string; effort?: string }) => Promise<null>>(() => Promise.resolve(null)),
  prewarmAgentSession: vi.fn(() => Promise.resolve()),
}))
// Another machine: a session started there shows in its next list.
const remote = vi.hoisted(() => ({ machines: new Map<number, { conversations: { id: string; kind: 'terminal' }[] }>() }))
const startSessionOnMachine = vi.hoisted(() => vi.fn<(machine: number, folder: string) => Promise<void>>((machine) => {
  remote.machines.get(machine)?.conversations.push({ id: `m${String(machine)}-1`, kind: 'terminal' })
  return Promise.resolve()
}))
vi.mock('@/api/machines', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/machines')>()), startSessionOnMachine }))
vi.mock('@/api/daemon', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/daemon')>()), ...daemon, loadConversations: () => Promise.resolve([...listed.sessions]) }))
const toast = vi.hoisted(() => ({ failed: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast }))
vi.mock('./model/agentHooks', () => ({ connectAgentOnce: () => Promise.resolve() }))

import { useSessionStarts } from './useSessionStarts'
import type { NewChatRequest } from './components/NewChatPage'

const ID = '0d0f5c1e-1111-4222-8333-444455556666'

type Watch = { /** Bypass Permissions off for these; every agent unless a test says otherwise. */ bypassOff?: readonly string[]; /** Settings' view for the whole app; the Terminal view unless a test says otherwise. */ openSessionsIn?: 'chat' | 'terminal'; setLayout?: () => void; setNewChatOpen?: (open: boolean) => void; setStartedFrom?: (change: unknown) => void }
function starts(watch: Watch = {}) {
  const { bypassOff, openSessionsIn } = watch
  const setter = vi.fn()
  const props = {
    queryClient: new QueryClient(), sessions: [], setWorktreeFrom: setter, setLayout: watch.setLayout ?? setter, flash: setter, focusedSession: undefined,
    setNewChatOpen: watch.setNewChatOpen ?? setter, online: true, starting: false, setStarting: setter, setStartedFrom: watch.setStartedFrom ?? setter, sessionMap: new Map([['old', {}]]),
    preferences: { bypassOff: bypassOff ?? ['claude', 'codex', 'gemini'], openSessionsIn: openSessionsIn ?? 'terminal' }, setExpectedAgents: setter,
    setSettingsSection: setter, setNewChatMachine: setter, setNewChatSeed: setter, home: '/home/me', machinesRef: { current: remote.machines },
  } as unknown as Parameters<typeof useSessionStarts>[0]
  return renderHook(() => useSessionStarts(props)).result.current
}

const request = (patch: Partial<NewChatRequest>): NewChatRequest => ({
  folder: '/dev/app', agent: 'claude', model: 'default', reasoning: 'medium', mode: 'default', message: '', branch: null, machine: 0, machineName: 'This computer', resume: null, ...patch,
})

beforeEach(() => {
  listed.sessions = []
  for (const call of Object.values(daemon)) call.mockClear()
  toast.error.mockClear()
})

describe('starting a new chat that resumes a saved conversation', () => {
  it('puts Claude\'s resume option first, then the picked flags', async () => {
    await starts().startNewChat(request({ resume: ID }))
    expect(daemon.startAgentSession).toHaveBeenCalledWith('/dev/app', 'claude', ['--resume', ID, '--effort', 'medium'])
  })

  it('starts each agent with its Bypass Permissions flag first while its switch is on', async () => {
    await starts({ bypassOff: [] }).startNewChat(request({ agent: 'codex', resume: ID }))
    expect(daemon.startAgentSession).toHaveBeenCalledWith('/dev/app', 'codex', ['--dangerously-bypass-approvals-and-sandbox', 'resume', ID, '-c', 'model_reasoning_effort=medium'])
    await starts({ bypassOff: ['codex'] }).startNewChat(request({ agent: 'claude' }))
    expect(daemon.startAgentSession).toHaveBeenLastCalledWith('/dev/app', 'claude', ['--dangerously-skip-permissions', '--effort', 'medium'])
  })

  it('puts Codex\'s resume subcommand first, then the picked flags', async () => {
    await starts().startNewChat(request({ agent: 'codex', resume: ID }))
    expect(daemon.startAgentSession).toHaveBeenCalledWith('/dev/app', 'codex', ['resume', ID, '-c', 'model_reasoning_effort=medium'])
  })

  it('refuses to resume a Gemini chat', async () => {
    await expect(starts().startNewChat(request({ agent: 'gemini', resume: ID }))).rejects.toThrow('cannot be resumed')
    expect(daemon.startAgentSession).not.toHaveBeenCalled()
  })

  it('refuses an id that would be read as a flag before any worktree or branch is made', async () => {
    const start = starts()
    await expect(start.startNewChat(request({ resume: '--dangerously-skip-permissions', branch: { name: 'x', create: true, worktree: true } }))).rejects.toThrow('cannot be resumed')
    await expect(start.startNewChat(request({ resume: '-x', branch: { name: 'x', create: false, worktree: false } }))).rejects.toThrow('cannot be resumed')
    expect(daemon.addWorktree).not.toHaveBeenCalled()
    expect(daemon.switchBranch).not.toHaveBeenCalled()
    expect(daemon.startAgentSession).not.toHaveBeenCalled()
  })
})

describe('opening a new chat from the page', () => {
  // The browser pictures the window right after a gliding pane's update (`movePanes`), so whatever the open needs must be in it.
  function glidingPane() {
    const pane = document.createElement('div')
    pane.className = 'mx-pane'
    pane.dataset.sessionId = 'old'
    const panes = document.createElement('div')
    panes.className = 'mx-panes'
    panes.append(pane)
    document.body.append(panes)
    const transition = { inside: false }
    const matchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: () => ({ matches: false }) })
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (update: () => void) => {
        transition.inside = true
        update()
        transition.inside = false
        return { finished: Promise.resolve() }
      },
    })
    return { transition, remove: () => { panes.remove(); Reflect.deleteProperty(document, 'startViewTransition'); if (matchMedia === undefined) Reflect.deleteProperty(window, 'matchMedia'); else Object.defineProperty(window, 'matchMedia', matchMedia) } }
  }

  it('closes the page in the same update that opens the pane, not a frame later', async () => {
    const glide = glidingPane()
    const during: Record<string, boolean> = {}
    const note = (what: string) => () => { during[what] = glide.transition.inside }
    try {
      await starts({ setLayout: note('layout'), setNewChatOpen: note('page') }).startNewChat(request({ message: 'hello' }))
    } finally {
      glide.remove()
    }
    expect(during).toEqual({ layout: true, page: true })
  })

  it('does the same for a chat started on another machine', async () => {
    const glide = glidingPane()
    remote.machines.set(3, { conversations: [] })
    const during: Record<string, boolean> = {}
    const note = (what: string) => () => { during[what] = glide.transition.inside }
    try {
      await starts({ setLayout: note('layout') }).startNewChat(request({ machine: 3, machineName: 'box' }))
    } finally {
      glide.remove()
      remote.machines.delete(3)
    }
    expect(during).toEqual({ layout: true })
  })
})

describe('starting new chats in the background', () => {
  const inWorktree = (name: string) => ({ name, create: true, worktree: true })

  it('starts a second chat while the first is still making its worktree, and gives each its own session', async () => {
    let finishFirstTree: () => void = () => undefined
    daemon.addWorktree.mockImplementationOnce((folder, branch) => new Promise((resolve) => { finishFirstTree = () => { resolve(`${folder}-${branch}`) } }))
    const start = starts()
    const first = start.startNewChat(request({ message: 'first task', branch: inWorktree('bold-otter') }), { background: true })
    await start.startNewChat(request({ message: 'second task', branch: inWorktree('calm-heron') }), { background: true })
    finishFirstTree()
    await first

    expect(daemon.addWorktree.mock.calls).toEqual([['/dev/app', 'bold-otter'], ['/dev/app', 'calm-heron']])
    expect(daemon.startAgentSession.mock.calls.map(([folder]) => folder)).toEqual(['/dev/app-calm-heron', '/dev/app-bold-otter'])
    expect(daemon.renameConversationOnDaemon.mock.calls).toEqual([[{ id: '1' }, 'second task'], [{ id: '2' }, 'first task']])
  })

  it('matches each launch to its own session when two start at once', async () => {
    const start = starts()
    await Promise.all([
      start.startNewChat(request({ message: 'one' }), { background: true }),
      start.startNewChat(request({ message: 'two' }), { background: true }),
    ])
    expect(daemon.renameConversationOnDaemon.mock.calls).toEqual([[{ id: '1' }, 'one'], [{ id: '2' }, 'two']])
  })

  it('leaves the window and the page as they are', async () => {
    const setLayout = vi.fn()
    const setNewChatOpen = vi.fn()
    await starts({ setLayout, setNewChatOpen }).startNewChat(request({ message: 'quietly' }), { background: true })
    expect(daemon.startAgentSession).toHaveBeenCalledTimes(1)
    expect(setLayout).not.toHaveBeenCalled()
    expect(setNewChatOpen).not.toHaveBeenCalled()
  })

  it('opens a chat started the plain way and closes the page, as before', async () => {
    const setLayout = vi.fn()
    const setNewChatOpen = vi.fn()
    await starts({ setLayout, setNewChatOpen }).startNewChat(request({ message: 'open it' }))
    expect(setLayout).toHaveBeenCalled()
    expect(setNewChatOpen).toHaveBeenCalledWith(false)
  })

  it('refuses a start from elsewhere while a chat is starting', async () => {
    let finishLaunch: () => void = () => undefined
    daemon.startAgentSession.mockImplementationOnce(() => new Promise((resolve) => {
      finishLaunch = () => { listed.sessions.push({ id: '1', kind: 'terminal', nativePane: 1 }); resolve() }
    }))
    const start = starts()
    const chat = start.startNewChat(request({ message: 'busy' }), { background: true })
    await vi.waitFor(() => { expect(daemon.startAgentSession).toHaveBeenCalled() })
    await expect(start.runStart(() => Promise.resolve('/dev/app'), () => undefined)).resolves.toBe(false)
    finishLaunch()
    await chat
  })
})

describe('what a start in the background says, and what it hides', () => {
  /** Follows the sidebar's "sessions there were when a start began" as the hook sets it, keeping every value it took. */
  function startedFromState() {
    let now: ReadonlySet<string> | null = null
    const seen: (ReadonlySet<string> | null)[] = []
    const setStartedFrom = (change: unknown) => {
      now = typeof change === 'function' ? (change as (was: typeof now) => typeof now)(now) : (change as typeof now)
      seen.push(now)
    }
    return { setStartedFrom, seen }
  }

  it('gives the page the real reason a start failed, with no toast', async () => {
    daemon.startAgentSession.mockImplementationOnce(() => Promise.reject(new Error('claude was not found')))
    await expect(starts().startNewChat(request({ message: 'x' }), { background: true })).rejects.toThrow('claude was not found')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('says another start is running when one that runs alone is under way', async () => {
    let finishShell: () => void = () => undefined
    const start = starts()
    const shell = start.runStart(() => Promise.resolve('/dev/app'), () => undefined, () => new Promise((resolve) => {
      finishShell = () => { listed.sessions.push({ id: '1', kind: 'terminal', nativePane: 1 }); resolve() }
    }))
    await expect(start.startNewChat(request({ message: 'x' }), { background: true })).rejects.toThrow('Another start is running. Try again in a moment.')
    finishShell()
    await expect(shell).resolves.toBe(true)
  })

  it('hides no session from the sidebar while it starts', async () => {
    const { setStartedFrom, seen } = startedFromState()
    await starts({ setStartedFrom }).startNewChat(request({ message: 'quietly' }), { background: true })
    expect(seen.every((value) => value === null)).toBe(true)
  })

  it('still holds new sessions off the sidebar while a chat that opens its pane starts', async () => {
    const { setStartedFrom, seen } = startedFromState()
    await starts({ setStartedFrom }).startNewChat(request({ message: 'open it' }))
    expect(seen[0]).toEqual(new Set(['old']))
    expect(seen.at(-1)).toBeNull()
  })
})

describe('starting a chat on another machine', () => {
  beforeEach(() => {
    remote.machines.clear()
    remote.machines.set(2, { conversations: [] })
    startSessionOnMachine.mockClear()
  })

  it('has that machine make the new worktree and starts the agent in it', async () => {
    await starts().startNewChat(request({ machine: 2, machineName: 'kingdom', folder: '/srv/app', branch: { name: 'quiet-otter', create: true, worktree: true } }))
    expect(daemon.addWorktree).toHaveBeenCalledWith('/srv/app', 'quiet-otter', 2)
    expect(startSessionOnMachine).toHaveBeenCalledWith(2, '/srv/app-quiet-otter')
  })

  it('refuses to switch that checkout\'s branch, and starts nothing', async () => {
    await expect(starts().startNewChat(request({ machine: 2, machineName: 'kingdom', branch: { name: 'dev', create: false, worktree: false } }))).rejects.toThrow(/new worktree/)
    expect(daemon.addWorktree).not.toHaveBeenCalled()
    expect(startSessionOnMachine).not.toHaveBeenCalled()
  })
})

// ADR 0018: what the Chat view starts is a chat with the agent over ACP, with no terminal behind it.
describe('starting a chat from the draft in the Chat view', () => {
  beforeEach(() => { localStorage.clear() })

  it('starts the agent over ACP in the folder, and sends the first message as it was written', async () => {
    const setNewChatOpen = vi.fn()

    await starts({ openSessionsIn: 'chat', setNewChatOpen }).startNewChat(request({ model: 'opus', reasoning: 'high', message: 'Fix the login redirect' }))

    expect(daemon.startAcpChat).toHaveBeenCalledWith('/dev/app', 'claude')
    expect(daemon.startAgentSession).not.toHaveBeenCalled()
    // The agent's own settings decide its model, so the draft's picks are not sent.
    expect(daemon.submitMessage).toHaveBeenCalledWith({ id: '44', generation: 1 }, expect.any(Number), 'Fix the login redirect')
    expect(daemon.renameConversationOnDaemon).toHaveBeenCalledWith({ id: '44' }, expect.stringContaining('Fix'))
    expect(setNewChatOpen).toHaveBeenCalledWith(false)
  })

  it('starts every agent that way, Gemini too', async () => {
    await starts({ openSessionsIn: 'chat' }).startNewChat(request({ agent: 'codex', mode: 'codexAuto' }))
    expect(daemon.startAcpChat).toHaveBeenLastCalledWith('/dev/app', 'codex')
    await starts({ openSessionsIn: 'chat' }).startNewChat(request({ agent: 'gemini' }))
    expect(daemon.startAcpChat).toHaveBeenLastCalledWith('/dev/app', 'gemini')
    expect(daemon.startAgentSession).not.toHaveBeenCalled()
  })

  it('sends nothing when the draft has no message', async () => {
    await starts({ openSessionsIn: 'chat' }).startNewChat(request({}))

    expect(daemon.submitMessage).not.toHaveBeenCalled()
  })

  it('leaves the page open with its message when the chat cannot start', async () => {
    const setNewChatOpen = vi.fn()
    daemon.startAcpChat.mockRejectedValueOnce(new Error('The program `claude-agent-acp` of agent `claude` was not found'))

    await expect(starts({ openSessionsIn: 'chat', setNewChatOpen }).startNewChat(request({ message: 'hello' }))).rejects.toThrow('was not found')

    expect(setNewChatOpen).not.toHaveBeenCalled()
    expect(daemon.submitMessage).not.toHaveBeenCalled()
  })

  it('still starts a saved conversation and anything in the Terminal view as the agent\'s own session', async () => {
    await starts({ openSessionsIn: 'chat' }).startNewChat(request({ resume: ID }))
    await starts({ openSessionsIn: 'terminal' }).startNewChat(request({}))

    expect(daemon.startAgentSession).toHaveBeenCalledTimes(2)
    expect(daemon.startAcpChat).not.toHaveBeenCalled()
  })

  it('starts no agent ahead of the first message for a chat that has no terminal', () => {
    starts({ openSessionsIn: 'chat' }).warmNewChat({ agent: 'claude', folder: '/dev/app', model: 'default', reasoning: 'default', mode: 'default', bypass: undefined } as never)

    expect(daemon.prewarmAgentSession).not.toHaveBeenCalled()
  })
})
