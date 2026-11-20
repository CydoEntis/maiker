import { movePanes } from './components/paneTransition'
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
import type { SplitPlace } from './model/terminalTabs'
import { resolveStartFolder } from './model/startFolder'
import { makeId } from './makeId'

/** Starts for what is in front: another terminal for an agent, or an agent in the focused folder. */
export function useAgentStarts({ sessionMap, endSessions, setAgentTerminals, onTerminalAdded, runStart, startRemoteShell, setLayout, focusedSession, setSettingsSection, preferences, home }: {
  sessionMap: Map<string, SessionView>
  endSessions: (ids: string[]) => void
  setAgentTerminals: Dispatch<SetStateAction<AgentTerminals>>
  /** A terminal was started for an agent: the window shows it in the terminal dock, as a tab or split in at `place`. */
  onTerminalAdded: (agentId: string, terminalId: string, place?: SplitPlace) => void
  runStart: (folder: () => Promise<string>, place: (sessionId: string) => void, launch?: (folder: string) => Promise<void>) => Promise<boolean>
  /** A shell in another machine's home folder, opened in the window once that machine lists it; its id, or null when it did not appear. */
  startRemoteShell: (machine: number) => Promise<string | null>
  setLayout: Dispatch<SetStateAction<Layout>>
  focusedSession: SessionView | undefined
  setSettingsSection: Dispatch<SetStateAction<DesktopSettingsSection | null>>
  preferences: SettingsPreferences
  home: string
}) {
  // "New terminal" on an agent: a shell in its folder, as another of its terminal tabs, or split in beside one of them.
  const addAgentTerminal = useCallback((agentId: string, place?: SplitPlace) => {
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

  // Closing a tab ends its shell. It stays in the agent's list, so Undo brings the tab back and not a stray session.
  const closeAgentTerminal = useCallback((terminalId: string) => { endSessions([terminalId]) }, [endSessions])

  // An agent is its program typed into a new shell, so it is the same start as a terminal. On this computer it opens in the
  // folder in front (when that is on this computer), else the start folder; on another machine, in that machine's home folder.
  const startAgent = useCallback((program: string, machine: number = focusedSession?.machine ?? LOCAL_MACHINE) => {
    setSettingsSection(null)
    const typeProgram = (id: string) => sendTerminalInput({ id, generation: 0 }, `${program}`).catch((error: unknown) => { toast.failed(`Could not start ${program}`, error) })
    if (machine !== LOCAL_MACHINE) {
      void startRemoteShell(machine).then((id) => { if (id !== null) void typeProgram(id) })
      return
    }
    const inFront = focusedSession !== undefined && focusedSession.machine === LOCAL_MACHINE ? focusedSession.cwd : null
    void runStart(async () => inFront ?? resolveStartFolder(preferences.startFolder, home || (await defaultSessionFolder())), (id) => {
      movePanes(() => { setLayout((current) => openArrangement(current, id, makeId)) })
      void typeProgram(id)
    })
  }, [focusedSession, setSettingsSection, runStart, startRemoteShell, preferences.startFolder, home, setLayout])

  // "Open worktree" in the + menu: a terminal in that worktree's folder, shown in the window.
  const openWorktree = useCallback((path: string) => {
    setSettingsSection(null)
    void runStart(() => Promise.resolve(path), (id) => { movePanes(() => { setLayout((current) => openArrangement(current, id, makeId)) }) })
  }, [setSettingsSection, runStart, setLayout])
  return { addAgentTerminal, closeAgentTerminal, startAgent, openWorktree }
}
