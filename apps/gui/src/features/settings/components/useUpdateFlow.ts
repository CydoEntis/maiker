import { useCallback, useRef, useState } from 'react'
import type { MachineActivity } from '@/api/machines'
import type { MachineHead, UpdateAction } from '@/features/workspace/model/machines'

/** The update a person has been asked about and not yet answered. */
export type Asked = { name: string; action: UpdateAction; activity: MachineActivity | null }

export type UpdateFlow = {
  /** The machine whose open sessions are being counted before the question. */
  checking: string | null
  asking: Asked | null
  /** Machines being installed on or updated now. */
  running: ReadonlySet<string>
  /** Ask first: an install is one question, an update counts what it will interrupt (ADR 0007). */
  ask: (head: MachineHead) => void
  cancel: () => void
  /** Answer the question: install or update now, or (`whenIdle`) once nothing is open there. */
  run: (whenIdle: boolean) => void
  /** Update several machines at once, after the person has been asked about all of them. */
  runAll: (names: readonly string[], whenIdle: boolean) => void
}

type Update = (name: string, action: UpdateAction, whenIdle: boolean) => Promise<void>
type Check = (name: string) => Promise<MachineActivity | null>

/** The ask-then-run steps shared by the list's Update and Install buttons and the machine page's. */
export function useUpdateFlow(onUpdate: Update, onCheckActivity: Check): UpdateFlow {
  const [checking, setChecking] = useState<string | null>(null)
  const [asking, setAsking] = useState<Asked | null>(null)
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set())
  // The question of the latest ask only: an answer that comes back after another ask is dropped.
  const latest = useRef(0)

  const mark = useCallback((names: readonly string[], on: boolean) => {
    setRunning((now) => new Set([...now].filter((name) => !names.includes(name)).concat(on ? names : [])))
  }, [])

  const ask = useCallback((head: MachineHead) => {
    const { updateAction: action, label: name } = head
    if (action === null) return
    const ticket = ++latest.current
    if (action === 'install') { setAsking({ name, action, activity: null }); return }
    setChecking(name)
    onCheckActivity(name).catch(() => null).then((activity) => {
      if (ticket !== latest.current) return
      setChecking(null)
      setAsking({ name, action, activity })
    }, () => { setChecking(null) })
  }, [onCheckActivity])

  const cancel = useCallback(() => { latest.current += 1; setChecking(null); setAsking(null) }, [])

  const run = useCallback((whenIdle: boolean) => {
    if (asking === null) return
    const { name, action } = asking
    setAsking(null)
    mark([name], true)
    // `onUpdate` has already told the person how it went, so only the busy mark is left to clear.
    void onUpdate(name, action, whenIdle).finally(() => { mark([name], false) })
  }, [asking, mark, onUpdate])

  const runAll = useCallback((names: readonly string[], whenIdle: boolean) => {
    mark(names, true)
    for (const name of names) void onUpdate(name, 'update', whenIdle).finally(() => { mark([name], false) })
  }, [mark, onUpdate])

  return { checking, asking, running, ask, cancel, run, runAll }
}
