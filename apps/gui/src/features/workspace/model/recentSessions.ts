import { useCallback, useEffect, useRef, useState } from 'react'
import { closedSessions, readyClosedFolder, reopenClosedSession, type ClosedSession } from '@/api/daemon'
import { errorMessage } from '@/lib/error-message'
import { LOCAL_MACHINE } from '@/api/machines'
import { DEFAULT_PICK } from '@/features/chat/agentChoice'
import type { NewChatRequest } from '../components/NewChatPage'
import { resumeWords } from './moveToWorktree'
import type { SessionView } from './session'

/** A saved conversation's resume start: in its folder as it is, with no branch made, named as its agent named it and aged from when it was last used. */
export function savedStart(folder: string, agent: 'claude' | 'codex', id: string, saved: { name: string; lastActive: number } | null = null): NewChatRequest {
  return {
    folder, agent, model: DEFAULT_PICK, reasoning: DEFAULT_PICK, mode: 'default', message: '', branch: null, machine: LOCAL_MACHINE, machineName: 'This computer', resume: id,
    ...(saved === null ? {} : { name: saved.name, lastActive: saved.lastActive }),
  }
}

/** What a reopen says when the service is too old to take it: the window offers the restart beside it. */
export const RESTART_TO_REOPEN = 'The Maiker service needs a restart to reopen it.'

/** Why a saved session is not opened, in the words Recent sessions, a Workspace row and the toast after an Open all use. */
export const FOLDER_GONE = 'folder removed; cannot be made again'
export const NO_CONVERSATION = 'no conversation to resume'
export const NOT_HERE = 'cannot be reopened here'
export const CHAT_VIEW_ONLY = 'its agent runs only in the Chat view'

/** What the Recent sessions list knows: nothing yet, the list, or why there is none. */
export type RecentRead = { kind: 'loading' } | { kind: 'listed'; list: readonly ClosedSession[] } | { kind: 'older' } | { kind: 'failed' }

const RESUMABLE = ['claude', 'codex'] as const
type ResumableAgent = (typeof RESUMABLE)[number]

function resumableAgent(agent: string): ResumableAgent | null {
  return RESUMABLE.find((known) => known === agent) ?? null
}

/** Whether the service can make a closed session's removed folder again: it was a worktree, and its repository and branch are known. */
function remakeable(closed: ClosedSession): boolean {
  return closed.worktree !== null && closed.repo !== null && closed.branch !== null
}

/** Why a closed session cannot be reopened from the list, or null when it can. */
export function reopenRefusal(closed: ClosedSession): string | null {
  if (!closed.folder_present && !remakeable(closed)) return FOLDER_GONE
  const agent = resumableAgent(closed.agent)
  if (agent === null) return NOT_HERE
  // The id is typed on the agent's command line, so one the shared rule refuses is never started.
  if (resumeWords(agent, closed.session) === null) return NO_CONVERSATION
  return null
}

/**
 * The start that reopens a closed session: its agent in its folder with its conversation. Null when it cannot be, or
 * when its folder is gone, since the service then makes the folder again and starts the agent itself.
 */
export function reopenRequest(closed: ClosedSession): NewChatRequest | null {
  return closed.folder_present ? resumeIn(closed, closed.cwd) : null
}

/** The start that resumes a closed session's conversation in `folder`; null when it cannot be resumed at all. */
function resumeIn(closed: ClosedSession, folder: string): NewChatRequest | null {
  const agent = resumableAgent(closed.agent)
  if (agent === null || reopenRefusal(closed) !== null) return null
  return { folder, agent, model: DEFAULT_PICK, reasoning: DEFAULT_PICK, mode: 'default', message: '', branch: null, machine: LOCAL_MACHINE, machineName: 'This computer', resume: closed.session }
}

/**
 * Has the service make a closed or saved session's removed folder again (its worktree, from the record it keeps) and
 * answers with the folder to start it in. An older service cannot only make the folder, so it is asked to reopen the
 * session itself, which starts it in its terminal: then there is nothing left to start, and the answer is null. One
 * older still says so in `RESTART_TO_REOPEN`.
 */
async function remakeFolder(closed: ClosedSession): Promise<string | null> {
  const folder = await readyClosedFolder(closed.agent, closed.session)
  if (folder !== null) return folder
  if (!(await reopenClosedSession(closed.agent, closed.session))) throw new Error(RESTART_TO_REOPEN)
  return null
}

/**
 * Reopens a closed session whose folder is gone: the service makes its worktree again (`remakeFolder`), then `start`
 * starts it there like any resume, so it opens as a chat or in its terminal as Settings says.
 */
export async function reopenRemoved(closed: ClosedSession, start: (request: NewChatRequest) => Promise<void>): Promise<void> {
  const folder = await remakeFolder(closed)
  if (folder === null) return
  const request = resumeIn(closed, folder)
  if (request === null) throw new Error('This session cannot be reopened here')
  await start(request)
}

/** Why a Gemini session starts a new conversation: the app knows no way to continue one of Gemini's. */
const GEMINI_FRESH = 'Gemini cannot continue a conversation from here'

/** An agent's name as the service runs one over ACP by it: lower-case letters, digits, `-` and `_`. */
const ACP_NAME = /^[a-z0-9_-]{1,64}$/

/**
 * How a project's saved session is opened again from its Workspace panel, or skipped with why. `request` is its start:
 * in its folder, or, when the folder is gone (`remake`), in the one the service makes again. Claude and Codex resume
 * their conversation, in the view Settings picks. Gemini starts a new conversation in its terminal (`terminal`), which
 * `fresh` says. Any other agent is a chat run over ACP, saved under the agent's own name: it is loaded by its id, and
 * when the agent cannot load it a new one starts there instead (`openSaved`); an ACP chat runs only in the Chat view.
 */
