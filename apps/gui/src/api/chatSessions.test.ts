import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { answerHelpers, chatInWorktree, conversationsFromSnapshot, resumeChatSession, startChatSession } from './daemon'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}))

// Chat sessions (ADR 0003): structured conversations the daemon owns, listed beside terminal sessions.
describe('chat sessions', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockReset().mockImplementation((command) => Promise.resolve(command === 'start_chat_session' || command === 'resume_chat_session' ? { id: 44, generation: 1 } : null))
  })

  const summary = (extra: Record<string, unknown> = {}) => ({
    id: 44, generation: 1, execution: 'Structured', provider: 'Claude', cwd: '/work/app-trees/agent-x', worktree: null, state: 'Running', status: 'Working',
    native_term: null, checks: [], title: null, archived: false, root: '/work/app', branch: 'agent/x', ...extra,
  })
  const snapshot = (conversations: unknown[]) => ({ terms: {}, workspaces: [], conversations })

  it('starts a chat session that asks first, unless full access is requested', async () => {
    await expect(startChatSession('/work/app', 'claude')).resolves.toEqual({ id: 44, generation: 1 })
    await startChatSession('/work/app', 'codex', 'agent/x')
    await startChatSession('/work/app', 'claude', null, 'full-access')
    await startChatSession('/work/app', 'codex', null, 'read-only')
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['start_chat_session', { cwd: '/work/app', provider: 'Claude', branch: null, permissions: 'workspace-write' }],
      ['start_chat_session', { cwd: '/work/app', provider: 'Codex', branch: 'agent/x', permissions: 'workspace-write' }],
      ['start_chat_session', { cwd: '/work/app', provider: 'Claude', branch: null, permissions: 'full-access' }],
      ['start_chat_session', { cwd: '/work/app', provider: 'Codex', branch: null, permissions: 'read-only' }],
    ])
  })

  it('opens a saved conversation as a chat by the name its agent gave it', async () => {
    await expect(resumeChatSession('/work/app', 'codex', 'saved-1', 'read-only')).resolves.toEqual({ id: 44, generation: 1 })

    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['resume_chat_session', { cwd: '/work/app', provider: 'Codex', session: 'saved-1', permissions: 'read-only' }],
    ])
  })

  it("lists the helpers a chat session's provider started as its subagents, and none from an older daemon", () => {
    const helper = { id: 'helper-thread', name: 'probe_helper', parent: null, state: 'Completed', task: 'probe_helper', model: 'gpt-a', effort: 'low', started_at: 1, updated_at: 2, latest_activity: null, result: 'pong' }
    const [chat] = conversationsFromSnapshot(snapshot([summary({ helpers: [helper] })]))
    expect(chat?.details?.subagents).toEqual([{ id: 'helper-thread', name: 'probe_helper', state: 'Completed', task: 'probe_helper', startedAt: 1, updatedAt: 2, latest: null, result: 'pong' }])
    const [older] = conversationsFromSnapshot(snapshot([summary()]))
    expect(older?.details?.subagents).toEqual([])
  })

  it('lists a structured conversation as a chat session in its project, with a chat that can be written to', () => {
    const [chat] = conversationsFromSnapshot(snapshot([summary()]))
    expect(chat).toMatchObject({
      id: '44', execution: 'Structured', agent: 'claude', process: 'claude', status: 'working',
      folder: '/work/app', cwd: '/work/app-trees/agent-x', repo: 'app', branch: 'agent/x',
      chat: { conversation: 44, generation: 1 },
    })
    expect(chat?.kind).toBeUndefined()
    expect(chat?.chat).not.toHaveProperty('readOnly')
  })

  it('keeps the agent conversation a chat resumes by, and none from an older daemon', () => {
    const [chat] = conversationsFromSnapshot(snapshot([summary({ session: 'claude-44' })]))
    expect(chat?.chat?.session).toBe('claude-44')
    const [older] = conversationsFromSnapshot(snapshot([summary()]))
    expect(older?.chat).not.toHaveProperty('session')
  })

  it('does not mistake the chat that follows a terminal pane for a chat session', () => {
    const term = { id: 7, agent: 'claude', process: 'claude', status: 'Working', cwd: '/srv', summary: '', name: 'n', label: '', pinned: false, archived: false, branch: null, root: null, conversation_id: null, popup: false, remote: null }
    const followed = summary({ id: 9, execution: 'Native', native_term: 7 })
    const listed = conversationsFromSnapshot({ terms: { '7': term }, workspaces: [], conversations: [followed] })
    expect(listed.map((item) => item.id)).toEqual(['t7'])
    expect(listed[0]?.chat).toEqual({ conversation: 9, generation: 1, readOnly: true })
  })

  it('keeps the pane that started a session as that session\'s id, on this computer and on another machine, and none from an older daemon', () => {
    const term = (id: number, extra: Record<string, unknown> = {}) => ({ id, agent: 'claude', process: 'claude', status: 'Working', cwd: '/srv', summary: '', name: 'n', label: '', pinned: false, archived: false, branch: null, root: null, conversation_id: null, popup: false, remote: null, ...extra })
    const terms = { '7': term(7), '8': term(8, { started_by: 7 }) }
    const here = conversationsFromSnapshot({ terms, workspaces: [], conversations: [] })
    expect(here.map((item) => [item.id, item.details?.startedBy])).toEqual([['t7', null], ['t8', 't7']])
    const there = conversationsFromSnapshot({ terms, workspaces: [], conversations: [] }, { id: 4, name: 'build' })
    expect(there.map((item) => [item.id, item.details?.startedBy])).toEqual([['build/t7', null], ['build/t8', 'build/t7']])
  })

  it('lists what a chat asked to start helpers for, names the chat on a helper it started, and reads neither from an older daemon', () => {
    const term = (id: number, extra: Record<string, unknown> = {}) => ({ id, agent: 'claude', process: 'claude', status: 'Working', cwd: '/srv', summary: '', name: 'n', label: '', pinned: false, archived: false, branch: null, root: null, conversation_id: null, popup: false, remote: null, ...extra })
    const asking = summary({ helper_ask: ['Review the diff', 'Write the tests'] })
    const [chat, helper, stranger] = conversationsFromSnapshot({ terms: { '8': term(8, { started_by_chat: 44 }), '9': term(9, { started_by_chat: 404 }) }, workspaces: [], conversations: [asking] })
    expect(chat?.details?.helperAsk).toEqual(['Review the diff', 'Write the tests'])
    expect([helper?.id, helper?.details?.startedBy]).toEqual(['t8', '44'])
    // A chat this list does not hold started nothing that can be shown as its helper.
    expect(stranger?.details?.startedBy).toBeNull()
    const [older] = conversationsFromSnapshot(snapshot([summary()]))
    expect(older?.details?.helperAsk).toEqual([])
  })

  it('lists a chat a restart left asleep as idle, one it cut as needing recovery and cut off, and none cut from an older daemon', () => {
    const [asleep, cut, older] = conversationsFromSnapshot(snapshot([
      summary({ id: 44, state: 'RecoveryRequired', status: 'Idle' }),
      summary({ id: 45, state: 'RecoveryRequired', status: 'Blocked', interrupted: true }),
      summary({ id: 46, state: 'RecoveryRequired', status: 'Blocked' }),
    ]))
    expect([asleep?.status, asleep?.details?.chatCutOff]).toEqual(['idle', false])
    expect([cut?.status, cut?.details?.chatCutOff]).toEqual(['recovery', true])
    expect([older?.status, older?.details?.chatCutOff]).toEqual(['recovery', false])
    // Asleep, it says it is waking once opened; a cut one waits for the person instead.
    expect([asleep?.chat?.waking, cut?.chat?.waking, older?.chat?.waking]).toEqual([true, undefined, undefined])
  })

  it('says an existing chat is waking while it starts again, and not a running one', () => {
    const [starting, running] = conversationsFromSnapshot(snapshot([summary({ id: 44, state: 'Stopped', status: 'Working' }), summary({ id: 45 })]))
    expect([starting?.chat?.waking, running?.chat?.waking]).toEqual([true, undefined])
  })

  it('gives a chat the time its status changed, and none from an older daemon', () => {
    const [chat] = conversationsFromSnapshot(snapshot([summary({ status_since: 1_780_000_000 })]))
    expect(chat?.details?.since).toBe(1_780_000_000)
    const [older] = conversationsFromSnapshot(snapshot([summary()]))
    expect(older?.details?.since).toBe(0)
  })

  it('names the pane of a chat that has one as the starter of that chat\'s helper', () => {
    const term = (id: number, extra: Record<string, unknown> = {}) => ({ id, agent: 'claude', process: 'claude', status: 'Working', cwd: '/srv', summary: '', name: 'n', label: '', pinned: false, archived: false, branch: null, root: null, conversation_id: null, popup: false, remote: null, ...extra })
    const followed = summary({ id: 9, execution: 'Native', native_term: 7 })
    const listed = conversationsFromSnapshot({ terms: { '7': term(7), '8': term(8, { started_by_chat: 9 }) }, workspaces: [], conversations: [followed] })
    expect(listed.map((item) => [item.id, item.details?.startedBy])).toEqual([['t7', null], ['t8', 't7']])
  })

  it('answers a chat\'s helper request as the chat, and a pane\'s as the pane', async () => {
    await answerHelpers({ id: '44' }, 'always')
    await answerHelpers({ id: 't7' }, 'no')
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['answer_chat_helpers', { id: 44, choice: 'always' }],
      ['answer_helpers', expect.objectContaining({ term: 7, choice: 'no' })],
    ])
  })

  it('reads a summary from before the repository and branch were named', () => {
    const old = Object.fromEntries(Object.entries(summary()).filter(([key]) => key !== 'root' && key !== 'branch'))
    const [chat] = conversationsFromSnapshot(snapshot([old]))
    expect(chat).toMatchObject({ folder: '/work/app-trees/agent-x', repo: null })
  })

})

describe('chatInWorktree', () => {
  it('is a worktree when the daemon names one or the folder is outside the main checkout', () => {
    expect(chatInWorktree('/home/me/.maiker/worktrees/shop/keen-otter', '/home/me/dev/shop', null)).toBe(true)
    expect(chatInWorktree('/home/me/dev/shop', '/home/me/dev/shop', '/home/me/dev/shop-wt')).toBe(true)
  })

  it('is not one in the main checkout, a subfolder of it, or outside git', () => {
    expect(chatInWorktree('/home/me/dev/shop/', '/home/me/dev/shop', null)).toBe(false)
    expect(chatInWorktree('/home/me/dev/shop/web', '/home/me/dev/shop', null)).toBe(false)
    expect(chatInWorktree('C:\\dev\\shop\\web', 'C:\\dev\\shop', null)).toBe(false)
    expect(chatInWorktree('/home/me/notes', null, null)).toBe(false)
  })
})
