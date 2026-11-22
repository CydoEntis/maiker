import { createContext, useContext } from 'react'
import { closedSessions, type ClosedSession } from '@/api/daemon'
import { chooseProjectFolder } from '@/api/folderPicker'
import { createFolder, listFolders, type CreateFolderOutcome } from '@/api/folders'
import type { Status } from './PaletteBody'
import type { Level, MachineOs, PaletteMachine, PaletteMode, RecentProject, RowAction } from './openPalette'
import type { CloneState } from './useCloneProject'
import type { ListFolders } from './useFolderListing'

/** What the palette asks of the machines. Given as props so the palette never knows how a machine is reached. */
export type PaletteServices = {
  list: ListFolders
  /** Makes the folder `name` inside `parent` on a machine; that machine's daemon decides. */
  create: (machine: number, parent: string, name: string) => Promise<CreateFolderOutcome>
  /** This computer's closed sessions, newest first; null from a service older than the question. */
  closed: () => Promise<ClosedSession[] | null>
  /** The system's own folder dialog, on this computer only; null where there is none. */
  chooseSystemFolder: ((startAt: string) => Promise<string | null>) | null
}

/** The desktop's own calls: each machine's daemon lists and makes folders, this computer's remembers closed sessions. */
export const DESKTOP_SERVICES: PaletteServices = {
  list: (machine, path) => listFolders(machine, path),
  create: (machine, parent, name) => createFolder(machine, parent, name),
  closed: async () => closedSessions(),
  chooseSystemFolder: (startAt) => chooseProjectFolder(startAt === '' ? undefined : startAt),
}

/** What every level of the palette shares: where it is, the machines, and the ways to move, take a folder and clone. */
export type PaletteShell = {
  mode: PaletteMode
  machines: readonly PaletteMachine[]
  machineOf: (machine: number) => PaletteMachine
  osOf: (machine: PaletteMachine) => MachineOs
  /** A machine's home folder once it is known, so paths under it read `~`. */
  homeOf: (machine: number) => string | null
  learnHome: (machine: number, home: string) => void
  /** The folders open as projects on a machine. */
  openOn: (machine: PaletteMachine) => readonly string[]
  recent: readonly RecentProject[]
  services: PaletteServices
  go: (level: Level) => void
  /** Back to the first level. */
  back: () => void
  /** Does what a row says, for the actions every level shares; a level handles its own first. */
  act: (action: RowAction) => void
  /** Opens (or, when picking, answers with) a folder on a machine, then closes the palette. */
  take: (machine: number, folder: string) => void
  /** The folder being taken, or why it could not be: shown in place of a level's own message. */
  taking: Status | null
  /** Drops a refusal that has been read: the next thing typed is about something else. */
  forget: () => void
  /** The machine a clone goes onto, and the next one a press of its button picks. */
  onto: PaletteMachine
  nextOnto: () => void
  clone: CloneState
  startClone: (label: string, address: string) => void
  resetClone: () => void
  /** True while a clone or an open runs: nothing else can be chosen and the palette stays. */
  locked: boolean
}

export const PaletteShellContext = createContext<PaletteShell | null>(null)

export function usePaletteShell(): PaletteShell {
  const shell = useContext(PaletteShellContext)
  if (shell === null) throw new Error('A palette level was drawn outside the palette')
  return shell
}
