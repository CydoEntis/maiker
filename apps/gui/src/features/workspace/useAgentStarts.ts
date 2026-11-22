import { movePanes } from './components/paneTransition'
import { confirmAsk } from '@/features/confirm/confirm'
import type { Confirm } from '@/features/confirm/useConfirm'
import { type Dispatch, type SetStateAction, useCallback } from 'react'
import { toast } from '@/lib/toast'
import { defaultSessionFolder, sendTerminalInput } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import { type AgentTerminals, withAgentTerminal } from '@/data/agentTerminals'
import type { DesktopSettingsSection } from '@/features/settings/components/DesktopSettings'
import type { SettingsPreferences } from '@/features/settings/preferences'
import { remoteStartRefusal } from './model/machines'
import { type Layout, openArrangement } from './model/layout'
import type { SessionView } from './model/session'
import type { TerminalPlace } from './model/terminalTabs'
import { resolveStartFolder } from './model/startFolder'
import { makeId } from './makeId'
import { chatAgentOf } from './model/chatView'
import { agentLabel } from '@/features/welcome/setup'
import { DEFAULT_PICK } from '@/features/chat/agentChoice'
import type { NewChatRequest, NewChatSeed } from './components/NewChatPage'
import { REMOTE_HOME } from './useSessionStarts'

/** The folder a new agent starts in on this computer: the session in front's (when it is this computer's), else the start folder. */
async function localStartFolder(inFront: SessionView | undefined, startFolder: string, home: string): Promise<string> {
  if (inFront !== undefined && inFront.machine === LOCAL_MACHINE) return inFront.cwd
  return resolveStartFolder(startFolder, home || (await defaultSessionFolder()))
}

/** Starts for what is in front: another terminal for an agent, or an agent in the focused folder. */
export function useAgentStarts({ sessionMap, endSessions, confirm, setAgentTerminals, onTerminalAdded, runStart, startRemoteShell, startNewChat, openDraft, chatView, machineNameOf, setLayout, focusedSession, setSettingsSection, preferences, home }: {
  sessionMap: Map<string, SessionView>
  endSessions: (ids: string[]) => void
  confirm: Confirm
  setAgentTerminals: Dispatch<SetStateAction<AgentTerminals>>
  /** A terminal was started for an agent: the window shows it as a tab of the side panel, or in the drawer when `place` says so. */
  onTerminalAdded: (agentId: string, terminalId: string, place?: TerminalPlace) => void
  runStart: (folder: () => Promise<string>, place: (sessionId: string) => void, launch?: (folder: string) => Promise<void>) => Promise<boolean>
  /** A shell in another machine's home folder, opened in the window once that machine lists it; its id, or null when it did not appear. */
  startRemoteShell: (machine: number) => Promise<string | null>
  /** Starts an agent session the way the New session page does: the one place that knows how. */
  startNewChat: (request: NewChatRequest) => Promise<void>
  /** Opens the New session draft on `machine`, with the agent and folder asked for; nothing is started until its first message is sent. */
  openDraft: (machine: number, seed: NewChatSeed) => void
  /** The Chat view: an agent from the palette opens the draft there. In the Terminal view it starts at once, in a terminal. */
  chatView: boolean
  /** What a machine is called in a message; empty for this computer. */
  machineNameOf: (machine: number) => string
  setLayout: Dispatch<SetStateAction<Layout>>
  focusedSession: SessionView | undefined
  setSettingsSection: Dispatch<SetStateAction<DesktopSettingsSection | null>>
  preferences: SettingsPreferences
  home: string
}) {
  // "New terminal" on an agent: a shell in its folder, as a tab of the side panel, or in the drawer under the pane (`place`).
  const addAgentTerminal = useCallback((agentId: string, place?: TerminalPlace) => {
    const agent = sessionMap.get(agentId)
    if (!agent) return
    const refusal = remoteStartRefusal(agent.machine !== LOCAL_MACHINE, agent.machineName, 'Opening a terminal here')
    if (refusal) {
      toast.info(refusal)
      return
    }
    void runStart(() => Promise.resolve(agent.cwd), (id) => {
      setAgentTerminals((current) => withAgentTerminal(current, agentId, id, new Set([...sessionMap.keys(), id])))
      onTerminalAdded(agentId, id, place)
    })
  }, [sessionMap, runStart, setAgentTerminals, onTerminalAdded])

  // Closing a tab or a split ends its shells, so it asks first, once for all of them. `name` is what its tab calls it;
  // `after` runs with the close, for what goes with it.
  const closeAgentTerminals = useCallback((terminalIds: string[], name: string, after?: () => void) => {
    confirm(confirmAsk('close-terminal', { name }), () => { endSessions(terminalIds); after?.() })
  }, [confirm, endSessions])

  // In the Chat view Claude Code, Codex and Gemini open the New session draft with that agent picked: the folder, branch, model
  // and permissions are chosen there and nothing starts before the first message. In the Terminal view they start at once as a
  // real agent session (`startNewChat`) shown as its terminal. An agent with no chat (OpenCode, Cursor) is typed into a new
  // shell and run. On this computer it uses the folder in front (when that is on this computer), else the start folder; on
  // another machine, that machine's home folder.
  const startAgent = useCallback((program: string, machine: number = focusedSession?.machine ?? LOCAL_MACHINE) => {
    setSettingsSection(null)
    const report = (error: unknown) => { toast.failed(`Could not start ${agentLabel(program)}`, error) }
    const agent = chatAgentOf(program)
    if (agent !== null) {
      const folder = machine === LOCAL_MACHINE ? localStartFolder(focusedSession, preferences.startFolder, home) : Promise.resolve(REMOTE_HOME)
      if (chatView) {
        folder.then((path) => { openDraft(machine, { folder: path, message: '', agent }) }).catch(report)
        return
      }
      folder
        .then((path) => startNewChat({ agent, folder: path, model: DEFAULT_PICK, reasoning: DEFAULT_PICK, mode: 'default', message: '', branch: null, machine, machineName: machineNameOf(machine), resume: null }))
        .catch(report)
      return
    }
    const typeProgram = (id: string) => sendTerminalInput({ id, generation: 0 }, `${program}\r`).catch(report)
    if (machine !== LOCAL_MACHINE) {
      void startRemoteShell(machine).then((id) => { if (id !== null) void typeProgram(id) })
      return
    }
    void runStart(() => localStartFolder(focusedSession, preferences.startFolder, home), (id) => {
      movePanes(() => { setLayout((current) => openArrangement(current, id, makeId)) })
      void typeProgram(id)
    })
  }, [focusedSession, setSettingsSection, runStart, startNewChat, openDraft, chatView, startRemoteShell, machineNameOf, preferences.startFolder, home, setLayout])

  return { addAgentTerminal, closeAgentTerminals, startAgent }
}
