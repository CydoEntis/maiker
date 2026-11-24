import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { forgetMachines, registerMachine } from './machines'
import { conversationKey } from './conversationKey'
import type { Conversation } from '@/data/preview'
import { loadTerminalScreen, loadTerminalReplay, sendTerminalInput, resizeTerminal, renameConversationOnDaemon, loadConversations, checkConversations, conversationsFromSnapshot, daemonSaidRemoved, daemonSaidEnded, localListRevision, markSeenOnDaemon, closeSession, readConversationPage, submitMessage, cancelTurn, reloadAgentOnDaemon, loadDaemonRestartStatus, loadDaemonUpdateStatus, loadMachines, restartMismatchedDaemon, restartStaleDaemon, allowAlways, sideAnswer, conversationActiveAt, importableChats } from './daemon'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}))

describe('workspace Git state', () => {
  it('marks a conversation folder without Git so Changes can explain why it is unavailable', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockReset().mockResolvedValue({
      conversations: [{
        id: 42,
        generation: 7,
        execution: 'Structured',
        provider: 'Claude',
        cwd: 'C:\\dev\\autobattler',
        worktree: null,
        state: 'Running',
        status: 'Working',
        native_term: null,
        checks: [],
      }],
      workspaces: [{ cwd: 'C:\\dev\\autobattler', git: null }],
    })

    await expect(loadConversations()).resolves.toMatchObject([
      { folder: 'C:\\dev\\autobattler', isGitRepository: false },
    ])
  })
})

