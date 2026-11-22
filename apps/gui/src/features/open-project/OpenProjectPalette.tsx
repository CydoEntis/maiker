import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { errorMessage } from '@/lib/error-message'
import { windowRoot } from '@/features/workspace/components/windowRoot'
import { baseName, joinPath, type PickedFolder } from '@/features/workspace/model/folderPick'
import { BrowseLevel } from './BrowseLevel'
import { GitHubLevel, UrlLevel } from './CloneLevels'
import type { Status } from './PaletteBody'
import { SourcesLevel } from './SourcesLevel'
import { HOME_FOLDER, ignoresCase, nextOf, recentProjects, sameFolder, type Level, type MachineOs, type PaletteMachine, type PaletteMode, type RecentProject, type RowAction } from './openPalette'
import { OPEN_PALETTE_ATTRIBUTE } from './paletteOpen'
import { DESKTOP_SERVICES, PaletteShellContext, type PaletteServices, type PaletteShell } from './paletteShell'
import { useCloneProject } from './useCloneProject'
import './open-palette.css'

/** Where the palette opens: the list of sources, a folder of a machine, or one of the two ways to clone. */
export type PaletteStart = { kind: 'sources' } | { kind: 'folder'; machine: number; folder?: string | undefined } | { kind: 'url' } | { kind: 'github' }

type Props = {
  /** `open` brings a project in; `pick` only answers with a folder, so it lists the machines' folders and nothing else. */
  mode: PaletteMode
  start: PaletteStart
  machines: readonly PaletteMachine[]
  /** This computer's system, which says whether its folder names ignore case; another machine's is told by its paths. */
  localOs: MachineOs
  /** This computer's home folder, so paths under it read `~`; '' until it is known. */
  home: string
  /** The folders open as projects, by machine name (null is this computer). */
  opened: ReadonlyArray<{ machineName: string | null; folder: string }>
  /**
   * Takes the folder chosen: opens it as a project, or hands it to whoever asked. The palette closes when this resolves;
   * a rejection keeps it open and its reason is shown.
   */
  onTake: (picked: PickedFolder) => Promise<void>
  onAddMachine?: (() => void) | undefined
  onClose: () => void
  services?: PaletteServices | undefined
}

type Taking = { state: 'taking'; folder: string } | { state: 'refused'; folder: string; why: string } | null

const levelOf = (start: PaletteStart, machines: readonly PaletteMachine[]): Level => {
  if (start.kind !== 'folder') return { kind: start.kind }
  const machine = machines.find((candidate) => candidate.machine === start.machine)
  return { kind: 'browse', machine: start.machine, path: start.folder ?? machine?.start ?? HOME_FOLDER }
}

/**
 * Open a project: the one keyboard palette for bringing a folder in from any machine. It lists where a project can come
 * from, browses folders the same way on every machine, and clones from a link or from GitHub. The frame is one size at
 * every level. Enter does what the highlighted row says, Backspace on an empty field goes back or up, Esc closes.
 */
