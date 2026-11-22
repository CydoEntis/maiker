import { act, renderHook } from '@testing-library/react'
import { useMemo, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { daemonSaidEnded } from '@/api/daemon'
import { type AgentTerminals, liveAgentTerminals, ownedTerminalIds } from '@/data/agentTerminals'
import type { Conversation } from '@/data/preview'
import { toast } from '@/lib/toast'
import { type Layout, openArrangement } from './model/layout'
import { toSessionView, type SessionView } from './model/session'
import { writeSessionSplits } from './model/splitStorage'
import { AGENT_LEAF, leavesOf, MAX_SESSION_PANES, splitLeaf, UNSPLIT } from './model/splitTree'
import { useSessionSplits, useSplitStore } from './useSessionSplits'

vi.mock('@/api/daemon', () => ({ daemonSaidEnded: vi.fn(() => false) }))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), failed: vi.fn() } }))

const HOME = '/home/me'
const shell = (pane: number, extra: Partial<Conversation> = {}): SessionView => toSessionView({ id: `t${String(pane)}`, generation: 0, kind: 'terminal', title: 'shop', named: false, project: '', folder: `${HOME}/shop`, cwd: `${HOME}/shop`, repo: 'shop', branch: 'main', provider: 'Codex', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: pane, hasDiff: false, agent: null, ...extra }, HOME)

const makeIds = () => { let next = 0; return (prefix: string) => `${prefix}${String(next++)}` }
const showing = (sessionId: string): Layout => openArrangement({ arrangements: [], activeId: null }, sessionId, makeIds())

type Setup = { sessions: SessionView[]; known?: AgentTerminals; listed?: boolean; chat?: boolean; nextShell?: string }

function setup(first: Setup) {
  const started: string[] = []
  const endSessions = vi.fn()
  const closeAgentTerminals = vi.fn<(ids: string[], name: string, after?: () => void) => void>()
  const hook = renderHook((props: Setup) => {
    const [known, setKnown] = useState<AgentTerminals>(first.known ?? new Map())
    const [layout, setLayout] = useState(() => showing(first.sessions[0]?.id ?? ''))
    const store = useSplitStore()
    const sessionMap = useMemo(() => new Map(props.sessions.map((session) => [session.id, session])), [props.sessions])
    const ownedShells = useMemo(() => liveAgentTerminals(known, new Set(sessionMap.keys())), [known, sessionMap])
    const splits = useSessionSplits({
      ...store, ownedShells, knownTerminals: known, setAgentTerminals: setKnown, sessionMap, layout, setLayout,
      shownAsTerminal: () => props.chat !== true, online: true, listed: props.listed ?? true,
      runStart: async (folder, place) => { started.push(await folder()); if (props.nextShell !== undefined) place(props.nextShell); return true },
      closeAgentTerminals, endSessions,
    })
    return { ...splits, known, ownedShells, saved: store.savedSplits }
  }, { initialProps: first })
  return { ...hook, started, endSessions, closeAgentTerminals }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(daemonSaidEnded).mockReturnValue(false)
})

describe('splitting a session', () => {
  it('starts a shell in the session’s folder and keeps it as the session’s own, in its tree', async () => {
    const owner = shell(2)
    const { result, rerender, started } = setup({ sessions: [owner], nextShell: 't7' })

    await act(async () => { result.current.split(null, 'right'); await Promise.resolve() })
    rerender({ sessions: [owner, shell(7)] })

    expect(started).toEqual([`${HOME}/shop`])
    expect(result.current.known.get('t2')).toEqual(['t7'])
    expect([...ownedTerminalIds(result.current.ownedShells)]).toEqual(['t7'])
    const splits = result.current.splitsOf(owner)
    expect(leavesOf(splits.tree)).toEqual([AGENT_LEAF, 't7'])
    expect(splits.focus).toBe('t7')
  })

  it('halves the pane it was asked to, and the one with the focus when none was named', async () => {
    const owner = shell(2)
    const { result, rerender } = setup({ sessions: [owner], nextShell: 't7' })
    await act(async () => { result.current.split(null, 'right'); await Promise.resolve() })
    rerender({ sessions: [owner, shell(7)], nextShell: 't8' })
    await act(async () => { result.current.split(null, 'down', AGENT_LEAF); await Promise.resolve() })
    rerender({ sessions: [owner, shell(7), shell(8)], nextShell: 't9' })
    await act(async () => { result.current.split(null, 'down'); await Promise.resolve() })
    rerender({ sessions: [owner, shell(7), shell(8), shell(9)] })

    expect(leavesOf(result.current.splitsOf(owner).tree)).toEqual([AGENT_LEAF, 't8', 't9', 't7'])
  })

  it('shows no splits and starts none where the session is a chat', async () => {
    const owner = shell(2)
    writeSessionSplits(new Map([['t2', splitLeaf(UNSPLIT, AGENT_LEAF, 'right', 't7')]]))
    const { result, started } = setup({ sessions: [owner, shell(7)], known: new Map([['t2', ['t7']]]), chat: true, nextShell: 't8' })

    expect(result.current.splitsOf(owner)).toBe(UNSPLIT)
    expect(result.current.splitRefusalOf(owner)).not.toBeNull()
    await act(async () => { result.current.split(null, 'right'); await Promise.resolve() })
    expect(started).toEqual([])
    expect(toast.info).toHaveBeenCalledTimes(1)
  })

  it('says why a full session, an ended one and one on another machine cannot be split', () => {
    const owner = shell(2)
    const ids = Array.from({ length: MAX_SESSION_PANES - 1 }, (_, index) => `t${String(index + 10)}`)
    writeSessionSplits(new Map([['t2', ids.reduce((splits, id) => splitLeaf(splits, AGENT_LEAF, 'right', id), UNSPLIT)]]))
    const { result } = setup({ sessions: [owner, ...ids.map((id) => shell(Number(id.slice(1))))], known: new Map([['t2', ids]]) })

    expect(result.current.splitRefusalOf(owner)).not.toBeNull()
    expect(result.current.splitRefusalOf(shell(3))).toBeNull()
    expect(result.current.splitRefusalOf({ ...shell(3), ended: true })).not.toBeNull()
    expect(result.current.splitRefusalOf({ ...shell(3), machine: 4, machineName: 'devbox' })).not.toBeNull()
  })
})

