import { useCallback, useEffect, useRef, useState } from 'react'
import { agentInstallCommand, installAgent, listenInstallProgress, type InstallableAgent } from '@/api/agentInstall'
import { explainError } from '@/lib/error-message'
import { toast } from '@/lib/toast'
import { agentLabel } from './setup'

/** Where one agent's install is. An agent not in the map is idle; one that finished is in `done`. */
export type InstallState =
  /** The exact line the install runs is on show (null until the shell has said it); nothing runs until it is confirmed. */
  | { phase: 'asking'; command: string | null }
  /** Confirmed, behind another install: the desktop shell runs one at a time. */
  | { phase: 'waiting'; command: string }
  | { phase: 'running'; command: string; percent: number | null }
  | { phase: 'failed'; reason: string }

export type Installs = {
  states: Readonly<Record<string, InstallState>>
  /** Agents installed from here, with the version the installer reported. */
  done: Readonly<Record<string, string | null>>
  /** Fetches the command and shows it; nothing runs yet. */
  ask: (agent: InstallableAgent) => void
  /** Runs the install whose command is on show, in the background, after any install already running. */
  run: (agent: InstallableAgent) => void
  /** Takes back an install that is not running: the command on show, or a failure. */
  dismiss: (agent: string) => void
}

/**
 * Runs installs one after another, in the order asked for: the desktop shell refuses a second while one runs. `onWaiting`
 * is told of an agent that has to wait its turn.
 */
function installQueue(run: (agent: InstallableAgent) => Promise<void>, onWaiting: (agent: InstallableAgent) => void): (agent: InstallableAgent) => void {
  const waiting: InstallableAgent[] = []
  let busy = false
  const next = (): void => {
    const agent = waiting.shift()
    if (agent === undefined) { busy = false; return }
    busy = true
    void run(agent).finally(next)
  }
  return (agent) => {
    if (waiting.includes(agent)) return
    waiting.push(agent)
    if (busy) onWaiting(agent)
    else next()
  }
}

/**
 * The first run's installs. Install shows the exact command first and runs nothing until it is confirmed
 * (docs/SECURITY.md, "Shown before it runs"). Each install then runs in the desktop shell (`install_agent`, off the UI
 * thread). One that ends after the setup closed says so in a toast.
 */
export function useAgentInstalls(): Installs {
  const [states, setStates] = useState<Record<string, InstallState>>({})
  const [done, setDone] = useState<Record<string, string | null>>({})
  const mounted = useRef(true)

  const put = useCallback((agent: string, state: InstallState | null) => {
    setStates((current) => {
      const rest = Object.fromEntries(Object.entries(current).filter(([name]) => name !== agent))
      return state === null ? rest : { ...rest, [agent]: state }
    })
  }, [])

  useEffect(() => {
    mounted.current = true
    let stop: (() => void) | undefined
    let stopped = false
    listenInstallProgress((progress) => {
      setStates((current) => {
        const now = current[progress.agent]
        return now?.phase === 'running' && progress.percent !== null ? { ...current, [progress.agent]: { ...now, percent: progress.percent } } : current
      })
    }).then((unlisten) => { if (stopped) unlisten(); else stop = unlisten }, (error: unknown) => { console.warn('Could not follow the installs', error) })
    return () => { mounted.current = false; stopped = true; stop?.() }
  }, [])

  const ask = useCallback((agent: InstallableAgent) => {
    put(agent, { phase: 'asking', command: null })
    agentInstallCommand(agent).then(
      (command) => { setStates((current) => (current[agent]?.phase === 'asking' ? { ...current, [agent]: { phase: 'asking', command } } : current)) },
      (error: unknown) => { put(agent, { phase: 'failed', reason: explainError(error, `Could not look up how to install ${agentLabel(agent)}`).reason }) },
    )
  }, [put])

  /** Moves a confirmed install on, keeping the command that was shown; an agent whose command is not on show is left alone. */
  const advance = useCallback((agent: InstallableAgent, phase: 'waiting' | 'running') => {
    setStates((current) => {
      const now = current[agent]
      if (now === undefined || now.phase === 'failed' || now.command === null) return current
      return { ...current, [agent]: phase === 'waiting' ? { phase, command: now.command } : { phase, command: now.command, percent: null } }
    })
  }, [])

  const runOne = useCallback(async (agent: InstallableAgent): Promise<void> => {
    const label = agentLabel(agent)
    advance(agent, 'running')
    try {
      const installed = await installAgent(agent)
      put(agent, null)
      setDone((current) => ({ ...current, [agent]: installed.version }))
      if (!mounted.current) toast.success(`${label} installed`, installed.version === null ? {} : { description: `Version ${installed.version}.` })
    } catch (error) {
      put(agent, { phase: 'failed', reason: explainError(error, `Could not install ${label}`).reason })
      if (!mounted.current) toast.failed(`Could not install ${label}`, error)
    }
  }, [advance, put])

  const queue = useRef<((agent: InstallableAgent) => void) | null>(null)
  const run = useCallback((agent: InstallableAgent) => {
    queue.current ??= installQueue(runOne, (waiting) => { advance(waiting, 'waiting') })
    queue.current(agent)
  }, [runOne, advance])

  const dismiss = useCallback((agent: string) => { put(agent, null) }, [put])

  return { states, done, ask, run, dismiss }
}
