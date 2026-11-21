import { movePanes } from './components/paneTransition'
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useRef, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { type RemoteMachine, remoteStartRefusal, remoteTargetOf } from './model/machines'
import { toast } from '@/lib/toast'
import { DEFAULT_PICK, everywhereModel, writeChoice } from '@/features/chat/agentChoice'
import { addWorktree, defaultSessionFolder, handoffBrief, dropPrewarmedAgent, prewarmAgentSession, startAgentSession as launchAgentSession, loadConversations, renameConversationOnDaemon, sendTerminalInput, sendWhenAgentReady, resumeChatSession, startAcpChat, startChatSession, startShellSession, submitMessage, switchBranch } from '@/api/daemon'
import { LOCAL_MACHINE, startSessionOnMachine } from '@/api/machines'
import { startGitHubSignIn } from '@/api/githubAccounts'
import { useSessionsEnded } from './useSessionsEnded'
import type { DesktopSettingsSection } from '@/features/settings/components/DesktopSettings'
import type { SettingsPreferences } from '@/features/settings/preferences'
import { newWorktreeSession } from '@/features/worktrees/api'
import { rememberConversationPermissions } from '@/data/conversationPermissions'
import { reserveOperation } from '@/features/chat/sendOperation'
import { updateComposer } from '@/features/chat/composerStore'
import { entrustFirstMessage, holdFirstMessage, holdStartChoice } from '@/features/chat/firstMessage'
import { connectAgentOnce } from './model/agentHooks'
import type { WarmAgent } from './useWarmAgent'
import { nameFromMessage } from './model/newSession'
import type { ChatAgent } from './model/chatView'
import { rememberShellStart } from './model/shellStarts'
import type { NewChatRequest, NewChatSeed, NewChatStartOptions } from './components/NewChatPage'
import type { WireChoice } from '@/features/chat/agentChoice'
import { rememberBypassSession } from '@/features/chat/bypassSessions'
import { bypasses } from '@/features/settings/preferences'
import { chatPermissions, launchFlags, startsBypassed, withBypass } from './model/newChatHost'
import { CODEX_FULL_MODE, START_MODE } from '@/features/chat/chatMeta'
import { type Layout, openArrangement } from './model/layout'
import type { SessionView } from './model/session'
import { resolveStartFolder } from './model/startFolder'
import { resumeWords } from './model/moveToWorktree'
import { hasAbility } from './model/agentAbilities'
import { makeId } from './makeId'
import { agentLabel } from '@/features/workspace/model/session'

/** How a start runs beside others: `alone` (refused while anything starts, and holds off the rest), `alongside` (a new chat
 * page start that opens its pane), `background` (one that opens nothing and rejects with the reason it failed). */
type StartMode = 'alone' | 'alongside' | 'background'
const ANOTHER_START_RUNNING = 'Another start is running. Try again in a moment.'
const NOT_LISTED = 'The Maiker service did not list the new session'

/** How long a new session on another machine is waited for, and how often its list is looked at. */
const REMOTE_START_WAIT_MS = 8000
const REMOTE_START_POLL_MS = 250
/** Where a shell starts on another machine when no folder is asked for: that machine's own home. */
export const REMOTE_HOME = '~'

/** How long a session started as an agent is taken to be it while the daemon has not said so; a command that never starts one stops claiming it. */
const EXPECTED_AGENT_MS = 30_000
/** The words each agent's command line takes to sign its account in. */
const SIGN_IN_WORDS: Readonly<Record<'claude' | 'codex', readonly string[]>> = { claude: ['auth', 'login'], codex: ['login'] }

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))
}

