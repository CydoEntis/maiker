import { useCallback, useEffect, useRef, useState } from 'react'
import { explainError } from '@/lib/error-message'
import { agentInstallCommand, installAgent, listenInstallProgress } from './agentInstall'
import { agentLabel } from './setup'

/** Where one agent's install is. An agent not in the map is idle; one that finished is in `done`. */
export type InstallState =
  | { phase: 'asking'; command: string | null }
  | { phase: 'running'; command: string; percent: number | null; line: string }
  | { phase: 'failed'; reason: string }

type Installs = {
  states: Readonly<Record<string, InstallState>>
  /** Agents installed from here, with the version the installer reported. */
  done: Readonly<Record<string, string | null>>
  /** Fetches the command and shows it; nothing runs yet. */
  ask: (agents: readonly string[]) => void
  /** Runs the install of every agent whose command is shown. */
  run: (agents: readonly string[]) => void
  cancel: (agent: string) => void
}

/** The install flow for the setup's agent list: ask (show the command), run (with progress), then done or failed. */
export function useAgentInstalls(): Installs {
  const [states, setStates] = useState<Record<string, InstallState>>({})
  const [done, setDone] = useState<Record<string, string | null>>({})
  const commands = useRef(new Map<string, string>())

  const put = useCallback((agent: string, state: InstallState | null) => {
    setStates((current) => {
      const rest = Object.fromEntries(Object.entries(current).filter(([name]) => name !== agent))
      return state === null ? rest : { ...rest, [agent]: state }
    })
  }, [])

  useEffect(() => {
    let stop: (() => void) | undefined
    let stopped = false
    listenInstallProgress((progress) => {
      setStates((current) => {
        const now = current[progress.agent]
        return now?.phase === 'running' ? { ...current, [progress.agent]: { ...now, percent: progress.percent, line: progress.line } } : current
      })
    }).then((unlisten) => { if (stopped) unlisten(); else stop = unlisten }, (error: unknown) => { console.warn('Could not follow the installs', error) })
    return () => { stopped = true; stop?.() }
  }, [])

  const ask = useCallback((agents: readonly string[]) => {
    for (const agent of agents) {
      put(agent, { phase: 'asking', command: null })
      agentInstallCommand(agent).then(
        (command) => { commands.current.set(agent, command); put(agent, { phase: 'asking', command }) },
        (error: unknown) => { put(agent, { phase: 'failed', reason: explainError(error, `Could not look up how to install ${agentLabel(agent)}`).reason }) },
      )
    }
  }, [put])

  const run = useCallback((agents: readonly string[]) => {
    for (const agent of agents) {
      const command = commands.current.get(agent)
      if (command === undefined) continue
      put(agent, { phase: 'running', command, percent: null, line: '' })
      installAgent(agent).then(
        (result) => { put(agent, null); setDone((current) => ({ ...current, [agent]: result.version })) },
        (error: unknown) => { put(agent, { phase: 'failed', reason: explainError(error, `Could not install ${agentLabel(agent)}`).reason }) },
      )
    }
  }, [put])

  const cancel = useCallback((agent: string) => { put(agent, null) }, [put])

  return { states, done, ask, run, cancel }
}
