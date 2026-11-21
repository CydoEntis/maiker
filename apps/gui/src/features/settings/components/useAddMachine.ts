import { useCallback, useEffect, useReducer, useRef } from 'react'
import { errorMessage } from '@/lib/error-message'
import type { MachineHead } from '@/features/workspace/model/machines'
import { addStep, IDLE, savedNameOf, type AddRequest, type AddState } from '../model/addFlow'
import type { MachinesInfo } from './DesktopSettings'

export type AddMachine = {
  state: AddState
  /** The machine the last try saved, which a new try takes out first; null when there is none. */
  saved: string | null
  /** Adds the machine, with Maiker installed when it is missing. A machine the last try saved is taken out first, so its name is free. */
  add: (request: AddRequest) => void
  /** The last request again. */
  retry: () => void
  /** Ends the add that is running; the field is back as it was. */
  cancel: () => void
}

function isConnected(list: readonly MachineHead[], name: string): boolean {
  return list.some((head) => head.name === name && head.chip?.word === 'connected')
}

/**
 * Runs Add a remote machine (`addStep` decides the screen): one call to the host, its install progress, and the clean up. The host
 * writes a machine before it logs in, so a machine saved by a try that did not connect is taken out when the dialog closes or the
 * add is cancelled; nothing unseen is left behind. `onAdded` is called once the machine is in.
 */
export function useAddMachine(machines: MachinesInfo, onAdded: (name: string) => void): AddMachine {
  const [state, dispatch] = useReducer(addStep, IDLE)
  const runs = useRef(0)
  // The parent builds `machines` again on every refresh of the list: the calls read the newest one without restarting anything.
  const latest = useRef({ state, machines })
  useEffect(() => { latest.current = { state, machines } })
  const removing = useRef(false)
  const alive = useRef(true)

  const begin = useCallback((request: AddRequest) => {
    const run = ++runs.current
    dispatch({ type: 'start', run, request })
    latest.current.machines.add.onAdd(request.target, request.name, request.port ?? undefined, { keyFile: request.keyFile, installHelper: true }).then(
      (result) => {
        if (run === runs.current) { dispatch({ type: 'answered', run, result }); return }
        // Nobody waits for this answer any more (cancelled, or the dialog closed), so a machine it saved goes again.
        const saved = savedNameOf(result)
        if (saved !== null) void latest.current.machines.onRemove(saved)
      },
      (error: unknown) => { if (run === runs.current) dispatch({ type: 'rejected', run, message: errorMessage(error, 'Could not add the machine') }) },
    )
  }, [])

  const add = useCallback((request: AddRequest) => {
    const { state: now, machines: current } = latest.current
    if (now.kind === 'busy' || removing.current) return
    const saved = now.kind === 'failed' ? now.failure.saved : null
    if (saved === null) { begin(request); return }
    removing.current = true
    // A refusal to take it out has already been told to the person; the sentence stays so they can try again.
    void current.onRemove(saved).then((removed) => {
      removing.current = false
      if (removed && alive.current && latest.current.state === now) begin(request)
    })
  }, [begin])

  const retry = useCallback(() => {
    const now = latest.current.state
    if (now.kind === 'failed') add(now.request)
  }, [add])

  const cancel = useCallback(() => {
    runs.current += 1
    latest.current.machines.add.onCancel()
    dispatch({ type: 'cancel' })
  }, [])

  const { onProgress } = machines.add
  useEffect(() => {
    let gone = false
    let stop: (() => void) | null = null
    onProgress((progress) => { dispatch({ type: 'installing', name: progress.name }) }).then(
      (stopListening) => { if (gone) stopListening(); else stop = stopListening },
      (error: unknown) => { console.warn('Could not follow the Maiker install', error) },
    )
    return () => { gone = true; stop?.() }
  }, [onProgress])

  const saved = state.kind === 'failed' ? state.failure.saved : null
  const connectedName = saved !== null && isConnected(machines.list, saved) ? saved : null
  useEffect(() => { if (connectedName !== null) dispatch({ type: 'connected', name: connectedName }) }, [connectedName])

  const addedName = state.kind === 'added' ? state.name : null
  const done = useRef(onAdded)
  useEffect(() => { done.current = onAdded })
  useEffect(() => { if (addedName !== null) done.current(addedName) }, [addedName])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      runs.current += 1
      const { state: last, machines: current } = latest.current
      if (last.kind === 'busy') current.add.onCancel()
      if (last.kind === 'failed' && last.failure.saved !== null && !isConnected(current.list, last.failure.saved)) void current.onRemove(last.failure.saved)
    }
  }, [])

  return { state, saved, add, retry, cancel }
}