/** Every way the window starts a session: a shell, an agent in a terminal, a chat, a worktree, on this computer or another machine. */
export function useSessionStarts({ queryClient, sessions, setWorktreeFrom, setLayout, flash, focusedSession, setNewChatOpen, online, starting, setStarting, setStartedFrom, sessionMap, preferences, setExpectedAgents, setSettingsSection, setNewChatMachine, setNewChatSeed, home, machinesRef }: {
  queryClient: QueryClient
  sessions: SessionView[]
  setWorktreeFrom: Dispatch<SetStateAction<SessionView | null>>
  setLayout: Dispatch<SetStateAction<Layout>>
  flash: (text: string) => void
  focusedSession: SessionView | undefined
  setNewChatOpen: Dispatch<SetStateAction<boolean>>
  online: boolean
  starting: boolean
  setStarting: Dispatch<SetStateAction<boolean>>
  setStartedFrom: Dispatch<SetStateAction<ReadonlySet<string> | null>>
  sessionMap: Map<string, SessionView>
  preferences: SettingsPreferences
  setExpectedAgents: Dispatch<SetStateAction<Record<string, ChatAgent>>>
  setSettingsSection: Dispatch<SetStateAction<DesktopSettingsSection | null>>
  setNewChatMachine: Dispatch<SetStateAction<number>>
  setNewChatSeed: Dispatch<SetStateAction<NewChatSeed | null>>
  home: string
  machinesRef: RefObject<ReadonlyMap<number, RemoteMachine>>
}) {
  // The session the daemon made since `known` was the whole list, if one appeared.
  const newSessionSince = useCallback(async (known: ReadonlySet<string>): Promise<string | null> => {
    await queryClient.invalidateQueries({ queryKey: ['conversations'] })
    const fresh = await queryClient.query({ queryKey: ['conversations'], queryFn: loadConversations, staleTime: 0 })
    const created = fresh.filter((item) => item.kind === 'terminal' && !known.has(item.id)).sort((a, b) => (a.nativePane ?? 0) - (b.nativePane ?? 0)).at(-1)
    return created?.id ?? null
  }, [queryClient])

  // A start knows its session only as the one new in the daemon's list, so launches take turns: each waits for the one
  // before it, and never takes a session an earlier start already claimed.
  const launches = useRef<Promise<unknown>>(Promise.resolve())
  const claimed = useRef(new Set<string>())
  const startShell = useCallback((folder: string, launch?: (folder: string) => Promise<void>): Promise<string | null> => {
    const turn = launches.current.then(async () => {
      const known = new Set([...sessions.map((session) => session.id), ...claimed.current])
      await (launch ?? startShellSession)(folder)
      const id = await newSessionSince(known)
      if (id) claimed.current.add(id)
      return id
    })
    // The next launch waits for this one to end, failed or not; this one's failure is its own caller's to report.
    launches.current = turn.then(() => undefined, () => undefined)
    return turn
  }, [sessions, newSessionSince])

  const createWorktree = useCallback(async (from: SessionView, branch: string, base: string | null) => {
    const known = new Set(sessions.map((session) => session.id))
    await newWorktreeSession(from.pane, branch, base, from.machine)
    const id = await newSessionSince(known)
    setWorktreeFrom(null)
    if (id) movePanes(() => { setLayout((current) => openArrangement(current, id, makeId)) })
    flash(`Worktree ${branch} ready`)
  }, [sessions, newSessionSince, setWorktreeFrom, setLayout, flash])

  // Lists again and opens the chat session the daemon just started, with its first prompt if there is one.
  const openStartedChat = useCallback(async (started: { id: number; generation: number }, prompt: string, choice: WireChoice | null = null) => {
    const id = String(started.id)
    await queryClient.invalidateQueries({ queryKey: ['conversations'] })
    await queryClient.query({ queryKey: ['conversations'], queryFn: loadConversations, staleTime: 0 })
    movePanes(() => { setLayout((current) => openArrangement(current, id, makeId)) })
    if (prompt !== '') {
      // The start has answered, so the agent is up: the first prompt is an ordinary send, number 1.
      const operation = reserveOperation(started.id, { receipt: null, queued: [] })
      await submitMessage({ id, generation: started.generation }, operation, prompt, choice ?? undefined)
    }
  }, [queryClient, setLayout])

  // A chat session in `path`, opened in a layout of its own: Claude Code and Codex through their own adapters, any other
  // agent over ACP, where its own settings decide what it may do (ADR 0018). Chats are this computer's: another machine's
  // shell asks first.
  const startChat = useCallback((path: string, agent: ChatAgent, fullAccess: boolean) => {
    const started = hasAbility(agent, 'structuredChat')
      ? startChatSession(path, agent, null, fullAccess ? 'full-access' : 'workspace-write').then((chat) => {
        if (fullAccess) rememberConversationPermissions(String(chat.id), 'full-access')
        return chat
      })
      : startAcpChat(path, agent)
    return started.then((chat) => openStartedChat(chat, '')).then(() => { flash(`${agentLabel(agent)} chat started`) })
  }, [openStartedChat, flash])


  // What the New session draft asks for: a structured chat in the folder, with the model and effort picked, and its first message.
  // Choosing another session (the sidebar, a shortcut) leaves the New session draft for it.
  const focusedSessionKey = focusedSession?.id
  const [seenFocusKey, setSeenFocusKey] = useState(focusedSessionKey)
  if (seenFocusKey !== focusedSessionKey) {
    setSeenFocusKey(focusedSessionKey)
    setNewChatOpen(false)
  }

  // The starts in flight. Starts from the New session draft (`alongside`, `background`) may run together; any other start runs
  // alone, as it always has: refused while something is starting, and nothing else starts until it ends. Only a start
  // that opens a pane (`opening`) keeps the sessions it did not know about off the sidebar until its pane is there.
  const inFlight = useRef({ count: 0, alone: false, opening: 0 })
  const beginStart = useCallback((mode: StartMode): boolean => {
    const now = inFlight.current
    if (now.alone || (now.count > 0 && mode === 'alone')) return false
    const opens = mode !== 'background'
    inFlight.current = { count: now.count + 1, alone: mode === 'alone', opening: now.opening + (opens ? 1 : 0) }
    setStarting(true)
    if (opens) setStartedFrom((current) => current ?? new Set(sessionMap.keys()))
    return true
  }, [setStarting, setStartedFrom, sessionMap])
  const endStart = useCallback((mode: StartMode) => {
    const now = inFlight.current
    inFlight.current = { count: now.count - 1, alone: false, opening: now.opening - (mode === 'background' ? 0 : 1) }
    if (inFlight.current.count === 0) setStarting(false)
    if (inFlight.current.opening === 0) setStartedFrom(null)
  }, [setStarting, setStartedFrom])

  // Resolves once the session is placed (true) or the start did not happen or failed (false, said in a toast). A start in
  // the `background` rejects instead, with the reason, for the page that asked to say.
  const runStart = useCallback((folder: () => Promise<string>, place: (sessionId: string) => void, launch?: (folder: string) => Promise<void>, mode: StartMode = 'alone'): Promise<boolean> => {
    const background = mode === 'background'
    if (!online) return background ? Promise.reject(new Error('The Maiker service is not reachable')) : Promise.resolve(false)
    if (!beginStart(mode)) return background ? Promise.reject(new Error(ANOTHER_START_RUNNING)) : Promise.resolve(false)
    return folder()
      .then((path) => startShell(path, launch))
      .then((id) => {
        if (!id) {
          if (background) throw new Error(NOT_LISTED)
          return false
        }
        // A start with no launch command is a plain shell, whoever asked (New terminal, a split, a restart): an agent typed into
        // it later stays in its terminal instead of turning the pane into the chat.
        if (launch === undefined) rememberShellStart(id)
        place(id)
        return true
      })
      .catch((error: unknown) => {
        if (background) throw error
        toast.failed('Could not start a shell', error)
        return false
      })
      .finally(() => { endStart(mode) })
  }, [online, beginStart, endStart, startShell])

  // A new session is the default agent, running in a terminal the daemon owns, shown as its chat or
  // as its terminal as Settings says for the whole app, so changing that setting never restarts the agent
  // (ADR 0003). A plain shell is `runStart` and has no chat view.
  // The agent is the new session's first command, so it starts as soon as the shell does instead of being typed in once the
  // shell is ready. Its status hooks are connected first: an agent already running never loads them, and its chat would
  // wait on them until it was restarted.
  const bypassOff = preferences.bypassOff
  const chatView = preferences.openSessionsIn === 'chat'
  // The words an agent is started with, its Bypass Permissions switch taken into account. A warm agent is taken only for
  // exactly these, so both ask through here.
  // `bypass` is the choice made for one session in the New session draft; without it Settings says.
  const startWords = useCallback((agent: ChatAgent, flags: string, bypass?: boolean) => withBypass(agent, flags.split(' ').filter((word) => word !== ''), bypass ?? bypasses({ bypassOff }, agent)), [bypassOff])
  const launchAgent = useCallback((agent: ChatAgent, flags: string, bypass?: boolean) => async (folder: string): Promise<void> => {
    await connectAgentOnce(agent).catch((error: unknown) => { console.warn(`Could not connect ${agent}'s status hooks`, error) })
    await launchAgentSession(folder, agent, startWords(agent, flags, bypass))
  }, [startWords])

  // The agent of the chat being written is started while it is written (`useWarmAgent`), so the first message does not wait
  // for it. It is a head start only: when it fails, the chat starts its agent as it always has.
  const warmNewChat = useCallback<WarmAgent>((spec) => {
    if (spec === null) {
      void dropPrewarmedAgent().catch((error: unknown) => { console.warn('Could not stop the agent started ahead', error) })
      return
    }
    if (!online) return
    // A chat with no terminal has no agent to start ahead: its start is the daemon's, on the first message (ADR 0018).
    if (chatView) return
    void connectAgentOnce(spec.agent)
      .catch((error: unknown) => { console.warn(`Could not connect ${spec.agent}'s status hooks`, error) })
      .then(() => prewarmAgentSession(spec.folder, spec.agent, startWords(spec.agent, launchFlags(spec.agent, spec.model, spec.reasoning, spec.mode), spec.bypass)))
      .catch((error: unknown) => { console.warn(`Could not start ${spec.agent} ahead of the first message`, error) })
  }, [online, startWords, chatView])

  // What the New session draft starts in the Chat view: a chat the daemon owns, with no terminal (ADR 0018). Claude Code
  // and Codex run through their own adapters, with the mode, model and effort picked, on a new session or a saved one;
  // any other agent runs over ACP by its name, where its own settings decide those. The start answers once the agent is up, so the page stays until
  // then, and the first message is an ordinary send after it.
  const startDirectChat = useCallback(async (request: NewChatRequest, { background = false, onPlaced }: NewChatStartOptions): Promise<void> => {
    const { agent, model, reasoning } = request
    // A saved conversation is resumed with no mode picked for it, so it opens in the agent's usual one.
    const picked = request.resume === null ? request.mode : START_MODE[agent]
    // Another agent picked for the session runs over ACP by its id, whatever the draft's own agent is (ADR 0019).
    const permissions = request.acp === undefined && hasAbility(agent, 'structuredChat') ? chatPermissions(agent, picked, request.bypass ?? bypasses({ bypassOff }, agent)) : undefined
    if (permissions === null) throw new Error(`${agentLabel(agent)} cannot start a chat in this permission mode yet. Pick another mode.`)
    const mode: StartMode = background ? 'background' : 'alongside'
    if (!beginStart(mode)) throw new Error(ANOTHER_START_RUNNING)
    try {
      // A saved conversation opens as a chat on the agent's own session, with what was said before as its history.
      const started = hasAbility(agent, 'structuredChat') && permissions !== undefined
        ? request.resume === null ? await startChatSession(request.folder, agent, null, permissions) : await resumeChatSession(request.folder, agent, request.resume, permissions)
        : await startAcpChat(request.folder, request.acp ?? agent)
      const id = String(started.id)
      const choice: WireChoice = permissions === undefined ? {} : { ...(model === DEFAULT_PICK ? {} : { model }), ...(reasoning === DEFAULT_PICK ? {} : { effort: reasoning }) }
      if (permissions !== undefined) {
        rememberConversationPermissions(id, permissions)
        // The chat's own model and effort chips read this, and the first message carries it to the daemon.
        writeChoice(started.id, { model, reasoning })
      }
      const named = request.name ?? (request.message === '' ? '' : nameFromMessage(request.message))
      if (named !== '') void renameConversationOnDaemon({ id }, named).catch((error: unknown) => { console.warn('Could not name the new session', error) })
      await queryClient.invalidateQueries({ queryKey: ['conversations'] })
      await queryClient.query({ queryKey: ['conversations'], queryFn: loadConversations, staleTime: 0 })
      // The page closes in the same update as the pane opens, so nothing shows in between (see `startAgentSession`).
      const settle = () => {
        if (!background) setNewChatOpen(false)
        onPlaced?.(id)
      }
      if (background) {
        setStartedFrom((current) => (current === null ? null : new Set([...current, id])))
        settle()
      } else {
        movePanes(() => {
          setLayout((current) => openArrangement(current, id, makeId))
          settle()
        })
      }
      if (request.message === '') return
      const operation = reserveOperation(started.id, { receipt: null, queued: [] })
      // The chat is open by now, so a send that fails is said there and the words go back into its box, not into a page that has closed.
      await submitMessage({ id, generation: started.generation }, operation, request.message, Object.keys(choice).length === 0 ? undefined : choice).catch((error: unknown) => {
        updateComposer(started.id, (state) => ({ ...state, draft: request.message }))
        toast.failed(`The chat started, but ${request.acp ?? agentLabel(agent)} did not take the first message`, error)
      })
    } finally {
      endStart(mode)
    }
  }, [bypassOff, beginStart, endStart, queryClient, setNewChatOpen, setStartedFrom, setLayout])

  // `background` leaves the new session unopened, listed in the sidebar, and the window as it was.
  const startAgentSession = useCallback((folder: () => Promise<string>, agent: ChatAgent, firstMessage = '', flags = '', placed: { afterPlace?: (id: string) => void; alongside?: boolean; background?: boolean; /** This session's Bypass Permissions choice, over Settings. */ bypass?: boolean; /** A name typed for it, in place of the first message's words. */ name?: string } = {}): Promise<boolean> => {
    return runStart(folder, (id) => {
      // A first message waits under the session and goes out once the agent takes input; its words name the session.
      if (firstMessage !== '') {
        holdFirstMessage(id, firstMessage)
        entrustFirstMessage(id, firstMessage, sendWhenAgentReady)
      }
      const named = placed.name ?? (firstMessage === '' ? '' : nameFromMessage(firstMessage))
      if (named !== '') void renameConversationOnDaemon({ id }, named).catch((error: unknown) => { console.warn('Could not name the new session', error) })
      // The daemon learns which agent runs from the agent's own hook, a moment after it starts; until then the
      // session is known to be this agent, so it never shows as a shell.
      setExpectedAgents((current) => ({ ...current, [id]: agent }))
      if (startsBypassed(agent, startWords(agent, flags, placed.bypass))) rememberBypassSession(id)
      window.setTimeout(() => { setExpectedAgents((current) => omitKey(current, id)) }, EXPECTED_AGENT_MS)
      // `afterPlace` (which closes the page) goes in the same update as the pane opens: `movePanes` commits its update at
      // once and the browser pictures the window right after it, so anything set after it would show a frame later, as a
      // flash of the page still open.
      const settle = () => { placed.afterPlace?.(id) }
      if (placed.background) {
        setStartedFrom((current) => (current === null ? null : new Set([...current, id])))
        settle()
      } else {
        movePanes(() => {
          setLayout((current) => openArrangement(current, id, makeId))
          settle()
        })
      }
    }, launchAgent(agent, flags, placed.bypass), placed.background ? 'background' : placed.alongside ? 'alongside' : 'alone')
  }, [runStart, launchAgent, setExpectedAgents, startWords, setLayout, setStartedFrom])

  // Signing an agent's account in is the agent's own interactive command, so it runs in a terminal of its own, in
  // the home folder: a browser opens from it, or it asks for a code. The session is a terminal, never a chat.
  const signInAgent = useCallback((agent: 'claude' | 'codex') => {
    setSettingsSection(null)
    void runStart(
      async () => home || (await defaultSessionFolder()),
      (id) => { rememberShellStart(id); movePanes(() => { setLayout((current) => openArrangement(current, id, makeId)) }) },
      (folder) => launchAgentSession(folder, agent, SIGN_IN_WORDS[agent]),
    )
  }, [runStart, home, setLayout, setSettingsSection])

  // "Start a Claude chat" on a shell's empty chat card: a chat session in that shell's folder.
  const startChatHere = useCallback((from: SessionView, agent: ChatAgent, fullAccess: boolean) => {
    const refusal = remoteStartRefusal(from.machine !== LOCAL_MACHINE, from.machineName, 'A chat session')
    if (refusal) {
      toast.info(refusal)
      return
    }
    if (!online || starting) return
    if (!beginStart('alone')) return
    startChat(from.cwd, agent, fullAccess)
      .catch((error: unknown) => { toast.failed(`Could not start a ${agentLabel(agent)} chat`, error) })
      .finally(() => { endStart('alone') })
  }, [online, starting, beginStart, endStart, startChat])

  // "Hand off to …": a new session of another agent in the same folder, starting with a text brief of this one's work.
  const handoffSession = useCallback(async (from: SessionView, to: ChatAgent) => {
    const refusal = remoteStartRefusal(from.machine !== LOCAL_MACHINE, from.machineName, 'A handoff')
    if (refusal) {
      toast.info(refusal)
      return
    }
    if (!online || starting) return
    try {
      await startAgentSession(() => Promise.resolve(from.cwd), to, await handoffBrief(from))
    } catch (error: unknown) {
      toast.failed(`Could not hand off to ${to}`, error)
    }
  }, [online, starting, startAgentSession])

  // Starts a shell on another machine and opens it once the machine lists it; resolves to its id.
  const startOnMachine = useCallback(async (target: { machine: number; name: string }, folder: string, launch?: () => Promise<void>, open = true): Promise<string | null> => {
    const known = new Set((machinesRef.current.get(target.machine)?.conversations ?? []).map((item) => item.id))
    await (launch ?? (() => startSessionOnMachine(target.machine, folder)))()
    // The machine tells its new session in its next list; its layout opens when it does.
    const deadline = Date.now() + REMOTE_START_WAIT_MS
    while (Date.now() < deadline) {
      const fresh = machinesRef.current.get(target.machine)?.conversations.find((item) => item.kind === 'terminal' && !known.has(item.id))
      if (fresh) {
        if (open) movePanes(() => { setLayout((current) => openArrangement(current, fresh.id, makeId)) })
        return fresh.id
      }
      await new Promise((resolve) => { setTimeout(resolve, REMOTE_START_POLL_MS) })
    }
    toast.error(`${target.name} did not report the new session`)
    return null
  }, [machinesRef, setLayout])

  // A chat on another machine is its daemon's terminal session with the agent typed into the shell, shown as its chat once the
  // agent reports a conversation. The line is built from the closed set `launchFlags` allows (the agent, a permission mode from
  // the fixed list, a model the agent takes by name everywhere, an effort level), so no free text reaches the remote shell;
  // the first message waits until the agent takes input. A new worktree is made by that machine's daemon in its own
  // checkout, as on this computer, and the agent starts in it; switching that checkout's branch is not done from here
  // (ADR 0007), so asking for it is refused rather than left to edit the checkout.
  const startRemoteChat = useCallback(async (request: NewChatRequest, { background = false, onPlaced }: NewChatStartOptions = {}): Promise<void> => {
    if (request.branch?.worktree === false) throw new Error(`A branch is switched only on this computer. Start it in a new worktree, or in ${request.machineName}'s folder as it is.`)
    const folder = request.branch ? await addWorktree(request.folder, request.branch.name, request.machine) : request.folder
    const id = await startOnMachine({ machine: request.machine, name: request.machineName }, folder, undefined, !background)
    if (id === null) throw new Error(`${request.machineName} did not report the new session`)
    if (request.message !== '') {
      holdFirstMessage(id, request.message)
      entrustFirstMessage(id, request.message, sendWhenAgentReady)
    }
    setExpectedAgents((current) => ({ ...current, [id]: request.agent }))
    window.setTimeout(() => { setExpectedAgents((current) => omitKey(current, id)) }, EXPECTED_AGENT_MS)
    if (request.name !== undefined) void renameConversationOnDaemon({ id }, request.name).catch((error: unknown) => { console.warn('Could not name the new session', error) })
    const words = startWords(request.agent, launchFlags(request.agent, everywhereModel(request.agent, request.model), request.reasoning, request.mode), request.bypass)
    if (startsBypassed(request.agent, words)) rememberBypassSession(id)
    await sendTerminalInput({ id, generation: 0 }, `${[request.agent, ...words].join(' ')}\r`)
    if (!background) setNewChatOpen(false)
    onPlaced?.(id)
  }, [startOnMachine, setExpectedAgents, setNewChatOpen, startWords])

  // The new chat is the agent in a terminal the daemon owns, shown as its chat: one session shown in
  // the app's view (ADR 0003), the same for every agent. Starts from the page run alongside each
  // other; one in the `background` is not opened and leaves the page open for the next.
  const startNewChat = useCallback(async (request: NewChatRequest, { background = false, onPlaced }: NewChatStartOptions = {}): Promise<void> => {
    if (!online) throw new Error('The Maiker service is not reachable')
    if (request.machine !== LOCAL_MACHINE) return startRemoteChat(request, { background, ...(onPlaced === undefined ? {} : { onPlaced }) })
    const resume = request.resume === null ? [] : !hasAbility(request.agent, 'resumeSaved') ? null : resumeWords(request.agent, request.resume)
    if (resume === null) throw new Error('This saved conversation cannot be resumed from here')
    // The branch is settled before the agent starts, and a failure stays on the page with its words.
    let folder = request.folder
    if (request.branch?.worktree) folder = await addWorktree(folder, request.branch.name)
    else if (request.branch) await switchBranch(folder, request.branch.name, request.branch.create)
    if (request.acp !== undefined && !chatView) throw new Error('An agent from the ACP registry starts only in the Chat view. Switch to it in Settings.')
    // In the Chat view a session is a chat with no terminal behind it (ADR 0018), a saved conversation included.
    if (chatView) return startDirectChat({ ...request, folder }, { background, ...(onPlaced === undefined ? {} : { onPlaced }) })
    const flags = `${resume.map((word) => ` ${word}`).join('')}${launchFlags(request.agent, request.model, request.reasoning, request.mode)}`
    // The page stays, with the message in it, until the chat that replaces it is there: closing it first showed the
    // empty window (or the last chat) for a moment between the two.
    await startAgentSession(() => Promise.resolve(folder), request.agent, request.message, flags, { alongside: true, background, ...(request.bypass === undefined ? {} : { bypass: request.bypass }), ...(request.name === undefined ? {} : { name: request.name }), afterPlace: (id) => {
      // Codex has no file that says its mode, so what it was started in is what its chat shows: Full access under Bypass Permissions.
      const codexMode = (request.bypass ?? bypasses({ bypassOff }, 'codex')) ? CODEX_FULL_MODE : request.mode === 'default' ? null : request.mode
      holdStartChoice(id, { model: request.model, reasoning: request.reasoning, mode: request.agent === 'claude' ? request.mode : request.agent === 'codex' ? codexMode : null })
      if (!background) setNewChatOpen(false)
      onPlaced?.(id)
    } })
  }, [online, setNewChatOpen, startAgentSession, startRemoteChat, bypassOff, chatView, startDirectChat])

  // A shell in another machine's home folder, opened in the window when that machine lists it.
  const startRemoteShell = useCallback((machine: number) => startOnMachine({ machine, name: 'The machine' }, REMOTE_HOME), [startOnMachine])

  // A plain shell: terminal view only, whatever the default agent is. In `folder` (a project's) when one is given;
  // otherwise the start folder, or on another machine that machine's home folder.
  const newTerminal = useCallback((machine?: number, folder?: string) => {
    setSettingsSection(null)
    const target = machine ?? remoteTargetOf(focusedSession)?.machine ?? LOCAL_MACHINE
    if (target !== LOCAL_MACHINE) {
      void startOnMachine({ machine: target, name: 'The machine' }, folder ?? REMOTE_HOME).then((id) => { if (id !== null) rememberShellStart(id) })
      return
    }
    void runStart(async () => folder ?? resolveStartFolder(preferences.startFolder, home || (await defaultSessionFolder())), (id) => { movePanes(() => { setLayout((current) => openArrangement(current, id, makeId)) }) })
  }, [setSettingsSection, focusedSession, runStart, startOnMachine, preferences.startFolder, home, setLayout])

  // "New chat with summary" on a chat whose context is nearly full: the New session draft, on the same machine and folder, with
  // the summary as its first message to read and edit before it is sent.
  const newChatWithSummary = useCallback((from: SessionView, summary: string) => {
    setSettingsSection(null)
    setNewChatMachine(from.machine)
    setNewChatSeed({ folder: from.cwd, message: summary })
    setNewChatOpen(true)
  }, [setNewChatOpen, setNewChatMachine, setNewChatSeed, setSettingsSection])

  // Signing in to GitHub is `gh`'s own interactive command, in a terminal of its own in the machine's home folder: it
  // shows a code and opens a browser. The host holds the command; only the machine is chosen here. The session is
  // watched so that whoever shows the sign-in can ask again once it has ended.
  const { watch: watchSignIn, ended: gitHubSignInsEnded } = useSessionsEnded(sessionMap)
  const signInGitHub = useCallback((machine: number, name: string) => {
    setSettingsSection(null)
    const started = (id: string) => { rememberShellStart(id); watchSignIn(id) }
    if (machine !== LOCAL_MACHINE) {
      void startOnMachine({ machine, name }, REMOTE_HOME, () => startGitHubSignIn(machine)).then(
        (id) => { if (id !== null) started(id) },
        (error: unknown) => { toast.failed(`Could not start the sign-in on ${name}`, error) },
      )
      return
    }
    void runStart(
      async () => home || (await defaultSessionFolder()),
      (id) => { started(id); movePanes(() => { setLayout((current) => openArrangement(current, id, makeId)) }) },
      () => startGitHubSignIn(LOCAL_MACHINE),
    )
  }, [setSettingsSection, watchSignIn, startOnMachine, runStart, home, setLayout])

  return { signInAgent, signInGitHub, gitHubSignInsEnded, runStart, startRemoteShell, newTerminal, startAgentSession, startChatHere, handoffSession, newChatWithSummary, startNewChat, warmNewChat, createWorktree }
}