describe('what a session’s splits follow', () => {
  const saved = () => { writeSessionSplits(new Map([['t2', splitLeaf(splitLeaf(UNSPLIT, AGENT_LEAF, 'right', 't7'), 't7', 'down', 't8')]])) }
  const known: AgentTerminals = new Map([['t2', ['t7', 't8']]])

  it('restores the splits whose shells still run and drops the ones that are gone', () => {
    saved()
    const owner = shell(2)
    const { result } = setup({ sessions: [owner, shell(8)], known })

    const splits = result.current.splitsOf(owner)
    expect(leavesOf(splits.tree)).toEqual([AGENT_LEAF, 't8'])
    expect(splits.numbers).toEqual({ t8: 2 })
  })

  it('never takes a shell for a split that the window did not record as that session’s', () => {
    saved()
    const owner = shell(2)
    const { result } = setup({ sessions: [owner, shell(7), shell(8)], known: new Map([['t2', ['t8']]]) })

    expect(leavesOf(result.current.splitsOf(owner).tree)).toEqual([AGENT_LEAF, 't8'])
  })

  it('ends the splits of a session the daemon says was closed or exited somewhere else, and forgets its tree', () => {
    saved()
    vi.mocked(daemonSaidEnded).mockImplementation((id) => id === 't2')
    const { result, endSessions } = setup({ sessions: [shell(7), shell(8), shell(3)], known })

    expect(endSessions).toHaveBeenCalledTimes(1)
    expect(endSessions).toHaveBeenCalledWith(['t7', 't8'])
    expect(result.current.saved.size).toBe(0)
  })

  it('ends nothing for a session that is only out of the list (put away, or gone before this window opened)', () => {
    saved()
    const { result, endSessions } = setup({ sessions: [shell(7), shell(8)], known })

    expect(endSessions).not.toHaveBeenCalled()
    expect(result.current.saved.size).toBe(0)
  })

  it('reads nothing into a list that is not the daemon’s', () => {
    saved()
    vi.mocked(daemonSaidEnded).mockReturnValue(true)
    const { result, endSessions } = setup({ sessions: [], known, listed: false })

    expect(endSessions).not.toHaveBeenCalled()
    expect(result.current.saved.size).toBe(1)
  })

  it('asks before a split closes, as for a terminal, and takes its pane out with the answer', () => {
    saved()
    const owner = shell(2)
    const { result, closeAgentTerminals } = setup({ sessions: [owner, shell(7), shell(8)], known })

    act(() => { result.current.closeSplit(owner, 't8') })
    expect(closeAgentTerminals).toHaveBeenCalledWith(['t8'], 'Split 2', expect.any(Function))
    expect(leavesOf(result.current.splitsOf(owner).tree)).toEqual([AGENT_LEAF, 't7', 't8'])
    act(() => { closeAgentTerminals.mock.calls[0]?.[2]?.() })
    expect(leavesOf(result.current.splitsOf(owner).tree)).toEqual([AGENT_LEAF, 't7'])
  })
})

describe('the pane keys', () => {
  it('step through a session’s own panes and wrap at the end, and the close key takes a split but not the session’s pane', () => {
    writeSessionSplits(new Map([['t2', splitLeaf(UNSPLIT, AGENT_LEAF, 'right', 't7')]]))
    const owner = shell(2)
    const { result, closeAgentTerminals } = setup({ sessions: [owner, shell(7)], known: new Map([['t2', ['t7']]]) })

    expect(result.current.splitsOf(owner).focus).toBe('t7')
    act(() => { result.current.stepPaneFocus(-1) })
    expect(result.current.splitsOf(owner).focus).toBe(AGENT_LEAF)
    expect(result.current.closeFocusedSplit()).toBe(false)
    act(() => { result.current.stepPaneFocus(-1) })
    expect(result.current.splitsOf(owner).focus).toBe('t7')
    let taken = false
    act(() => { taken = result.current.closeFocusedSplit() })
    expect(taken).toBe(true)
    expect(closeAgentTerminals).toHaveBeenCalledWith(['t7'], 'Split 1', expect.any(Function))
  })
})