export type ReopenPlan =
  | { kind: 'open'; request: NewChatRequest; remake: boolean; terminal: boolean; fresh: string | null }
  | { kind: 'skip'; why: string }

export function reopenPlan(saved: ClosedSession, chatView: boolean): ReopenPlan {
  if (!saved.folder_present && !remakeable(saved)) return { kind: 'skip', why: FOLDER_GONE }
  const remake = !saved.folder_present
  const named: Partial<Pick<NewChatRequest, 'name'>> = saved.title === null ? {} : { name: saved.title }
  const base: Omit<NewChatRequest, 'agent' | 'resume'> = { folder: saved.cwd, model: DEFAULT_PICK, reasoning: DEFAULT_PICK, mode: 'default', message: '', branch: null, machine: LOCAL_MACHINE, machineName: 'This computer' }
  const agent = resumableAgent(saved.agent)
  if (agent !== null) {
    // The id is typed on the agent's command line, so one the shared rule refuses is never started.
    if (resumeWords(agent, saved.session) === null) return { kind: 'skip', why: NO_CONVERSATION }
    return { kind: 'open', request: { ...base, agent, resume: saved.session }, remake, terminal: false, fresh: null }
  }
  if (saved.agent === 'gemini') return { kind: 'open', request: { ...base, agent: 'gemini', resume: null, ...named }, remake, terminal: true, fresh: GEMINI_FRESH }
  // "acp" names no agent: it is how the closed list writes a chat whose agent it did not keep.
  if (saved.agent === 'acp' || !ACP_NAME.test(saved.agent)) return { kind: 'skip', why: NOT_HERE }
  if (!chatView) return { kind: 'skip', why: CHAT_VIEW_ONLY }
  // The request's own agent is a stand-in: a start with `acp` runs that agent, as the New session draft's does.
  return { kind: 'open', request: { ...base, agent: 'claude', acp: saved.agent, resume: saved.session, ...named }, remake, terminal: false, fresh: null }
}

/**
 * The folder a plan starts in: the saved one, or, when it is gone, the one the service makes again. Null when an older
 * service reopened the session itself (`remakeFolder`).
 */
export async function plannedRequest(saved: ClosedSession, plan: Extract<ReopenPlan, { kind: 'open' }>): Promise<NewChatRequest | null> {
  if (!plan.remake) return plan.request
  const folder = await remakeFolder(saved)
  return folder === null ? null : { ...plan.request, folder }
}

/**
 * The start that resumes an ended session's own conversation in its folder, or why it cannot be: only Claude and Codex
 * resume, only from this computer, and only with the conversation id the daemon reported before the session ended.
 */
export function endedResume(session: Pick<SessionView, 'process' | 'machine' | 'cwd' | 'agentSession'>): { kind: 'request'; request: NewChatRequest } | { kind: 'refused'; why: string } {
  if (session.machine !== LOCAL_MACHINE) return { kind: 'refused', why: 'A session of another machine cannot be resumed from here' }
  const agent = resumableAgent(session.process)
  if (agent === null) return { kind: 'refused', why: 'This agent cannot be resumed from here' }
  const id = session.agentSession ?? null
  if (id === null || resumeWords(agent, id) === null) return { kind: 'refused', why: 'No conversation was saved to resume' }
  return { kind: 'request', request: { folder: session.cwd, agent, model: DEFAULT_PICK, reasoning: DEFAULT_PICK, mode: 'default', message: '', branch: null, machine: LOCAL_MACHINE, machineName: 'This computer', resume: id } }
}

/** This computer's closed sessions, read off the UI thread when the list opens; `retry` asks again. */
export function useClosedSessions(): { read: RecentRead; retry: () => void } {
  const [read, setRead] = useState<RecentRead>({ kind: 'loading' })
  const [again, setAgain] = useState(0)
  useEffect(() => {
    const stop = new AbortController()
    void (async () => {
      try {
        const list = await closedSessions()
        if (!stop.signal.aborted) setRead(list === null ? { kind: 'older' } : { kind: 'listed', list })
      } catch (error) {
        if (!stop.signal.aborted) setRead({ kind: 'failed' })
        console.warn('Could not read the closed sessions', error)
      }
    })()
    return () => { stop.abort() }
  }, [again])
  const retry = useCallback(() => { setRead({ kind: 'loading' }); setAgain((count) => count + 1) }, [])
  return { read, retry }
}

/** Where reopening a session whose folder is gone stands. */
export type RemakeState = { kind: 'idle' } | { kind: 'working' } | { kind: 'failed'; message: string }

/**
 * Reopening a session whose folder is gone: the service makes it again, then `start` starts the session there
 * (`reopenRemoved`); `onReopened` runs once it has.
 */
export function useReopenRemoved(start: (request: NewChatRequest) => Promise<void>, onReopened: () => void): { state: RemakeState; reopen: (closed: ClosedSession) => void } {
  const [state, setState] = useState<RemakeState>({ kind: 'idle' })
  // A second pick before the first answers would start the session twice.
  const busy = useRef(false)
  // The list can close before the service answers; that answer then changes nothing here.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const reopen = useCallback((closed: ClosedSession) => {
    if (busy.current) return
    busy.current = true
    setState({ kind: 'working' })
    void (async () => {
      let outcome: RemakeState
      try {
        await reopenRemoved(closed, start)
        outcome = { kind: 'idle' }
      } catch (error) {
        outcome = { kind: 'failed', message: errorMessage(error, 'Could not reopen the session.') }
      }
      busy.current = false
      if (!mounted.current) return
      setState(outcome)
      if (outcome.kind === 'idle') onReopened()
    })()
  }, [start, onReopened])
  return { state, reopen }
}
