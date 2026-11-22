import { useEffect, useRef } from 'react'
import { toast } from '@/lib/toast'
import { useLatest } from '@/lib/useLatest'
import { downSentence, machineDrops, machineTitle, UPDATE_WORDS, type MachineHead, type MachinesDown, type UpdateAction } from './model/machines'

const downToastId = (name: string): string => `machine-down-${name}`

/**
 * Says once that another machine is not connected: its name, the host's one sentence for what failed (ADR 0017) and the
 * fix, Retry or the Install or Update it needs. The sidebar has no machine heading to say it on; its tag only turns amber.
 * The toast goes when the machine is back. A machine that is being updated drops on purpose, and its own toast says so.
 */
export function useMachineToasts({ heads, updating, onRetry, onUpdate }: {
  heads: readonly MachineHead[]
  /** The machines an install or update is running on, by name. */
  updating: Readonly<Record<string, number>>
  onRetry: (name: string) => void
  onUpdate: (name: string, action: UpdateAction) => void
}): void {
  const seen = useRef<MachinesDown | null>(null)
  const retry = useLatest(onRetry)
  const update = useLatest(onUpdate)
  useEffect(() => {
    const { seen: now, dropped, back } = machineDrops(seen.current, heads)
    seen.current = now
    for (const name of back) toast.dismiss(downToastId(name))
    for (const head of dropped) {
      const name = head.name
      if (name === null || name in updating) continue
      const fix = head.updateAction
      const action = fix === null
        ? { label: 'Retry', onClick: () => { retry(name) } }
        : { label: UPDATE_WORDS[fix].verb, onClick: () => { update(name, fix) } }
      toast.warning(`${machineTitle(head)} is not connected`, { id: downToastId(name), description: downSentence(head), action })
    }
  }, [heads, updating, retry, update])
}