export function OpenProjectPalette({ mode, start, machines, localOs, home, opened, onTake, onAddMachine, onClose, services = DESKTOP_SERVICES }: Props) {
  const [level, setLevel] = useState<Level>(() => levelOf(start, machines))
  const [homes, setHomes] = useState<Readonly<Record<number, string>>>({})
  const [taking, setTaking] = useState<Taking>(null)
  const [closed, setClosed] = useState<ReadonlyArray<{ folder: string; present: boolean }>>([])
  const local = machines.find((machine) => machine.name === null) ?? null
  const first = machines[0]
  const [ontoNumber, setOntoNumber] = useState(start.kind === 'folder' ? start.machine : local?.machine ?? first?.machine ?? 0)
  // Two takes at once would open two projects for one choice.
  const busy = useRef(false)

  useEffect(() => {
    if (mode !== 'open') return undefined
    let live = true
    services.closed().then(
      (list) => { if (live && list !== null) setClosed(list.map((session) => ({ folder: session.repo ?? session.cwd, present: session.repo !== null || session.folder_present }))) },
      // Recent projects are a shortcut: without them the palette still browses and clones.
      () => undefined,
    )
    return () => { live = false }
  }, [mode, services])

  const machineOf = useCallback((machine: number): PaletteMachine => machines.find((candidate) => candidate.machine === machine) ?? first ?? { machine, name: null, label: 'This computer', address: null, ready: true, why: null, start: HOME_FOLDER }, [machines, first])
  const openOn = useCallback((machine: PaletteMachine) => opened.filter((project) => (project.machineName === null ? machine.name === null : machine.name !== null && project.machineName.toLowerCase() === machine.name.toLowerCase())).map((project) => project.folder), [opened])
  const osOf = useCallback((machine: PaletteMachine): MachineOs => (machine.name === null ? localOs : null), [localOs])
  const take = useCallback((machine: number, folder: string) => {
    if (busy.current) return
    busy.current = true
    setTaking({ state: 'taking', folder })
    // A folder that is open already is taken in the spelling it was opened with, so it is never listed a second time.
    const from = machineOf(machine)
    const known = openOn(from).find((other) => sameFolder(other, folder, ignoresCase(folder, osOf(from))))
    onTake({ machine, folder: known ?? folder }).then(onClose, (error: unknown) => {
      busy.current = false
      setTaking({ state: 'refused', folder, why: errorMessage(error, 'The folder could not be read') })
    })
  }, [onTake, onClose, machineOf, openOn, osOf])
  const cloning = useCloneProject(take)

  const learnHome = useCallback((machine: number, folder: string) => { setHomes((known) => (known[machine] === folder ? known : { ...known, [machine]: folder })) }, [])
  const homeOf = useCallback((machine: number) => homes[machine] ?? (machine === local?.machine && home !== '' ? home : null), [homes, local, home])

  const recent = useMemo<readonly RecentProject[]>(() => (local === null ? [] : recentProjects(closed, openOn(local), local, ignoresCase(home, localOs))), [closed, local, openOn, home, localOs])
  const ready = machines.filter((machine) => machine.ready)
  const onto = ready.find((machine) => machine.machine === ontoNumber) ?? ready[0] ?? machineOf(ontoNumber)
  const locked = taking?.state === 'taking' || cloning.state.kind === 'cloning'

  const forget = () => { if (taking?.state === 'refused') setTaking(null) }
  const go = (next: Level) => { forget(); setLevel(next) }
  const back = () => { cloning.reset(); go({ kind: 'sources' }) }
  const act = (action: RowAction) => {
    if (action.do === 'open') take(action.machine, action.folder)
    else if (action.do === 'browse') go({ kind: 'browse', machine: action.machine, path: action.path })
    else if (action.do === 'level') go({ kind: action.level })
    else if (action.do === 'add-machine') onAddMachine?.()
  }
  const takingStatus: Status | null = taking === null ? null
    : taking.state === 'taking' ? { tone: 'working', title: `${mode === 'open' ? 'Opening' : 'Choosing'} ${baseName(taking.folder)}`, detail: taking.folder }
    : { tone: 'bad', title: `Could not open ${baseName(taking.folder)}`, detail: taking.why }

  const shell: PaletteShell = {
    mode, machines, machineOf, osOf, homeOf, learnHome, openOn, recent, services, go, back, act, take, forget,
    taking: takingStatus,
    onto,
    nextOnto: () => { setOntoNumber(nextOf(ready, onto).machine) },
    clone: cloning.state,
    startClone: (label, address) => {
      const name = baseName(label)
      cloning.clone({ machine: onto.machine, label, address, parent: onto.start, target: joinPath(onto.start, name) })
    },
    resetClone: () => { if (cloning.state.kind === 'problem') cloning.reset() },
    locked,
  }
  const title = mode === 'open' ? 'Open a project' : 'Choose a folder'

  return (
    // A clone that is running cannot be taken back, and a folder being opened is about to close the palette itself.
    <Dialog open onOpenChange={(isOpen) => { if (!isOpen && !locked) onClose() }}>
      <DialogContent unstyled container={windowRoot()} overlayClassName="mx-op-scrim" aria-label={title} aria-describedby={undefined} className="mx-op" {...{ [OPEN_PALETTE_ATTRIBUTE]: '' }} onOpenAutoFocus={(event) => { event.preventDefault() }}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <PaletteShellContext.Provider value={shell}>
          {level.kind === 'sources' && <SourcesLevel />}
          {/* A new folder is a new list: its filter and its highlighted row start over. */}
          {level.kind === 'browse' && <BrowseLevel key={`${String(level.machine)}:${level.path}`} level={level} />}
          {level.kind === 'url' && <UrlLevel />}
          {level.kind === 'github' && <GitHubLevel />}
        </PaletteShellContext.Provider>
      </DialogContent>
    </Dialog>
  )
}
