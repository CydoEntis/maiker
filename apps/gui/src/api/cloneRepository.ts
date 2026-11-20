import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { z } from 'zod'
import { LOCAL_MACHINE } from './machines'
import { taggedAnswers } from './taggedAnswers'

// One of `folder` and `refused` is set: where the clone is, or why there is none.
const AnswerSchema = z.object({
  machine: z.number().int(),
  tag: z.number().int(),
  folder: z.string().nullable(),
  refused: z.string().nullable(),
})

/** The parts of a clone, in the order git does them. `checking-out` is writing the files, at the very end. */
export const CLONE_PHASES = ['counting', 'compressing', 'receiving', 'resolving', 'checking-out'] as const
export type ClonePhase = (typeof CLONE_PHASES)[number]

/** How far a clone has got: `percent` (0 to 100) is of `phase`, not of the whole clone. */
export type CloneProgress = { readonly phase: ClonePhase; readonly percent: number }

const MOST_PERCENT = 100

const ProgressSchema = z.object({
  machine: z.number().int(),
  tag: z.number().int(),
  phase: z.enum(CLONE_PHASES),
  percent: z.number().int().min(0).max(MOST_PERCENT),
})

const PROGRESS_EVENT = 'clone-progress'

/**
 * How long a machine has to say how a clone ended. The daemon stops a clone after ten minutes
 * (`CLONE_LIMIT_SECS`) and the host waits half a minute more for the answer to cross: eleven
 * minutes here covers both.
 */
export const CLONE_ANSWER_MS = 660_000

const ask = taggedAnswers('repository-cloned', AnswerSchema)

/**
 * Clones the repository at `address` into a new folder inside `parent` on a machine (this computer
 * is machine 0) and gives the new folder's path. It rejects with the machine's own reason when
 * nothing was cloned: an address it will not clone, a folder already there, a failed sign-in.
 *
 * `onProgress` hears each step git reports while it works, from a machine whose service is new
 * enough to send them; from an older one it is never called and the clone still ends as always.
 */
export async function cloneRepository(machine: number, address: string, parent: string, onProgress?: (progress: CloneProgress) => void): Promise<string> {
  let stopListening: (() => void) | undefined
  const send = async (tag: number) => {
    if (onProgress !== undefined) {
      stopListening = await listen<unknown>(PROGRESS_EVENT, (told) => {
        const step = ProgressSchema.safeParse(told.payload)
        if (step.success && step.data.tag === tag && step.data.machine === machine) onProgress({ phase: step.data.phase, percent: step.data.percent })
      })
    }
    await invoke('clone_repository', machine === LOCAL_MACHINE ? { address, parent, tag } : { machine, address, parent, tag })
  }
  try {
    const answer = await ask(send, CLONE_ANSWER_MS, 'The machine did not say how the clone ended')
    if (answer.folder !== null) return answer.folder
    throw new Error(answer.refused ?? 'The repository was not cloned')
  } finally {
    stopListening?.()
  }
}