describe('a service a release behind', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockReset().mockResolvedValue({ daemonVersion: '0.71.0', behind: true, canRestart: true, sessionCount: 11, activeTurnCount: 1 })
  })

  it('loads what the host reports', async () => {
    await expect(loadDaemonUpdateStatus()).resolves.toMatchObject({ daemonVersion: '0.71.0', behind: true, sessionCount: 11 })
    expect(invoke).toHaveBeenCalledWith('daemon_update_status', undefined)
  })

  it('accepts a service that is not behind, which has no version to show', async () => {
    vi.mocked(invoke).mockResolvedValue({ daemonVersion: null, behind: false, canRestart: false, sessionCount: 0, activeTurnCount: null })
    await expect(loadDaemonUpdateStatus()).resolves.toMatchObject({ behind: false, daemonVersion: null })
  })

  it('names the version it was shown when it asks for the restart', async () => {
    await restartStaleDaemon('0.71.0')
    expect(invoke).toHaveBeenCalledWith('restart_stale_daemon', { expectedVersion: '0.71.0' })
  })

  it('rejects an empty version and browser-side requests', async () => {
    await expect(restartStaleDaemon('')).rejects.toThrow('Service version is invalid')
    vi.mocked(isTauri).mockReturnValue(false)
    await expect(loadDaemonUpdateStatus()).rejects.toThrow('Service update status is available in the desktop app')
    await expect(restartStaleDaemon('0.71.0')).rejects.toThrow('Service restart is available in the desktop app')
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('daemon protocol recovery', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockReset().mockResolvedValue({ daemonProtocol: 49, guiProtocol: 59, canRestart: true, sessionCount: 2, activeTurnCount: 1 })
  })

  it('loads restart details from the desktop host', async () => {
    await expect(loadDaemonRestartStatus()).resolves.toMatchObject({ daemonProtocol: 49, canRestart: true, activeTurnCount: 1 })
    expect(invoke).toHaveBeenCalledWith('daemon_restart_status', undefined)
  })

  it('confirms only the protocol shown to the user', async () => {
    await restartMismatchedDaemon(49)
    expect(invoke).toHaveBeenCalledWith('restart_mismatched_daemon', { expectedProtocol: 49 })
  })

  it('rejects invalid protocol versions and browser-side restart requests', async () => {
    await expect(restartMismatchedDaemon(0)).rejects.toThrow('Daemon protocol is invalid')
    vi.mocked(isTauri).mockReturnValue(false)
    await expect(loadDaemonRestartStatus()).rejects.toThrow('Daemon restart status is available in the desktop app')
    await expect(restartMismatchedDaemon(49)).rejects.toThrow('Daemon restart is available in the desktop app')
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('the chat of a pane whose conversation the daemon lists with more than this window knows', () => {
  const pane = { id: 9, agent: 'gemini', process: 'gemini', status: 'Idle', cwd: '/srv', summary: '', name: 'n', label: '', pinned: false, archived: false, branch: null, root: null, conversation_id: null, popup: false, remote: null, hooked: true }
  const summary = { id: 6, generation: 1, execution: 'Native', provider: 'Gemini', cwd: '/srv', worktree: null, state: 'Running', status: 'Idle', native_term: 9, checks: [] }

  beforeEach(() => { vi.mocked(isTauri).mockReturnValue(true) })

  it('still links the pane to its chat, and says in the log what it could not read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const [shown] = conversationsFromSnapshot({ terms: { '9': pane }, workspaces: [], conversations: [summary] })
    expect(shown?.chat).toMatchObject({ conversation: 6, generation: 1, readOnly: true })
    expect(shown?.details?.hooked).toBe(true)
    expect(shown?.details?.hookProblem).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('provider'))
    warn.mockRestore()
  })
})

describe('the chat of a session on another machine', () => {
  const pane = { id: 7, agent: 'claude', process: 'claude', status: 'Idle', cwd: '/srv', summary: '', name: 'n', label: '', pinned: false, archived: false, branch: null, root: null, conversation_id: null, popup: false, remote: null }
  const snapshot = {
    terms: { '7': pane },
    workspaces: [],
    conversations: [{ id: 5, generation: 4, execution: 'Native', provider: 'Claude', cwd: '/srv', worktree: null, state: 'Running', status: 'Idle', native_term: 7, checks: [] }],
  }
  const key = conversationKey(3, 5) ?? -1

  beforeEach(() => {
    forgetMachines()
    registerMachine('build', 3)
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockReset().mockResolvedValue(null)
  })

  it('gets a chat link under a key that holds the machine, and lists no session of its own', () => {
    const [shown, ...others] = conversationsFromSnapshot(snapshot, { id: 3, name: 'build' })
    expect(others).toEqual([])
    expect(shown?.chat).toEqual({ conversation: key, generation: 4, readOnly: true, machine: 'build' })
    expect(key).not.toBe(5)
    expect(conversationsFromSnapshot(snapshot)[0]?.chat).toEqual({ conversation: 5, generation: 4, readOnly: true })
  })

  it('has "always in this project" remembered by its own machine, under its own number', async () => {
    await allowAlways({ id: String(key), generation: 4 }, 'req-1')
    expect(invoke).toHaveBeenCalledWith('allow_conversation_always', { id: 5, machine: 3, generation: 4, requestId: 'req-1' })
  })

  it('has a side question answered by its own machine, under its own number', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ Answered: { text: 'on track' } })
    await expect(sideAnswer(key, { question: 'where are we?' })).resolves.toEqual({ ok: true, text: 'on track' })
    expect(invoke).toHaveBeenCalledWith('side_answer', { id: 5, machine: 3, ask: { Question: 'where are we?' } })
  })

  it('is read, sent to and stopped on its own machine under its own number', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ conversation: 5, generation: 4, status: 'Idle', receipt: null, error: null, cancelling: false, history: { entries: [], next: null, completeness: 'Complete' }, checks: [], approvals: [] })
    vi.mocked(invoke).mockResolvedValueOnce({ conversation: 5, generation: 4, operation: 1 })
    await readConversationPage(key, null)
    await submitMessage({ id: String(key), generation: 4 }, 1, 'hello')
    await cancelTurn({ id: String(key), generation: 4 })
    const calls = vi.mocked(invoke).mock.calls
    expect(calls[0]?.[1]).toMatchObject({ id: 5, machine: 3 })
    expect(calls[1]).toEqual(['send_conversation', { id: 5, machine: 3, generation: 4, operation: 1, text: 'hello' }])
    expect(calls[2]).toEqual(['cancel_conversation', { id: 5, machine: 3, generation: 4 }])
  })

  it('asks this computer\'s daemon with no machine for a local chat, exactly as before', async () => {
    await cancelTurn({ id: '5', generation: 4 })
    expect(vi.mocked(invoke).mock.calls[0]).toEqual(['cancel_conversation', { id: 5, generation: 4 }])
  })

})

