import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { LOCAL_MACHINE } from './machines'
import { taggedAnswers } from './taggedAnswers'

const FolderEntrySchema = z.object({ name: z.string(), git: z.string().nullable(), has_children: z.boolean() })
const FolderListingSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  entries: z.array(FolderEntrySchema),
  truncated: z.boolean(),
  // A service from before folders could be made leaves this out.
  can_create: z.boolean().default(false),
})
const AnswerSchema = z.object({ machine: z.number().int(), tag: z.number().int(), listing: FolderListingSchema })

/** The folders directly inside a folder of a machine. Only folder names, never files. */
export type FolderListing = z.infer<typeof FolderListingSchema>
export type FolderEntry = z.infer<typeof FolderEntrySchema>

/** How long a machine has to answer before the question is given up. */
export const FOLDER_ANSWER_MS = 8000

const ask = taggedAnswers('folder-listing', AnswerSchema)

/**
 * The folders inside `path` on a machine (this computer is machine 0). A path that is not there, or
 * cannot be read, is a listing with `exists` false, not an error; an error is a machine that could
 * not be asked or did not answer.
 */
export async function listFolders(machine: number, path: string): Promise<FolderListing> {
  const send = (tag: number) => invoke('list_folders', machine === LOCAL_MACHINE ? { path, tag } : { machine, path, tag })
  return (await ask(send, FOLDER_ANSWER_MS, 'The machine did not answer in time')).listing
}

const CreatedAnswerSchema = z.object({
  machine: z.number().int(),
  tag: z.number().int(),
  outcome: z.union([
    z.object({ Created: z.object({ path: z.string() }) }),
    z.literal('Exists'),
    z.object({ NotAllowed: z.object({ reason: z.string() }) }),
    z.object({ Failed: z.object({ reason: z.string() }) }),
  ]),
})

/** How the making of a folder ended, in words the dialog can show: every case but `created` says why or what to do. */
export type CreateFolderOutcome =
  | { kind: 'created'; path: string }
  | { kind: 'exists' }
  | { kind: 'not-allowed'; reason: string }
  | { kind: 'failed'; reason: string }

/** How long a machine has to make a folder before the question is given up. */
export const CREATE_FOLDER_ANSWER_MS = 10_000

const askCreate = taggedAnswers('folder-created', CreatedAnswerSchema)

/**
 * Makes the one folder `name` directly inside `parent` on a machine (this computer is machine 0). The machine's daemon
 * checks both again and decides; a refusal is an outcome, and an error is a machine that could not be asked or did not answer.
 */
export async function createFolder(machine: number, parent: string, name: string): Promise<CreateFolderOutcome> {
  const send = (tag: number) => invoke('create_folder', machine === LOCAL_MACHINE ? { parent, name, tag } : { machine, parent, name, tag })
  const { outcome } = await askCreate(send, CREATE_FOLDER_ANSWER_MS, 'The machine did not answer in time. The folder may or may not have been made: look again.')
  if (outcome === 'Exists') return { kind: 'exists' }
  if ('Created' in outcome) return { kind: 'created', path: outcome.Created.path }
  if ('NotAllowed' in outcome) return { kind: 'not-allowed', reason: outcome.NotAllowed.reason }
  return { kind: 'failed', reason: outcome.Failed.reason }
}
