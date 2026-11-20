import { useRef } from 'react'
import { createFolder, listFolders } from '@/api/folders'
import { toast } from '@/lib/toast'
import type { PickedFolder } from '../model/folderPick'
import type { MachineHead } from '../model/machines'
import type { OpenedProject } from '../model/openedProjects'
import { projectOfFolder } from '../projectOfFolder'
import { PickFolderDialog } from './PickFolderDialog'
import { pickerMachinesOf } from './useFolderPick'

type Props = {
  /** The machines the window knows; the picker can move to any of them. */
  heads: readonly MachineHead[]
  /** The machine whose folders the picker opens on. */
  machine: number
  /** Adds the project: the folder chosen, or its repository's main checkout. */
  onOpen: (project: OpenedProject) => void
  onClose: () => void
}

/**
 * Open a project on another machine: the folder picker on that machine, browsed or typed into, and the folder chosen is
 * opened as a project with no session. A folder that machine cannot read is refused with its reason in a toast, nothing is
 * added, and the picker stays so another folder can be chosen.
 */
export function ProjectFolderPicker({ heads, machine, onOpen, onClose }: Props) {
  // A second choice while the machine still reads the first would open two projects for one pick.
  const reading = useRef(false)
  const pick = ({ machine: chosen, folder }: PickedFolder) => {
    const head = heads.find((candidate) => candidate.machine === chosen)
    if (reading.current || head === undefined) return
    reading.current = true
    projectOfFolder(chosen, head.name, folder).then(
      (project) => {
        onOpen(project)
        onClose()
      },
      (error: unknown) => {
        reading.current = false
        toast.failed(`Could not open ${folder} as a project`, error)
      },
    )
  }
  return <PickFolderDialog machines={pickerMachinesOf(heads)} machine={machine} list={listFolders} create={createFolder} onPick={pick} onCancel={onClose} />
}
