import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '@/lib/error-message'
import { reachedOf, savedNameOf, stageAfterAdd, stageAfterFailure, type AddRequest, type HostResult, type Stage } from '../model/addStage'
import type { MachinesInfo } from './DesktopSettings'

/** The steps the host takes for one machine, in the order they are asked. */
export type AddRun = {
  stage: Stage
  host: HostResult
  /** Asks the whole sequence again from the start (a machine that could not be reached). */
  retry: () => void
  /** Trusts the host key that was shown, then goes on. */
  trust: () => void
  /** Puts Maiker on the saved machine (or brings it up to date), showing how far it has got. */
  setUpHelper: (action: 'install' | 'update') => void
  /** Takes a saved machine of the same name out, then starts the whole run again from the top. */
  removeSaved: (name: string) => void
  /** Dials a saved machine of the same name again and follows it through the checklist from where it stopped. */
  retrySaved: (name: string) => void
  /** Leaves the machine saved as it is (without Maiker, or with its old one): it is no longer taken out when this goes away. */
  keep: () => void
}

/**
 * Runs adding one machine: look at its host key (nothing is written yet), ask the host to add it with the helper installed when
 * it is missing, and follow where that goes. Only the latest run may change the screen. When this goes away with a machine saved
 * that never connected, the machine is taken out again, so a Cancel or a closed dialog leaves nothing unseen behind; one that
 * connected stays.
 */
export function useAddRun(request: AddRequest, machines: MachinesInfo): AddRun {
  const { add, list } = machines
  const [stage, setStage] = useState<Stage>({ kind: 'checking' })
  const [host, setHost] = useState<HostResult>('unchecked')
  const ticket = useRef(0)
  const saved = useRef<string | null>(null)
  const latest = useRef({ stage, onRemove: machines.onRemove, onCancel: add.onCancel })
  useEffect(() => { latest.current = { stage, onRemove: machines.onRemove, onCancel: add.onCancel } })
  // The parent builds `add` and `request` again on every refresh of the machine list. A run that restarted with them would begin
  // again every few seconds (an endless "connecting" that jumps back), so the run reads the newest ones without depending on them.
  const inputs = useRef({ add, request })
  useEffect(() => { inputs.current = { add, request } })

  const connect = useCallback((seen: HostResult, run: number) => {
    const { add, request } = inputs.current
    setHost(seen)
    setStage({ kind: 'adding', helper: false, action: 'install', percent: null })
    add.onAdd(request.target, request.name, request.port ?? undefined, { keyFile: request.keyFile, installHelper: true }).then(
      (result) => {
        if (run !== ticket.current) return
        const next = stageAfterAdd(result, request)
        if (next === null) return
        // The host writes the machine before it logs in: from here it is saved, and goes again unless it connects.
        saved.current = savedNameOf(next)
        setStage(next)
      },
      (error: unknown) => { if (run === ticket.current) setStage(stageAfterFailure(errorMessage(error, 'Could not add the machine'))) },
    )
  }, [])

  const begin = useCallback(() => {
    const { add, request } = inputs.current
    const run = ++ticket.current
    setStage({ kind: 'checking' })
    // A host whose key cannot be fetched here (a jump host, say) is still added as before: ssh checks the key itself.
    void add.inspect(request.target, request.port ?? undefined).catch((error: unknown) => {
      console.warn('Could not look at the host key before adding', error)
      return null
    }).then((report) => {
      if (run !== ticket.current) return
      if (report?.status === 'changed') setStage({ kind: 'changed', report })
      else if (report?.status === 'unknown') setStage({ kind: 'trust', report, trusting: false, problem: null })
      else connect(report === null ? 'unchecked' : 'known', run)
    })
  }, [connect])

  // Deferred so that the double mount of development builds asks the host once, not twice.
  useEffect(() => {
    const timer = window.setTimeout(begin, 0)
    return () => { window.clearTimeout(timer) }
  }, [begin])

  // The host says how far the helper's install has got, by the machine's name.
  const { name: addedName } = request
  useEffect(() => {
    let gone = false
    let stop: (() => void) | null = null
    inputs.current.add.onProgress((progress) => {
      if (progress.name !== addedName) return
      setStage((now) => (now.kind === 'adding' ? { ...now, helper: true, percent: progress.percent } : now))
    }).then((stopListening) => { if (gone) stopListening(); else stop = stopListening }, (error: unknown) => { console.warn('Could not follow the helper install', error) })
    return () => { gone = true; stop?.() }
  }, [addedName])

  // A machine waiting on the person (a key, a restart) goes on by itself the moment it connects.
  const waitingName = stage.kind === 'key' ? stage.login.name : stage.kind === 'saved' ? stage.name : stage.kind === 'helper' && stage.reason === 'not-running' ? stage.added.name : null
  const connectedName = waitingName !== null && list.some((head) => head.name === waitingName && head.chip?.word === 'connected') ? waitingName : null
  useEffect(() => { if (connectedName !== null) saved.current = null }, [connectedName])
  const shown: Stage = connectedName === null
    ? stage
    : { kind: 'connected', reached: reachedOf(request, connectedName, stage.kind === 'helper' ? stage.added : null) }

  useEffect(() => () => {
    ticket.current += 1
    const { stage: last, onRemove, onCancel } = latest.current
    if (last.kind === 'checking' || last.kind === 'adding') onCancel()
    if (saved.current !== null) void onRemove(saved.current)
  }, [])

  const trust = () => {
    if (stage.kind !== 'trust' || stage.trusting) return
    const { report } = stage
    const run = ticket.current
    setStage({ ...stage, trusting: true, problem: null })
    add.trust(request.target, report.fingerprint, request.port ?? undefined).then(
      () => { if (run === ticket.current) connect('trusted', run) },
      (error: unknown) => { if (run === ticket.current) setStage({ kind: 'trust', report, trusting: false, problem: errorMessage(error, 'Could not trust the key') }) },
    )
  }

  const setUpHelper = (action: 'install' | 'update') => {
    const before = stage
    const target = before.kind === 'helper' ? { name: before.added.name, added: before.added } : before.kind === 'saved' ? { name: before.name, added: null } : null
    if (target === null) return
    const run = ticket.current
    setStage({ kind: 'adding', helper: true, action, percent: null })
    machines.onUpdate(target.name, action, false).then(
      () => {
        if (run !== ticket.current) return
        saved.current = null
        setStage({ kind: 'connected', reached: reachedOf(request, target.name, target.added) })
      },
      () => { if (run === ticket.current) setStage(before) },
    )
  }

  // The run starts again only once the host has taken the machine out: its name is free then, so the add cannot be refused for it.
  const removeSaved = (name: string) => {
    const run = ++ticket.current
    setStage({ kind: 'removing', name })
    void machines.onRemove(name).then((removed) => {
      if (run !== ticket.current) return
      if (removed) begin()
      else setStage({ kind: 'name-taken', name })
    })
  }

  const retrySaved = (name: string) => {
    ++ticket.current
    machines.onRetry(name)
    setStage({ kind: 'saved', name })
  }

  const keep = () => { saved.current = null }

  return { stage: shown, host, retry: begin, trust, setUpHelper, removeSaved, retrySaved, keep }
}
