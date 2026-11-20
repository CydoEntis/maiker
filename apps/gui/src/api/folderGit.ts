import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { LOCAL_MACHINE } from './machines'
import { taggedAnswers } from './taggedAnswers'

const BranchSchema = z.object({
  /** A local branch's name, or a remote-tracking branch's with its remote in front (`origin/main`). */
  name: z.string(),
  current: z.boolean(),
  /** Unix seconds of its last commit. */
  when: z.number().nullable(),
  /** A remote-tracking branch: what was last fetched, not a branch to commit to. */
  remote: z.boolean(),
})
const WorktreeSchema = z.object({ path: z.string(), branch: z.string().nullable(), main: z.boolean(), when: z.number().nullable() })
const ListingSchema = z.object({
  current: z.string().nullable(),
  branches: z.array(BranchSchema),
  worktrees: z.array(WorktreeSchema),
})
const AnswerSchema = z.object({
  machine: z.number().int(),
  tag: z.number().int(),
  state: z.enum(['branches', 'not-a-repo', 'switched', 'failed']),
  why: z.string().nullable(),
  listing: ListingSchema.nullable(),
  branch: z.string().nullable(),
})

export type FolderBranch = z.infer<typeof BranchSchema>
/** A folder's branches and worktrees: local branches first, then remote-tracking ones, each newest first. */
export type FolderBranchList = z.infer<typeof ListingSchema>

/**
 * How long a machine has to answer. Its daemon gives git fifteen seconds for each of the two commands a checkout
 * of a remote branch runs, and the answer has to cross.
 */
export const FOLDER_GIT_ANSWER_MS = 60_000

const ask = taggedAnswers('folder-git', AnswerSchema)

type Request = 'Branches' | { Switch: { branch: string } } | { Create: { branch: string } } | { CheckoutRemote: { remote_branch: string } }

async function askFolder(machine: number, folder: string, request: Request) {
  const send = (tag: number) => invoke('folder_git', machine === LOCAL_MACHINE ? { folder, request, tag } : { machine, folder, request, tag })
  const answer = await ask(send, FOLDER_GIT_ANSWER_MS, 'The machine did not answer in time')
  if (answer.state === 'failed') throw new Error(answer.why ?? 'Git could not do that')
  return answer
}

async function branchSwitched(machine: number, folder: string, request: Request): Promise<string> {
  const answer = await askFolder(machine, folder, request)
  if (answer.state !== 'switched' || answer.branch === null) throw new Error('The machine gave an answer this app does not understand')
  return answer.branch
}

/**
 * A folder's local and remote-tracking branches and its worktrees, on a machine (this computer is machine 0), asked
 * of that machine's own daemon. Null when the folder is not in a git repository. Rejects with the machine's own
 * reason when it could not be read (no such folder, git missing) and when a service older than protocol 119 never
 * answers.
 */
export async function loadFolderBranches(machine: number, folder: string): Promise<FolderBranchList | null> {
  const answer = await askFolder(machine, folder, 'Branches')
  return answer.state === 'branches' ? answer.listing : null
}

/** Switches the folder's checkout to an existing local branch and gives its name. Rejects with git's own reason. */
export function switchFolderBranch(machine: number, folder: string, branch: string): Promise<string> {
  return branchSwitched(machine, folder, { Switch: { branch } })
}

/** Makes a branch from where the checkout is, switches to it and gives its name. */
export function createFolderBranch(machine: number, folder: string, branch: string): Promise<string> {
  return branchSwitched(machine, folder, { Create: { branch } })
}

/**
 * Checks out a remote-tracking branch as given in the list (`origin/feature`): a local branch of the same name without
 * the remote (`feature`) is made, follows it, and its name is given. Rejects when that local name is taken.
 */
export function checkoutRemoteBranch(machine: number, folder: string, remoteBranch: string): Promise<string> {
  return branchSwitched(machine, folder, { CheckoutRemote: { remote_branch: remoteBranch } })
}

/** The branches of a listing that can be committed to. */
export function localBranches(list: FolderBranchList): FolderBranch[] {
  return list.branches.filter((branch) => !branch.remote)
}

/** The remote-tracking branches of a listing that no local branch follows by name yet: the ones worth offering to check out. */
export function untrackedRemoteBranches(list: FolderBranchList): FolderBranch[] {
  const local = new Set(localBranches(list).map((branch) => branch.name))
  return list.branches.filter((branch) => branch.remote && !local.has(localNameOf(branch.name)))
}

/** `feature` for `origin/feature`: the name the local branch gets when a remote one is checked out. */
export function localNameOf(remoteBranch: string): string {
  return remoteBranch.slice(remoteBranch.indexOf('/') + 1)
}
