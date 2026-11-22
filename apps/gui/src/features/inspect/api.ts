import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'
import { LOCAL_MACHINE } from '@/api/machines'

const Count = z.number().int().nonnegative()

const ChangeKindSchema = z.enum(['Added', 'Modified', 'Deleted', 'Renamed', 'Untracked', 'Conflicted'])
const StatusSchema = z.object({
  branch: z.string().nullable(),
  ahead: Count,
  behind: Count,
  files: z.array(z.object({ path: z.string(), kind: ChangeKindSchema })),
})
const EntrySchema = z.object({ name: z.string(), is_directory: z.boolean() })
const DiffSchema = z.object({
  files: z.array(z.object({ path: z.string(), additions: Count, deletions: Count, patch: z.string(), binary: z.boolean() })),
  additions: Count,
  deletions: Count,
  total_files: Count,
  truncated: z.boolean(),
})
const BranchSchema = z.object({ name: z.string(), current: z.boolean() })
const WorktreeSchema = z.object({ path: z.string(), branch: z.string(), main: z.boolean(), repo: z.string() })
const SnapshotSchema = z.object({ commit: z.string(), at: Count, why: z.string() })
const ReferenceSchema = z.object({ name: z.string(), kind: z.string(), bytes: Count, modified: Count })
const FoundFilesSchema = z.object({ paths: z.array(z.string()), truncated: z.boolean() })

export type RepoStatus = z.infer<typeof StatusSchema>
export type RepoChangeKind = z.infer<typeof ChangeKindSchema>
export type RepoEntry = z.infer<typeof EntrySchema>
export type RepoDiff = z.infer<typeof DiffSchema>
export type RepoBranch = z.infer<typeof BranchSchema>
export type RepoWorktree = z.infer<typeof WorktreeSchema>
export type RepoSnapshot = z.infer<typeof SnapshotSchema>
export type RepoReference = z.infer<typeof ReferenceSchema>

const HighlightSchema = z.array(z.array(z.object({ text: z.string(), kind: z.enum(['plain', 'comment', 'string', 'number', 'keyword', 'variable']) }))).nullable()
export type HighlightedLines = z.infer<typeof HighlightSchema>

/** The file's lines split into colour roles by the shared highlighter, or null when its type has no grammar. */
export async function highlightFile(path: string, text: string): Promise<HighlightedLines> {
  return HighlightSchema.parse(await invoke('highlight_file', { path, text }))
}

/**
 * Ask the daemon that owns pane `term` about the repository it is in: this computer's, or machine
 * `machine`'s. It answers `{ <Kind>: payload }`; a different kind is a bug.
 */
async function ask<T>(term: number, question: unknown, kind: string, payload: z.ZodType<T>, machine: number = LOCAL_MACHINE): Promise<T> {
  if (!isTauri()) throw new Error('Repository details are only available in the desktop app')
  const reply = z.record(z.string(), z.unknown()).parse(await invoke<unknown>('repo_query', { ...(machine === LOCAL_MACHINE ? {} : { machine }), term, question }))
  if (!(kind in reply)) throw new Error('The Maiker service answered a different question')
  return payload.parse(reply[kind])
}

// What changed, its diff, a folder's listing and a markdown document are what another machine's daemon is asked (ADR 0014); the rest are this computer's.
export const repoStatus = (term: number, machine: number = LOCAL_MACHINE) => ask(term, 'Status', 'Status', StatusSchema, machine)
export const repoTree = (term: number, path: string | null, machine: number = LOCAL_MACHINE) => ask(term, { Tree: { path } }, 'Tree', z.array(EntrySchema), machine)
export const repoLocate = (term: number, path: string) => ask(term, { Locate: { path } }, 'Located', z.string())
export const repoFile = (term: number, path: string) => ask(term, { File: { path } }, 'File', z.string())
/**
 * A text file and its version (opaque; equal for equal bytes), which a later `saveProjectFile` names to notice a change made meanwhile.
 * Another machine's daemon answers for a markdown document only; an empty version there means its text was changed to be shown safely, so it is not to be saved.
 */
export const repoFileStamped = (term: number, path: string, machine: number = LOCAL_MACHINE) =>
  ask(term, { FileStamped: { path } }, 'FileStamped', z.object({ text: z.string(), version: z.string() }), machine)
export const repoDiff = (term: number, path: string | null = null, machine: number = LOCAL_MACHINE) => ask(term, { Diff: { path } }, 'Diff', DiffSchema, machine)
export const repoDiffRange = (term: number, from: string, to: string, path: string | null = null) =>
  ask(term, { DiffRange: { from, to, path } }, 'Diff', DiffSchema)
