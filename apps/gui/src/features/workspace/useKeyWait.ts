import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/lib/toast'
import { advanceKeyWaits, KEY_WAIT_DIAL_MS, type KeyWait } from './model/keyWait'
import type { MachineHead } from './model/machines'

/**
 * After the person sets up a machine's key in a terminal, the machine is dialled again until it connects: then "Connected
 * to <name>" is said once. Nothing here sees what is typed in the terminal; it only watches the machine's own state.
 */
export function useKeyWait(heads: readonly MachineHead[], retry: (name: string) => void) {
  // The machines waited for live in a ref so that the timer and the state check share one list; `watching` only starts and stops the timer.
  const waits = useRef<readonly KeyWait[]>([])
  const [watching, setWatching] = useState(false)
  const connectedKey = heads.flatMap((head) => (head.chip?.word === 'connected' && head.name !== null ? [head.name] : [])).sort().join('\n')
  const retryRef = useRef(retry)
  useEffect(() => { retryRef.current = retry }, [retry])

  const look = useCallback((connected: ReadonlySet<string>) => {
    const quiet = new Set(waits.current.filter((wait) => wait.quiet === true).map((wait) => wait.name))
    const step = advanceKeyWaits(waits.current, connected, Date.now())
    waits.current = step.still
    for (const name of step.connected) if (!quiet.has(name)) toast.success(`Connected to ${name}`)
    for (const name of step.gaveUp) if (!quiet.has(name)) toast.info(`Stopped waiting for ${name}. Retry it from Settings › Remote machines.`)
  }, [])

  useEffect(() => { look(new Set(connectedKey === '' ? [] : connectedKey.split('\n'))) }, [look, connectedKey, watching])

  useEffect(() => {
    if (!watching) return undefined
    const timer = setInterval(() => {
      look(new Set(connectedKey === '' ? [] : connectedKey.split('\n')))
      if (waits.current.length === 0) { setWatching(false); return }
      for (const wait of waits.current) retryRef.current(wait.name)
    }, KEY_WAIT_DIAL_MS)
    return () => { clearInterval(timer) }
  }, [watching, look, connectedKey])

  // Starts waiting for `name`; the returned call stops it. `quiet` leaves saying "Connected" to the caller.
  return useCallback((name: string, quiet = false) => {
    waits.current = [...waits.current.filter((wait) => wait.name !== name), { name, since: Date.now(), quiet }]
    setWatching(true)
    return () => { waits.current = waits.current.filter((wait) => wait.name !== name) }
  }, [])
}