describe('names and closed sessions shared through the daemon', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockReset()
  })

  const summary = {
    id: 42,
    generation: 7,
    execution: 'Structured',
    provider: 'Codex',
    cwd: '/home/casey/sample',
    worktree: null,
    state: 'Running',
    status: 'Idle',
    native_term: null,
    checks: [],
  }

  it('shows the name any client gave a session, and its closed state', async () => {
    vi.mocked(invoke).mockResolvedValue({
      conversations: [{ ...summary, title: 'Fix the login bug', archived: true }],
      workspaces: [],
    })

    await expect(loadConversations()).resolves.toMatchObject([
      { id: '42', title: 'Fix the login bug', archived: true },
    ])
  })

  it('words an unnamed session itself and treats an older daemon as not closed', async () => {
    vi.mocked(invoke).mockResolvedValue({ conversations: [summary], workspaces: [] })

    await expect(loadConversations()).resolves.toMatchObject([
      { title: 'Codex conversation 42', archived: false },
    ])
  })

  it('sends a rename to the daemon rather than keeping it in the browser', async () => {
    vi.mocked(invoke).mockResolvedValue(null)

    await renameConversationOnDaemon({ id: '42' }, 'Fix the login bug')

    expect(invoke).toHaveBeenCalledExactlyOnceWith('rename_conversation', { id: 42, title: 'Fix the login bug' })
  })

  it('tells the daemon when a saved session was last used, so the chat\'s age counts from then', async () => {
    vi.mocked(invoke).mockResolvedValue(null)

    await conversationActiveAt('42', 1_780_000_000)

    expect(invoke).toHaveBeenCalledExactlyOnceWith('conversation_active_at', { id: 42, at: 1_780_000_000 })
  })

  it('reads the name an agent gave a chat to bring in, and none from a service that sends no name', async () => {
    vi.mocked(invoke).mockResolvedValue([
      { agent: 'claude', folder: '/code/app', saved: { id: 'a', first_message: 'Fix it', title: 'Login bug', last_active: 5 } },
      { agent: 'codex', folder: '/code/app', saved: { id: 'b', first_message: 'Add it', last_active: 4 } },
    ])

    const chats = await importableChats()

    expect(chats?.map((chat) => chat.saved.title ?? null)).toEqual(['Login bug', null])
  })

  it('names a chat of another machine on that machine', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockResolvedValue(null)
    registerMachine('build', 3)
    const chat = { id: 'build/c12', generation: 2 } as Conversation

    await renameConversationOnDaemon(chat, 'Fix the login bug')

    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['rename_conversation', { id: 12, machine: 3, title: 'Fix the login bug' }],
    ])
  })

  it('tells the daemon that runs a chat it was seen, on this computer or another', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockResolvedValue(null)
    registerMachine('build', 3)

    await markSeenOnDaemon({ id: '42' })
    await markSeenOnDaemon({ id: 'build/c12' })

    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['mark_conversation_seen', { id: 42 }],
      ['mark_conversation_seen', { id: 12, machine: 3 }],
    ])
  })
})

