import { useCallback, useEffect, useRef, useState } from 'react'
import { cloneRepository, type ClonePhase, type CloneProgress } from '@/api/cloneRepository'
import { LOCAL_MACHINE } from '@/api/machines'
import { errorMessage } from '@/lib/error-message'
import { baseName } from '@/features/workspace/model/folderPick'
import { explainCloneFailure, type CloneProblem } from '@/features/workspace/model/repoAddress'

/** Where the dialog's one project stands: nothing yet, being cloned, on the disk and ready for a session, or not cloned. */
export type ProjectState =
  | { kind: 'idle' }
  | { kind: 'cloning'; label: string; progress: CloneProgress | null }
  | { kind: 'ready'; name: string; folder: string }
  | { kind: 'problem'; problem: CloneProblem }

const IDLE: ProjectState = { kind: 'idle' }

/** What git is doing, in the words a person would use. */
export const PHASE_WORDS: Readonly<Record<ClonePhase, string>> = {
  counting: 'Counting objects',
  compressing: 'Compressing',
  receiving: 'Receiving',
  resolving: 'Resolving deltas',
  'checking-out': 'Writing files',
}

/**
 * The project a dialog is bringing in, on this computer: `clone` runs the daemon's clone and follows its progress, `open`
 * marks a folder already on the disk as ready, `reset` goes back to choosing. A clone that has been left (the dialog closed)
 * is not reported on, though the daemon still finishes it.
 */
export function useCloneProject(): { state: ProjectState; /** The folders cloned since the dialog opened, by the repository's name. */ cloned: ReadonlyMap<string, string>; clone: (label: string, address: string, parent: string) => void; open: (folder: string) => void; reset: () => void } {
  const [state, setState] = useState<ProjectState>(IDLE)
  const [cloned, setCloned] = useState<ReadonlyMap<string, string>>(new Map())
  const turn = useRef(0)
  useEffect(() => () => { turn.current += 1 }, [])

  const clone = useCallback((label: string, address: string, parent: string) => {
    turn.current += 1
    const mine = turn.current
    setState({ kind: 'cloning', label, progress: null })
    const progress = (step: CloneProgress) => { if (turn.current === mine) setState({ kind: 'cloning', label, progress: step }) }
    cloneRepository(LOCAL_MACHINE, address, parent, progress).then(
      (folder) => {
        // The daemon did the clone, so the folder is there whether or not the dialog still looks at it.
        setCloned((now) => new Map(now).set(baseName(folder).toLowerCase(), folder))
        if (turn.current === mine) setState({ kind: 'ready', name: baseName(folder), folder })
      },
      (error: unknown) => { if (turn.current === mine) setState({ kind: 'problem', problem: explainCloneFailure(errorMessage(error, 'The repository could not be cloned')) }) },
    )
  }, [])
  const open = useCallback((folder: string) => {
    turn.current += 1
    setState({ kind: 'ready', name: baseName(folder), folder })
  }, [])
  const reset = useCallback(() => {
    turn.current += 1
    setState(IDLE)
  }, [])
  return { state, cloned, clone, open, reset }
}
