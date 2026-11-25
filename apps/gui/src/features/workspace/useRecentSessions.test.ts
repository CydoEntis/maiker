import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readyClosedFolder, reopenClosedSession, type ClosedSession } from '@/api/daemon'
import { toast } from '@/lib/toast'
import type { NewChatRequest, NewChatStartOptions } from './components/NewChatPage'
import { useRecentSessions } from './useRecentSessions'

vi.mock('@/lib/toast', () => ({ toast: { failed: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('@/api/daemon', () => ({ readyClosedFolder: vi.fn(), reopenClosedSession: vi.fn(), closedSessions: vi.fn() }))

beforeEach(() => { vi.clearAllMocks() })

const parser: ClosedSession = { agent: 'claude', session: 'abc-123', cwd: '/dev/app', branch: null, title: 'Fix the parser', at: 1, folder_present: true, worktree: null, repo: null }

function listOpen(starting: boolean) {
  const startNewChat = vi.fn(() => Promise.resolve())
  const hook = renderHook(() => useRecentSessions(startNewChat, starting, false))
  act(() => { hook.result.current.setRecentOpen(true) })
  return { hook, startNewChat }
}

describe('reopening from Recent sessions', () => {
  it('closes the list and starts the session', () => {
    const { hook, startNewChat } = listOpen(false)
    act(() => { hook.result.current.reopenSession(parser) })
    expect(startNewChat).toHaveBeenCalledWith(expect.objectContaining({ folder: '/dev/app', resume: 'abc-123' }))
    expect(hook.result.current.recentOpen).toBe(false)
  })

  it('says so, and keeps the list open, while another session is starting', () => {
    const { hook, startNewChat } = listOpen(true)
    act(() => { hook.result.current.reopenSession(parser) })
    expect(startNewChat).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalledWith('A session is already starting')
    expect(hook.result.current.recentOpen).toBe(true)
  })
})

describe('opening a project’s saved sessions', () => {
  type Start = (request: NewChatRequest, options?: NewChatStartOptions) => Promise<void>
  const saved = (over: Partial<ClosedSession>): ClosedSession => ({ ...parser, ...over })
  const removed = (over: Partial<ClosedSession> = {}) => saved({ folder_present: false, cwd: '/dev/app-wt', ...over })
  const remakeable = { worktree: '/dev/app-wt', repo: '/dev/app', branch: 'feat/parser' }

  function opener(starting = false, startNewChat = vi.fn<Start>(() => Promise.resolve()), chatView = true) {
    const hook = renderHook(() => useRecentSessions(startNewChat, starting, chatView))
    return { hook, startNewChat }
  }

  it('starts them in the background one after another, and counts the one that failed', async () => {
    let finishFirst: () => void = () => undefined
    const startNewChat = vi.fn<Start>()
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
      .mockImplementationOnce(() => Promise.reject(new Error('it is busy')))
      .mockImplementationOnce(() => Promise.resolve())
    const { hook } = opener(false, startNewChat)
    act(() => { hook.result.current.openSaved([parser, saved({ session: 'def-456' }), saved({ session: 'ghi-789' })], 'shop') })
    expect(hook.result.current.opening).toBe(true)
    expect(startNewChat).toHaveBeenCalledTimes(1)
    expect(startNewChat).toHaveBeenCalledWith(expect.objectContaining({ folder: '/dev/app', resume: 'abc-123' }), { background: true })

    act(() => { finishFirst() })
    await waitFor(() => { expect(hook.result.current.opening).toBe(false) })
    expect(startNewChat).toHaveBeenCalledTimes(3)
    expect(toast.failed).toHaveBeenCalledWith('Opened 2, but 1 could not start', expect.objectContaining({ message: 'it is busy' }), { context: 'shop' })
  })

  it('has the service make a removed worktree again and starts it there, and skips one it cannot make, saying why', async () => {
    vi.mocked(readyClosedFolder).mockResolvedValue('/dev/app-wt')
    const { hook, startNewChat } = opener()
    act(() => { hook.result.current.openSaved([removed(remakeable), removed()], 'shop') })
    await waitFor(() => { expect(toast.warning).toHaveBeenCalledWith('Opened 1 session, skipped 1', { context: 'shop', description: 'Skipped “Fix the parser”: folder removed; cannot be made again.' }) })
    expect(readyClosedFolder).toHaveBeenCalledWith('claude', 'abc-123')
    // Started like any resume, so it opens as a chat or in its terminal as Settings says, never by the service itself.
    expect(startNewChat).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', folder: '/dev/app-wt', resume: 'abc-123' }), { background: true })
    expect(reopenClosedSession).not.toHaveBeenCalled()
  })

  it('has an older service, which cannot only make the folder, reopen a removed worktree itself', async () => {
    vi.mocked(readyClosedFolder).mockResolvedValue(null)
    vi.mocked(reopenClosedSession).mockResolvedValue(true)
    const { hook, startNewChat } = opener()
    act(() => { hook.result.current.openSaved([removed(remakeable)], 'shop') })
    await waitFor(() => { expect(toast.success).toHaveBeenCalledWith('Opened 1 session', { context: 'shop' }) })
    expect(reopenClosedSession).toHaveBeenCalledWith('claude', 'abc-123')
    expect(startNewChat).not.toHaveBeenCalled()
  })

  it('loads a chat saved under its ACP agent’s own name by its id, in the folder the service makes again', async () => {
    vi.mocked(readyClosedFolder).mockResolvedValue('/dev/app-wt')
    const { hook, startNewChat } = opener()
    act(() => { hook.result.current.openSaved([saved({ agent: 'opencode', session: 'ses_1' }), removed({ agent: 'opencode', session: 'ses_2', ...remakeable })], 'shop') })
    await waitFor(() => { expect(toast.success).toHaveBeenCalledWith('Opened 2 sessions', { context: 'shop' }) })
    expect(startNewChat).toHaveBeenNthCalledWith(1, expect.objectContaining({ acp: 'opencode', folder: '/dev/app', resume: 'ses_1', name: 'Fix the parser' }), { background: true })
    expect(startNewChat).toHaveBeenNthCalledWith(2, expect.objectContaining({ acp: 'opencode', folder: '/dev/app-wt', resume: 'ses_2' }), { background: true })
    expect(readyClosedFolder).toHaveBeenCalledWith('opencode', 'ses_2')
  })

  it('starts a new chat with that agent, and says so, when it cannot load its conversation', async () => {
    const startNewChat = vi.fn<Start>((request) => (request.resume === null ? Promise.resolve() : Promise.reject(new Error('The agent did not continue the saved conversation'))))
    const { hook } = opener(false, startNewChat)
    act(() => { hook.result.current.openSaved([saved({ agent: 'opencode', session: 'ses_1' })], 'shop') })
    await waitFor(() => { expect(toast.warning).toHaveBeenCalledWith('Opened 1 session, 1 as a new conversation', { context: 'shop', description: '“Fix the parser” started a new conversation: The agent did not continue the saved conversation.' }) })
    expect(startNewChat).toHaveBeenLastCalledWith(expect.objectContaining({ acp: 'opencode', resume: null }), { background: true })
  })

  it('skips a chat over ACP in the Terminal view, saying why, since its agent runs only in the Chat view', async () => {
    const { hook, startNewChat } = opener(false, undefined, false)
    act(() => { hook.result.current.openSaved([saved({ agent: 'opencode' })], 'shop') })
    await waitFor(() => { expect(toast.warning).toHaveBeenCalledWith('Could not open 1 session', expect.objectContaining({ description: 'Skipped “Fix the parser”: its agent runs only in the Chat view.' })) })
    expect(startNewChat).not.toHaveBeenCalled()
  })

  it('starts Gemini in its terminal with a new conversation, and says so', async () => {
    const { hook, startNewChat } = opener()
    act(() => { hook.result.current.openSaved([saved({ agent: 'gemini' })], 'shop') })
    await waitFor(() => { expect(toast.warning).toHaveBeenCalledWith('Opened 1 session, 1 as a new conversation', { context: 'shop', description: '“Fix the parser” started a new conversation: Gemini cannot continue a conversation from here.' }) })
    expect(startNewChat).toHaveBeenCalledWith(expect.objectContaining({ agent: 'gemini', folder: '/dev/app', resume: null }), { background: true, terminal: true })
  })

  it('skips a chat whose agent the record does not name', async () => {
    const { hook, startNewChat } = opener()
    act(() => { hook.result.current.openSaved([saved({ agent: 'acp' })], 'shop') })
    await waitFor(() => { expect(toast.warning).toHaveBeenCalledWith('Could not open 1 session', expect.objectContaining({ description: 'Skipped “Fix the parser”: cannot be reopened here.' })) })
    expect(startNewChat).not.toHaveBeenCalled()
  })

  it('starts nothing, and says so, while another session is starting', () => {
    const { hook, startNewChat } = opener(true)
    act(() => { hook.result.current.openSaved([parser], 'shop') })
    expect(startNewChat).not.toHaveBeenCalled()
    expect(hook.result.current.opening).toBe(false)
    expect(toast.info).toHaveBeenCalledWith('A session is already starting')
  })
})
