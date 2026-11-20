import { useState } from 'react'
import { toast } from '@/lib/toast'
import type { AddRequest, MachineFacts } from '../model/addStage'
import { AddMachinePanel } from './AddMachinePanel'
import { AddRun } from './AddRun'
import type { MachinesInfo } from './DesktopSettings'

type Props = {
  machines: MachinesInfo
  onClose: () => void
  /** Start a session on the machine just added (by its number). */
  onStartSession: (machine: number) => void
  /** What the machine's daemon can say about it, once the host reports that. */
  facts?: MachineFacts | undefined
  /** The running app's version, for the helper that is copied. */
  appVersion?: string | null | undefined
}

/**
 * Add a remote machine, start to end, in one card: the address, then the checklist after Connect, then Machine added. Change
 * address comes back to what was typed. Nothing is saved before the host adds the machine, so going back or cancelling early
 * leaves nothing behind.
 */
export function AddMachineFlow({ machines, onClose, onStartSession, facts, appVersion }: Props) {
  const [request, setRequest] = useState<AddRequest | null>(null)
  const [entry, setEntry] = useState<AddRequest['entry'] | undefined>(undefined)

  // The label is a local name for the machine in this window; it is only saved when it is not the name the host knows it by.
  const save = (name: string, label: string) => { if (label !== name) machines.onRename(name, label) }

  if (request === null) {
    return <AddMachinePanel machines={machines} onClose={onClose} entry={entry} onConnect={(next) => { setEntry(next.entry); setRequest(next) }} />
  }
  return (
    <AddRun
      request={request}
      machines={machines}
      facts={facts}
      appVersion={appVersion}
      onChangeAddress={() => { setRequest(null) }}
      onClose={onClose}
      onKept={(name) => { toast.info(`Added ${name}`); onClose() }}
      onDone={(name, label) => { save(name, label); onClose() }}
      onStart={(name, label, machine) => { save(name, label); onClose(); onStartSession(machine) }}
    />
  )
}
