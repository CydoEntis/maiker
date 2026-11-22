import { useEffect, useRef } from 'react'
import { agentsInstalled } from '@/api/daemon'
import { agentInstallCommand, installAgent, type InstallableAgent } from '@/api/agentInstall'
import { stopsFor, stopToastOf, type StopsSeen } from '@/features/notifications/stops'
import { toast } from '@/lib/toast'
import { useLatest } from '@/lib/useLatest'
import { agentLabel, type SessionView } from './model/session'

const stopToastId = (sessionId: string): string => `stop-${sessionId}`

/**
 * Installs an agent from its toast, with the app's own installer (`install_agent`: a fixed command the host holds, never
 * text from here). The command it runs is shown while it runs, and the toast becomes the outcome in place.
 */
function installFromToast(agent: InstallableAgent, open: () => void): void {
  const label = agentLabel(agent)
  const id = `install-${agent}`
  const title = `Installing ${label}`
  toast.progress(title, { id })
  agentInstallCommand(agent)
    .then((command) => { toast.progress(title, { id, description: command }) })
    .then(() => installAgent(agent))
    .then(
      (installed) => {
        toast.success(`${label} installed`, {
          id,
          description: installed.version === null ? 'A new session will find it.' : `Version ${installed.version}. Start the session again.`,
          action: { label: 'Open', onClick: open },
        })
      },
      (error: unknown) => { toast.failed(`Could not install ${label}`, error, { id }) },
    )
}

/**
 * Says a session's stop once, as a toast: an agent that stopped is an error toast naming its project, with the fix first
 * where there is one (Install, for an agent that is not on this computer) and Open, which selects the session; one the
 * daemon holds for its plan limit is one warning toast saying when it carries on. `stopsFor` decides what is new, so a
 * re-render or a reconnect raises nothing twice. A toast goes when its stop does.
 */
export function useStopToasts({ sessions, listed, online, showSessionById }: {
  sessions: readonly SessionView[]
  /** The sessions have been listed once: before that an empty list is not "nothing stopped". */
  listed: boolean
  online: boolean
  showSessionById: (sessionId: string) => void
}): void {
  const seen = useRef<StopsSeen | null>(null)
  const show = useLatest(showSessionById)
  useEffect(() => {
    // With no line to the service every status is unknown and nothing new can be told.
    if (!listed || !online) return
    const { seen: now, stopped, ended } = stopsFor(seen.current, sessions)
    for (const id of ended) toast.dismiss(stopToastId(id))
    seen.current = now
    if (stopped.length === 0) return
    const raise = (installed: readonly string[] | null) => {
      for (const session of stopped) {
        const said = stopToastOf(session, installed)
        if (said === null) continue
        const open = () => { show(session.id) }
        const openAction = { label: 'Open', onClick: open }
        const fix = said.fix
        const actions = fix.kind === 'install'
          ? { action: { label: fix.label, onClick: () => { installFromToast(fix.agent, open) } }, secondary: openAction }
          : { action: openAction }
        toast[said.kind](said.title, { id: stopToastId(session.id), context: said.context, description: said.description, ...actions })
      }
    }
    // Asked when a stop happens, not once at the start: an agent installed since must not be offered again.
    agentsInstalled().then(raise, (error: unknown) => {
      console.warn('Could not look for the installed agents', error)
      raise(null)
    })
  }, [sessions, listed, online, show])
}
