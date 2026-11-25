import { z } from 'zod'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { LOCAL_MACHINE } from '@/api/machines'

/**
 * Make a worktree for `branch` next to the repository `term` is in and open a session in it. A
 * branch that already exists is checked out; a new one starts from `base` (null: the current commit).
 * The daemon of `machine`, the pane's own, makes it (this computer's, 0, when absent).
 */
export async function newWorktreeSession(term: number, branch: string, base: string | null, machine: number = LOCAL_MACHINE): Promise<void> {
  if (!isTauri()) throw new Error('Worktrees are only available in the desktop app')
  await invoke('new_worktree_session', { term, branch, base, ...(machine === LOCAL_MACHINE ? {} : { machine }) })
}

const StandingSchema = z.object({
  dirty: z.number().int().nonnegative(),
  branch: z.string().nullable(),
  merged: z.boolean(),
  last_commit: z.string(),
  /** Days with no commit and no file change, once past `worktree.inactive_days`; null otherwise. */
  inactive_days: z.number().int().nonnegative().nullable(),
  missing: z.boolean(),
})

/** Where a worktree stands, as the daemon read it: what removing it would lose. */
export type WorktreeStanding = z.infer<typeof StandingSchema>

/** Where the worktree at `folder` of the repository at `repo` (on `machine`; only this computer's, 0, is answered) stands. */
export async function worktreeStanding(repo: string, folder: string, machine: number): Promise<WorktreeStanding> {
  if (!isTauri()) throw new Error('Worktrees are only available in the desktop app')
  return StandingSchema.parse(await invoke<unknown>('worktree_standing', { machine, repo, folder }))
}

const OverlapSchema = z.array(z.object({ file: z.string(), checkouts: z.array(z.string()) }))

/** The files more than one of these checkouts (name, folder) changed since their branches parted, committed or not. */
export async function worktreeOverlaps(checkouts: readonly { name: string; path: string }[], machine: number): Promise<z.infer<typeof OverlapSchema>> {
  if (!isTauri()) throw new Error('Worktrees are only available in the desktop app')
  return OverlapSchema.parse(await invoke<unknown>('worktree_overlaps', { machine, checkouts: checkouts.map((checkout) => [checkout.name, checkout.path]) }))
}

/** Makes a worktree whose folder was deleted by hand again, on its branch; resolves to a line to show. */
export async function recreateWorktree(main: string, folder: string, branch: string, machine: number): Promise<string> {
  if (!isTauri()) throw new Error('Worktrees are only available in the desktop app')
  return z.string().parse(await invoke<unknown>('worktree_recreate', { machine, main, folder, branch }))
}

/** Merges the worktree's committed work into the main checkout's branch; resolves to a line to show. */
export async function mergeWorktree(folder: string, machine: number): Promise<string> {
  if (!isTauri()) throw new Error('Worktrees are only available in the desktop app')
  return z.string().parse(await invoke<unknown>('worktree_merge', { machine, folder }))
}

const RemovedSchema = z.object({
  removed: z.array(z.string()),
  kept: z.array(z.object({ path: z.string(), why: z.string() })),
}).nullable()

/**
 * How a removal went, by the folders as they were asked for: the ones removed, and each one kept with the daemon's
 * reason. Null from a service too old to say, so the caller looks again.
 */
export type WorktreesRemoved = z.infer<typeof RemovedSchema>

/**
 * Removes worktrees with the daemon, which keeps one something still runs in. `force` goes on when the worktree
 * holds uncommitted changes (they are lost). It resolves once the daemon is done.
 */
export async function removeWorktrees(items: readonly { path: string; force: boolean }[], machine: number): Promise<WorktreesRemoved> {
  if (!isTauri()) throw new Error('Worktrees are only available in the desktop app')
  return RemovedSchema.parse(await invoke<unknown>('remove_worktrees', { machine, items: items.map((item) => [item.path, item.force]) }))
}