export const repoBranches = (term: number) => ask(term, 'Branches', 'Branches', z.array(BranchSchema))
export const repoWorktrees = (term: number) => ask(term, 'Worktrees', 'Worktrees', z.array(WorktreeSchema))
export const repoSnapshots = (term: number) => ask(term, 'Snapshots', 'Snapshots', z.array(SnapshotSchema))
export const repoReferences = (term: number) => ask(term, 'References', 'References', z.array(ReferenceSchema))
/** Files whose path holds `query`, best first, relative to the checkout's top; `truncated` when the daemon stopped looking early. */
export const repoFindFiles = (term: number, query: string, limit: number) =>
  ask(term, { FindFiles: { query, limit } }, 'Files', FoundFilesSchema)

/** Put the pane's checkout back as it was in one of the daemon's snapshots; resolves to how many files changed. */
export async function restoreSnapshot(term: number, commit: string): Promise<number> {
  if (!isTauri()) throw new Error('Restoring is only available in the desktop app')
  return Count.parse(await invoke<unknown>('restore_snapshot', { term, commit }))
}

/** How many files restoring one of the daemon's snapshots would change now; nothing is changed. */
export async function restoreCount(term: number, commit: string): Promise<number> {
  if (!isTauri()) throw new Error('Restoring is only available in the desktop app')
  return Count.parse(await invoke<unknown>('snapshot_restore_count', { term, commit }))
}

/** What names a checkout on another machine: the pane there that is in it. Nothing on this computer, whose checkout is named by its folder. */
const paneArg = (term: number | undefined): { term?: number } => (term === undefined ? {} : { term })

/**
 * Stages and commits changes, all of them or only `paths`; resolves to the commit's short hash.
 * On this computer the checkout is the one at `folder`; on another machine, the one pane `term` there is in.
 */
export async function commitAll(folder: string, message: string, machine: number, paths?: readonly string[], term?: number): Promise<string> {
  if (!isTauri()) throw new Error('Committing is only available in the desktop app')
  return z.string().parse(await invoke<unknown>('git_commit_all', { machine, folder, message, paths: paths ?? null, ...paneArg(term) }))
}

/**
 * Discards the uncommitted changes of one file, `path` from the top of the repository: a changed or deleted file goes
 * back to the last commit, a new one is removed for good. On this computer the checkout is the one at `folder`; on
 * another machine, the one pane `term` there is in. Rejects with one line saying why nothing was discarded.
 */
export async function discardFile(folder: string, path: string, machine: number, term?: number): Promise<void> {
  if (!isTauri()) throw new Error('Discarding is only available in the desktop app')
  await invoke('git_discard_file', { machine, folder, path, ...paneArg(term) })
}

/** Saves the text of an existing file of the checkout `term` is in; the daemon refuses anything but a plain file inside it. */
export async function writeProjectFile(term: number, machine: number, path: string, contents: string): Promise<void> {
  if (!isTauri()) throw new Error('Editing is only available in the desktop app')
  await invoke('write_project_file', { machine, term, path, contents })
}

const SavedSchema = z.union([z.literal('ChangedOnDisk'), z.object({ Saved: z.object({ version: z.string() }) })])
export type SaveResult = { readonly kind: 'saved'; readonly version: string } | { readonly kind: 'changed' }

/**
 * Saves `contents` over an existing file when it is still `version` (null: whatever is there, only after the person
 * chose to overwrite). A file changed meanwhile is the `changed` result, with nothing written.
 */
export async function saveProjectFile(term: number, machine: number, path: string, contents: string, version: string | null): Promise<SaveResult> {
  if (!isTauri()) throw new Error('Editing is only available in the desktop app')
  const reply = SavedSchema.parse(await invoke<unknown>('save_project_file', { machine, term, path, contents, version }))
  return reply === 'ChangedOnDisk' ? { kind: 'changed' } : { kind: 'saved', version: reply.Saved.version }
}

/** What the daemon's refusal says when the running service is older than this app (it cannot save with a version check). */
export const OLDER_SERVICE_WORDS = 'older than this app'

/** What the remote button can do for a checkout. */
export type SyncAction = 'fetch' | 'pull' | 'push'

/**
 * Fetches, pulls (fast-forward only) or pushes a checkout; resolves to a line to show. On this
 * computer it is the one at `folder`; on another machine, the one pane `term` there is in.
 */
export async function syncRemote(folder: string, action: SyncAction, machine: number, term?: number): Promise<string> {
  if (!isTauri()) throw new Error('Syncing is only available in the desktop app')
  return z.string().parse(await invoke<unknown>('git_sync', { machine, folder, action, ...paneArg(term) }))
}

/** Pushes the checkout's branch and opens a pull request for it, with the GitHub sign-in of the machine the checkout is on; resolves to the pull request's address. */
export async function createPullRequest(folder: string, machine: number, term?: number): Promise<string> {
  if (!isTauri()) throw new Error('Pull requests are only available in the desktop app')
  return z.string().parse(await invoke<unknown>('git_create_pull_request', { machine, folder, ...paneArg(term) }))
}