describe('terminal sessions shown beside chats', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockReset()
  })

  const term = (overrides: Record<string, unknown>) => ({
    id: 5,
    agent: 'claude',
    status: 'Working',
    cwd: '/home/casey/sample',
    root: null,
    branch: 'main',
    label: '',
    conversation_id: null,
    popup: false,
    remote: null,
    ...overrides,
  })

  it('remembers the revision and the sessions the daemon said left, until it lists one again', () => {
    conversationsFromSnapshot({ conversations: [], workspaces: [], terms: { '8': term({ id: 8 }) }, revision: 7, removed: { '3': 'Closed', '4': 'SomethingNewer' } })
    expect(localListRevision()).toBe(7)
    expect([daemonSaidRemoved('t3'), daemonSaidRemoved('t4'), daemonSaidRemoved('t8')]).toEqual([true, true, false])
    // Only a close or an exit says the session is over: a reason this build does not know may be one that keeps it running.
    expect([daemonSaidEnded('t3'), daemonSaidEnded('t4'), daemonSaidEnded('t8')]).toEqual([true, false, false])

    conversationsFromSnapshot({ conversations: [], workspaces: [], terms: { '3': term({ id: 3 }) } })
    expect(localListRevision()).toBe(0)
    expect([daemonSaidRemoved('t3'), daemonSaidRemoved('t4')]).toEqual([false, true])
  })

  it('keeps what another machine says left under that machine, never as this computer\'s', () => {
    conversationsFromSnapshot({ conversations: [], workspaces: [], terms: {}, revision: 7 })
    conversationsFromSnapshot({ conversations: [], workspaces: [], terms: {}, revision: 9, removed: { '11': 'Exited' } }, { id: 2, name: 'box' })
    expect([daemonSaidRemoved('box/t11'), daemonSaidRemoved('t11')]).toEqual([true, false])
    expect(localListRevision()).toBe(7)

    conversationsFromSnapshot({ conversations: [], workspaces: [], terms: { '11': term({ id: 11 }) } }, { id: 2, name: 'box' })
    expect(daemonSaidRemoved('box/t11')).toBe(false)
  })

  it('reads this computer\'s list for a check without taking it as the list the window last heard', async () => {
    conversationsFromSnapshot({ conversations: [], workspaces: [], terms: { '8': term({ id: 8 }) }, revision: 7 })
    vi.mocked(invoke).mockResolvedValueOnce({ conversations: [], workspaces: [], terms: { '12': term({ id: 12 }) }, revision: 30, removed: { '8': 'Closed' } })
    expect((await checkConversations()).map((item) => item.id)).toEqual(['t12'])
    expect(localListRevision()).toBe(7)
    expect(daemonSaidRemoved('t8')).toBe(false)
  })

  it('keeps a session in the list with its last good state when one refresh cannot read it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const snapshot = (terms: Record<string, unknown>) => ({ conversations: [], workspaces: [], terms })
    vi.mocked(invoke).mockResolvedValueOnce(snapshot({ '77': term({ id: 77, label: 'Server goodness' }) }))
    expect((await loadConversations()).map((item) => item.title)).toEqual(['Server goodness'])

    vi.mocked(invoke).mockResolvedValueOnce(snapshot({ '77': term({ id: 77, cwd: null }) }))
    expect((await loadConversations()).map((item) => item.title)).toEqual(['Server goodness'])
    expect(warn).toHaveBeenCalledTimes(1)

    vi.mocked(invoke).mockResolvedValueOnce(snapshot({}))
    expect(await loadConversations()).toEqual([])
    vi.mocked(invoke).mockResolvedValueOnce(snapshot({ '77': term({ id: 77, cwd: null }) }))
    expect(await loadConversations()).toEqual([])
    warn.mockRestore()
  })

  it('gives each agent session the plan limits its agent last reported, and none to a shell', async () => {
    vi.mocked(invoke).mockResolvedValue({
      conversations: [],
      workspaces: [],
      limits: [['claude', [{ name: '5h', used: 12.5, resets_at: 900 }, { name: 'week', used: 43, resets_at: 5000 }]]],
      terms: { '5': term({ id: 5, agent: 'claude' }), '6': term({ id: 6, agent: null }) },
    })

    const listed = await loadConversations()

    expect(listed.map((item) => item.details?.limits)).toEqual([
      [{ name: '5h', used: 12.5, resetsAt: 900 }, { name: 'week', used: 43, resetsAt: 5000 }],
      [],
    ])
  })

  it('gives a chat session its agent\'s plan limits too, so the status bar has them while only chats are open', async () => {
    const chat = { id: 40, generation: 1, execution: 'Structured', provider: 'Claude', cwd: '/srv', worktree: null, state: 'Running', status: 'Idle', native_term: null, checks: [] }
    vi.mocked(invoke).mockResolvedValue({ conversations: [chat], workspaces: [], limits: [['claude', [{ name: 'week', used: 65, resets_at: 5000 }]]], terms: {} })

    const listed = await loadConversations()

    expect(listed.map((item) => [item.process, item.details?.limits])).toEqual([['claude', [{ name: 'week', used: 65, resetsAt: 5000 }]]])
  })

  it('reads what set the status of a session, and nothing from a daemon that does not say', async () => {
    vi.mocked(invoke).mockResolvedValue({ conversations: [], workspaces: [], terms: { '5': term({ id: 5, status_why: 'hook: Stop' }), '6': term({ id: 6 }) } })

    const listed = await loadConversations()

    expect(listed.map((item) => item.details?.statusWhy)).toEqual(['hook: Stop', ''])
  })

  it('reads when a session stopped by its plan limit continues, and nothing from a daemon that does not say', async () => {
    vi.mocked(invoke).mockResolvedValue({ conversations: [], workspaces: [], terms: { '5': term({ id: 5, resume_at: 1_800_000_000 }), '6': term({ id: 6, resume_at: null }), '7': term({ id: 7 }) } })

    const listed = await loadConversations()

    expect(listed.map((item) => item.details?.resumeAt)).toEqual([1_800_000_000, null, null])
  })

  it('reads when a snooze ends, and nothing from a daemon that does not say', async () => {
    vi.mocked(invoke).mockResolvedValue({ conversations: [], workspaces: [], terms: { '5': term({ id: 5, snoozed_until: 1_800_000_000 }), '6': term({ id: 6, snoozed_until: null }), '7': term({ id: 7 }) } })

    const listed = await loadConversations()

    expect(listed.map((item) => item.details?.snoozedUntil)).toEqual([1_800_000_000, null, null])
  })

  it('still lists the sessions, without limits, when the limits cannot be read', async () => {
    vi.mocked(invoke).mockResolvedValue({ conversations: [], workspaces: [], limits: 'soon', terms: { '5': term({ id: 5, agent: 'claude' }) } })

    const listed = await loadConversations()

    expect(listed.map((item) => item.details?.limits)).toEqual([[]])
  })

  it('still lists the terminals when one chat record cannot be read', async () => {
    vi.mocked(invoke).mockResolvedValue({
      conversations: [{ id: 'not a conversation' }],
      workspaces: [],
      terms: { '5': term({ label: 'Fix login' }) },
    })

    const listed = await loadConversations()

    expect(listed.map((item) => item.title)).toEqual(['Fix login'])
  })

  it('keeps a session of this computer listed while ssh runs in it', async () => {
    vi.mocked(invoke).mockResolvedValue({
      conversations: [],
      workspaces: [],
      terms: { '8': term({ id: 8, agent: null, status: 'Idle', process: 'ssh', remote: 'build-box' }) },
    })

    const sessions = await loadConversations()

    expect(sessions.map((session) => session.id)).toEqual(['t8'])
    expect(sessions[0]).toMatchObject({ kind: 'terminal', nativePane: 8, title: 'Shell 8' })
  })

  it('lists an agent in a pane that also has ssh open like any other agent terminal', async () => {
    vi.mocked(invoke).mockResolvedValue({
      conversations: [],
      workspaces: [],
      terms: { '8': term({ id: 8, agent: 'claude', remote: 'build-box' }) },
    })

    const sessions = await loadConversations()

    expect(sessions).toMatchObject([{ id: 't8', kind: 'terminal', agent: 'claude', provider: 'Claude' }])
  })

  it('still leaves out a popup and a chat terminal while ssh runs in them', async () => {
    vi.mocked(invoke).mockResolvedValue({
      conversations: [],
      workspaces: [],
      terms: {
        '7': term({ id: 7, popup: true, remote: 'build-box' }),
        '9': term({ id: 9, conversation_id: 3, remote: 'build-box' }),
      },
    })

    expect(await loadConversations()).toEqual([])
  })

  it('lists shells and agents in terminals of their own, and leaves out popups and a chat terminal', async () => {
    vi.mocked(invoke).mockResolvedValue({
      conversations: [],
      workspaces: [],
      terms: {
        '5': term({ label: 'Fix login' }),
        '6': term({ id: 6, agent: null, status: 'Idle' }),
        '7': term({ id: 7, popup: true }),
        '9': term({ id: 9, conversation_id: 3 }),
        '10': term({ id: 10, agent: 'gemini' }),
        '11': { nonsense: true },
      },
    })

    const sessions = await loadConversations()

    expect(sessions.map((session) => session.id)).toEqual(['t5', 't6', 't10'])
    expect(sessions[0]).toMatchObject({
      id: 't5',
      kind: 'terminal',
      title: 'Fix login',
      provider: 'Claude',
      status: 'working',
      nativePane: 5,
      named: true,
      agent: 'claude',
    })
    expect(sessions[1]).toMatchObject({ id: 't6', title: 'Shell 6', agent: null, status: 'idle', named: false })
    expect(sessions[2]).toMatchObject({ id: 't10', agent: 'gemini' })
  })

  it('links a terminal to the daemon conversation whose native terminal it is, and only on this computer', async () => {
    const summary = (overrides: Record<string, unknown>) => ({ id: 40, generation: 3, execution: 'Native', provider: 'Claude', cwd: '/home/casey/sample', worktree: null, state: 'Running', status: 'Idle', native_term: null, checks: [], ...overrides })
    vi.mocked(invoke).mockResolvedValue({
      conversations: [summary({ id: 40, generation: 3, native_term: 5 }), summary({ id: 41, native_term: null })],
      workspaces: [],
      terms: { '5': term({}), '6': term({ id: 6, agent: null }) },
    })

    const sessions = await loadConversations()

    // A followed agent's chat only shows what it did (ADR 0003), so the link says it cannot send.
    expect(sessions.find((session) => session.id === 't5')?.chat).toEqual({ conversation: 40, generation: 3, readOnly: true })
    expect(sessions.find((session) => session.id === 't6')?.chat).toBeUndefined()
  })

  it('does not list a pane\'s conversation as a session of its own, but keeps one whose pane is not listed', async () => {
    const summary = (overrides: Record<string, unknown>) => ({ id: 40, generation: 3, execution: 'Native', provider: 'Claude', cwd: '/home/casey/sample', worktree: null, state: 'Running', status: 'Idle', native_term: null, checks: [], ...overrides })
    vi.mocked(invoke).mockResolvedValue({
      conversations: [summary({ id: 40, native_term: 5 }), summary({ id: 41, native_term: 9 }), summary({ id: 42, execution: 'Structured', native_term: null })],
      workspaces: [],
      terms: { '5': term({}), '9': term({ id: 9, conversation_id: 41 }) },
    })

    const sessions = await loadConversations()

    expect(sessions.map((session) => session.id)).toEqual(['41', '42', 't5'])
  })

  it('reads, types into, resizes and names a terminal session by its pane number', async () => {
    vi.mocked(invoke).mockResolvedValue(null)
    const target = { id: 't5', generation: 0 }

    vi.mocked(invoke).mockResolvedValueOnce('screen')
    await expect(loadTerminalScreen(target)).resolves.toBe('screen')
    vi.mocked(invoke).mockResolvedValueOnce(Uint8Array.from([1, 2]).buffer)
    await expect(loadTerminalReplay(target)).resolves.toEqual(Uint8Array.from([1, 2]))
    await sendTerminalInput(target, 'ls\r')
    await resizeTerminal(target, 100, 30)
    await renameConversationOnDaemon({ id: 't5' }, 'Fix login')

    expect(vi.mocked(invoke).mock.calls.map(([name, args]) => [name, args])).toEqual([
      ['pane_terminal_screen', { term: 5 }],
      ['pane_terminal_replay', { term: 5 }],
      ['terminal_input', { term: 5, data: [108, 115, 13] }],
      ['pane_terminal_resize', { term: 5, cols: 100, rows: 30 }],
      ['rename_terminal_session', { term: 5, name: 'Fix login' }],
    ])
  })
})

