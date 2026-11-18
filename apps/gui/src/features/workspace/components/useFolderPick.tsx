import { useCallback, useState, type ReactNode } from 'react'
import { createFolder, listFolders } from '@/api/folders'
import type { PickedFolder } from '../model/folderPick'
import { PickFolderDialog, type PickerMachine } from './PickFolderDialog'

type Pending = { machine: number; answer: (picked: PickedFolder | null) => void }

/**
 * The window's folder picker: `pick(machine)` shows "Open a folder on <machine>" and answers with the folder chosen and the
 * machine it is on (the picker can switch machines), or null when it is cancelled. One picker serves this computer and every
 * other machine, so a folder is found the same way everywhere.
 */
export function useFolderPick(machines: readonly PickerMachine[]): { pick: (machine: number) => Promise<PickedFolder | null>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null)
  const pick = useCallback((machine: number) => new Promise<PickedFolder | null>((resolve) => { setPending({ machine, answer: resolve }) }), [])
  const settle = (picked: PickedFolder | null) => {
    pending?.answer(picked)
    setPending(null)
  }
  const dialog = pending === null ? null : <PickFolderDialog machines={machines} machine={pending.machine} list={listFolders} create={createFolder} onPick={settle} onCancel={() => { settle(null) }} />
  return { pick, dialog }
}
