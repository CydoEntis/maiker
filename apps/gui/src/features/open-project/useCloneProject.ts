import { useCallback, useEffect, useRef, useState } from 'react'
import { cloneRepository, type ClonePhase, type CloneProgress } from '@/api/cloneRepository'
import { errorMessage } from '@/lib/error-message'
import { explainCloneFailure, type CloneProblem } from '@/features/workspace/model/repoAddress'

/** Where the palette's one clone stands: none, running, or not made. A clone that ends well is handed on at once. */
export type CloneState =
  | { kind: 'idle' }
  | { kind: 'cloning'; label: string; machine: number; target: string; progress: CloneProgress | null }
  | { kind: 'problem'; machine: number; problem: CloneProblem }

const IDLE: CloneState = { kind: 'idle' }

/** What git is doing, in the words a person would use. */
export const PHASE_WORDS: Readonly<Record<ClonePhase, string>> = {
  counting: 'Counting objects',
  compressing: 'Compressing',
  receiving: 'Receiving',
  resolving: 'Resolving deltas',
  'checking-out': 'Writing files',
}

export type CloneRequest = { machine: number; label: string; address: string; parent: string; target: string }

/**
 * The palette's clone: `clone` has a machine's daemon clone into `parent` there and follows its progress, then gives
 * the new folder to `onCloned`; `reset` forgets a refusal. A clone left behind (the palette gone) is not reported on,
 * though the daemon still finishes it.
 */
export function useCloneProject(onCloned: (machine: number, folder: string) => void): { state: CloneState; clone: (request: CloneRequest) => void; reset: () => void } {
  const [state, setState] = useState<CloneState>(IDLE)
  const turn = useRef(0)
  const done = useRef(onCloned)
  useEffect(() => { done.current = onCloned }, [onCloned])
  useEffect(() => () => { turn.current += 1 }, [])

  const clone = useCallback(({ machine, label, address, parent, target }: CloneRequest) => {
    turn.current += 1
    const mine = turn.current
    setState({ kind: 'cloning', label, machine, target, progress: null })
    const progress = (step: CloneProgress) => { if (turn.current === mine) setState({ kind: 'cloning', label, machine, target, progress: step }) }
    cloneRepository(machine, address, parent, progress).then(
      (folder) => {
        if (turn.current !== mine) return
        setState(IDLE)
        done.current(machine, folder)
      },
      (error: unknown) => { if (turn.current === mine) setState({ kind: 'problem', machine, problem: explainCloneFailure(errorMessage(error, 'The repository could not be cloned')) }) },
    )
  }, [])
  const reset = useCallback(() => {
    turn.current += 1
    setState(IDLE)
  }, [])
  return { state, clone, reset }
}