describe('machines', () => {
  it('lists the machine names the host read, and nothing about where they point', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockReset().mockResolvedValue({ names: ['build', 'box'], error: null })
    expect(await loadMachines()).toEqual({ names: ['build', 'box'], error: null })
    expect(invoke).toHaveBeenCalledWith('list_machines', undefined)
  })

  it('carries the host\'s error for a bad machine file', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockReset().mockResolvedValue({ names: [], error: '[[machines]] #1: bad name' })
    expect((await loadMachines()).error).toBe('[[machines]] #1: bad name')
  })

  it('has no machines in a plain browser', async () => {
    vi.mocked(isTauri).mockReturnValue(false)
    vi.mocked(invoke).mockReset()
    expect(await loadMachines()).toEqual({ names: [], error: null })
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('commands for a pane, on whichever machine it is', () => {
  const pane = { id: 't7', generation: 0 }
  const there = { id: 'build/t7', generation: 0 }

  beforeEach(() => {
    forgetMachines()
    registerMachine('build', 3)
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockReset().mockResolvedValue(null)
  })

  it('asks the host about a pane of this computer exactly as before machines', async () => {
    await sendTerminalInput(pane, 'ls')
    await resizeTerminal(pane, 100, 30)
    await renameConversationOnDaemon(pane, 'api')
    await markSeenOnDaemon(pane)
    await reloadAgentOnDaemon(pane)
    await closeSession(pane)
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['terminal_input', { term: 7, data: [108, 115] }],
      ['pane_terminal_resize', { term: 7, cols: 100, rows: 30 }],
      ['rename_terminal_session', { term: 7, name: 'api' }],
      ['mark_terminal_seen', { term: 7 }],
      ['reload_terminal_session', { term: 7 }],
      ['close_session_with_undo', { term: 7 }],
    ])
  })

  it('names the machine to the host for a pane of another, and nothing else about the call changes', async () => {
    await sendTerminalInput(there, 'ls')
    await resizeTerminal(there, 100, 30)
    await renameConversationOnDaemon(there, 'api')
    await markSeenOnDaemon(there)
    await reloadAgentOnDaemon(there)
    await closeSession(there)
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['terminal_input', { term: 7, data: [108, 115], machine: 3 }],
      ['pane_terminal_resize', { term: 7, cols: 100, rows: 30, machine: 3 }],
      ['rename_terminal_session', { term: 7, name: 'api', machine: 3 }],
      ['mark_terminal_seen', { term: 7, machine: 3 }],
      ['reload_terminal_session', { term: 7, machine: 3 }],
      ['close_session_with_undo', { term: 7, machine: 3 }],
    ])
  })

  it('sends nothing for a machine the host has not told it of', async () => {
    forgetMachines()
    await expect(sendTerminalInput(there, 'ls')).rejects.toThrow('build is not one of this computer\'s machines')
    await expect(markSeenOnDaemon(there)).rejects.toThrow('build is not one of this computer\'s machines')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not ask this computer\'s daemon for the screen or replay of another machine\'s pane', async () => {
    await expect(loadTerminalScreen(there)).rejects.toThrow('The screen text is local-only in v1: the files are on build, not on this computer.')
    await expect(loadTerminalReplay(there)).rejects.toThrow('A fresh replay is local-only in v1: the files are on build, not on this computer.')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('takes whether a chat steers from the daemon, and says nothing where the daemon did not', () => {
    const chat = (id: number, more: Record<string, unknown>) => ({ id, generation: 1, execution: 'Structured', provider: 'Codex', cwd: '/srv', worktree: null, state: 'Running', status: 'Idle', native_term: null, checks: [], ...more })
    const snapshot = {
      terms: {},
      workspaces: [],
      conversations: [chat(1, { capabilities: { steer: true, resume: true, verified: 'Pinned' } }), chat(2, { capabilities: { steer: false } }), chat(3, {}), chat(4, { capabilities: 'something newer' })],
    }

    const listed = conversationsFromSnapshot(snapshot)

    expect(listed.map((item) => item.chat?.steers)).toEqual([true, false, undefined, undefined])
  })

  it('reads a chat run over ACP as its agent\'s, and marks it so the chat offers no picker', () => {
    const chat = (id: number, more: Record<string, unknown>) => ({ id, generation: 1, execution: 'Structured', provider: 'Acp', cwd: '/srv', worktree: null, state: 'Running', status: 'Idle', native_term: null, checks: [], ...more })
    const snapshot = { terms: {}, workspaces: [], conversations: [chat(1, { agent: 'claude' }), chat(2, { agent: 'gemini' }), { ...chat(3, {}), provider: 'Codex' }] }

    const listed = conversationsFromSnapshot(snapshot)

    expect(listed.map((item) => [item.agent, item.chat?.acp, item.title])).toEqual([
      ['claude', true, 'Claude conversation 1'],
      ['gemini', true, 'Gemini conversation 2'],
      ['codex', undefined, 'Codex conversation 3'],
    ])
  })

  it('lists the terminals of another machine and the chats its daemon started, with ids that name it', () => {
    const snapshot = {
      terms: { '7': { id: 7, agent: null, process: 'bash', status: 'Idle', cwd: '/srv', summary: '', name: 'n', label: '', pinned: false, archived: false, branch: null, root: null, conversation_id: null, popup: false, remote: null } },
      workspaces: [],
      conversations: [
        { id: 5, generation: 1, execution: 'Structured', provider: 'Claude', cwd: '/srv', worktree: null, state: 'Running', status: 'Idle', native_term: null, checks: [] },
        // A conversation that follows an agent in a pane this list does not show is no session of its own there.
        { id: 6, generation: 1, execution: 'Native', provider: 'Claude', cwd: '/srv', worktree: null, state: 'Running', status: 'Idle', native_term: 99, checks: [] },
      ],
    }
    const listed = conversationsFromSnapshot(snapshot, { id: 3, name: 'build' })
    expect(listed.map((item) => item.id)).toEqual(['build/c5', 'build/t7'])
    // The chat's feed and sends are kept under a key that holds the machine: 3 above 32 bits, conversation 5 below.
    expect(listed[0]).toMatchObject({ machine: 3, machineName: 'build', chat: { conversation: 3 * 4_294_967_296 + 5, generation: 1, machine: 'build' } })
    expect(conversationsFromSnapshot(snapshot).map((item) => item.id)).toEqual(['5', '6', 't7'])
  })

  it('lists a session on another machine once, beside a session of this computer that has ssh open to it', () => {
    const shell = (id: number, remote: string | null) => ({ id, agent: null, process: remote === null ? 'bash' : 'ssh', status: 'Idle', cwd: '/srv', summary: '', name: 'n', label: '', pinned: false, archived: false, branch: null, root: null, conversation_id: null, popup: false, remote })
    const here = conversationsFromSnapshot({ terms: { '8': shell(8, 'build') }, workspaces: [], conversations: [] })
    const onBuild = conversationsFromSnapshot({ terms: { '7': shell(7, null) }, workspaces: [], conversations: [] }, { id: 3, name: 'build' })

    expect(here.map((item) => item.id)).toEqual(['t8'])
    expect(onBuild.map((item) => item.id)).toEqual(['build/t7'])
    const ids = [...here, ...onBuild].map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('lists a session of another machine while ssh runs in it there', () => {
    const snapshot = {
      terms: { '9': { id: 9, agent: null, process: 'ssh', status: 'Idle', cwd: '/srv', summary: '', name: 'n', label: '', pinned: false, archived: false, branch: null, root: null, conversation_id: null, popup: false, remote: 'far-box' } },
      workspaces: [],
      conversations: [],
    }

    expect(conversationsFromSnapshot(snapshot, { id: 3, name: 'build' }).map((item) => item.id)).toEqual(['build/t9'])
  })
})
