import type { ReactNode } from 'react'
import { LOCAL_MACHINE } from '@/api/machines'
import { BranchChip } from '../place/BranchChip'
import { FolderChip } from '../place/FolderChip'
import { MachineChip } from '../place/MachineChip'
import { NoBranchChip } from '../place/NoBranchChip'
import type { PlacePicking } from '../place/picking'
import { usePlaceActions } from '../place/placeActions'
import { SyncChip } from '../place/SyncChip'
import { useSessionSync } from '../place/useSessionSync'
import '../place/place-chips.css'

/** Where a session runs, as the session list already knows it. The view never reads git for it. */
export type SessionPlace = {
  /** The machine's name when it is not this computer; null on this computer, where nothing shows. */
  machine: string | null
  /** The project (repository) name, or the folder's when there is no repository. */
  project: string
  /** The branch the daemon reports; null outside git. */
  branch: string | null
  /** The session works in a linked worktree. */
  worktree: boolean
  /** The full folder path, for the hover tooltip and the folder menu. */
  folder?: string | undefined
  /** The number of the machine the session lives on; 0 for this computer. */
  machineId?: number | undefined
  /** The session's pane, which names its checkout on another machine. */
  pane?: number | undefined
  /** The linked worktree's folder name, when the session is in one. */
  worktreeName?: string | null | undefined
  /** Set on a draft, a session not started: the chips choose the machine, folder and branch it will start with. */
  picking?: PlacePicking | undefined
}

type Props = {
  place?: SessionPlace | undefined
  /** What sits at the right end of the row: the context bar. */
  children?: ReactNode
}

/**
 * The row under the chat box of a session that has run nothing (`placeChipsShown`): folder, branch and sync as plain
 * chips at the left, the context bar at the right. It is never wider than the box, and the folder's text gives way
 * first (its full path is on hover). Once the session has run, the composer does not draw it.
 */
export function SessionBar({ place, children }: Props) {
  return (
    <div className="mx-session-bar" data-screen-label="Under the box">
      {place !== undefined && <Place place={place} />}
      <span className="mx-spacer" />
      {children}
    </div>
  )
}

function Place({ place }: { place: SessionPlace }) {
  const actions = usePlaceActions()
  const machine = place.machineId ?? LOCAL_MACHINE
  const folder = place.folder ?? ''
  const branch = folder === '' ? null : place.branch
  const { picking } = place
  const term = place.pane ?? 0
  // Another machine's checkout is named by the session's pane, so a draft there (no pane yet) has nothing to sync.
  const reading = branch === null || picking?.sync === false ? 'none' : machine === LOCAL_MACHINE ? 'counted' : term > 0 ? 'uncounted' : 'none'
  const sync = useSessionSync({ folder, machine, term, project: place.project, reading, branch })
  const text = place.worktreeName == null ? place.project : `${place.project} / ${place.worktreeName}`
  return (
    <span className="mx-session-place" role="group" aria-label="Session location">
      {picking !== undefined && <MachineChip machine={picking.machine} />}
      {place.machine !== null && <span className="mx-session-machine">{place.machine}</span>}
      {folder === '' && picking === undefined
        ? <span className="mx-place-chip is-folder"><span className="mx-place-text">{text}</span></span>
        : <FolderChip folder={folder} text={text} machine={machine} machineName={place.machine} projects={actions.projects} onNewSessionIn={actions.onNewSessionIn} picking={picking?.folder} />}
      {branch !== null && <BranchChip folder={folder} machine={machine} branch={branch} project={place.project} worktreeName={place.worktreeName ?? null} picking={picking?.branch} />}
      {branch === null && picking?.noBranch != null && <NoBranchChip note={picking.noBranch} />}
      {sync !== null && branch !== null && picking?.sync !== false && <SyncChip state={sync} branch={branch} />}
    </span>
  )
}
