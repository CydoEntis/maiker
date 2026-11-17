import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { LOCAL_MACHINE } from './machines'
import { taggedAnswers } from './taggedAnswers'

const AnswerSchema = z.object({
  machine: z.number().int(),
  tag: z.number().int(),
  answer: z.object({
    repos: z.array(z.object({ path: z.string(), branch: z.string().nullable(), last_used: z.number().int().nonnegative() })),
    indexed_at: z.number().int().nonnegative(),
    more: z.boolean(),
  }),
})

/** A git repository a machine's daemon found. */
export type IndexedRepository = {
  /** The folder, absolute, written with `/`. */
  path: string
  /** The branch it is on (a short commit when detached); null when it could not be read. */
  branch: string | null
  /** When it was last used, in unix seconds; 0 when not known. */
  lastUsed: number
}

/** What a machine's daemon knows of its repositories, most recently used first. */
export type RepositoryList = {
  repos: IndexedRepository[]
  /** When the search that made the list ended, in unix seconds; 0 when none has. */
  indexedAt: number
  /** There are more than were sent, or the search ran out of time before it was done. */
  more: boolean
}

/**
 * How long a machine has to answer. Its daemon gives a search fifteen seconds, and the host waits for
 * that and the time the answer takes to cross.
 */
export const REPOSITORIES_ANSWER_MS = 50_000

const NOT_ANSWERED = 'The machine did not list its repositories in time'
const ask = taggedAnswers('repositories', AnswerSchema)

async function repositories(machine: number, rescan: boolean): Promise<RepositoryList> {
  const send = (tag: number) => invoke('repositories', machine === LOCAL_MACHINE ? { rescan, tag } : { machine, rescan, tag })
  const { answer } = await ask(send, REPOSITORIES_ANSWER_MS, NOT_ANSWERED)
  return {
    repos: answer.repos.map((repo) => ({ path: repo.path, branch: repo.branch, lastUsed: repo.last_used })),
    indexedAt: answer.indexed_at,
    more: answer.more,
  }
}

/**
 * The git repositories a machine's daemon indexed (this computer is machine 0). The daemon answers
 * at once from its list, and waits for its first search when it has made none yet. An offline
 * machine, or a daemon from before the index, rejects with why.
 */
export function listRepositories(machine: number = LOCAL_MACHINE): Promise<RepositoryList> {
  return repositories(machine, false)
}

/** Has a machine's daemon search again, and resolves with the new list when the search ends. */
export function rescanRepositories(machine: number = LOCAL_MACHINE): Promise<RepositoryList> {
  return repositories(machine, true)
}
