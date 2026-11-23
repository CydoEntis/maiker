import { useCallback, useState, type ReactNode } from 'react'
import { OpenProjectPalette } from '@/features/open-project/OpenProjectPalette'
import type { MachineOs, PaletteMachine } from '@/features/open-project/openPalette'
import type { PickedFolder } from '../model/folderPick'

type Pending = { machine: number; answer: (picked: PickedFolder | null) => void }

const NONE_OPEN: ReadonlyArray<{ machineName: string | null; folder: string }> = []

/**
 * The window's way to ask for a folder: `pick(machine)` shows the Open a project palette's folder browser on that
 * machine, in its choosing mode, and answers with the folder chosen and the machine it is on (the palette can move to
 * another of `machines`), or null when it is closed. One browser serves this computer and every other machine.
 */
export function useFolderPick(machines: readonly PaletteMachine[], localOs: MachineOs = null, home = ''): { pick: (machine: number) => Promise<PickedFolder | null>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null)
  const pick = useCallback((machine: number) => new Promise<PickedFolder | null>((resolve) => { setPending({ machine, answer: resolve }) }), [])
  const settle = (picked: PickedFolder | null) => {
    pending?.answer(picked)
    setPending(null)
  }
  const dialog = pending === null ? null : (
    <OpenProjectPalette mode="pick" start={{ kind: 'folder', machine: pending.machine }} machines={machines} localOs={localOs} home={home} opened={NONE_OPEN}
      onTake={(picked) => { settle(picked); return Promise.resolve() }} onClose={() => { settle(null) }} />
  )
  return { pick, dialog }
}
